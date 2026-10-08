import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {googleAI} from "@genkit-ai/google-genai";
import {ai} from "../ai/genkit";
import {db} from "../config/firebase";
import {assertAgencyTeamForLinkedInOs} from "./access";
import {
  formatBrandStrategyForPrompt,
  isPrismChannel,
  PRISM_CHANNEL_FORMATS,
  PRISM_CHANNEL_LABELS,
  PRISM_CHANNELS,
  PRISM_MAX_POSTS_PER_WEEK,
  requirePrismBrandStrategy,
} from "./brandStrategy";
import {ISO_DATE, todayIn, weekDates} from "./channelFormats";
import type {
  LinkedInOsJobItem,
  LinkedInOsVoiceProfile,
  PrismBrandStrategy,
  PrismChannel,
  PrismFormat,
} from "./types";
import {PRISM_AI_COST, withPrismUsage} from "./billing";
import {findCatalogItem, formatCatalogForPrompt, loadPrismCatalog, type PrismCatalogItem} from "./products";

const MODEL = "gemini-3.6-flash";
const MAX_BRIEF = 6000;
const CTAS = new Set(["follow", "comment", "soft_product", "hard_product"]);

/**
 * Truncates text.
 * @param {string} s Input.
 * @param {number} max Max.
 * @return {string} Truncated.
 */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n\n[truncated…]";
}

/**
 * Formats a stored voice profile for the planner prompt.
 * @param {LinkedInOsVoiceProfile | null} profile Voice profile.
 * @return {string} Prompt block.
 */
function formatVoice(profile: LinkedInOsVoiceProfile | null): string {
  if (!profile?.voiceSummary) {
    return "(no voice profile yet — plan with a clear, concrete, no-hype voice)";
  }
  return [
    profile.voiceSummary,
    `Tone: ${(profile.toneTraits || []).join(", ") || "n/a"}`,
    `Hooks: ${(profile.hookPatterns || []).join("; ") || "n/a"}`,
    `Topics that work: ${(profile.topicsThatWork || []).join("; ") || "n/a"}`,
    `Avoid: ${(profile.topicsToAvoid || []).join("; ") || "n/a"}`,
    `CTA style: ${profile.ctaStyle || "n/a"}`,
    `Do: ${(profile.doList || []).join("; ") || "n/a"}`,
    `Don't: ${(profile.dontList || []).join("; ") || "n/a"}`,
  ].join("\n");
}

/**
 * Monday of the week containing a date.
 * @param {string} date YYYY-MM-DD.
 * @return {string} YYYY-MM-DD.
 */
function mondayOf(date: string): string {
  const ts = Date.parse(`${date}T00:00:00Z`);
  const back = (new Date(ts).getUTCDay() + 6) % 7;
  return new Date(ts - back * 86400000).toISOString().slice(0, 10);
}

/**
 * Weekday name for a date.
 * @param {string} date YYYY-MM-DD.
 * @return {string} e.g. "Tuesday".
 */
function weekdayName(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {weekday: "long", timeZone: "UTC"});
}

/**
 * Splits the weekly post budget across channels, capped at the per-week max.
 * @param {PrismBrandStrategy} s Brand setup.
 * @param {!Array<PrismChannel>} channels Channels to plan.
 * @return {Record<string, number>} Posts per channel.
 */
export function planSlots(s: PrismBrandStrategy, channels: PrismChannel[]): Partial<Record<PrismChannel, number>> {
  const wanted = channels.map((ch) => ({ch, n: Math.max(1, s.channels[ch].postsPerWeek)}));
  const total = wanted.reduce((sum, w) => sum + w.n, 0);
  const out: Partial<Record<PrismChannel, number>> = {};
  if (total <= PRISM_MAX_POSTS_PER_WEEK) {
    for (const w of wanted) out[w.ch] = w.n;
    return out;
  }
  let left = PRISM_MAX_POSTS_PER_WEEK;
  for (const w of wanted) {
    const n = Math.max(1, Math.floor((w.n / total) * PRISM_MAX_POSTS_PER_WEEK));
    out[w.ch] = n;
    left -= n;
  }
  for (const w of [...wanted].sort((a, b) => b.n - a.n)) {
    if (left <= 0) break;
    out[w.ch] = (out[w.ch] ?? 0) + 1;
    left--;
  }
  return out;
}

