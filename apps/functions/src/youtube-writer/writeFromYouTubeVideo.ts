import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {googleAI} from "@genkit-ai/google-genai";
import {ai} from "../ai/genkit";
import {db} from "../config/firebase";
import {extractYouTubeVideoId} from "../social/youtubeVideo";
import type {UserProfileFirestoreData} from "../types";

const MODEL = "gemini-3.6-flash";
const MAX_PROMPT = 4000;
const COOLDOWN_SECONDS = 25;
const CREATOR_ROLES = new Set(["individual_creator", "talent"]);

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
 * Maps Gemini / transport errors into clearer callable errors when possible.
 * @param {unknown} err Caught error.
 * @return {HttpsError} Mapped error.
 */
function mapGenerateError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (
    lower.includes("private") ||
    lower.includes("unavailable") ||
    lower.includes("not found") ||
    lower.includes("invalid youtube") ||
    lower.includes("failed to fetch") ||
    lower.includes("cannot process")
  ) {
    return new HttpsError(
      "failed-precondition",
      "Gemini could not access that video. It must be a public YouTube URL."
    );
  }
  return new HttpsError(
    "internal",
    "Could not write from that video. Try again in a moment."
  );
}

/**
 * Callable: watch a public YouTube video with Gemini and return freeform text.
 */
export const writeFromYouTubeVideo = onCall(
  {timeoutSeconds: 180, memory: "512MiB"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to use YouTube Writer.");
    }
    const uid = request.auth.uid;

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new HttpsError("failed-precondition", "User profile not found.");
    }
    const user = userSnap.data() as UserProfileFirestoreData;
    assertCreatorRole(user.role);

    const lastAt = (user as {youtubeWriterLastAt?: Timestamp}).youtubeWriterLastAt;
    if (lastAt && typeof lastAt.toMillis === "function") {
      const elapsedMs = Date.now() - lastAt.toMillis();
      if (elapsedMs < COOLDOWN_SECONDS * 1000) {
        const wait = Math.ceil((COOLDOWN_SECONDS * 1000 - elapsedMs) / 1000);
        throw new HttpsError(
          "resource-exhausted",
          `Please wait ${wait}s before generating again.`
        );
      }
    }

    const data = request.data as {
      youtubeUrl?: unknown;
      prompt?: unknown;
    };

    const youtubeUrl =
      typeof data.youtubeUrl === "string" ? data.youtubeUrl.trim() : "";
    if (!youtubeUrl) {
      throw new HttpsError("invalid-argument", "A YouTube URL is required.");
    }

    const videoId = extractYouTubeVideoId(youtubeUrl);
    if (!videoId) {
      throw new HttpsError(
        "invalid-argument",
        "Enter a valid YouTube video URL (youtube.com or youtu.be)."
      );
    }

    const prompt =
      typeof data.prompt === "string" ? data.prompt.trim().slice(0, MAX_PROMPT) : "";
    if (!prompt) {
      throw new HttpsError(
        "invalid-argument",
        "Tell Gemini what to write about the video."
      );
    }

    const canonicalWatchUrl = `https://www.youtube.com/watch?v=${videoId}`;

    try {
      const {text} = await ai.generate({
        model: googleAI.model(MODEL),
        prompt: [
          {media: {url: canonicalWatchUrl, contentType: "video/*"}},
          {text: prompt},
        ],
        config: {temperature: 0.7},
      });

      const output = text?.trim() ?? "";
      if (!output) {
        throw new HttpsError("internal", "Gemini returned no content.");
      }

      await userRef.update({
        youtubeWriterLastAt: FieldValue.serverTimestamp(),
      });

      logger.info("[youtube-writer] writeFromYouTubeVideo ok", {uid, videoId});
      return {text: output, videoId};
    } catch (err) {
      logger.error("[youtube-writer] writeFromYouTubeVideo failed", {
        uid,
        videoId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw mapGenerateError(err);
    }
  }
);
