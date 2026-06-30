import type {Bucket} from "@google-cloud/storage";
import * as logger from "firebase-functions/logger";
import {HttpsError} from "firebase-functions/v2/https";

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function mimeFromBuffer(buffer: Buffer): string {
  if (buffer.subarray(0, 3).equals(JPEG_MAGIC)) return "image/jpeg";
  if (buffer.subarray(0, 4).equals(PNG_MAGIC)) return "image/png";
  return "image/jpeg";
}

function bufferToDataUri(buffer: Buffer): string {
  const mime = mimeFromBuffer(buffer);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

/** Extract object path from Firebase / GCS URLs for this app's bucket. */
export function storageObjectPathFromUrl(url: string, bucketName: string): string | null {
  try {
    const parsed = new URL(url);

    if (parsed.hostname === "storage.googleapis.com") {
      const prefix = `/${bucketName}/`;
      if (parsed.pathname.startsWith(prefix)) {
        return decodeURIComponent(parsed.pathname.slice(prefix.length));
      }
    }

    if (parsed.hostname === "firebasestorage.googleapis.com") {
      const match = parsed.pathname.match(/\/b\/([^/]+)\/o\/(.+)$/);
      if (match && match[1] === bucketName) {
        return decodeURIComponent(match[2]);
      }
    }
  } catch {
    return null;
  }

  return null;
}

function assertUserOwnsGeneratedScenePath(objectPath: string, userId: string): void {
  const expectedPrefix = `generated-scenes/${userId}/`;
  if (!objectPath.startsWith(expectedPrefix)) {
    throw new HttpsError(
      "permission-denied",
      "Reference image must be from your generated scenes or character portraits."
    );
  }
}

/**
 * Resolve a reference image for multimodal generation.
 * Prefers client-provided data URI (user upload). Otherwise loads from Storage via signed URL.
 */
export async function resolveReferenceImageDataUri(options: {
  imageDataUri?: string;
  referenceImageUrl?: string;
  bucket: Bucket;
  bucketName: string;
  userId: string;
}): Promise<string | null> {
  const {imageDataUri, referenceImageUrl, bucket, bucketName, userId} = options;

  if (typeof imageDataUri === "string" && imageDataUri.length > 0) {
    return imageDataUri;
  }

  if (!referenceImageUrl || typeof referenceImageUrl !== "string") {
    return null;
  }

  const objectPath = storageObjectPathFromUrl(referenceImageUrl, bucketName);
  if (objectPath) {
    assertUserOwnsGeneratedScenePath(objectPath, userId);
    try {
      const [buffer] = await bucket.file(objectPath).download();
      logger.info(`Loaded reference image from Storage for user ${userId}: ${objectPath}`);
      return bufferToDataUri(buffer);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      logger.warn(`Storage download failed for ${objectPath}, falling back to HTTP fetch`, message);
    }
  }

  // Fallback: server-side HTTP fetch (no browser CORS)
  try {
    const fetch = (await import("node-fetch")).default;
    const response = await fetch(referenceImageUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const pathFromUrl = objectPath ?? storageObjectPathFromUrl(referenceImageUrl, bucketName);
    if (pathFromUrl) {
      assertUserOwnsGeneratedScenePath(pathFromUrl, userId);
    }
    logger.info(`Loaded reference image via HTTP for user ${userId}`);
    return bufferToDataUri(buffer);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    logger.error("Failed to load reference image", {userId, message});
    throw new HttpsError("invalid-argument", "Could not load character reference image.");
  }
}
