import {GoogleGenerativeAI} from "@google/generative-ai";
import {FieldValue, getFirestore} from "firebase-admin/firestore";

import {buildCarouselPdf, buildCarouselZip, renderCarouselPngs} from "./carousel/renderCarousel";
import {loadWorkerBrand, type WorkerBrand} from "./brand";
import "./firebaseAdmin";
import type {CarouselAssets} from "./carousel/uploadCarousel";
import {uploadCarouselAssets} from "./carousel/uploadCarousel";

const db = getFirestore();

const MAX_CTX = 14000;
const MAX_RUN_BRIEF = 6000;
const MAX_RUN_CONSTRAINT = 500;

type JobItem = {
  id: string;
  channel?: string;
  pillar: string;
  format: string;
  hook: string;
  productTruth: string;
  cta: string;
  notes?: string;
  idea?: string;
  date?: string;
  scheduledAt?: string;
};

type JobOutput = {
  id: string;
  channel: string;
  format: string;
  pillar: string;
  markdown: string;
  generatedAt: string;
  model: string;
  carouselAssets?: CarouselAssets;
  scheduledAt?: string;
  postId?: string;
};

const CAROUSEL_FORMATS = new Set(["carousel_outline", "ig_carousel"]);

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
 * @param {WorkerBrand} brand Brand setup.
 * @param {string} voice Learned voice profile markdown.
 * @param {object} run Optional per-job author context.
 * @param {string} run.weeklyBrief Markdown for this run only.
 * @param {string} run.mustMention Phrase to reflect.
 * @param {string} run.neverMention Phrase to avoid.
 * @return {string} System prompt.
 */
function buildSystemPrompt(
  brand: WorkerBrand,
  voice: string,
  run: {weeklyBrief: string; mustMention: string; neverMention: string}
): string {
  const runBrief =
    run.weeklyBrief ||
    "(none — rely on the brand setup and each task's productTruth / hook / notes only)";
  const runMust = run.mustMention || "(none)";
  const runNever = run.neverMention || "(none)";

  return `You are the social media writer for ${brand.brandName}. You write native content for each channel.

VOICE: Match the LEARNED VOICE PROFILE when present. Otherwise: concrete, respectful, no hype. Short lines.

RULES:
- Use ONLY the product facts in the BRAND SETUP below plus the task's "productTruth" line. Do not invent fees, metrics,
  customers, features, or legal outcomes.
- Obey the BANNED / sensitive list literally.
- Honor CONTEXT — THIS RUN when it conflicts with the generic brand setup; never contradict explicit "never mention" lines.
- Write natively for the channel in the task — never paste the same copy across channels.
- Never guarantee income, ROI, or virality. No legal/tax advice.
- Output only the deliverable — no preamble like "Here is your post."

CONTEXT — LEARNED VOICE PROFILE:
---
${voice || "(none — use the default voice above)"}
---

CONTEXT — BRAND SETUP:
---
${truncate(brand.setupBlock, MAX_CTX)}
---

CONTEXT — THIS RUN (submitted with the job; combine with each task's productTruth, hook, and notes):
---
${runBrief}
---

RUN CONSTRAINTS (treat as hard filters when non-empty):
- Must reflect or mention: ${runMust}
- Must not mention or imply: ${runNever}

BANNED / SENSITIVE:
---
${truncate(brand.bannedClaims, MAX_CTX) || "(not configured)"}
---
`;
}

/**
 * Carousel slide-format instructions shared by LinkedIn and Instagram.
 * @param {number} min Min slides.
 * @param {number} max Max slides.
 * @return {string} Format block.
 */
function slideFormat(min: number, max: number): string {
  return `Slides (${min}–${max}), each as:
## Slide N — short label
- title (5 words max)
- 1–2 bullets

Slide 1 is the hook. The last slide is CTA only (soft unless cta is hard_product).`;
}

/**
 * Builds the user message for one queue item, per channel and format.
 * @param {JobItem} item Queue item.
 * @param {string} weekLabel Week label.
 * @param {string} reviewer Reviewer display name.
 * @return {string} User message.
 */
