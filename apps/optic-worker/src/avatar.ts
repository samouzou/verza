import {createHash, randomUUID} from "node:crypto";
import * as admin from "firebase-admin";

const MAX_AVATAR_BYTES = 1_500_000;

function storageBucket() {
  const name =
    process.env.APP_STORAGE_BUCKET?.trim() ||
    process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
    "";
  return name ? admin.storage().bucket(name) : admin.storage().bucket();
}

function opticAvatarStoragePath(agencyId: string, profileUrl: string): string {
  const key = createHash("sha256").update(profileUrl.trim().toLowerCase()).digest("hex").slice(0, 32);
  return `optic_avatars/${agencyId}/${key}.jpg`;
}

function refererFor(url: string): string {
  try {
    return new URL(url).origin + "/";
  } catch {
    return "https://www.youtube.com/";
  }
}

async function fetchAvatarFromUrl(
  url: string,
  profileUrl?: string | null
): Promise<{buffer: Buffer; contentType: string} | null> {
  try {
    if (!/^https:\/\//i.test(url)) return null;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: refererFor(profileUrl || url),
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    if (!contentType.startsWith("image/")) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_AVATAR_BYTES) return null;
    return {buffer, contentType};
  } catch {
    return null;
  }
}

async function uploadAvatar(args: {
  agencyId: string;
  profileUrl: string;
  buffer: Buffer;
  contentType: string;
}): Promise<string | null> {
  try {
    const bucket = storageBucket();
    const storagePath = opticAvatarStoragePath(args.agencyId, args.profileUrl);
    const file = bucket.file(storagePath);
    const token = randomUUID();
    await file.save(args.buffer, {
      resumable: false,
      metadata: {
        contentType: args.contentType.startsWith("image/") ? args.contentType : "image/jpeg",
        cacheControl: "public,max-age=31536000",
        metadata: {firebaseStorageDownloadTokens: token},
      },
    });
    const encoded = encodeURIComponent(storagePath);
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media&token=${token}`;
  } catch (e) {
    console.warn(
      "[Optic avatar] Upload failed",
      e instanceof Error ? e.message : String(e)
    );
    return null;
  }
}

/** Stores a durable Firebase download URL from in-browser bytes or a remote URL. */
export async function persistOpticAvatar(args: {
  agencyId: string;
  profileUrl: string;
  avatarBytes?: Buffer | null;
  avatarContentType?: string | null;
  avatarSourceUrl?: string | null;
}): Promise<string | null> {
  let decoded: {buffer: Buffer; contentType: string} | null = null;
  if (args.avatarBytes && args.avatarBytes.length && args.avatarBytes.length <= MAX_AVATAR_BYTES) {
    decoded = {
      buffer: args.avatarBytes,
      contentType: args.avatarContentType?.startsWith("image/")
        ? args.avatarContentType
        : "image/jpeg",
    };
  } else if (args.avatarSourceUrl?.trim()) {
    decoded = await fetchAvatarFromUrl(args.avatarSourceUrl.trim(), args.profileUrl);
  }
  if (!decoded) return null;
  return uploadAvatar({
    agencyId: args.agencyId,
    profileUrl: args.profileUrl,
    buffer: decoded.buffer,
    contentType: decoded.contentType,
  });
}

/** @deprecated Prefer persistOpticAvatar with in-browser bytes. */
export async function persistOpticAvatarFromUrl(args: {
  agencyId: string;
  profileUrl: string;
  avatarSourceUrl?: string | null;
}): Promise<string | null> {
  return persistOpticAvatar(args);
}
