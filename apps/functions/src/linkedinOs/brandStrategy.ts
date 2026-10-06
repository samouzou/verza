import {FieldValue} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {googleAI} from "@genkit-ai/google-genai";
import {ai} from "../ai/genkit";
import {db} from "../config/firebase";
import {brandKitRef} from "../agency/brandKit";
import {normalizeBrandUrl, scrapeBrandPage} from "../brand-research";
import {assertAgencyTeamForLinkedInOs} from "./access";
import type {
  PrismBrandStrategy,
  PrismChannel,
  PrismChannelPlan,
  PrismFormat,
  PrismPillar,
} from "./types";

const MODEL = "gemini-3.6-flash";
const MAX_SITE_TEXT = 12000;

export const PRISM_BRANDS = "prism_brands";
export const PRISM_CHANNELS: PrismChannel[] = ["linkedin", "x", "instagram", "tiktok"];
export const PRISM_CHANNEL_LABELS: Record<PrismChannel, string> = {
  linkedin: "LinkedIn",
  x: "X",
  instagram: "Instagram",
  tiktok: "TikTok",
};
export const PRISM_CHANNEL_FORMATS: Record<PrismChannel, PrismFormat[]> = {
  linkedin: ["short_post", "carousel_outline"],
  x: ["x_post", "x_thread"],
  instagram: ["ig_feed", "ig_carousel", "ig_reel"],
  tiktok: ["tiktok_video"],
};
export const PRISM_MAX_POSTS_PER_WEEK = 12;

const MAX_PILLARS = 6;
const MAX_POSTS_PER_CHANNEL = 14;

/**
 * Trims and caps a string field.
 * @param {unknown} raw Raw value.
 * @param {number} max Max length.
 * @return {string} Clean string.
 */
function str(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.trim().slice(0, max) : "";
}

/**
 * Builds a stable pillar id from its label.
 * @param {string} label Pillar label.
 * @param {number} index Fallback index.
 * @return {string} Slug id.
 */
function slugify(label: string, index: number): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug || `pillar_${index + 1}`;
}

/**
 * Whether a channel id is supported.
 * @param {unknown} v Candidate.
 * @return {boolean} True when v is a Prism channel.
 */
export function isPrismChannel(v: unknown): v is PrismChannel {
  return typeof v === "string" && (PRISM_CHANNELS as string[]).includes(v);
}

/**
 * Normalizes pillars: unique ids, 1–6 entries, shares clamped to 0–100.
 * @param {unknown} raw Raw pillars array.
 * @return {!Array<PrismPillar>} Clean pillars.
 */
function parsePillars(raw: unknown): PrismPillar[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PrismPillar[] = [];
  raw.forEach((row, i) => {
    if (!row || typeof row !== "object" || out.length >= MAX_PILLARS) return;
    const o = row as Record<string, unknown>;
    const label = str(o.label, 60);
    if (!label) return;
    let id = str(o.id, 40) || slugify(label, i);
    if (seen.has(id)) id = `${id}_${i + 1}`;
    seen.add(id);
    const share = Math.max(0, Math.min(100, Math.round(Number(o.share) || 0)));
    out.push({id, label, description: str(o.description, 300), share});
  });
  return out;
}

/**
 * Normalizes per-channel plans; missing channels are disabled.
 * @param {unknown} raw Raw channels object.
 * @return {Record<PrismChannel, PrismChannelPlan>} Clean channel plans.
 */
function parseChannels(raw: unknown): Record<PrismChannel, PrismChannelPlan> {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as Record<PrismChannel, PrismChannelPlan>;
  for (const ch of PRISM_CHANNELS) {
    const o = src[ch] && typeof src[ch] === "object" ? (src[ch] as Record<string, unknown>) : {};
    const posts = Math.round(Number(o.postsPerWeek) || 0);
    out[ch] = {
      enabled: o.enabled === true,
      role: str(o.role, 200),
      postsPerWeek: Math.max(0, Math.min(MAX_POSTS_PER_CHANNEL, posts)),
    };
  }
  return out;
}

/**
 * Validates a client-supplied brand setup.
 * @param {unknown} raw Raw payload.
 * @param {string} agencyId Owning agency.
 * @return {PrismBrandStrategy} Clean setup.
 */