function userMessageForItem(item: JobItem, weekLabel: string, reviewer: string): string {
  const hook =
    (item.hook || "").trim() ||
    "(no hook supplied—propose 2 hook options first)";
  const truth =
    (item.productTruth || "").trim() ||
    "(no productTruth supplied—stay general about the category, no specific product claims)";
  const notes = (item.notes || "").trim();
  const header = `Week: ${weekLabel}
Reviewer (human in the loop): ${reviewer}
Pillar: ${item.pillar}
Hook / direction: ${hook}
Product truth you may assume (do not exceed): ${truth}
CTA type: ${item.cta || "comment"}
Extra notes: ${notes || "none"}`;

  switch (item.format) {
  case "carousel_outline":
    return `${header}

Write a LinkedIn **document carousel outline**.

${slideFormat(7, 10)}`;
  case "x_post":
    return `${header}

Write ONE post for X. Plain text, 280 characters max including spaces. One idea, punchy, no thread.
No hashtags unless essential (max 1). No emojis unless the voice uses them.`;
  case "x_thread":
    return `${header}

Write an X thread of 4–7 posts. Format each as "1/", "2/"… on its own line followed by the post.
Each post is 280 characters max. Post 1 must stand alone as a hook. Last post is the CTA. No hashtags.`;
  case "ig_feed":
    return `${header}

Write an Instagram feed post.

## Visual
One or two sentences describing the single image or graphic to post (what's in frame, any on-image text ≤ 8 words).

## Caption
- First line is the hook (under 125 characters — it shows before "more").
- 3–8 short lines of value. Line breaks between ideas.
- One CTA line (save, share, comment, or link in bio).
- Last line: 3–5 relevant hashtags.`;
  case "ig_carousel":
    return `${header}

Write an Instagram carousel. Put the caption FIRST, then the slides.

## Caption
Hook line (under 125 characters), 2–4 short lines, a "save this" or comment CTA, then 3–5 hashtags.

${slideFormat(5, 8)}`;
  case "ig_reel":
    return `${header}

Write an Instagram Reel (15–45 seconds, vertical).

## Hook (0–2s)
On-screen text + first spoken line.

## Beats
3–5 beats, each with [on-screen text] and what's on camera.

## Spoken script
Teleprompter lines, conversational.

## Caption
Hook line, 1–2 lines, CTA, 3–5 hashtags.

## Audio
Suggest original voiceover vs. trending audio, and why.`;
  case "tiktok_video":
    return `${header}

Write a TikTok video (20–45 seconds, vertical, native — not an ad).

## Hook (0–1s)
Pattern interrupt: first spoken line + [on-screen text]. Must stop the scroll.

## Beats
3–5 fast beats with [on-screen text] cues and what's on camera.

## Spoken script
Teleprompter lines — short sentences, talking-to-a-friend energy.

## Caption
One line + 3–4 hashtags.

## Sound
Original voiceover or trending sound, and why.`;
  default:
    return `${header}

Write ONE LinkedIn post (plain text; avoid markdown headings).

Structure:
- Line 1 must work as the LinkedIn preview (punchy, under ~140 chars if possible).
- Then body: 4–10 short lines. Optional short numbered list (max 3 bullets).
- End with one CTA line. Max 3 hashtags if any.`;
  }
}

/**
 * Calendar title for a draft: the planned hook, else the first line of copy.
 * Mirrors studioTitle in functions/src/linkedinOs/posts.ts.
 * @param {string} hook Planned hook.
 * @param {string} markdown Draft copy.
 * @param {string} fallback Fallback (item id).
 * @return {string} Title.
 */
function studioTitle(hook: string, markdown: string, fallback: string): string {
  const firstLine = markdown.split("\n").find((l) => l.trim() && !l.trim().startsWith("#"))?.trim() ?? "";
  return (hook.trim() || firstLine).replace(/^[-*\d/.\s]+/, "").slice(0, 120) || fallback;
}

/**
 * Groups item indexes into calendar posts: items with the same idea on the same day share a post,
 * one version per channel. Items without an idea, or repeating a channel, get their own post.
 * @param {!Array<JobItem>} items Job items.
 * @return {!Array<!Array<number>>} Groups of item indexes, in item order.
 */
