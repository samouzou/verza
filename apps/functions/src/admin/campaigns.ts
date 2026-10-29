import {onCall, HttpsError} from "firebase-functions/v2/https";
import type {CallableRequest} from "firebase-functions/v2/https";
import {FieldValue} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import type {Agency, Gig} from "../types";
import {
  START_CAMPAIGN_BUDGET_FIELDS,
  canStartCampaignBudget,
  centsToDollars,
  dollarsToCents,
  gigPlatformFeeFraction,
  isPoolBudgetGig,
} from "../poolBudget";

const VERZA_ADMIN_EMAIL = "serge@tryverza.com";
const FUNDABLE_STATUSES = new Set(["pending_payment", "open", "in-progress", "budget_exhausted"]);

/**
 * @param {CallableRequest} request Callable request.
 * @return {string} Lowercased auth email, or empty.
 */
function adminEmail(request: CallableRequest): string {
  return String(request.auth?.token.email || "").trim().toLowerCase();
}

/**
 * @param {CallableRequest} request Callable request.
 * @return {string} Admin uid.
 */
function assertVerzaAdmin(request: CallableRequest): string {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const email = adminEmail(request);
  if (email !== VERZA_ADMIN_EMAIL) {
    throw new HttpsError("permission-denied", "This page is only available to Verza admin.");
  }
  return request.auth.uid;
}

/**
 * @param {unknown} v Raw value.
 * @return {number} Finite number or 0.
 */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {string} id Gig id.
 * @param {Gig} gig Campaign document.
 * @return {object} Fields the admin UI needs.
 */
function serializeCampaign(id: string, gig: Gig): Record<string, unknown> {
  const createdAt = gig.createdAt as {toDate?: () => Date} | undefined;
  return {
    id,
    title: gig.title || "",
    status: gig.status,
    brandId: gig.brandId,
    campaignType: gig.campaignType || null,
    budgetMode: gig.budgetMode || "flat_fee",
    ratePerCreator: num(gig.ratePerCreator),
    creatorsNeeded: num(gig.creatorsNeeded),
    campaignBudget: num(gig.campaignBudget),
    fundedAmount: num(gig.fundedAmount),
    budgetSpent: num(gig.budgetSpent),
    platformFeeFraction: gigPlatformFeeFraction(gig),
    platformFeePercent: Math.round(gigPlatformFeeFraction(gig) * 1000) / 10,
    createdAt: createdAt?.toDate ? createdAt.toDate().toISOString() : null,
  };
}

/** Whether the signed-in user may open the campaign admin page. */
export const getAdminCampaignAccess = onCall(async (request) => {
  if (!request.auth) return {allowed: false};
  return {allowed: adminEmail(request) === VERZA_ADMIN_EMAIL};
});

/** Recent campaigns, or one campaign by id / title fragment. */
export const listAdminCampaigns = onCall(async (request) => {
  assertVerzaAdmin(request);
  const queryText = String(request.data?.query ?? "").trim();

  if (queryText) {
    const byId = await db.collection("gigs").doc(queryText).get();
    if (byId.exists) {
      return {campaigns: [serializeCampaign(byId.id, byId.data() as Gig)]};
    }
    const snap = await db.collection("gigs").orderBy("createdAt", "desc").limit(80).get();
    const needle = queryText.toLowerCase();
    const campaigns = snap.docs
      .filter((d) => String((d.data() as Gig).title || "").toLowerCase().includes(needle))
      .map((d) => serializeCampaign(d.id, d.data() as Gig));
    return {campaigns};
  }

  const snap = await db.collection("gigs").orderBy("createdAt", "desc").limit(40).get();
  return {campaigns: snap.docs.map((d) => serializeCampaign(d.id, d.data() as Gig))};
});

/**
 * Credit escrow and this campaign's funded amount without charging a card or wallet.
 * Same budget fields as Stripe / wallet funding, including first budget on performance-only campaigns.
 */