/**
 * Normalizes one plan item from the model.
 * @param {Record<string, unknown>} raw Raw object.
 * @param {number} index Index for fallback id.
 * @param {PrismBrandStrategy} s Brand setup (valid pillars and channels).
 * @param {!Array<PrismChannel>} channels Channels being planned.
 * @param {!Array<string>} dates Dates the item may land on.
 * @param {!Array<PrismCatalogItem>} catalog Brand kit products the item may feature.
 * @return {LinkedInOsJobItem} Item.
 */
function normalizeItem(
  raw: Record<string, unknown>,
  index: number,
  s: PrismBrandStrategy,
  channels: PrismChannel[],
  dates: string[],
  catalog: PrismCatalogItem[] = []
): LinkedInOsJobItem {
  const channel: PrismChannel = isPrismChannel(raw.channel) && channels.includes(raw.channel) ?
    raw.channel :
    channels[index % channels.length];
  const formats = PRISM_CHANNEL_FORMATS[channel];
  const format = formats.includes(raw.format as PrismFormat) ? (raw.format as PrismFormat) : formats[0];
  const pillarIds = s.pillars.map((p) => p.id);
  const pillarRaw = typeof raw.pillar === "string" ? raw.pillar.trim() : "";
  const pillar = pillarIds.includes(pillarRaw) ? pillarRaw : pillarIds[index % pillarIds.length];
  const id = typeof raw.id === "string" && raw.id.trim() ?
    raw.id.trim().slice(0, 64) :
    `${channel}-${index + 1}`;
  const ctaRaw = typeof raw.cta === "string" ? raw.cta.trim() : "comment";
  const notes = typeof raw.notes === "string" ? raw.notes.trim().slice(0, 400) : "";
  const date = typeof raw.date === "string" && dates.includes(raw.date) ? raw.date : dates[index % dates.length];
  const idea = typeof raw.idea === "string" ? raw.idea.trim().slice(0, 160) : "";
  const product = findCatalogItem(catalog, raw.product);
  return {
    id,
    channel,
    pillar,
    format,
    date,
    ...(idea ? {idea} : {}),
    hook: typeof raw.hook === "string" ? raw.hook.trim().slice(0, 280) : "",
    productTruth: typeof raw.productTruth === "string" ? raw.productTruth.trim().slice(0, 500) : "",
    cta: CTAS.has(ctaRaw) ? ctaRaw : "comment",
    ...(notes ? {notes} : {}),
    ...(product ? {product: product.name} : {}),
  };
}

/**
 * Generates a weekly multi-channel content plan (queue items) from the brand setup and voice.
 * @return {!Promise<{items: LinkedInOsJobItem[], rationale: string}>} Plan.
 */
