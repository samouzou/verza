import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {googleAI} from "@genkit-ai/google-genai";
import {ai} from "../ai/genkit";
import * as params from "../config/params";
import {db} from "../config/firebase";
import {
  findProductReceiptsCarouselOutput,
  loadCompletedLinkedInOsJob,
  PRODUCT_RECEIPTS_OUTPUT_ID,
} from "./jobAccess";
import {parseCarouselMarkdown} from "./parseCarouselMarkdown";
import type {LinkedInOsBeehiivNewsletter, LinkedInOsCarouselSlideAsset} from "./types";

const MODEL = "gemini-3-flash-preview";
const SIGNED_URL_TTL_MS = 1000 * 60 * 60 * 24 * 7;

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
 * Builds the system prompt for Beehiiv newsletter generation.
 * @param {string} brief Brand brief markdown.
 * @param {string} banned Banned claims markdown.
 * @return {string} System prompt.
 */
function buildSystemPrompt(brief: string, banned: string): string {
  return `You are a newsletter writer for Verza (tryverza) publishing on Beehiiv.

VOICE: operator-insider, concrete, respectful, no hype. Write like a sharp founder newsletter—not a press release.

RULES:
- Use ONLY facts from the CAROUSEL SOURCE and brand context. Do not invent features, metrics, fees, or outcomes.
- Obey the BANNED / sensitive list literally.
- Never guarantee income, ROI, or virality. No legal/tax advice.
- Output markdown only—no preamble.

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
 * Formats parsed slides and optional image URLs for the user prompt.
 * @param {string} markdown Raw carousel markdown.
 * @param {!Array<object>} slideImages Signed image URLs per slide.
 * @return {string} Structured source block.
 */
function formatCarouselSource(
  markdown: string,
  slideImages: {index: number; filename: string; url: string}[]
): string {
  const parsed = parseCarouselMarkdown(markdown);
  const slideBlocks = parsed.map((slide, i) => {
    const image = slideImages[i];
    const bullets = slide.bullets.map((b) => `- ${b}`).join("\n");
    const imageLine = image ? `\nImage URL for Beehiiv: ${image.url}` : "";
    return `### Slide ${slide.index}: ${slide.title}
${bullets || "(no bullets)"}${imageLine}`;
  });

  return `CAROUSEL MARKDOWN (raw):
---
${markdown}
---

PARSED SLIDES (${parsed.length} total — write one newsletter section per slide, same order):
---
${slideBlocks.join("\n\n")}
---`;
}

/**
 * Beehiiv-specific user prompt.
 * @param {string} source Carousel source block.
 * @param {string} weekLabel Week label for context.
 * @return {string} User prompt.
 */
function buildUserPrompt(source: string, weekLabel: string): string {
  return `Turn the LinkedIn product-receipts carousel below into a Beehiiv newsletter draft for week ${weekLabel}.

${source}

FORMAT (markdown):

## Subject line
One compelling subject (under ~60 chars if possible).

## Preview text
1–2 sentences for inbox preview.

## Opening
Short intro paragraph (2–4 sentences) that sets up the topic—do not repeat the subject line verbatim.

## Body
For EACH carousel slide, in order, write:

### [Slide title as section heading]

One or two paragraphs expanding that slide's idea for newsletter readers
(not slide bullets copy-pasted verbatim). Where an image URL is provided for that slide,
include on the next line:
![Slide N caption](THE_EXACT_URL_FROM_SOURCE)

Use the slide title as the ### heading. Last slide / CTA slide should end with a soft CTA
(follow, reply, or tryverza.com)—no hard sell unless the slide implies it.

Keep total length readable in one sitting (~400–800 words unless the carousel is very short).`;
}

/**
 * Signs download URLs for carousel PNGs (for Beehiiv image embeds).
 * @param {!Array<LinkedInOsCarouselSlideAsset>} slides Slide asset metadata.
 * @return {!Promise<!Array<{index: number, filename: string, url: string}>>} Signed URLs.
 */
async function signCarouselSlideUrls(
  slides: LinkedInOsCarouselSlideAsset[]
): Promise<{index: number; filename: string; url: string}[]> {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const bucket = admin.storage().bucket(params.APP_STORAGE_BUCKET.value());
  const sorted = [...slides].sort((a, b) => a.index - b.index);
  const signed: {index: number; filename: string; url: string}[] = [];

  for (const slide of sorted) {
    const file = bucket.file(slide.storagePath);
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + SIGNED_URL_TTL_MS,
    });
    signed.push({index: slide.index, filename: slide.filename, url});
  }

  return signed;
}

/**
 * Generates a Beehiiv newsletter from the thu-product-receipts carousel (+ PNG URLs).
 * @return {!Promise<object>} Generated newsletter metadata.
 */
export const generateLinkedInOsBeehiivNewsletter = onCall(
  {timeoutSeconds: 120, memory: "512MiB"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to generate a Beehiiv newsletter.");
    }

    const {jobId} = request.data as {jobId?: unknown};
    if (typeof jobId !== "string" || !jobId.trim()) {
      throw new HttpsError("invalid-argument", "jobId is required.");
    }

    const {jobRef, job, outputs} = await loadCompletedLinkedInOsJob(
      request.auth.uid,
      jobId.trim()
    );

    const carouselOutput = findProductReceiptsCarouselOutput(outputs);
    if (!carouselOutput) {
      throw new HttpsError(
        "failed-precondition",
        `No carousel output found (expected ${PRODUCT_RECEIPTS_OUTPUT_ID}).`
      );
    }

    const slides = carouselOutput.carouselAssets?.slides ?? [];
    let slideImageUrls: {index: number; filename: string; url: string}[] = [];
    if (slides.length > 0) {
      try {
        slideImageUrls = await signCarouselSlideUrls(slides);
      } catch (e) {
        logger.warn("[LinkedIn OS] Could not sign carousel slide URLs", {
          jobId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const promptsSnap = await db.collection("linkedin_os_prompts").doc("default").get();
    const prompts = promptsSnap.exists ? promptsSnap.data()! : {};
    const brief = truncate(String(prompts.brandBrief ?? ""), 12000);
    const banned = truncate(String(prompts.bannedClaims ?? ""), 8000);
    const weekLabel = String(job.weekLabel ?? "this week");
    const source = truncate(
      formatCarouselSource(carouselOutput.markdown, slideImageUrls),
      24000
    );

    const system = buildSystemPrompt(brief, banned);
    const user = buildUserPrompt(source, weekLabel);

    const {text} = await ai.generate({
      model: googleAI.model(MODEL),
      prompt: `${system}\n\n${user}`,
      config: {temperature: 0.65},
    });

    const markdown = text?.trim();
    if (!markdown) {
      throw new HttpsError("internal", "Gemini returned no newsletter content.");
    }

    const entry: LinkedInOsBeehiivNewsletter = {
      sourceOutputId: carouselOutput.id,
      markdown,
      generatedAt: new Date().toISOString(),
      model: MODEL,
      ...(slideImageUrls.length > 0 ? {slideImageUrls} : {}),
    };

    await jobRef.update({
      beehiivNewsletter: entry,
      beehiivNewsletterUpdatedAt: FieldValue.serverTimestamp(),
    });

    logger.info("[LinkedIn OS] Beehiiv newsletter generated", {
      jobId,
      sourceOutputId: carouselOutput.id,
      uid: request.auth.uid,
    });

    return {
      sourceOutputId: entry.sourceOutputId,
      markdown: entry.markdown,
      generatedAt: entry.generatedAt,
      slideImageUrls: entry.slideImageUrls ?? [],
    };
  }
);
