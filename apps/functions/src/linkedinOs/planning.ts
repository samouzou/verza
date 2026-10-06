import {FieldValue} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {googleAI} from "@genkit-ai/google-genai";
import {ai} from "../ai/genkit";
import {db} from "../config/firebase";
import {
  formatBrandStrategyForPrompt,
  isPrismChannel,
  PRISM_CHANNEL_FORMATS,
  PRISM_CHANNEL_LABELS,
  PRISM_CHANNELS,
  requirePrismBrandStrategy,
} from "./brandStrategy";
import {
  formatInstructions,
  PRISM_DEFAULT_TIMES,
  PRISM_MAX_VARIANT_CHARS,
  todayIn,
  zonedToUtcIso,
} from "./channelFormats";
import {appendHistory, loadPrismPost, PRISM_POSTS, prismCaller, prismEvent} from "./posts";
import {PRISM_AI_COST, withPrismUsage} from "./billing";
import type {
  LinkedInOsVoiceProfile,
  PrismBrandStrategy,
  PrismChannel,
  PrismFormat,
  PrismPost,
  PrismPostStatus,
  PrismVariant,
} from "./types";

const MODEL = "gemini-3.6-flash";
const MAX_PLAN_IDEAS = 40;

/**
 * Formats the learned voice for prompts.
 * @param {string} agencyId Agency id.
 * @return {!Promise<string>} Voice block.
 */
async function voiceBlock(agencyId: string): Promise<string> {
  const snap = await db.collection("linkedin_os_voice_profiles").doc(agencyId).get();
  const v = snap.exists ? (snap.data() as LinkedInOsVoiceProfile) : null;
  if (!v?.voiceSummary) return "(no voice profile — concrete, respectful, no hype)";
  return [
    v.voiceSummary,
    `Tone: ${(v.toneTraits || []).join(", ")}`,
    `Hooks: ${(v.hookPatterns || []).join("; ")}`,
    `CTA style: ${v.ctaStyle || "n/a"}`,
    `Do: ${(v.doList || []).join("; ")}`,
    `Don't: ${(v.dontList || []).join("; ")}`,
  ].join("\n");
}

/**
 * Shared system rules for anything Prism writes.
 * @param {PrismBrandStrategy} s Brand setup.
 * @param {string} voice Voice block.
 * @return {string} Prompt preamble.
 */
function writerPreamble(s: PrismBrandStrategy, voice: string): string {
  return `You are the social media manager for ${s.brandName}.

RULES:
- Use only facts in the BRAND SETUP and the idea. Never invent metrics, customers, prices, or features.
- Write natively for each channel. Never paste the same copy across channels.
- Never guarantee income, ROI, or virality. No legal/tax advice.
- Banned claims (never say or imply):
${s.bannedClaims || "(none)"}

${formatBrandStrategyForPrompt(s)}

VOICE:
${voice}`;
}

/**
 * Extracts the first JSON object from model text.
 * @param {string} text Model output.
 * @return {Record<string, unknown>} Parsed object.
 */
function parseJsonObject(text: string): Record<string, unknown> {
  const fence = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1].trim() : text.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new HttpsError("internal", "The plan came back without JSON.");
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new HttpsError("internal", "The plan JSON was invalid.");
  }
}

/**
 * Writes native copy for each selected channel of a post from its idea.
 * @return {!Promise<{postId: string, channels: string[]}>} Result.
 */