export const generateLinkedInOsWeeklyPlan = onCall(
  {timeoutSeconds: 120},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to generate a weekly plan.");
    }
    const uid = request.auth.uid;
    const agencyId = await assertAgencyTeamForLinkedInOs(uid);
    const strategy = await requirePrismBrandStrategy(agencyId);

    const tz = strategy.timezone || "America/New_York";
    const today = todayIn(tz);
    const weekStart = typeof request.data?.weekStart === "string" && ISO_DATE.test(request.data.weekStart) ?
      request.data.weekStart :
      mondayOf(today);
    const dates = weekDates(weekStart).filter((d) => d >= today);
    if (dates.length === 0) {
      throw new HttpsError("invalid-argument", "That week is already over. Pick this week or a later one.");
    }
    const weekLabel =
      typeof request.data?.weekLabel === "string" && request.data.weekLabel.trim() ?
        request.data.weekLabel.trim().slice(0, 40) :
        `week of ${weekStart}`;
    const weeklyBrief =
      typeof request.data?.weeklyBrief === "string" ?
        truncate(request.data.weeklyBrief.trim(), MAX_BRIEF) :
        "";
    const mustMention =
      typeof request.data?.mustMention === "string" ?
        request.data.mustMention.trim().slice(0, 500) :
        "";
    const neverMention =
      typeof request.data?.neverMention === "string" ?
        request.data.neverMention.trim().slice(0, 500) :
        "";

    const requested = Array.isArray(request.data?.channels) ?
      (request.data.channels as unknown[]).filter(isPrismChannel) :
      [];
    const enabled = PRISM_CHANNELS.filter((ch) => strategy.channels[ch].enabled);
    const channels = requested.length > 0 ? requested.filter((ch) => enabled.includes(ch)) : enabled;
    if (channels.length === 0) {
      throw new HttpsError("failed-precondition", "Turn on at least one channel in your brand setup.");
    }
    const slots = planSlots(strategy, channels);
    const total = channels.reduce((sum, ch) => sum + (slots[ch] ?? 0), 0);
    const slotLines = channels
      .map((ch) => `- ${ch}: ${slots[ch]} post(s); formats: ${PRISM_CHANNEL_FORMATS[ch].join(" | ")}`)
      .join("\n");

    const [voiceSnap, catalog] = await Promise.all([
      db.collection("linkedin_os_voice_profiles").doc(agencyId).get(),
      loadPrismCatalog(agencyId),
    ]);
    const catalogBlock = formatCatalogForPrompt(catalog);
    const voice = voiceSnap.exists ? (voiceSnap.data() as LinkedInOsVoiceProfile) : null;

    const {text} = await withPrismUsage(agencyId, {ai: PRISM_AI_COST.weeklyPlan}, () => ai.generate({
      model: googleAI.model(MODEL),
      prompt: `You are the social media manager for ${strategy.brandName}.
Plan ${weekLabel}: exactly ${total} posts across these channels:
${slotLines}

Days you can post on (timezone ${tz}):
${dates.map((d) => `- ${d} (${weekdayName(d)})`).join("\n")}
Spread posts across these days; avoid stacking the same channel on one day.

Think like a strategist:
- Each channel has a job (see CHANNELS). Native formats only — a TikTok is a video, an X post is short and punchy,
  LinkedIn is for insight and proof, Instagram is visual.
- Balance pillars by their target share across the week.
- Reuse one strong idea across channels when it fits, but adapt the angle to each channel. Items that share an idea
  must use the exact same "idea" text and the same date — they become one calendar post with a version per channel.

${formatBrandStrategyForPrompt(strategy)}
${catalogBlock ?
    `\n${catalogBlock}\nFeature catalog products where they fit (launches, how-tos, proof). Not every post sells.\n` :
    ""}
VOICE PROFILE:
---
${formatVoice(voice)}
---

WEEKLY BRIEF:
---
${weeklyBrief || "(none — use evergreen angles from the brief)"}
---

CONSTRAINTS:
- Must mention/reflect: ${mustMention || "(none)"}
- Never mention: ${neverMention || "(none)"}
- Banned claims:
${strategy.bannedClaims || "(none)"}

Return ONLY valid JSON (no fences):
{
  "rationale": "1–2 sentences on the week's angle",
  "items": [
    {
      "id": "tue-linkedin-proof",
      "idea": "short, specific idea title (identical across items that share the idea)",
      "date": "one of the days above (YYYY-MM-DD)",
      "channel": "${channels.join("|")}",
      "pillar": "${strategy.pillars.map((p) => p.id).join("|")}",
      "format": "one of that channel's formats",
      "hook": "suggested first line / opening seconds",
      "productTruth": "one factual sentence the human can stand behind (no invented metrics)",
      "cta": "follow|comment|soft_product|hard_product",
      "notes": "optional planner note (visual idea, angle)"${catalog.length ? `,
      "product": "exact CATALOG name this post features, or empty"` : ""}
    }
  ]
}

Use stable ids like mon-x-*, tue-linkedin-*, wed-instagram-*.
Do not invent fees, user counts, or legal claims.
`,
    }));

    if (!text?.trim()) {
      throw new HttpsError("internal", "Weekly plan returned empty text.");
    }

    let rationale = "";
    let rawItems: Record<string, unknown>[] = [];
    try {
      const fence = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/i);
      const raw = fence ? fence[1].trim() : text.trim();
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
        rationale = typeof obj.rationale === "string" ? obj.rationale.trim() : "";
        if (Array.isArray(obj.items)) {
          rawItems = obj.items as Record<string, unknown>[];
        }
      }
    } catch {
      throw new HttpsError("internal", "Weekly plan JSON was invalid.");
    }

    if (rawItems.length === 0) {
      throw new HttpsError("internal", "Weekly plan had no items.");
    }

    const seen = new Set<string>();
    const items = rawItems.slice(0, PRISM_MAX_POSTS_PER_WEEK).map((row, i) => {
      const item = normalizeItem(row, i, strategy, channels, dates, catalog);
      if (seen.has(item.id)) item.id = `${item.id}-${i + 1}`;
      seen.add(item.id);
      return item;
    });

    logger.info("[Prism] Weekly plan generated", {
      agencyId,
      itemCount: items.length,
      channels: channels.map((ch) => PRISM_CHANNEL_LABELS[ch]),
      createdBy: uid,
    });

    return {items, rationale, weekLabel, weekStart};
  }
);
