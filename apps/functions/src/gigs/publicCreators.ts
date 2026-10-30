import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import type {ContentShowcaseItem, PublicCreator, UserProfileFirestoreData} from "../types";

const PUBLIC_COLLECTION = "public_creators";

/**
 * @param {unknown} value Firestore timestamp.
 * @return {string} ISO timestamp.
 */
function toIso(value: unknown): string {
  if (value && typeof value === "object" && "toDate" in value &&
    typeof (value as {toDate: unknown}).toDate === "function") {
    return (value as {toDate: () => Date}).toDate().toISOString();
  }
  return new Date().toISOString();
}

/**
 * @param {unknown} value Numeric field.
 * @return {number} Finite number or 0.
 */
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {unknown} value Raw handle.
 * @param {RegExp} pattern Allowed handle after stripping a leading @.
 * @return {string | null} Safe handle or null.
 */
function handle(value: unknown, pattern: RegExp): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^@/, "");
  return pattern.test(trimmed) ? trimmed : null;
}

/**
 * @param {boolean} connected Whether Insights is linked.
 * @param {unknown} username Instagram handle.
 * @return {string | null} Public profile URL.
 */
function instagramUrl(connected: boolean, username: unknown): string | null {
  const name = connected ? handle(username, /^[A-Za-z0-9._]{1,30}$/) : null;
  return name ? `https://www.instagram.com/${name}/` : null;
}

/**
 * @param {boolean} connected Whether Insights is linked.
 * @param {unknown} username TikTok handle.
 * @return {string | null} Public profile URL.
 */
function tiktokUrl(connected: boolean, username: unknown): string | null {
  const name = connected ? handle(username, /^[A-Za-z0-9._]{2,24}$/) : null;
  return name ? `https://www.tiktok.com/@${name}` : null;
}

/**
 * @param {boolean} connected Whether Insights is linked.
 * @param {unknown} channelId YouTube channel id.
 * @param {unknown} customUrl YouTube handle or custom URL.
 * @return {string | null} Public channel URL.
 */
function youtubeUrl(connected: boolean, channelId: unknown, customUrl: unknown): string | null {
  if (!connected) return null;
  const named = handle(customUrl, /^[A-Za-z0-9._-]{3,30}$/);
  if (named) return `https://www.youtube.com/@${named}`;
  if (typeof channelId === "string" && /^UC[\w-]{22}$/.test(channelId.trim())) {
    return `https://www.youtube.com/channel/${channelId.trim()}`;
  }
  return null;
}

/**
 * @param {unknown} value Stored showcase array.
 * @return {ContentShowcaseItem[]} Sanitized public clips.
 */
function showcaseItems(value: unknown): ContentShowcaseItem[] {
  if (!Array.isArray(value)) return [];
  const items: ContentShowcaseItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as ContentShowcaseItem;
    if (typeof row.submissionId !== "string" || typeof row.url !== "string") continue;
    if (row.platform !== "youtube" && row.platform !== "tiktok" && row.platform !== "instagram") continue;
    const item: ContentShowcaseItem = {
      submissionId: row.submissionId,
      url: row.url,
      platform: row.platform,
    };
    if (typeof row.verzaScore === "number") item.verzaScore = row.verzaScore;
    if (typeof row.createdAtMs === "number") item.createdAtMs = row.createdAtMs;
    items.push(item);
  }
  return items;
}

/**
 * @param {string} userId Creator uid.
 * @param {UserProfileFirestoreData} user User document.
 * @return {PublicCreator} Fields safe to show on the public profile.
 */
export function toPublicCreator(userId: string, user: UserProfileFirestoreData): PublicCreator {
  const wishlist = Array.isArray(user.brandWishlist) ?
    user.brandWishlist.filter((b): b is string => typeof b === "string" && b.trim().length > 0) :
    [];
  return {
    id: userId,
    displayName: user.displayName?.trim() || "Creator",
    avatarUrl: user.avatarUrl || null,
    niche: user.niche?.trim() || "Content Creator",
    contentType: user.contentType ?? null,
    missionStatement: user.missionStatement?.trim() || null,
    brandWishlist: wishlist,
    instagramConnected: user.instagramConnected === true,
    instagramFollowers: num(user.instagramFollowers),
    instagramEngagement: num(user.instagramEngagement),
    instagramUrl: instagramUrl(user.instagramConnected === true, user.instagramUsername),
    tiktokConnected: user.tiktokConnected === true,
    tiktokFollowers: num(user.tiktokFollowers),
    tiktokEngagement: num(user.tiktokEngagement),
    tiktokUrl: tiktokUrl(user.tiktokConnected === true, user.tiktokUsername),
    youtubeConnected: user.youtubeConnected === true,
    youtubeFollowers: num(user.youtubeFollowers),
    youtubeEngagement: num(user.youtubeEngagement),
    youtubeUrl: youtubeUrl(
      user.youtubeConnected === true,
      user.youtubeChannelId,
      user.youtubeHandle
    ),
    averageVerzaScore: num(user.averageVerzaScore),
    contentShowcase: showcaseItems(user.contentShowcase),
    updatedAtIso: toIso(undefined),
  };
}

/**
 * @param {string} userId Creator uid.
 * @param {UserProfileFirestoreData | null} user User document, or null if deleted.
 * @return {Promise<"written" | "deleted" | "skipped">} Sync result.
 */
export async function syncOnePublicCreator(
  userId: string,
  user: UserProfileFirestoreData | null
): Promise<"written" | "deleted" | "skipped"> {
  const ref = db.collection(PUBLIC_COLLECTION).doc(userId);
  if (!user || user.showInMarketplace !== true) {
    const existing = await ref.get();
    if (!existing.exists) return "skipped";
    await ref.delete();
    return "deleted";
  }
  await ref.set(toPublicCreator(userId, user));
  return "written";
}

/** Keeps indexable creator profiles in step with marketplace users. */
export const syncPublicCreator = onDocumentWritten("users/{userId}", async (event) => {
  const userId = event.params.userId;
  const after = event.data?.after;
  const user = after?.exists ? (after.data() as UserProfileFirestoreData) : null;
  try {
    await syncOnePublicCreator(userId, user);
  } catch (err) {
    logger.error("syncPublicCreator failed", {userId, err});
  }
});

/** Backfills public creator pages for marketplace profiles that predate the trigger. */
export const reconcilePublicCreators = onSchedule("every 24 hours", async () => {
  const listed = await db.collection("users").where("showInMarketplace", "==", true).get();
  let written = 0;
  for (const docSnap of listed.docs) {
    const result = await syncOnePublicCreator(docSnap.id, docSnap.data() as UserProfileFirestoreData);
    if (result === "written") written++;
  }
  const publicSnap = await db.collection(PUBLIC_COLLECTION).get();
  let deleted = 0;
  for (const docSnap of publicSnap.docs) {
    const userSnap = await db.collection("users").doc(docSnap.id).get();
    const result = await syncOnePublicCreator(
      docSnap.id,
      userSnap.exists ? (userSnap.data() as UserProfileFirestoreData) : null
    );
    if (result === "deleted") deleted++;
  }
  logger.info("reconcilePublicCreators done", {written, deleted, listed: listed.size});
});