export const adaptPrismPost = onCall({timeoutSeconds: 120}, async (request) => {
  const c = await prismCaller(request.auth?.uid);
  const {ref, post, postId} = await loadPrismPost(c, request.data?.postId);
  if (post.status === "posted") {
    throw new HttpsError("failed-precondition", "This post is already marked posted.");
  }
  const strategy = await requirePrismBrandStrategy(c.agencyId);
  const requested = Array.isArray(request.data?.channels) ?
    (request.data.channels as unknown[]).filter(isPrismChannel) :
    [];
  const channels = requested.length ? post.channels.filter((ch) => requested.includes(ch)) : post.channels;
  if (channels.length === 0) throw new HttpsError("invalid-argument", "Pick at least one channel.");
  const instruction = typeof request.data?.instruction === "string" ?
    request.data.instruction.trim().slice(0, 500) :
    "";

  const preamble = writerPreamble(strategy, await voiceBlock(c.agencyId));
  const pillar = strategy.pillars.find((p) => p.id === post.pillar);
  const now = new Date().toISOString();

  const results = await withPrismUsage(c.agencyId, {ai: channels.length}, () => Promise.all(
    channels.map(async (ch) => {
      const formats = PRISM_CHANNEL_FORMATS[ch];
      const current = post.variants?.[ch];
      const format = current && formats.includes(current.format) ? current.format : formats[0];
      const {text} = await ai.generate({
        model: googleAI.model(MODEL),
        config: {temperature: 0.7},
        prompt: `${preamble}

IDEA: ${post.title}
ANGLE / NOTES: ${post.angle || "(none)"}
PILLAR: ${pillar ? `${pillar.label} — ${pillar.description}` : post.pillar}
CHANNEL: ${PRISM_CHANNEL_LABELS[ch]} (role: ${strategy.channels[ch].role || "not specified"})
${current?.text && instruction ? `CURRENT DRAFT:\n${current.text}\n` : ""}${
  instruction ? `EDITOR'S REQUEST: ${instruction}\n` : ""
}
Write: ${formatInstructions(format)}

Output only the deliverable, no preamble.`,
      });
      const body = (text ?? "").trim().slice(0, PRISM_MAX_VARIANT_CHARS);
      if (!body) throw new HttpsError("internal", `No copy came back for ${PRISM_CHANNEL_LABELS[ch]}.`);
      return {ch, variant: {...(current ?? {}), format, text: body, generatedAt: now} as PrismVariant};
    })
  ));

  const variants = {...(post.variants ?? {})};
  for (const r of results) variants[r.ch] = r.variant;
  let status: PrismPostStatus = post.status;
  if (status === "idea" || status === "approved" || status === "in_review") status = "draft";

  await ref.update({
    variants,
    status,
    history: appendHistory(
      post.history,
      prismEvent(c, `AI wrote ${channels.map((ch) => PRISM_CHANNEL_LABELS[ch]).join(", ")}`, instruction || undefined)
    ),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: c.uid,
  });
  logger.info("[Prism] Post adapted", {postId, channels});
  return {postId, channels};
});

/**
 * Plans a month of ideas across the brand's channels and adds them to the calendar as ideas.
 * Only fills days from today onward.
 * @return {!Promise<{created: number, rationale: string}>} Result.
 */
export const generatePrismMonthPlan = onCall({timeoutSeconds: 180}, async (request) => {
  const c = await prismCaller(request.auth?.uid);
  const strategy = await requirePrismBrandStrategy(c.agencyId);
  const tz = strategy.timezone || "America/New_York";

  const month = typeof request.data?.month === "string" && /^\d{4}-\d{2}$/.test(request.data.month) ?
    request.data.month :
    todayIn(tz).slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = todayIn(tz);
  const firstDate = `${month}-01` < today ? today : `${month}-01`;
  const lastDate = `${month}-${String(lastDay).padStart(2, "0")}`;
  if (firstDate > lastDate) throw new HttpsError("invalid-argument", "That month is already over.");
  const days = Math.round((Date.parse(lastDate) - Date.parse(firstDate)) / 86400000) + 1;

  const requested = Array.isArray(request.data?.channels) ?
    (request.data.channels as unknown[]).filter(isPrismChannel) :
    [];
  const enabled = PRISM_CHANNELS.filter((ch) => strategy.channels[ch].enabled);
  const channels = requested.length ? requested.filter((ch) => enabled.includes(ch)) : enabled;
  if (channels.length === 0) throw new HttpsError("failed-precondition", "Turn on at least one channel.");

  const targets = Object.fromEntries(
    channels.map((ch) => [ch, Math.max(1, Math.round((strategy.channels[ch].postsPerWeek * days) / 7))])
  ) as Record<PrismChannel, number>;
  const ideaCount = Math.min(MAX_PLAN_IDEAS, Math.max(...channels.map((ch) => targets[ch])));
  const brief = typeof request.data?.brief === "string" ? request.data.brief.trim().slice(0, 4000) : "";

  const existing = await db.collection(PRISM_POSTS)
    .where("agencyId", "==", c.agencyId)
    .where("scheduledAt", ">=", `${firstDate}T00:00:00.000Z`)
    .where("scheduledAt", "<=", `${lastDate}T23:59:59.999Z`)
    .limit(100)
    .get();
  const taken = existing.docs.map((d) => {
    const p = d.data() as PrismPost;
    return `- ${String(p.scheduledAt).slice(0, 10)}: ${p.title} (${p.channels.join(", ")})`;
  });

  const gigs = await db.collection("gigs").where("brandId", "==", c.agencyId).limit(30).get();
  const campaigns = gigs.docs
    .map((d) => d.data())
    .filter((g) => g.status === "open" || g.status === "in-progress")
    .map((g) => {
      const due = g.deliverablesDueDate ? ` (creator content due ${String(g.deliverablesDueDate).slice(0, 10)})` : "";
      return `- ${String(g.title ?? "Campaign")}${due}`;
    });

  const formatList = channels.map((ch) => `${ch}: ${PRISM_CHANNEL_FORMATS[ch].join(" | ")}`).join("\n");
  const {text} = await withPrismUsage(c.agencyId, {ai: PRISM_AI_COST.monthPlan}, async () => ai.generate({
    model: googleAI.model(MODEL),
    config: {temperature: 0.8},
    prompt: `${writerPreamble(strategy, await voiceBlock(c.agencyId))}

TASK: Plan ${strategy.brandName}'s content calendar from ${firstDate} to ${lastDate} (timezone ${tz}).
Propose exactly ${ideaCount} ideas. One idea can run on several channels (adapted natively later).
Channel targets for this period (number of ideas that include the channel):
${channels.map((ch) => `- ${ch}: ${targets[ch]}`).join("\n")}

Think like a strategist:
- Balance pillars by their share. Mix formats. Spread posts across the period; avoid stacking the same day.
- Build in moments: launches, campaigns, seasonal or industry dates relevant to this audience.
- Each idea needs a specific angle, not a topic ("3 mistakes we made pricing creators", not "pricing").

MONTH BRIEF FROM THE TEAM:
${brief || "(none)"}

ACTIVE CREATOR CAMPAIGNS (great for behind-the-scenes and creator content):
${campaigns.join("\n") || "(none)"}

ALREADY ON THE CALENDAR (don't duplicate):
${taken.join("\n") || "(nothing yet)"}

FORMATS PER CHANNEL:
${formatList}

Return ONLY JSON:
{
  "rationale": "2 sentences on the month's narrative",
  "ideas": [
    {
      "date": "YYYY-MM-DD",
      "title": "specific idea",
      "angle": "1–3 sentences: the hook, the point, the proof to use",
      "pillar": "${strategy.pillars.map((p) => p.id).join("|")}",
      "channels": [{"channel": "${channels.join("|")}", "format": "one of that channel's formats"}]
    }
  ]
}`,
  }));
  if (!text?.trim()) throw new HttpsError("internal", "The plan came back empty.");

  const obj = parseJsonObject(text);
  const rawIdeas = Array.isArray(obj.ideas) ? (obj.ideas as Record<string, unknown>[]) : [];
  const pillarIds = strategy.pillars.map((p) => p.id);
  const now = new Date().toISOString();
  const batch = db.batch();
  let created = 0;

  for (const [i, idea] of rawIdeas.slice(0, MAX_PLAN_IDEAS).entries()) {
    const title = typeof idea.title === "string" ? idea.title.trim().slice(0, 200) : "";
    if (!title) continue;
    const date = typeof idea.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(idea.date) &&
      idea.date >= firstDate && idea.date <= lastDate ? idea.date : null;
    const rows = Array.isArray(idea.channels) ? (idea.channels as Record<string, unknown>[]) : [];
    const variants: Partial<Record<PrismChannel, PrismVariant>> = {};
    const postChannels: PrismChannel[] = [];
    for (const row of rows) {
      const ch = row?.channel;
      if (!isPrismChannel(ch) || !channels.includes(ch) || postChannels.includes(ch)) continue;
      const formats = PRISM_CHANNEL_FORMATS[ch];
      const format = formats.includes(row.format as PrismFormat) ? (row.format as PrismFormat) : formats[0];
      postChannels.push(ch);
      variants[ch] = {format, text: ""};
    }
    if (postChannels.length === 0) {
      const ch = channels[i % channels.length];
      postChannels.push(ch);
      variants[ch] = {format: PRISM_CHANNEL_FORMATS[ch][0], text: ""};
    }
    const pillarRaw = typeof idea.pillar === "string" ? idea.pillar.trim() : "";
    const post: PrismPost = {
      agencyId: c.agencyId,
      title,
      angle: typeof idea.angle === "string" ? idea.angle.trim().slice(0, 2000) : "",
      pillar: pillarIds.includes(pillarRaw) ? pillarRaw : pillarIds[i % pillarIds.length],
      channels: postChannels,
      scheduledAt: date ? zonedToUtcIso(date, PRISM_DEFAULT_TIMES[postChannels[0]], tz) : null,
      status: "idea",
      variants,
      history: [{at: now, uid: c.uid, name: c.name, action: `planned for ${month}`}],
      source: "plan",
      createdBy: c.uid,
      createdByName: c.name,
    };
    batch.set(db.collection(PRISM_POSTS).doc(), {
      ...post,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    created++;
  }
  if (created === 0) throw new HttpsError("internal", "The plan had no usable ideas. Try again.");
  await batch.commit();

  const rationale = typeof obj.rationale === "string" ? obj.rationale.trim().slice(0, 600) : "";
  logger.info("[Prism] Month planned", {agencyId: c.agencyId, month, created});
  return {created, rationale, month};
});