export function parseBrandStrategy(raw: unknown, agencyId: string): PrismBrandStrategy {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    agencyId,
    brandName: str(o.brandName, 80),
    websiteUrl: str(o.websiteUrl, 300),
    brief: str(o.brief, 6000),
    audience: str(o.audience, 2000),
    pillars: parsePillars(o.pillars),
    channels: parseChannels(o.channels),
    bannedClaims: str(o.bannedClaims, 3000),
    timezone: str(o.timezone, 64) || "America/New_York",
    approvalRequired: o.approvalRequired !== false,
  };
}

/**
 * Loads a brand's Prism setup.
 * @param {string} agencyId Agency id.
 * @return {!Promise<?PrismBrandStrategy>} Setup or null when not configured.
 */
export async function loadPrismBrandStrategy(agencyId: string): Promise<PrismBrandStrategy | null> {
  const snap = await db.collection(PRISM_BRANDS).doc(agencyId).get();
  if (!snap.exists) return null;
  const s = parseBrandStrategy(snap.data(), agencyId);
  return s.brandName && s.pillars.length > 0 ? s : null;
}

/**
 * Loads a brand's Prism setup or throws a user-facing error.
 * @param {string} agencyId Agency id.
 * @return {!Promise<PrismBrandStrategy>} Setup.
 */
export async function requirePrismBrandStrategy(agencyId: string): Promise<PrismBrandStrategy> {
  const s = await loadPrismBrandStrategy(agencyId);
  if (!s) {
    throw new HttpsError(
      "failed-precondition",
      "Set up your brand in Prism first (brand brief, pillars, and channels)."
    );
  }
  return s;
}

/**
 * Formats the brand setup as a prompt block.
 * @param {PrismBrandStrategy} s Brand setup.
 * @return {string} Markdown block.
 */
export function formatBrandStrategyForPrompt(s: PrismBrandStrategy): string {
  const pillars = s.pillars
    .map((p) => `- ${p.id} (${p.label}, ~${p.share}% of posts): ${p.description || "no description"}`)
    .join("\n");
  const channels = PRISM_CHANNELS.filter((ch) => s.channels[ch].enabled)
    .map((ch) => {
      const c = s.channels[ch];
      return `- ${PRISM_CHANNEL_LABELS[ch]}: ${c.postsPerWeek}/week. Role: ${c.role || "not specified"}`;
    })
    .join("\n");
  return [
    `BRAND: ${s.brandName}${s.websiteUrl ? ` (${s.websiteUrl})` : ""}`,
    `BRIEF:\n${s.brief || "(none)"}`,
    `AUDIENCE:\n${s.audience || "(none)"}`,
    `PILLARS:\n${pillars}`,
    `CHANNELS:\n${channels || "(none enabled)"}`,
  ].join("\n\n");
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
  if (start < 0 || end <= start) {
    throw new HttpsError("internal", "Brand setup draft returned no JSON.");
  }
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new HttpsError("internal", "Brand setup draft JSON was invalid.");
  }
}

/**
 * Drafts a Prism brand setup from the brand's website and brand kit. Does not save.
 * @return {!Promise<{strategy: PrismBrandStrategy}>} Draft for the user to edit.
 */