function groupByIdea(items: JobItem[]): number[][] {
  const groups: number[][] = [];
  const open = new Map<string, number[]>();
  items.forEach((item, i) => {
    const idea = (item.idea || "").trim().toLowerCase();
    const day = item.date || item.scheduledAt?.slice(0, 10) || "";
    const channel = item.channel || "linkedin";
    if (!idea) {
      groups.push([i]);
      return;
    }
    const key = `${idea}|${day}`;
    const group = open.get(key);
    if (group && !group.some((j) => (items[j]!.channel || "linkedin") === channel)) {
      group.push(i);
      return;
    }
    const fresh = [i];
    groups.push(fresh);
    open.set(key, fresh);
  });
  return groups;
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
 * Runs a Prism draft job: loads the brand setup, generates drafts per channel, writes outputs.
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
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";

  await ref.update({
    status: "running",
    startedAt: FieldValue.serverTimestamp(),
  });

  try {
    const weeklyBrief = truncate(String(data.weeklyBrief ?? ""), MAX_RUN_BRIEF);
    const mustMention = truncate(String(data.mustMention ?? ""), MAX_RUN_CONSTRAINT);
    const neverMention = truncate(String(data.neverMention ?? ""), MAX_RUN_CONSTRAINT);

    const agencyIdEarly = String(data.agencyId ?? "").trim();
    let voiceBlock = "";
    if (agencyIdEarly) {
      const voiceSnap = await db.collection("linkedin_os_voice_profiles").doc(agencyIdEarly).get();
      if (voiceSnap.exists) {
        const v = voiceSnap.data()!;
        voiceBlock = truncate(
          [
            String(v.voiceSummary ?? ""),
            `Tone: ${Array.isArray(v.toneTraits) ? v.toneTraits.join(", ") : ""}`,
            `Hook patterns: ${Array.isArray(v.hookPatterns) ? v.hookPatterns.join("; ") : ""}`,
            `Topics that work: ${Array.isArray(v.topicsThatWork) ? v.topicsThatWork.join("; ") : ""}`,
            `Avoid: ${Array.isArray(v.topicsToAvoid) ? v.topicsToAvoid.join("; ") : ""}`,
            `CTA style: ${String(v.ctaStyle ?? "")}`,
            `Do: ${Array.isArray(v.doList) ? v.doList.join("; ") : ""}`,
            `Don't: ${Array.isArray(v.dontList) ? v.dontList.join("; ") : ""}`,
            `Sample lines:\n${Array.isArray(v.sampleLines) ? v.sampleLines.map((l: string) => `- ${l}`).join("\n") : ""}`,
          ]
            .filter(Boolean)
            .join("\n"),
          MAX_CTX
        );
      }
    }

    const brand = await loadWorkerBrand(agencyIdEarly);
    const system = buildSystemPrompt(brand, voiceBlock, {
      weeklyBrief,
      mustMention,
      neverMention,
    });

    const items = (data.items || []) as JobItem[];
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Job has no items.");
    }

    const weekLabel = String(data.weekLabel ?? "");
    const reviewer = String(data.reviewer ?? "Reviewer");
    const agencyId = String(data.agencyId ?? "").trim();
    if (!agencyId) {
      throw new Error("Job is missing agencyId.");
    }

    const texts = await Promise.all(
      items.map((item) => geminiComplete(system, userMessageForItem(item, weekLabel, reviewer), apiKey, model))
    );

    const outputs: JobOutput[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const markdown = texts[i]!;
      const output: JobOutput = {
        id: item.id,
        channel: item.channel || "linkedin",
        format: item.format,
        pillar: item.pillar,
        markdown,
        generatedAt: new Date().toISOString(),
        model,
        ...(item.scheduledAt ? {scheduledAt: item.scheduledAt} : {}),
      };

      if (CAROUSEL_FORMATS.has(item.format)) {
        try {
          const pngSlides = await renderCarouselPngs(markdown, brand.theme);
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

    const createdBy = String(data.createdBy ?? "");
    const batch = db.batch();
    for (const group of groupByIdea(items)) {
      const first = group[0]!;
      const firstOut = outputs[first]!;
      const firstItem = items[first]!;
      const postRef = db.collection("prism_posts").doc();
      const variants: Record<string, unknown> = {};
      const times: string[] = [];
      for (const i of group) {
        const output = outputs[i]!;
        output.postId = postRef.id;
        if (output.scheduledAt) times.push(output.scheduledAt);
        variants[output.channel] = {
          format: output.format,
          text: output.markdown,
          generatedAt: output.generatedAt,
          ...(output.carouselAssets ? {assets: {...output.carouselAssets, renderedAt: output.generatedAt}} : {}),
        };
      }
      const idea = (firstItem.idea || "").trim();
      batch.set(postRef, {
        agencyId,
        title: group.length > 1 && idea ? idea.slice(0, 120) : studioTitle(firstItem.hook || idea, firstOut.markdown, firstOut.id),
        angle: firstItem.productTruth || "",
        pillar: firstOut.pillar,
        channels: group.map((i) => outputs[i]!.channel),
        scheduledAt: times.sort()[0] ?? null,
        status: "draft",
        variants,
        history: [{at: firstOut.generatedAt, uid: createdBy, name: reviewer, action: "written in Studio"}],
        source: "studio",
        studio: {jobId, itemId: firstOut.id, ...(group.length > 1 ? {itemIds: group.map((i) => outputs[i]!.id)} : {})},
        createdBy,
        createdByName: reviewer,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    batch.update(ref, {
      status: "completed",
      outputs,
      completedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
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
