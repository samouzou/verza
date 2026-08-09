import {FieldValue} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {googleAI} from "@genkit-ai/google-genai";
import {ai} from "../ai/genkit";
import {db} from "../config/firebase";
import {loadCompletedLinkedInOsJob} from "./jobAccess";
import type {LinkedInOsJobOutput, LinkedInOsVideoPlatform, LinkedInOsVideoScript} from "./types";

const MODEL = "gemini-3.6-flash";
const MAX_SOURCE = 24000;

const PLATFORMS = new Set<LinkedInOsVideoPlatform>(["tiktok", "instagram_reels", "youtube"]);

/**
 * Truncates text for token safety.
 * @param {string} s Input string.
 * @param {number} max Max length.
 * @return {string} Truncated string.
 */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n\n[truncated…]";
}

/**
 * Formats completed LinkedIn outputs as source material for video scripts.
 * @param {!Array<LinkedInOsJobOutput>} outputs Job outputs.
 * @return {string} Combined markdown source.
 */
function formatLinkedInSource(outputs: LinkedInOsJobOutput[]): string {
  return outputs
    .map((o) => `### ${o.id} (${o.pillar} · ${o.format})\n${o.markdown}`)
    .join("\n\n");
}

/**
 * Builds the system prompt for video script generation.
 * @param {string} brief Brand brief markdown.
 * @param {string} banned Banned claims markdown.
 * @return {string} System prompt.
 */
function buildSystemPrompt(brief: string, banned: string): string {
  return `You are a video scriptwriter for Verza (tryverza). Verza is the operating system for the creator economy.

VOICE: operator-insider, concrete, respectful, no hype. Speak like a founder sharing receipts—not a hype ad.

RULES:
- Use ONLY facts present in the LINKEDIN SOURCE below and the brand context. Do not invent features, metrics, fees, or outcomes.
- Obey the BANNED / sensitive list literally.
- Never guarantee income, ROI, or virality. No legal/tax advice.
- Output markdown only—no preamble like "Here is your script."

BRAND CONTEXT:
---
${brief || "(not configured — keep Verza-specific claims minimal)"}
---

BANNED / SENSITIVE:
---
${banned || "(not configured)"}
---
`;
}

/**
 * Platform-specific user instructions for script format.
 * @param {LinkedInOsVideoPlatform} platform Target platform.
 * @param {string} source LinkedIn draft source text.
 * @return {string} User prompt.
 */
function buildUserPrompt(platform: LinkedInOsVideoPlatform, source: string): string {
  const shared = `Turn the week's LinkedIn drafts below into ONE cohesive video script for ${platformLabel(platform)}.
Weave the three angles together (playbook, build-in-public, product receipt)—do not produce three separate mini-scripts.

LINKEDIN SOURCE:
---
${source}
---
`;

  if (platform === "youtube") {
    return `${shared}

FORMAT (YouTube — target 3–8 minutes spoken, ~450–900 words):

## Hook (0:00–0:20)
Opening line on camera + why this matters now.

## Section 1 — The playbook angle
Talking points + transition.

## Section 2 — What we are building
Behind-the-scenes / build-in-public beat.

## Section 3 — Product receipt
Concrete proof or workflow—stay within stated facts.

## Outro + CTA
One clear next step (follow, comment, or soft product mention).

Optional: short **B-roll notes** in italics where helpful.`;
  }

  if (platform === "instagram_reels") {
    return `${shared}

FORMAT (Instagram Reels — 30–60 seconds, ~75–130 spoken words):

## Hook (0–2s)
First line on screen + first spoken line.

## Beats
3–5 short beats with **on-screen text** suggestions in brackets.

## Spoken script
Full teleprompter lines (tight, conversational).

## Caption
1–2 sentence post caption + 3 hashtags max.

## CTA
Soft close (save, follow, or comment prompt).`;
  }

  return `${shared}

FORMAT (TikTok — 30–60 seconds, ~75–130 spoken words):

## Hook (0–1s)
Pattern interrupt—first line must stop the scroll.

## Beats
3–5 rapid beats with **[on-screen text]** cues.

## Spoken script
Full teleprompter lines—short sentences, punchy delivery.

## CTA
One line close (follow for more / comment your take).`;
}

/**
 * Human label for a platform id.
 * @param {LinkedInOsVideoPlatform} platform Platform id.
 * @return {string} Display label.
 */
function platformLabel(platform: LinkedInOsVideoPlatform): string {
  if (platform === "instagram_reels") return "Instagram Reels";
  if (platform === "youtube") return "YouTube";
  return "TikTok";
}

/**
 * Loads a completed LinkedIn OS job the caller may access.
 * @param {string} uid User id.
 * @param {string} jobId Job id.
 * @return {!Promise<object>} Job ref and outputs.
 */
async function loadJobForCaller(uid: string, jobId: string) {
  const {jobRef, outputs} = await loadCompletedLinkedInOsJob(uid, jobId);
  return {jobRef, outputs};
}

/**
 * Generates a platform-specific video script from completed LinkedIn OS outputs.
 * @return {!Promise<{platform: string, markdown: string}>} Generated script.
 */
export const generateLinkedInOsVideoScript = onCall(
  {timeoutSeconds: 120, memory: "512MiB"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to generate a video script.");
    }

    const {jobId, platform: rawPlatform} = request.data as {
      jobId?: unknown;
      platform?: unknown;
    };

    if (typeof jobId !== "string" || !jobId.trim()) {
      throw new HttpsError("invalid-argument", "jobId is required.");
    }
    if (typeof rawPlatform !== "string" || !PLATFORMS.has(rawPlatform as LinkedInOsVideoPlatform)) {
      throw new HttpsError(
        "invalid-argument",
        "platform must be tiktok, instagram_reels, or youtube."
      );
    }
    const platform = rawPlatform as LinkedInOsVideoPlatform;

    const {jobRef, outputs} = await loadJobForCaller(request.auth.uid, jobId.trim());

    const promptsSnap = await db.collection("linkedin_os_prompts").doc("default").get();
    const prompts = promptsSnap.exists ? promptsSnap.data()! : {};
    const brief = truncate(String(prompts.brandBrief ?? ""), 12000);
    const banned = truncate(String(prompts.bannedClaims ?? ""), 8000);
    const source = truncate(formatLinkedInSource(outputs), MAX_SOURCE);

    const system = buildSystemPrompt(brief, banned);
    const user = buildUserPrompt(platform, source);

    const {text} = await ai.generate({
      model: googleAI.model(MODEL),
      prompt: `${system}\n\n${user}`,
      config: {temperature: 0.7},
    });

    const markdown = text?.trim();
    if (!markdown) {
      throw new HttpsError("internal", "Gemini returned no script content.");
    }

    const entry: LinkedInOsVideoScript = {
      platform,
      markdown,
      generatedAt: new Date().toISOString(),
      model: MODEL,
    };

    const existing = ((await jobRef.get()).data()?.videoScripts ?? []) as LinkedInOsVideoScript[];
    const merged = [...existing.filter((s) => s.platform !== platform), entry];

    await jobRef.update({
      videoScripts: merged,
      videoScriptsUpdatedAt: FieldValue.serverTimestamp(),
    });

    logger.info("[LinkedIn OS] Video script generated", {jobId, platform, uid: request.auth.uid});

    return {platform, markdown, generatedAt: entry.generatedAt};
  }
);
