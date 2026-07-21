import {HttpsError, onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {googleAI} from "@genkit-ai/google-genai";
import {ai} from "../ai/genkit";
import {db} from "../config/firebase";
import type {UserProfileFirestoreData} from "../types";

const MODEL = "gemini-3-flash-preview";
const MAX_PROMPT = 4000;
const MAX_CHAPTERS = 20;
const DEFAULT_CHAPTER_COUNT = 5;

/**
 * Strips obvious script injection; chapter HTML is shown to paying buyers.
 * @param {string} html Raw HTML from the model.
 * @return {string} Safer HTML fragment.
 */
function sanitizeChapterHtml(html: string): string {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<\/?(iframe|object|embed|form|input|button|meta|link)\b[^>]*>/gi, "");
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  return s.trim().slice(0, 20000);
}

function assertCreatorRole(role: string | undefined): void {
  if (role !== "individual_creator" && role !== "talent") {
    throw new HttpsError(
      "permission-denied",
      "Only creators can generate Store course content."
    );
  }
}

function parseJsonFromModel(text: string): unknown {
  const raw = text?.trim() ?? "";
  const jsonMatch = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new HttpsError("internal", "Model returned no JSON.");
  }
  return JSON.parse(jsonMatch[0]);
}

/**
 * Callable: AI-generated course outline or single chapter (HTML) for the Store editor.
 */
