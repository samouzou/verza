import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import type {Gig, PublicCampaign} from "../types";

const PUBLIC_COLLECTION = "public_campaigns";

/** Statuses that keep an existing public page alive (shown as closed) instead of deleting it. */
const CLOSED_BUT_VISIBLE: Gig["status"][] = ["in-progress", "completed", "budget_exhausted"];

export function slugifyCampaign(title: string, gigId: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return base ? `${base}-${gigId}` : gigId;
}

function toIso(value: unknown): string | null {
  if (value && typeof value === "object" && "toDate" in value &&
    typeof (value as {toDate: unknown}).toDate === "function") {
    return (value as {toDate: () => Date}).toDate().toISOString();
  }
  return null;
}

async function brandHasKit(brandId: string | undefined): Promise<boolean> {
  if (!brandId) return false;
  const snap = await db.collection("agencies").doc(brandId).get();
  return snap.data()?.hasBrandKit === true;
}

export function toPublicCampaign(gigId: string, gig: Gig, hasBrandKit = false): PublicCampaign {
  const accepted = Array.isArray(gig.acceptedCreatorIds) ? gig.acceptedCreatorIds.length : 0;
  const creatorsNeeded = Number(gig.creatorsNeeded) || 0;
  const affiliate = gig.affiliateSettings?.isEnabled ? gig.affiliateSettings : null;
  return {
    id: gigId,
    slug: slugifyCampaign(gig.title || "campaign", gigId),
    listed: gig.status === "open" && gig.isPublic !== false,
    status: gig.status,
    title: gig.title || "Creator campaign",
    description: gig.description || "",
    brandName: gig.brandName || "Brand",
    brandLogoUrl: gig.brandLogoUrl ?? null,
    platforms: Array.isArray(gig.platforms) ? gig.platforms : [],
    campaignType: gig.campaignType || "standard_sponsorship",
    ratePerCreator: Number(gig.ratePerCreator) || 0,
    creatorsNeeded,
    spotsLeft: Math.max(0, creatorsNeeded - accepted),
    budgetMode: gig.budgetMode === "pool" ? "pool" : undefined,
    videosPerCreator: Number(gig.videosPerCreator) || 0,
    usageRights: gig.usageRights ?? null,
    allowWhitelisting: Boolean(gig.allowWhitelisting),
    deliverablesDueDate: gig.deliverablesDueDate ?? null,
    requireVerzaScore: Boolean(gig.requireVerzaScore),
    verzaScoreThreshold: gig.requireVerzaScore ? gig.verzaScoreThreshold ?? null : null,
    performanceReward: affiliate ? {
      rewardType: affiliate.rewardType,
      rewardAmount: Number(affiliate.rewardAmount) || 0,
      trackingMethod: affiliate.trackingMethod ?? null,
    } : null,
    hasBrandKit,
    createdAtIso: toIso(gig.createdAt),
    updatedAtIso: new Date().toISOString(),
  };
}

/** Decide what the public copy should be: a projection to write, or null to delete it. */
async function syncOne(gigId: string, gig: Gig | null): Promise<"written" | "deleted" | "skipped"> {
  const ref = db.collection(PUBLIC_COLLECTION).doc(gigId);
  if (!gig || gig.isPublic === false || gig.status === "pending_payment") {
    await ref.delete();
    return "deleted";
  }
  if (gig.status === "open") {
    await ref.set(toPublicCampaign(gigId, gig, await brandHasKit(gig.brandId)));
    return "written";
  }
  if (CLOSED_BUT_VISIBLE.includes(gig.status)) {
    const existing = await ref.get();
    if (!existing.exists) return "skipped";
    await ref.set(toPublicCampaign(gigId, gig, await brandHasKit(gig.brandId)));
    return "written";
  }
  await ref.delete();
  return "deleted";
}

export const syncPublicCampaign = onDocumentWritten("gigs/{gigId}", async (event) => {
  const gigId = event.params.gigId;
  const after = event.data?.after;
  const gig = after?.exists ? (after.data() as Gig) : null;
  try {
    await syncOne(gigId, gig);
  } catch (err) {
    logger.error("syncPublicCampaign failed", {gigId, err});
  }
});

/** Refreshes the teaser flag on a brand's public pages when its kit appears or is cleared. */
export async function setPublicBrandKitFlag(brandId: string, hasBrandKit: boolean): Promise<void> {
  const gigs = await db.collection("gigs").where("brandId", "==", brandId).select().get();
  for (const gig of gigs.docs) {
    const ref = db.collection(PUBLIC_COLLECTION).doc(gig.id);
    const snap = await ref.get();
    if (snap.exists && snap.data()?.hasBrandKit !== hasBrandKit) await ref.update({hasBrandKit});
  }
}

/** Daily reconcile: backfills campaigns that predate the trigger and repairs any drift. */
export const reconcilePublicCampaigns = onSchedule("every 24 hours", async () => {
  const openSnap = await db.collection("gigs").where("status", "==", "open").get();
  let written = 0;
  let deleted = 0;
  for (const doc of openSnap.docs) {
    const result = await syncOne(doc.id, doc.data() as Gig);
    if (result === "written") written++;
    if (result === "deleted") deleted++;
  }

  const publicSnap = await db.collection(PUBLIC_COLLECTION).where("listed", "==", true).get();
  for (const doc of publicSnap.docs) {
    const gigSnap = await db.collection("gigs").doc(doc.id).get();
    const result = await syncOne(doc.id, gigSnap.exists ? (gigSnap.data() as Gig) : null);
    if (result === "deleted") deleted++;
  }
  logger.info("reconcilePublicCampaigns done", {written, deleted, open: openSnap.size});
});
