import {GoogleGenerativeAI} from "@google/generative-ai";
import {FieldValue, getFirestore} from "firebase-admin/firestore";

import {buildCarouselPdf, buildCarouselZip, renderCarouselPngs} from "./carousel/renderCarousel";
import "./firebaseAdmin";
import type {CarouselAssets} from "./carousel/uploadCarousel";
import {uploadCarouselAssets} from "./carousel/uploadCarousel";

const db = getFirestore();

const MAX_CTX = 14000;

type JobItem = {
  id: string;
  pillar: string;
  format: "short_post" | "carousel_outline";
  hook: string;
  productTruth: string;
  cta: string;
  notes?: string;
};

type JobOutput = {
  id: string;
  format: string;
  pillar: string;
  markdown: string;
  generatedAt: string;
  model: string;
  carouselAssets?: CarouselAssets;
};

/**
 * Truncates context for token safety.
 * @param {string} s Input string.
 * @param {number} max Max length.
 * @return {string} Truncated string.
 */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n\n[truncated…]";
}

/**
 * Builds the system prompt for Gemini.
 * @param {string} brief Brand brief markdown.
 * @param {string} strategy Social strategy markdown.
 * @param {string} banned Banned-claims markdown.
 * @return {string} System prompt.
 */
function buildSystemPrompt(brief: string, strategy: string, banned: string): string {
  return `You are a LinkedIn ghostwriter for Verza (tryverza). Verza is the operating system for the creator economy.

VOICE: operator-insider, concrete, respectful, no hype. Short lines. No hashtag spam (max 3 if any).

RULES:
- Use ONLY the product facts implied by the CONTEXT below plus the user's "productTruth" line for each task. Do not invent fees, thresholds, features, or legal outcomes.
- Obey the BANNED / sensitive list literally.
- LinkedIn: strong first line (hook). Use whitespace. Optional short numbered list (max 3 bullets).
- Never guarantee income, ROI, or virality. No legal/tax advice.

CONTEXT — BRAND / PRODUCT BRIEF:
---
${brief || "(not configured — keep Verza-specific claims minimal)"}
---

CONTEXT — SOCIAL STRATEGY:
---
${strategy || "(not configured)"}
---

BANNED / SENSITIVE:
---
${banned || "(not configured)"}
---
`;
}

/**
 * Builds the user message for one queue item.
 * @param {JobItem} item Queue item.
 * @param {string} weekLabel Week label.
 * @param {string} reviewer Reviewer display name.
 * @return {string} User message.
 */
function userMessageForItem(item: JobItem, weekLabel: string, reviewer: string): string {
  const pillar = item.pillar || "playbooks";
  const format = item.format || "short_post";
  const hook =
    (item.hook || "").trim() ||
    "(author may supply hook—propose 2 hook options in line 1)";
  const truth =
    (item.productTruth || "").trim() ||
    "(no productTruth supplied—keep post generic about category, no Verza-specific claims)";
  const cta = item.cta || "comment";
  const notes = (item.notes || "").trim();

  if (format === "carousel_outline") {
    return `Week: ${weekLabel}
Reviewer (human in the loop): ${reviewer}

Write a LinkedIn **document carousel outline** (7–10 slides).

Pillar: ${pillar}
Suggested hook direction: ${hook}
Product truth to reflect (do not exceed it): ${truth}
CTA type: ${cta}
Extra notes: ${notes || "none"}

Output format (markdown):
## Slide 1 — Hook
- title (5 words max)
- 1–2 bullets

Repeat ## Slide N for each slide. Last slide must be CTA only (soft unless cta is hard_product).

Do not claim specific Verza metrics not in the product truth.`;
  }

  return `Week: ${weekLabel}
Reviewer (human in the loop): ${reviewer}

Write ONE LinkedIn post (plain text; avoid markdown headings).

Pillar: ${pillar}
Format: short post
Hook / direction: ${hook}
Product truth you may assume (do not exceed): ${truth}
CTA type: ${cta}
Extra notes: ${notes || "none"}

Structure:
- Line 1 must work as LinkedIn preview (punchy, under ~140 chars if possible).
- Then body: 4–10 short lines.
- End with one CTA line.`;
}

/**
 * Calls Gemini (Google AI) with system instruction + user content.
 * @param {string} system System prompt.
 * @param {string} user User prompt.
 * @param {string} apiKey Gemini API key.
 * @param {string} model Model id.
 * @return {!Promise<string>} Model text.
 */
async function geminiComplete(
  system: string,
  user: string,
  apiKey: string,
  model: string
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({
    model,
    systemInstruction: system,
    generationConfig: {temperature: 0.7},
  });
  const result = await genModel.generateContent(user);
  const text = result.response.text();
  if (!text?.trim()) {
    throw new Error("Gemini returned no content.");
  }
  return text.trim();
}

/**
 * Runs a LinkedIn OS job: loads prompts from Firestore, generates drafts, writes outputs.
 * @param {string} jobId Firestore job id.
 * @return {!Promise<void>}
 */
export async function runLinkedInOsJob(jobId: string): Promise<void> {
  const ref = db.collection("linkedin_os_jobs").doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Job not found");
  }
  const data = snap.data()!;
  if (data.status !== "queued") {
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set on the worker.");
  }
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3-flash-preview";

  await ref.update({
    status: "running",
    startedAt: FieldValue.serverTimestamp(),
  });

  try {
    const promptsSnap = await db.collection("linkedin_os_prompts").doc("default").get();
    const prompts = promptsSnap.exists ? promptsSnap.data()! : {};
    const brief = truncate(String(prompts.brandBrief ?? ""), MAX_CTX);
    const strategy = truncate(String(prompts.socialStrategy ?? ""), MAX_CTX);
    const banned = truncate(String(prompts.bannedClaims ?? ""), MAX_CTX);
    const system = buildSystemPrompt(brief, strategy, banned);

    const items = (data.items || []) as JobItem[];
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Job has no items.");
    }

    const weekLabel = String(data.weekLabel ?? "");
    const reviewer = String(data.reviewer ?? "Serge");
    const agencyId = String(data.agencyId ?? "").trim();
    if (!agencyId) {
      throw new Error("Job is missing agencyId.");
    }

    const outputs: JobOutput[] = [];
    for (const item of items) {
      const userMsg = userMessageForItem(item, weekLabel, reviewer);
      const markdown = await geminiComplete(system, userMsg, apiKey, model);
      const output: JobOutput = {
        id: item.id,
        format: item.format,
        pillar: item.pillar,
        markdown,
        generatedAt: new Date().toISOString(),
        model,
      };

      if (item.format === "carousel_outline") {
        try {
          const pngSlides = await renderCarouselPngs(markdown);
          const [pdf, zip] = await Promise.all([
            buildCarouselPdf(pngSlides),
            buildCarouselZip(pngSlides),
          ]);
          output.carouselAssets = await uploadCarouselAssets({
            agencyId,
            jobId,
            outputId: item.id,
            slides: pngSlides,
            pdf,
            zip,
          });
        } catch (renderErr) {
          const msg = renderErr instanceof Error ? renderErr.message : String(renderErr);
          throw new Error(`Carousel render failed for ${item.id}: ${msg}`);
        }
      }

      outputs.push(output);
    }

    await ref.update({
      status: "completed",
      outputs,
      completedAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ref
      .update({
        status: "failed",
        error: msg.slice(0, 2000),
        completedAt: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined);
    throw e;
  }
}