export const generateStoreCourseContent = onCall(
  {timeoutSeconds: 120, memory: "512MiB"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to generate course content.");
    }
    const uid = request.auth.uid;

    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) {
      throw new HttpsError("failed-precondition", "User profile not found.");
    }
    const user = userSnap.data() as UserProfileFirestoreData;
    assertCreatorRole(user.role);

    const data = request.data as {
      mode?: unknown;
      userPrompt?: unknown;
      courseTitle?: unknown;
      courseDescription?: unknown;
      chapterCount?: unknown;
      tone?: unknown;
      audience?: unknown;
      chapterTitle?: unknown;
      chapterSummary?: unknown;
      chapterIndex?: unknown;
      priorChapters?: unknown;
      productId?: unknown;
    };

    const mode = data.mode === "chapter" ? "chapter" : "outline";
    const userPrompt =
      typeof data.userPrompt === "string" ? data.userPrompt.trim().slice(0, MAX_PROMPT) : "";
    if (!userPrompt) {
      throw new HttpsError(
        "invalid-argument",
        "Describe what this course should teach or what this chapter should cover."
      );
    }

    const courseTitle =
      typeof data.courseTitle === "string" ? data.courseTitle.trim().slice(0, 120) : "";
    const courseDescription =
      typeof data.courseDescription === "string"
        ? data.courseDescription.trim().slice(0, 2000)
        : "";
    const tone =
      typeof data.tone === "string" ? data.tone.trim().slice(0, 120) : "";
    const audience =
      typeof data.audience === "string" ? data.audience.trim().slice(0, 200) : "";

    const productId =
      typeof data.productId === "string" ? data.productId.trim() : "";
    if (productId) {
      const productSnap = await db.collection("storeProducts").doc(productId).get();
      if (!productSnap.exists) {
        throw new HttpsError("not-found", "Product not found.");
      }
      const product = productSnap.data()!;
      if (product.creatorId !== uid) {
        throw new HttpsError("permission-denied", "Not your product.");
      }
    }

    const creatorName =
      typeof user.displayName === "string" && user.displayName.trim()
        ? user.displayName.trim()
        : "Creator";
    const creatorNiche =
      typeof user.niche === "string" && user.niche.trim()
        ? user.niche.trim().slice(0, 200)
        : null;

    const contextLines = [
      `Creator: ${creatorName}`,
      creatorNiche ? `Creator niche: ${creatorNiche}` : null,
      courseTitle ? `Course title: ${courseTitle}` : null,
      courseDescription ? `Course description: ${courseDescription}` : null,
      tone ? `Tone: ${tone}` : null,
      audience ? `Target audience: ${audience}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      if (mode === "outline") {
        const chapterCountRaw =
          typeof data.chapterCount === "number" ? Math.floor(data.chapterCount) : DEFAULT_CHAPTER_COUNT;
        const chapterCount = Math.min(
          MAX_CHAPTERS,
          Math.max(1, chapterCountRaw || DEFAULT_CHAPTER_COUNT)
        );

        const system = `You are an expert course designer for Verza Store — creators sell digital courses to their audience.

RULES:
- Output valid JSON only (no markdown fences).
- Shape: { "chapters": [ { "title": string, "summary": string } ] }
- Produce exactly ${chapterCount} chapters in logical learning order.
- "title": max 120 chars, specific and actionable.
- "summary": 1–2 sentences, public-facing teaser (max 500 chars) — no spoilers of full lesson content.
- Do not invent pricing, guarantees, or credentials not in the user brief.

CONTEXT:
${contextLines}

USER BRIEF:
---
${userPrompt}
---`;

        const {text} = await ai.generate({
          model: googleAI.model(MODEL),
          prompt: `${system}\n\nGenerate the JSON now.`,
          config: {temperature: 0.7},
        });

        const parsed = parseJsonFromModel(text ?? "") as {
          chapters?: unknown;
        };
        if (!Array.isArray(parsed.chapters) || parsed.chapters.length === 0) {
          throw new HttpsError("internal", "Model returned an empty outline.");
        }

        const chapters = parsed.chapters.slice(0, MAX_CHAPTERS).map((item, index) => {
          const row = (item || {}) as Record<string, unknown>;
          const title =
            typeof row.title === "string" ? row.title.trim().slice(0, 120) : "";
          const summary =
            typeof row.summary === "string" ? row.summary.trim().slice(0, 500) : "";
          if (!title) {
            throw new HttpsError("internal", `Chapter ${index + 1} missing title.`);
          }
          return {title, summary: summary || undefined};
        });

        logger.info("[store] generateStoreCourseContent outline ok", {
          uid,
          productId: productId || null,
          count: chapters.length,
        });
        return {mode: "outline" as const, chapters};
      }

      // chapter mode
      const chapterTitle =
        typeof data.chapterTitle === "string" ? data.chapterTitle.trim().slice(0, 120) : "";
      const chapterSummary =
        typeof data.chapterSummary === "string"
          ? data.chapterSummary.trim().slice(0, 500)
          : "";
      const chapterIndex =
        typeof data.chapterIndex === "number" && Number.isFinite(data.chapterIndex)
          ? Math.max(0, Math.floor(data.chapterIndex))
          : 0;

      const priorChapters = Array.isArray(data.priorChapters)
        ? (data.priorChapters as unknown[])
            .slice(0, 20)
            .map((item) => {
              const row = (item || {}) as Record<string, unknown>;
              const title =
                typeof row.title === "string" ? row.title.trim().slice(0, 120) : "";
              const summary =
                typeof row.summary === "string" ? row.summary.trim().slice(0, 300) : "";
              return title ? {title, summary: summary || undefined} : null;
            })
            .filter(Boolean)
        : [];

      const priorBlock =
        priorChapters.length > 0
          ? `Prior chapters (for continuity — do not repeat):\n${priorChapters
            .map((c, i) => `${i + 1}. ${c!.title}${c!.summary ? ` — ${c!.summary}` : ""}`)
            .join("\n")}`
          : "This may be the first chapter.";

      const chapterFocus = chapterTitle
        ? `CHAPTER TO WRITE (#${chapterIndex + 1}): ${chapterTitle}${chapterSummary ? `\nPublic summary: ${chapterSummary}` : ""}`
        : `CHAPTER #${chapterIndex + 1} (infer title from brief)`;

      const system = `You are an expert course writer for Verza Store. Write one lesson chapter creators sell to fans.

RULES:
- Output valid JSON only (no markdown fences).
- Shape: { "title": string, "summary": string, "bodyHtml": string }
- "title": max 120 chars.
- "summary": 1–2 sentence public teaser (max 500 chars).
- "bodyHtml": rich HTML for ReactQuill. Allowed tags only: p, br, strong, em, ul, ol, li, h2, h3, blockquote.
- Teach clearly: 4–8 short sections with headings, bullets where helpful, actionable steps.
- Total bodyHtml under 12000 characters.
- No scripts, images, or invented claims.

CONTEXT:
${contextLines}

${priorBlock}

${chapterFocus}

USER BRIEF / FOCUS:
---
${userPrompt}
---`;

      const {text} = await ai.generate({
        model: googleAI.model(MODEL),
        prompt: `${system}\n\nGenerate the JSON now.`,
        config: {temperature: 0.65},
      });

      const parsed = parseJsonFromModel(text ?? "") as {
        title?: unknown;
        summary?: unknown;
        bodyHtml?: unknown;
      };
      const title =
        typeof parsed.title === "string"
          ? parsed.title.trim().slice(0, 120)
          : chapterTitle;
      const summary =
        typeof parsed.summary === "string"
          ? parsed.summary.trim().slice(0, 500)
          : chapterSummary;
      const bodyHtml =
        typeof parsed.bodyHtml === "string"
          ? sanitizeChapterHtml(parsed.bodyHtml)
          : "";
      if (!title || !bodyHtml || !bodyHtml.replace(/<[^>]*>/g, "").trim()) {
        throw new HttpsError("internal", "Model returned an empty chapter.");
      }

      logger.info("[store] generateStoreCourseContent chapter ok", {
        uid,
        productId: productId || null,
        chapterIndex,
      });
      return {
        mode: "chapter" as const,
        title,
        summary: summary || undefined,
        bodyHtml,
      };
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("[store] generateStoreCourseContent failed", {uid, mode, error: msg});
      throw new HttpsError(
        "internal",
        "Could not generate course content. Try again in a moment."
      );
    }
  }
);
