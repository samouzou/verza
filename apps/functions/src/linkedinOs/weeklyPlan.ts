import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {googleAI} from "@genkit-ai/google-genai";
import {ai} from "../ai/genkit";
import {db} from "../config/firebase";
import {assertAgencyTeamForLinkedInOs} from "./access";
import type {LinkedInOsJobItem, LinkedInOsVoiceProfile} from "./types";

const MODEL = "gemini-3.6-flash";
const MAX_BRIEF = 6000;
const PILLARS = new Set([
  "build_in_public",
  "playbooks",
  "creator_respect",
  "product_receipts",
]);
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
 * Parses JSON array from model text.
 * @param {string} text Model output.
 * @return {!Array<Record<string, unknown>>} Parsed array.
 */
function parseJsonArray(text: string): Record<string, unknown>[] {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1].trim() : trimmed;
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) {
    throw new HttpsError("internal", "Weekly plan returned no JSON array.");
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("not array");
    }
    return parsed as Record<string, unknown>[];
  } catch {
    throw new HttpsError("internal", "Weekly plan JSON was invalid.");
  }
}

/**
 * Formats a stored voice profile for the planner prompt.
 * @param {LinkedInOsVoiceProfile | null} profile Voice profile.
 * @return {string} Prompt block.
 */
function formatVoice(profile: LinkedInOsVoiceProfile | null): string {
  if (!profile?.voiceSummary) {
    return "(no voice profile yet — plan with Verza operator-insider defaults)";
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
 * Normalizes one plan item from the model.
 * @param {Record<string, unknown>} raw Raw object.
 * @param {number} index Index for fallback id.
 * @return {LinkedInOsJobItem} Item.
 */
function normalizeItem(raw: Record<string, unknown>, index: number): LinkedInOsJobItem {
  const id =
    typeof raw.id === "string" && raw.id.trim()
      ? raw.id.trim().slice(0, 64)
      : `plan-${index + 1}`;
  const pillarRaw = typeof raw.pillar === "string" ? raw.pillar.trim() : "playbooks";
  const pillar = PILLARS.has(pillarRaw) ? pillarRaw : "playbooks";
  const format = raw.format === "carousel_outline" ? "carousel_outline" : "short_post";
  const ctaRaw = typeof raw.cta === "string" ? raw.cta.trim() : "comment";
  const cta = CTAS.has(ctaRaw) ? ctaRaw : "comment";
  const hook = typeof raw.hook === "string" ? raw.hook.trim().slice(0, 280) : "";
  const productTruth =
    typeof raw.productTruth === "string" ? raw.productTruth.trim().slice(0, 500) : "";
  const notes = typeof raw.notes === "string" ? raw.notes.trim().slice(0, 400) : "";
  return {
    id,
    pillar,
    format,
    hook,
    productTruth,
    cta,
    ...(notes ? {notes} : {}),
  };
}

/**
 * Generates a weekly LinkedIn content plan (queue items) from voice + brief.
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

    const weekLabel =
      typeof request.data?.weekLabel === "string" && request.data.weekLabel.trim()
        ? request.data.weekLabel.trim().slice(0, 40)
        : "this week";
    const weeklyBrief =
      typeof request.data?.weeklyBrief === "string"
        ? truncate(request.data.weeklyBrief.trim(), MAX_BRIEF)
        : "";
    const mustMention =
      typeof request.data?.mustMention === "string"
        ? request.data.mustMention.trim().slice(0, 500)
        : "";
    const neverMention =
      typeof request.data?.neverMention === "string"
        ? request.data.neverMention.trim().slice(0, 500)
        : "";

    const voiceSnap = await db.collection("linkedin_os_voice_profiles").doc(agencyId).get();
    const voice = voiceSnap.exists
      ? (voiceSnap.data() as LinkedInOsVoiceProfile)
      : null;

    const {text} = await ai.generate({
      model: googleAI.model(MODEL),
      prompt: `You are a LinkedIn content strategist for Verza (tryverza), the OS for the creator economy.

Propose exactly 3 posts for ${weekLabel}: a balanced mix across pillars.
Prefer 2 short_post + 1 carousel_outline (product_receipts) unless the brief says otherwise.

VOICE PROFILE:
---
${formatVoice(voice)}
---

WEEKLY BRIEF:
---
${weeklyBrief || "(none — use evergreen Verza angles)"}
---

CONSTRAINTS:
- Must mention/reflect: ${mustMention || "(none)"}
- Never mention: ${neverMention || "(none)"}

Return ONLY valid JSON (no fences):
{
  "rationale": "1–2 sentences on the week's angle",
  "items": [
    {
      "id": "tue-playbooks",
      "pillar": "build_in_public|playbooks|creator_respect|product_receipts",
      "format": "short_post|carousel_outline",
      "hook": "suggested first line direction",
      "productTruth": "one factual sentence the human can stand behind (no invented metrics)",
      "cta": "follow|comment|soft_product|hard_product",
      "notes": "optional planner note"
    }
  ]
}

Use stable ids like tue-*, wed-*, thu-* when possible.
Do not invent fees, user counts, or legal claims.
`,
    });

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
      rawItems = parseJsonArray(text);
    }

    if (rawItems.length === 0) {
      throw new HttpsError("internal", "Weekly plan had no items.");
    }

    const items = rawItems.slice(0, 5).map((row, i) => normalizeItem(row, i));

    logger.info("[LinkedIn OS] Weekly plan generated", {
      agencyId,
      itemCount: items.length,
      createdBy: uid,
    });

    return {items, rationale, weekLabel};
  }
);