export const draftPrismBrandStrategy = onCall(
  {timeoutSeconds: 120, memory: "1GiB"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to draft a brand setup.");
    }
    const agencyId = await assertAgencyTeamForLinkedInOs(request.auth.uid);
    const websiteUrl = normalizeBrandUrl(str(request.data?.websiteUrl, 300));

    const [agencySnap, kitSnap] = await Promise.all([
      db.collection("agencies").doc(agencyId).get(),
      brandKitRef(agencyId).get(),
    ]);
    const agencyName = str(agencySnap.data()?.name, 80);
    const guide = (kitSnap.data()?.brandGuide ?? agencySnap.data()?.brandGuide ?? {}) as Record<string, unknown>;
    const guideLines = [
      str(guide.missionStatement, 600) && `Mission: ${str(guide.missionStatement, 600)}`,
      str(guide.toneOfVoice, 400) && `Tone of voice: ${str(guide.toneOfVoice, 400)}`,
      Array.isArray(guide.dos) && guide.dos.length ? `Do: ${guide.dos.slice(0, 6).join("; ")}` : "",
      Array.isArray(guide.donts) && guide.donts.length ? `Don't: ${guide.donts.slice(0, 6).join("; ")}` : "",
    ].filter(Boolean).join("\n");

    let siteText = "";
    if (websiteUrl) {
      try {
        siteText = (await scrapeBrandPage(websiteUrl)).websiteText.slice(0, MAX_SITE_TEXT);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn("[Prism] Website scrape failed", {agencyId, websiteUrl, msg});
        if (!guideLines) {
          throw new HttpsError("failed-precondition", "We couldn't read that website. Try the homepage URL.");
        }
      }
    }
    if (!siteText && !guideLines) {
      throw new HttpsError(
        "invalid-argument",
        "Add your website URL (or fill in your Brand Guide) so Prism has something to learn from."
      );
    }

    const {text} = await ai.generate({
      model: googleAI.model(MODEL),
      prompt: `You are a senior social media strategist onboarding a new brand.
From the material below, draft the brand's social media setup.

Brand name on file: ${agencyName || "(unknown)"}
Website: ${websiteUrl || "(none)"}

BRAND GUIDE:
---
${guideLines || "(none)"}
---

WEBSITE TEXT:
---
${siteText || "(none)"}
---

Rules:
- Use only facts present above. Never invent metrics, customers, prices, or awards.
- 3–5 content pillars. Shares add up to 100. Pillars must be specific to this brand, not generic.
- Channels: linkedin, x, instagram, tiktok. Enable the ones that fit the audience. For each, give a one-line role
  (what this channel does for the brand) and a realistic posts-per-week (0–7) for a small team.
- bannedClaims: claims this brand must avoid (regulated, unverifiable, competitor-bashing), one per line.

Return ONLY JSON:
{
  "brandName": "...",
  "brief": "What the brand sells, to whom, why it's different, proof points (markdown, under 1200 chars)",
  "audience": "Who we're talking to and what they care about (under 600 chars)",
  "pillars": [{"label": "...", "description": "...", "share": 30}],
  "channels": {
    "linkedin": {"enabled": true, "role": "...", "postsPerWeek": 3},
    "x": {"enabled": true, "role": "...", "postsPerWeek": 3},
    "instagram": {"enabled": true, "role": "...", "postsPerWeek": 3},
    "tiktok": {"enabled": false, "role": "...", "postsPerWeek": 0}
  },
  "bannedClaims": "..."
}`,
    });
    if (!text?.trim()) {
      throw new HttpsError("internal", "Brand setup draft came back empty.");
    }

    const draft = parseBrandStrategy(parseJsonObject(text), agencyId);
    draft.websiteUrl = websiteUrl;
    if (!draft.brandName) draft.brandName = agencyName;

    logger.info("[Prism] Brand setup drafted", {agencyId, pillars: draft.pillars.length});
    return {strategy: draft};
  }
);

/**
 * Saves a brand's Prism setup.
 * @return {!Promise<{ok: boolean}>} Result.
 */
export const savePrismBrandStrategy = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to save your brand setup.");
  }
  const uid = request.auth.uid;
  const agencyId = await assertAgencyTeamForLinkedInOs(uid);
  const s = parseBrandStrategy(request.data?.strategy, agencyId);

  if (!s.brandName) {
    throw new HttpsError("invalid-argument", "Brand name is required.");
  }
  if (!s.brief) {
    throw new HttpsError("invalid-argument", "Add a brand brief so drafts stay factual.");
  }
  if (s.pillars.length === 0) {
    throw new HttpsError("invalid-argument", "Add at least one content pillar.");
  }
  const enabled = PRISM_CHANNELS.filter((ch) => s.channels[ch].enabled);
  if (enabled.length === 0) {
    throw new HttpsError("invalid-argument", "Turn on at least one channel.");
  }

  const ref = db.collection(PRISM_BRANDS).doc(agencyId);
  const existing = await ref.get();
  await ref.set({
    ...s,
    updatedBy: uid,
    updatedAt: FieldValue.serverTimestamp(),
    ...(existing.exists ? {} : {createdAt: FieldValue.serverTimestamp()}),
  });

  logger.info("[Prism] Brand setup saved", {agencyId, channels: enabled, uid});
  return {ok: true};
});
