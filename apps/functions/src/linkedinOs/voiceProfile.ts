import {FieldValue} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {googleAI} from "@genkit-ai/google-genai";
import {ai} from "../ai/genkit";
import {db} from "../config/firebase";
import {assertAgencyTeamForLinkedInOs} from "./access";
import type {LinkedInOsVoiceProfile} from "./types";

const MODEL = "gemini-3.6-flash";
const MAX_POSTS_CHARS = 28000;
const MIN_POSTS_CHARS = 200;

/**
 * Truncates text for token safety.
 * @param {string} s Input.
 * @param {number} max Max length.
 * @return {string} Truncated string.
 */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n\n[truncated…]";
}

/**
 * Parses JSON object from model text (strips fences if present).
 * @param {string} text Model output.
 * @return {Record<string, unknown>} Parsed object.
 */
function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1].trim() : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new HttpsError("internal", "Voice analysis returned no JSON object.");
  }
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new HttpsError("internal", "Voice analysis JSON was invalid.");
  }
}

/**
 * Coerces unknown to a string array (max items, trimmed).
 * @param {unknown} raw Unknown value.
 * @param {number} max Max items.
 * @return {!Array<string>} Strings.
 */
function asStringArray(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

/**
 * Analyzes pasted LinkedIn posts and saves a voice profile for the agency.
 * @return {!Promise<object>} Saved voice profile summary.
 */
export const analyzeLinkedInOsVoiceProfile = onCall(
  {timeoutSeconds: 120},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to analyze LinkedIn voice.");
    }
    const uid = request.auth.uid;
    const agencyId = await assertAgencyTeamForLinkedInOs(uid);

    const postsRaw =
      typeof request.data?.posts === "string" ? request.data.posts.trim() : "";
    if (postsRaw.length < MIN_POSTS_CHARS) {
      throw new HttpsError(
        "invalid-argument",
        `Paste at least ~${MIN_POSTS_CHARS} characters of recent LinkedIn posts.`
      );
    }
    const posts = truncate(postsRaw, MAX_POSTS_CHARS);

    const {text} = await ai.generate({
      model: googleAI.model(MODEL),
      prompt: `You are a LinkedIn content strategist. Analyze the author's posts and extract a reusable VOICE PROFILE for future drafting.

Return ONLY valid JSON (no markdown fences) with this shape:
{
  "voiceSummary": "2–4 sentences on how they sound",
  "toneTraits": ["short phrases"],
  "hookPatterns": ["how they open posts"],
  "topicsThatWork": ["recurring themes"],
  "topicsToAvoid": ["what they avoid or that would break voice"],
  "ctaStyle": "one sentence on how they ask for engagement",
  "doList": ["writing rules to follow"],
  "dontList": ["writing rules to avoid"],
  "sampleLines": ["3–6 short lines that sound like them (paraphrased, not copyrighted verbatim blocks)"]
}

Rules:
- Infer from evidence in the posts only. Do not invent company facts or metrics.
- Prefer concrete craft notes over vague adjectives.
- sampleLines must be short paraphrases in their style, not long copied paragraphs.

POSTS:
---
${posts}
---
`,
    });

    if (!text?.trim()) {
      throw new HttpsError("internal", "Voice analysis returned empty text.");
    }

    const parsed = parseJsonObject(text);
    const profile: LinkedInOsVoiceProfile = {
      agencyId,
      voiceSummary:
        typeof parsed.voiceSummary === "string" ? parsed.voiceSummary.trim() : "",
      toneTraits: asStringArray(parsed.toneTraits, 12),
      hookPatterns: asStringArray(parsed.hookPatterns, 10),
      topicsThatWork: asStringArray(parsed.topicsThatWork, 12),
      topicsToAvoid: asStringArray(parsed.topicsToAvoid, 10),
      ctaStyle: typeof parsed.ctaStyle === "string" ? parsed.ctaStyle.trim() : "",
      doList: asStringArray(parsed.doList, 12),
      dontList: asStringArray(parsed.dontList, 12),
      sampleLines: asStringArray(parsed.sampleLines, 8),
      samplePostCount: Math.max(1, posts.split(/\n{2,}/).filter((b) => b.trim().length > 40).length),
      updatedBy: uid,
      model: MODEL,
    };

    if (!profile.voiceSummary) {
      throw new HttpsError("internal", "Voice analysis missing voiceSummary.");
    }

    const ref = db.collection("linkedin_os_voice_profiles").doc(agencyId);
    await ref.set(
      {
        ...profile,
        updatedAt: FieldValue.serverTimestamp(),
      },
      {merge: true}
    );

    logger.info("[LinkedIn OS] Voice profile saved", {
      agencyId,
      samplePostCount: profile.samplePostCount,
      updatedBy: uid,
    });

    return {agencyId, profile};
  }
);
