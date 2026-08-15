import {createHash, randomUUID} from "node:crypto";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import * as params from "../config/params";

const MAX_AVATAR_BYTES = 1_500_000;

/**
 * Stable Storage object path for a creator profile avatar.
 * @param {string} agencyId Agency id.
 * @param {string} profileUrl Canonical profile URL.
 * @return {string} Storage path.
 */
export function opticAvatarStoragePath(agencyId: string, profileUrl: string): string {
  const key = createHash("sha256").update(profileUrl.trim().toLowerCase()).digest("hex").slice(0, 32);
  return `optic_avatars/${agencyId}/${key}.jpg`;
}

/**
 * Decodes a data URL (or raw base64) into a buffer + content type.
 * @param {string} raw Data URL or base64 payload.
 * @return {object | null} Buffer + contentType, or null if invalid.
 */
export function decodeAvatarDataUrl(raw: string): {buffer: Buffer; contentType: string} | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const dataUrlMatch = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (dataUrlMatch) {
    const contentType = dataUrlMatch[1].toLowerCase();
    const buffer = Buffer.from(dataUrlMatch[2], "base64");
    if (!buffer.length || buffer.length > MAX_AVATAR_BYTES) return null;
    if (!contentType.startsWith("image/")) return null;
    return {buffer, contentType};
  }

  // Raw base64 fallback (assume jpeg).
  try {
    const buffer = Buffer.from(trimmed, "base64");
    if (!buffer.length || buffer.length > MAX_AVATAR_BYTES) return null;
    return {buffer, contentType: "image/jpeg"};
  } catch {
    return null;
  }
}

/**
 * Uploads an Optic lead avatar to Storage and returns a durable download URL.
 * @param {object} args Agency, profile URL, and image payload.
 * @return {Promise<string | null>} Public Firebase download URL, or null on failure.
 */
export async function persistOpticAvatar(args: {
  agencyId: string;
  profileUrl: string;
  /** data:image/...;base64,... from the extension (preferred). */
  avatarDataUrl?: string | null;
  /** Hotlink fallback — may fail if the CDN blocks Cloud Functions. */
  avatarSourceUrl?: string | null;
}): Promise<string | null> {
  let decoded = args.avatarDataUrl ? decodeAvatarDataUrl(args.avatarDataUrl) : null;

  if (!decoded && args.avatarSourceUrl?.trim()) {
    decoded = await fetchAvatarFromUrl(args.avatarSourceUrl.trim());
  }
  if (!decoded) return null;

  try {
    if (!admin.apps.length) {
      admin.initializeApp();
    }
    const bucketName = params.APP_STORAGE_BUCKET.value();
    const bucket = admin.storage().bucket(bucketName || undefined);
    const storagePath = opticAvatarStoragePath(args.agencyId, args.profileUrl);
    const file = bucket.file(storagePath);
    const token = randomUUID();

    await file.save(decoded.buffer, {
      resumable: false,
      metadata: {
        contentType: decoded.contentType.startsWith("image/") ?
          decoded.contentType :
          "image/jpeg",
        cacheControl: "public,max-age=31536000",
        metadata: {
          firebaseStorageDownloadTokens: token,
        },
      },
    });

    const encoded = encodeURIComponent(storagePath);
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media&token=${token}`;
  } catch (e) {
    logger.warn("[Optic avatar] Upload failed", {
      agencyId: args.agencyId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Best-effort fetch of a remote avatar URL (worker / CDN fallback).
 * @param {string} url Remote image URL.
 * @return {Promise<object | null>} Decoded image, or null.
 */
async function fetchAvatarFromUrl(
  url: string
): Promise<{buffer: Buffer; contentType: string} | null> {
  try {
    if (!/^https:\/\//i.test(url)) return null;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: "https://www.instagram.com/",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    if (!contentType.startsWith("image/")) return null;
    const ab = await res.arrayBuffer();
    const buffer = Buffer.from(ab);
    if (!buffer.length || buffer.length > MAX_AVATAR_BYTES) return null;
    return {buffer, contentType};
  } catch {
    return null;
  }
}
