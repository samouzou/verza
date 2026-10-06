import {FieldValue} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {googleAI} from "@genkit-ai/google-genai";
import {ai} from "../ai/genkit";
import {formatBrandStrategyForPrompt, requirePrismBrandStrategy} from "./brandStrategy";
import {loadCompletedLinkedInOsJob} from "./jobAccess";
import type {LinkedInOsJobOutput, LinkedInOsVideoPlatform, LinkedInOsVideoScript} from "./types";
import {PRISM_AI_COST, withPrismUsage} from "./billing";

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
 * Formats completed draft outputs as source material for video scripts.
 * @param {!Array<LinkedInOsJobOutput>} outputs Job outputs.
 * @return {string} Combined markdown source.
 */
function formatDraftSource(outputs: LinkedInOsJobOutput[]): string {
  return outputs
    .map((o) => `### ${o.id} (${o.channel ?? "linkedin"} · ${o.pillar} · ${o.format})\n${o.markdown}`)
    .join("\n\n");
}

/**
 * Builds the system prompt for video script generation.
 * @param {string} brandName Brand name.
 * @param {string} brief Brand setup markdown.
 * @param {string} banned Banned claims markdown.
 * @return {string} System prompt.
 */
function buildSystemPrompt(brandName: string, brief: string, banned: string): string {
  return `You are a video scriptwriter for ${brandName}.

VOICE: concrete, respectful, no hype. Sound like a real person sharing what they know—not an ad.

RULES:
- Use ONLY facts present in the DRAFTS SOURCE below and the brand context. Do not invent features, metrics, fees, or outcomes.
- Obey the BANNED / sensitive list literally.
- Never guarantee income, ROI, or virality. No legal/tax advice.
- Output markdown only—no preamble like "Here is your script."

BRAND CONTEXT:
---
${brief}
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
 * @param {string} source Draft source text.
 * @return {string} User prompt.
 */
function buildUserPrompt(platform: LinkedInOsVideoPlatform, source: string): string {
  const shared = `Turn the week's drafts below into ONE cohesive video script for ${platformLabel(platform)}.
Weave the strongest angles together—do not produce separate mini-scripts.

DRAFTS SOURCE:
---
${source}
---
`;

  if (platform === "youtube") {
    return `${shared}

FORMAT (YouTube — target 3–8 minutes spoken, ~450–900 words):

## Hook (0:00–0:20)
Opening line on camera + why this matters now.

## Section 1 — The core idea
Talking points + transition.

## Section 2 — Behind the scenes
How it works or how we got here.

## Section 3 — Proof
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
 * Generates a platform-specific video script from completed Prism draft outputs.
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

    const {jobRef, job, outputs} = await loadCompletedLinkedInOsJob(request.auth.uid, jobId.trim());
    const strategy = await requirePrismBrandStrategy(String(job.agencyId ?? ""));
    const brief = truncate(formatBrandStrategyForPrompt(strategy), 12000);
    const banned = truncate(strategy.bannedClaims, 8000);
    const source = truncate(formatDraftSource(outputs), MAX_SOURCE);

    const system = buildSystemPrompt(strategy.brandName, brief, banned);
    const user = buildUserPrompt(platform, source);

    const {text} = await withPrismUsage(String(job.agencyId ?? ""), {ai: PRISM_AI_COST.repurpose}, () => ai.generate({
      model: googleAI.model(MODEL),
      prompt: `${system}\n\n${user}`,
      config: {temperature: 0.7},
    }));

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

    logger.info("[Prism] Video script generated", {jobId, platform, uid: request.auth.uid});

    return {platform, markdown, generatedAt: entry.generatedAt};
  }
);