export const adminFundCampaign = onCall(async (request) => {
  const adminUid = assertVerzaAdmin(request);
  const gigId = String(request.data?.gigId ?? "").trim();
  const amount = Number(request.data?.amount);
  if (!gigId) throw new HttpsError("invalid-argument", "Campaign ID is required.");
  if (!Number.isFinite(amount) || amount < 1) {
    throw new HttpsError("invalid-argument", "Enter at least $1 to fund.");
  }

  const gigRef = db.collection("gigs").doc(gigId);
  const preview = await gigRef.get();
  if (!preview.exists) throw new HttpsError("not-found", "Campaign not found.");
  const previewGig = preview.data() as Gig;
  if (previewGig.campaignType === "cause_campaign") {
    throw new HttpsError("failed-precondition", "Cause campaigns do not take cash funding.");
  }
  if (!FUNDABLE_STATUSES.has(previewGig.status)) {
    throw new HttpsError(
      "failed-precondition",
      `Cannot fund a campaign in status "${previewGig.status}".`
    );
  }

  const amountCents = dollarsToCents(amount);
  const marker = `manual_${Date.now()}`;

  return db.runTransaction(async (transaction) => {
    const gigSnap = await transaction.get(gigRef);
    const gig = gigSnap.data() as Gig;
    if (gig.campaignType === "cause_campaign") {
      throw new HttpsError("failed-precondition", "Cause campaigns do not take cash funding.");
    }
    if (!FUNDABLE_STATUSES.has(gig.status)) {
      throw new HttpsError(
        "failed-precondition",
        `Cannot fund a campaign in status "${gig.status}".`
      );
    }

    const agencyRef = db.collection("agencies").doc(gig.brandId);
    const agencySnap = await transaction.get(agencyRef);
    if (!agencySnap.exists) throw new HttpsError("not-found", "Brand not found.");
    const agency = agencySnap.data() as Agency | undefined;
    if (!agency) throw new HttpsError("not-found", "Brand not found.");

    const startingBudget = canStartCampaignBudget(gig);
    const fundedCents = dollarsToCents(gig.fundedAmount || 0) + amountCents;
    const budgetCents = dollarsToCents(gig.campaignBudget || 0) + amountCents;
    const updates: {[key: string]: FieldValue | string | number} = {
      ...(startingBudget ? START_CAMPAIGN_BUDGET_FIELDS : {}),
      fundedAmount: centsToDollars(fundedCents),
      lastAdminFundAt: FieldValue.serverTimestamp(),
      lastAdminFundBy: adminUid,
      lastAdminFundAmount: centsToDollars(amountCents),
      lastAdminFundId: marker,
    };
    if (startingBudget || isPoolBudgetGig(gig)) {
      updates.campaignBudget = centsToDollars(budgetCents);
    }
    if (!gig.fundingPaymentIntentId) {
      updates.fundingPaymentIntentId = marker;
    }
    if (gig.status === "pending_payment" || gig.status === "budget_exhausted") {
      updates.status = "open";
    }

    transaction.update(agencyRef, {
      escrowBalance: centsToDollars(dollarsToCents(agency.escrowBalance || 0) + amountCents),
    });
    transaction.update(gigRef, updates);
    return {
      success: true,
      fundedAmount: centsToDollars(fundedCents),
      status: gig.status === "pending_payment" || gig.status === "budget_exhausted" ? "open" : gig.status,
    };
  });
});

/** Set this campaign's Verza fee (percent, 0–50). Used on the next payout. */
export const adminSetCampaignFee = onCall(async (request) => {
  assertVerzaAdmin(request);
  const gigId = String(request.data?.gigId ?? "").trim();
  const percent = Number(request.data?.percent);
  if (!gigId) throw new HttpsError("invalid-argument", "Campaign ID is required.");
  if (!Number.isFinite(percent) || percent < 0 || percent > 50) {
    throw new HttpsError("invalid-argument", "Fee must be between 0 and 50 percent.");
  }

  const gigRef = db.collection("gigs").doc(gigId);
  const snap = await gigRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Campaign not found.");

  const fraction = Math.round(percent * 10) / 1000;
  await gigRef.update({platformFeeFraction: fraction});
  return {success: true, platformFeeFraction: fraction, platformFeePercent: Math.round(fraction * 1000) / 10};
});
