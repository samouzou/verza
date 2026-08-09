import {HttpsError, onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {googleAI} from "@genkit-ai/google-genai";
import {ai} from "../ai/genkit";
import {db} from "../config/firebase";
import type {UserProfileFirestoreData} from "../types";

const MODEL = "gemini-3.6-flash";
const MAX_SOURCE = 12000;
const CREATOR_ROLES = new Set(["individual_creator", "talent"]);
const PLATFORMS = new Set(["linkedin", "instagram"]);

type SocialPlatform = "linkedin" | "instagram";

/**
 * Ensures the caller is a creator role allowed to use YouTube Writer.
 * @param {string | undefined} role User role from Firestore.
 */
function assertCreatorRole(role: string | undefined): void {
  if (!role || !CREATOR_ROLES.has(role)) {
    throw new HttpsError(
      "permission-denied",
      "Only creators can use YouTube Writer."
    );
  }
}

/**
 * Platform-specific rewrite instructions.
 * @param {SocialPlatform} platform Target network.
 * @return {string} Instruction block.
 */
function platformInstructions(platform: SocialPlatform): string {
  if (platform === "linkedin") {
    return `Rewrite the SOURCE into one LinkedIn post ready to paste.

Rules:
- Professional but human; operator-insider tone, no corporate fluff.
- Strong opening hook in the first 1–2 lines.
- Short paragraphs with line breaks (mobile-friendly).
- End with a soft CTA or question.
- At most 3 relevant hashtags, at the end.
- No markdown headings, no bullet-list dump unless natural.
- Stay faithful to facts in SOURCE — do not invent claims.
- Output ONLY the post text.`;
  }

  return `Rewrite the SOURCE into one Instagram caption ready to paste.

Rules:
- Conversational caption voice; scannable on mobile.
- Hook in the first line.
- Keep it tighter than LinkedIn (aim under ~1,500 characters).
- Light emoji only if it helps rhythm — never spam.
- Put 3–8 relevant hashtags on their own lines at the end.
- Stay faithful to facts in SOURCE — do not invent claims.
- Output ONLY the caption text.`;
}

/**
 * Callable: adapt a YouTube Writer draft for LinkedIn or Instagram, return copyable text.
 */
export const adaptYouTubeWriterDraft = onCall(
  {timeoutSeconds: 60, memory: "512MiB"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to adapt a draft.");
    }
    const uid = request.auth.uid;

    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) {
      throw new HttpsError("failed-precondition", "User profile not found.");
    }
    const user = userSnap.data() as UserProfileFirestoreData;
    assertCreatorRole(user.role);

    const data = request.data as {
      text?: unknown;
      platform?: unknown;
    };

    const source =
      typeof data.text === "string" ? data.text.trim().slice(0, MAX_SOURCE) : "";
    if (!source) {
      throw new HttpsError("invalid-argument", "Draft text is required.");
    }

    if (typeof data.platform !== "string" || !PLATFORMS.has(data.platform)) {
      throw new HttpsError(
        "invalid-argument",
        "platform must be linkedin or instagram."
      );
    }
    const platform = data.platform as SocialPlatform;

    const prompt = `${platformInstructions(platform)}

SOURCE:
---
${source}
---
`;

    try {
      const {text} = await ai.generate({
        model: googleAI.model(MODEL),
        prompt,
        config: {temperature: 0.65},
      });

      const output = text?.trim() ?? "";
      if (!output) {
        throw new HttpsError("internal", "Gemini returned no adapted text.");
      }

      logger.info("[youtube-writer] adaptYouTubeWriterDraft ok", {uid, platform});
      return {platform, text: output};
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error("[youtube-writer] adaptYouTubeWriterDraft failed", {
        uid,
        platform,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError(
        "internal",
        "Could not adapt that draft. Try again in a moment."
      );
    }
  }
);
