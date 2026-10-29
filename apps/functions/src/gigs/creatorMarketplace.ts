import {type DocumentData, type Timestamp} from "firebase-admin/firestore";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import type {ContentShowcaseItem, ContentShowcasePlatform, UserProfileFirestoreData} from "../types";
import {syncOnePublicCreator} from "./publicCreators";

const SHOWCASE_CAP = 6;

/**
 * @param {string} url Submission video URL.
 * @return {ContentShowcasePlatform | null} Public social host, or null for private uploads.
 */
export function publicShowcasePlatform(url: string): ContentShowcasePlatform | null {
  let host: string;
  try {
    host = new URL(url.trim()).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    return "youtube";
  }
  if (host === "tiktok.com" || host === "m.tiktok.com" || host === "vm.tiktok.com" || host === "vt.tiktok.com") {
    return "tiktok";
  }
  if (host === "instagram.com" || host === "instagr.am") {
    return "instagram";
  }
  return null;
}

/**
 * @param {unknown} value Firestore timestamp or millis.
 * @return {number} Epoch millis.
 */
function toMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    const ts = value as Timestamp;
    if (typeof ts.toMillis === "function") return ts.toMillis();
    if (typeof ts.toDate === "function") return ts.toDate().getTime();
  }
  return 0;
}

/**
 * Rebuilds marketplace proof fields from a creator's submissions.
 * @param {string} creatorId User id.
 */
export async function rebuildCreatorMarketplaceProof(creatorId: string): Promise<void> {
  const snap = await db.collection("submissions").where("creatorId", "==", creatorId).get();
  const scores: number[] = [];
  const items: ContentShowcaseItem[] = [];

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const score = Number(data.verzaScore);
    if (Number.isFinite(score) && score > 0) scores.push(score);

    const url = typeof data.videoUrl === "string" ? data.videoUrl : "";
    const platform = url ? publicShowcasePlatform(url) : null;
    if (data.status !== "approved" || !platform) continue;

    const item: ContentShowcaseItem = {
      submissionId: docSnap.id,
      url,
      platform,
      createdAtMs: toMs(data.createdAt),
    };
    if (Number.isFinite(score) && score > 0) item.verzaScore = Math.round(score);
    items.push(item);
  }

  items.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
  const contentShowcase = items.slice(0, SHOWCASE_CAP);
  const averageVerzaScore = scores.length ?
    Math.round(scores.reduce((sum, n) => sum + n, 0) / scores.length) :
    0;

  const userRef = db.collection("users").doc(creatorId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    logger.warn("skip marketplace proof; missing user", {creatorId});
    return;
  }

  await userRef.update({
    contentShowcase,
    averageVerzaScore,
  });
  const latest = await userRef.get();
  if (latest.exists) {
    await syncOnePublicCreator(creatorId, latest.data() as UserProfileFirestoreData);
  }
}

/**
 * @param {DocumentData | undefined} before Previous submission.
 * @param {DocumentData | undefined} after Next submission.
 * @return {boolean} Whether marketplace proof fields changed.
 */
function relevantChanged(
  before: DocumentData | undefined,
  after: DocumentData | undefined
): boolean {
  if (!before || !after) return true;
  return before.status !== after.status ||
    before.videoUrl !== after.videoUrl ||
    before.verzaScore !== after.verzaScore ||
    before.creatorId !== after.creatorId;
}

/** Keeps marketplace showcase and average Verza Score in step with submissions. */
export const syncCreatorMarketplaceProof = onDocumentWritten(
  "submissions/{submissionId}",
  async (event) => {
    const after = event.data?.after?.exists ? event.data.after.data() : undefined;
    const before = event.data?.before?.exists ? event.data.before.data() : undefined;
    if (!relevantChanged(before, after)) return;

    const creatorIds = new Set<string>();
    for (const data of [before, after]) {
      const id = data?.creatorId;
      if (typeof id === "string" && id) creatorIds.add(id);
    }
    await Promise.all([...creatorIds].map((id) => rebuildCreatorMarketplaceProof(id)));
  }
);
