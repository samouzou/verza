import {FieldValue} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {db} from "../config/firebase";
import {loadAgencyOpticBilling, type OpticPlanTier} from "../optic/billing";
import type {Agency} from "../types";

export const ACTIVE_CAMPAIGN_STATUSES = new Set(["open", "in-progress"]);
export const FREE_ACTIVE_CAMPAIGN_LIMIT = 1;
export const PAID_OPTIC_CAMPAIGN_TIERS = new Set<OpticPlanTier>([
  "launch",
  "pilot",
  "enterprise",
  "flagship",
  "appsumo",
]);

/**
 * Counts live campaigns for a brand (open or in-progress).
 * @param {string} agencyId Agency / brand id.
 * @return {Promise<number>} Active campaign count.
 */
export async function countActiveCampaigns(agencyId: string): Promise<number> {
  const snap = await db.collection("gigs").where("brandId", "==", agencyId).get();
  return snap.docs.filter((doc) => ACTIVE_CAMPAIGN_STATUSES.has(String(doc.data().status ?? ""))).length;
}

/**
 * First active campaign is free. A second live campaign requires a paid Optic plan.
 * @param {string} agencyId Agency / brand id.
 * @return {Promise<void>} Resolves when launch is allowed.
 */
export async function assertCanLaunchCampaign(agencyId: string): Promise<void> {
  const active = await countActiveCampaigns(agencyId);
  if (active < FREE_ACTIVE_CAMPAIGN_LIMIT) {
    return;
  }
  const billing = await loadAgencyOpticBilling(agencyId);
  if (billing.subscriptionActive && PAID_OPTIC_CAMPAIGN_TIERS.has(billing.plan)) {
    return;
  }
  throw new HttpsError(
    "failed-precondition",
    "You already have an active campaign. Upgrade to Optic Launch to run more than one at a time."
  );
}

/** Performance-only / $0 campaigns — server-side create so the free-slot gate cannot be bypassed. */
export const launchFreeCampaign = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to launch a campaign.");
  }
  const userId = request.auth.uid;
  const {
    title,
    description,
    platforms,
    creatorsNeeded,
    videosPerCreator,
    campaignType,
    usageRights,
    allowWhitelisting,
    affiliateSettings,
    requireVerzaScore,
    verzaScoreThreshold,
    deliverablesDueDate,
  } = request.data ?? {};

  if (!title || !description || !platforms || !videosPerCreator || !campaignType) {
    throw new HttpsError("invalid-argument", "Missing required campaign details.");
  }

  const userSnap = await db.collection("users").doc(userId).get();
  const userData = userSnap.data();
  const agencyId = userData?.primaryAgencyId as string | undefined;
  if (!agencyId) {
    throw new HttpsError("failed-precondition", "You must be part of an agency to launch a campaign.");
  }

  const agencySnap = await db.collection("agencies").doc(agencyId).get();
  if (!agencySnap.exists) {
    throw new HttpsError("not-found", "Agency not found.");
  }
  const agency = agencySnap.data() as Agency;
  const isTeam =
    agency.ownerId === userId ||
    agency.team?.some((m) => m.userId === userId);
  if (!isTeam) {
    throw new HttpsError("permission-denied", "Only your brand team can launch campaigns.");
  }

  await assertCanLaunchCampaign(agencyId);

  const creatorsNum = Number(creatorsNeeded);
  if (campaignType === "cause_campaign") {
    if (!Number.isFinite(creatorsNum) || creatorsNum < 0) {
      throw new HttpsError("invalid-argument", "Invalid creators count.");
    }
  } else if (!Number.isFinite(creatorsNum) || creatorsNum <= 0) {
    throw new HttpsError("invalid-argument", "A positive number of creators is required.");
  }

  const ownerSnap = await db.collection("users").doc(agency.ownerId).get();
  const gigRef = db.collection("gigs").doc();
  await gigRef.set({
    brandId: agencyId,
    brandName: agency.name || "Brand",
    brandLogoUrl: ownerSnap.data()?.companyLogoUrl || null,
    title: String(title).trim(),
    description: String(description).trim(),
    platforms,
    ratePerCreator: 0,
    creatorsNeeded: campaignType === "cause_campaign" ? 0 : creatorsNum,
    videosPerCreator: Number(videosPerCreator),
    campaignType,
    usageRights: usageRights || null,
    allowWhitelisting: !!allowWhitelisting,
    requireVerzaScore: requireVerzaScore ?? true,
    verzaScoreThreshold: verzaScoreThreshold ?? 65,
    status: "open",
    acceptedCreatorIds: [],
    paidCreatorIds: [],
    createdAt: FieldValue.serverTimestamp(),
    fundedAmount: 0,
    affiliateSettings: affiliateSettings || {isEnabled: false},
    ...(deliverablesDueDate ? {deliverablesDueDate} : {}),
  });

  return {gigId: gigRef.id};
});
