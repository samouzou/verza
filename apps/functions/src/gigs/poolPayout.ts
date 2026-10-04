import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {DocumentReference, FieldValue, Timestamp} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import type {Agency, Gig, InternalPayout, Notification, UserProfileFirestoreData} from "../types";
import {
  centsToDollars,
  dollarsToCents,
  isPoolBudgetGig,
  maxCreatorPayoutCents,
  poolDrawForCreatorAmount,
  poolRemainingCents,
} from "../poolBudget";

const PAYABLE_STATUSES = new Set(["open", "in-progress", "budget_exhausted"]);

function assertPoolGig(gig: Gig): void {
  if (!isPoolBudgetGig(gig)) {
    throw new HttpsError("failed-precondition", "This campaign uses a flat creator rate.");
  }
}

async function assertBrandTeam(agencyId: string, requesterId: string, agencyData?: Agency): Promise<Agency> {
  const agency = agencyData ?? (await db.collection("agencies").doc(agencyId).get()).data() as Agency | undefined;
  if (!agency) {
    throw new HttpsError("not-found", "Brand not found.");
  }
  const isTeam = agency.ownerId === requesterId ||
    agency.team?.some((m) => m.userId === requesterId && (m.role === "admin" || m.role === "member"));
  if (!isTeam) {
    throw new HttpsError("permission-denied", "Only the brand team can move this campaign's budget.");
  }
  return agency;
}

function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

/**
 * Pay one creator a chosen amount from a pool campaign.
 * The creator receives that amount (minus any talent-agency commission).
 * Verza's 15% is an additional debit on this campaign's remaining budget and the brand escrow.
 */
export async function payoutPoolCreator(args: {
  gigId: string;
  creatorId: string;
  amount: unknown;
  gigData: Gig;
}): Promise<{
  success: true;
  creatorAmount: number;
  platformFee: number;
  totalDraw: number;
  creatorNet: number;
}> {
  const {gigId, creatorId, gigData} = args;
  assertPoolGig(gigData);

  const creatorAmountUsd = Number(args.amount);
  if (!Number.isFinite(creatorAmountUsd) || creatorAmountUsd < 1) {
    throw new HttpsError("invalid-argument", "Enter at least $1 to pay this creator.");
  }

  const draw = poolDrawForCreatorAmount(creatorAmountUsd);
  const assignment = gigData.assignments?.[creatorId];
  const agencyCommissionCents = assignment ?
    Math.round(draw.creatorAmountCents * (Number(assignment.commissionRate) || 0) / 100) :
    0;
  const creatorNetCents = draw.creatorAmountCents - agencyCommissionCents;

  const gigDocRef = db.collection("gigs").doc(gigId);
  const creatorDocRef = db.collection("users").doc(creatorId);
  const agencyDocRef = db.collection("agencies").doc(gigData.brandId);

  const creatorSnap = await creatorDocRef.get();
  if (!creatorSnap.exists) {
    throw new HttpsError("not-found", "Creator profile not found.");
  }
  const creatorData = creatorSnap.data() as UserProfileFirestoreData;

  let talentAgencyOwnerId: string | null = null;
  let brandOwnerId = "";
  let creatorNetDollars = 0;

  await db.runTransaction(async (transaction) => {
    const currentGigSnap = await transaction.get(gigDocRef);
    const currentGig = currentGigSnap.data() as Gig | undefined;
    if (!currentGig) throw new HttpsError("not-found", "Campaign not found.");
    assertPoolGig(currentGig);
    if (!PAYABLE_STATUSES.has(currentGig.status)) {
      throw new HttpsError("failed-precondition", "This campaign is not open for payouts.");
    }
    if (!currentGig.acceptedCreatorIds?.includes(creatorId)) {
      throw new HttpsError("failed-precondition", "This creator has not been accepted on the campaign.");
    }
    if (currentGig.paidCreatorIds?.includes(creatorId)) {
      throw new HttpsError("already-exists", "This creator has already been paid for this campaign.");
    }

    const remaining = poolRemainingCents(currentGig);
    if (draw.totalDrawCents > remaining) {
      const max = maxCreatorPayoutCents(remaining);
      throw new HttpsError(
        "failed-precondition",
        remaining < 100 ?
          "This campaign budget is used up. Add funds before paying another creator." :
          `This campaign has $${formatUsd(remaining)} left. The most you can pay this creator is $${formatUsd(max)}.`
      );
    }

    const brandAgencySnap = await transaction.get(agencyDocRef);
    const brandAgency = brandAgencySnap.data() as Agency | undefined;
    if (!brandAgency) throw new HttpsError("not-found", "Brand not found.");
    brandOwnerId = brandAgency.ownerId;

    let talentAgency: Agency | null = null;
    let talentAgencyDocRef: DocumentReference | null = null;
    if (assignment && agencyCommissionCents > 0) {
      talentAgencyDocRef = db.collection("agencies").doc(assignment.agencyId);
      const talentAgencySnap = await transaction.get(talentAgencyDocRef);
      if (talentAgencySnap.exists) {
        talentAgency = talentAgencySnap.data() as Agency;
        talentAgencyOwnerId = talentAgency.ownerId;
      }
    }

    const escrowCents = dollarsToCents(brandAgency.escrowBalance || 0);
    if (escrowCents < draw.totalDrawCents) {
      throw new HttpsError(
        "failed-precondition",
        "Brand escrow does not cover this payout. Add funds to the campaign before paying."
      );
    }

    const spentCents = dollarsToCents(currentGig.budgetSpent || 0) + draw.totalDrawCents;
    const lockedCents = dollarsToCents(currentGig.fundedAmount || 0);
    const gigUpdates: {[key: string]: any} = {
      paidCreatorIds: FieldValue.arrayUnion(creatorId),
      budgetSpent: centsToDollars(spentCents),
      [`creatorPayouts.${creatorId}`]: {
        creatorAmount: centsToDollars(draw.creatorAmountCents),
        platformFee: centsToDollars(draw.platformFeeCents),
        agencyCommission: centsToDollars(agencyCommissionCents),
        creatorNet: centsToDollars(creatorNetCents),
        totalDraw: centsToDollars(draw.totalDrawCents),
        paidAt: Timestamp.now(),
      },
    };
    if (lockedCents - spentCents <= 0) {
      gigUpdates.status = "budget_exhausted";
    }
    transaction.update(gigDocRef, gigUpdates);
    transaction.update(agencyDocRef, {
      escrowBalance: centsToDollars(escrowCents - draw.totalDrawCents),
    });

    creatorNetDollars = centsToDollars(creatorNetCents);
    if (creatorNetCents > 0) {
      transaction.update(creatorDocRef, {
        walletBalance: FieldValue.increment(creatorNetDollars),
      });
      const earningsRef = db.collection("internalPayouts").doc();
      transaction.set(earningsRef, {
        id: earningsRef.id,
        type: "creator_payment",
        agencyId: gigData.brandId,
        agencyName: brandAgency.name || "Brand",
        agencyOwnerId: brandAgency.ownerId,
        talentId: creatorId,
        talentName: creatorData.displayName || "Unknown Creator",
        amount: creatorNetDollars,
        platformFee: centsToDollars(draw.platformFeeCents),
        description: `Payment for campaign: ${currentGig.title}`,
        status: "pending",
        initiatedAt: FieldValue.serverTimestamp(),
        paidAt: null,
      } as unknown as InternalPayout);
    }

    const feeRef = db.collection("platformFees").doc();
    transaction.set(feeRef, {
      id: feeRef.id,
      gigId,
      agencyId: gigData.brandId,
      creatorId,
      creatorAmount: centsToDollars(draw.creatorAmountCents),
      platformFee: centsToDollars(draw.platformFeeCents),
      totalDraw: centsToDollars(draw.totalDrawCents),
      createdAt: FieldValue.serverTimestamp(),
    });

    if (talentAgency && talentAgencyDocRef && assignment) {
      const commissionAmount = centsToDollars(agencyCommissionCents);
      transaction.update(talentAgencyDocRef, {
        availableBalance: (talentAgency.availableBalance || 0) + commissionAmount,
        updatedAt: FieldValue.serverTimestamp(),
      });
      const payoutRef = db.collection("internalPayouts").doc();
      transaction.set(payoutRef, {
        id: payoutRef.id,
        type: "agency_commission",
        agencyId: assignment.agencyId,
        agencyName: talentAgency.name,
        agencyOwnerId: talentAgency.ownerId,
        talentId: creatorId,
        talentName: creatorData.displayName || "Unknown Creator",
        amount: commissionAmount,
        description: `Commission (${assignment.commissionRate}%) for ${currentGig.title}`,
        status: "pending",
        initiatedAt: FieldValue.serverTimestamp(),
        paidAt: null,
      } as unknown as InternalPayout);
    }
  });

  await db.collection("notifications").add({
    userId: creatorId,
    title: "Funds Added to Wallet!",
    message: `Your work for "${gigData.title}" has been approved. $${creatorNetDollars.toFixed(2)} has been added to your Verza wallet.`,
    type: "payout_received",
    read: false,
    link: "/wallet",
    createdAt: FieldValue.serverTimestamp(),
  } as unknown as Omit<Notification, "id">);

  if (assignment && talentAgencyOwnerId) {
    await db.collection("notifications").add({
      userId: talentAgencyOwnerId,
      title: "Agency Commission Added!",
      message: `Your commission for ${creatorData.displayName}'s work on "${gigData.title}" has been added to your agency balance.`,
      type: "payout_received",
      read: false,
      link: "/agency/dashboard",
      createdAt: FieldValue.serverTimestamp(),
    } as unknown as Omit<Notification, "id">);
  }

  if (brandOwnerId) {
    const updated = await gigDocRef.get();
    if (updated.data()?.status === "budget_exhausted") {
      await db.collection("notifications").add({
        userId: brandOwnerId,
        title: "Campaign budget used",
        message: `"${gigData.title}" has no budget left. Add funds to pay more creators, or close the campaign.`,
        type: "system",
        read: false,
        link: `/campaigns/${gigId}`,
        createdAt: FieldValue.serverTimestamp(),
      } as unknown as Omit<Notification, "id">);
    }
  }

  logger.info(`Pool payout for creator ${creatorId} on campaign ${gigId}.`, {
    creatorAmount: centsToDollars(draw.creatorAmountCents),
    platformFee: centsToDollars(draw.platformFeeCents),
  });

  return {
    success: true,
    creatorAmount: centsToDollars(draw.creatorAmountCents),
    platformFee: centsToDollars(draw.platformFeeCents),
    totalDraw: centsToDollars(draw.totalDrawCents),
    creatorNet: creatorNetDollars,
  };
}

/** Move this campaign's unused budget from escrow back to the brand wallet and close it. */
export const releaseUnspentCampaignBudget = onCall({invoker: "public"}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }
  const gigId = request.data?.gigId as string | undefined;
  if (!gigId) throw new HttpsError("invalid-argument", "Campaign ID is required.");

  const requesterId = request.auth.uid;
  const gigRef = db.collection("gigs").doc(gigId);
  const preview = await gigRef.get();
  if (!preview.exists) throw new HttpsError("not-found", "Campaign not found.");
  const previewGig = preview.data() as Gig;
  assertPoolGig(previewGig);
  await assertBrandTeam(previewGig.brandId, requesterId);

  if (previewGig.status === "pending_payment") {
    throw new HttpsError("failed-precondition", "This campaign has not been funded yet.");
  }

  return db.runTransaction(async (transaction) => {
    const gigSnap = await transaction.get(gigRef);
    const gig = gigSnap.data() as Gig;
    assertPoolGig(gig);
    const agencyRef = db.collection("agencies").doc(gig.brandId);
    const agencySnap = await transaction.get(agencyRef);
    const agency = agencySnap.data() as Agency;
    await assertBrandTeam(gig.brandId, requesterId, agency);

    const remaining = poolRemainingCents(gig);
    const locked = dollarsToCents(gig.fundedAmount || 0);
    if (remaining <= 0) {
      if (gig.status !== "completed") {
        transaction.update(gigRef, {status: "completed"});
      }
      return {success: true, released: 0};
    }

    const escrowCents = dollarsToCents(agency.escrowBalance || 0);
    if (escrowCents < remaining) {
      throw new HttpsError(
        "failed-precondition",
        "Escrow is short of this campaign's remaining budget. Contact support before closing it."
      );
    }

    transaction.update(agencyRef, {
      escrowBalance: centsToDollars(escrowCents - remaining),
      availableBalance: centsToDollars(dollarsToCents(agency.availableBalance || 0) + remaining),
    });
    transaction.update(gigRef, {
      status: "completed",
      budgetSpent: centsToDollars(locked),
      unspentReleased: centsToDollars(remaining),
    });
    return {success: true, released: centsToDollars(remaining)};
  });
});

/** Move wallet funds into an already-open pool campaign. */
export const addCampaignBudgetFromWallet = onCall({invoker: "public"}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }
  const gigId = request.data?.gigId as string | undefined;
  const amount = Number(request.data?.amount);
  if (!gigId) throw new HttpsError("invalid-argument", "Campaign ID is required.");
  if (!Number.isFinite(amount) || amount < 1) {
    throw new HttpsError("invalid-argument", "Enter at least $1 to add.");
  }

  const requesterId = request.auth.uid;
  const gigRef = db.collection("gigs").doc(gigId);
  const preview = await gigRef.get();
  if (!preview.exists) throw new HttpsError("not-found", "Campaign not found.");
  const previewGig = preview.data() as Gig;
  assertPoolGig(previewGig);
  if (!PAYABLE_STATUSES.has(previewGig.status)) {
    throw new HttpsError("failed-precondition", "Add funds while the campaign is open.");
  }
  await assertBrandTeam(previewGig.brandId, requesterId);

  const amountCents = dollarsToCents(amount);

  return db.runTransaction(async (transaction) => {
    const gigSnap = await transaction.get(gigRef);
    const gig = gigSnap.data() as Gig;
    assertPoolGig(gig);
    if (!PAYABLE_STATUSES.has(gig.status)) {
      throw new HttpsError("failed-precondition", "Add funds while the campaign is open.");
    }
    const agencyRef = db.collection("agencies").doc(gig.brandId);
    const agencySnap = await transaction.get(agencyRef);
    const agency = agencySnap.data() as Agency;
    await assertBrandTeam(gig.brandId, requesterId, agency);

    const availableCents = dollarsToCents(agency.availableBalance || 0);
    if (availableCents < amountCents) {
      throw new HttpsError(
        "failed-precondition",
        `Insufficient wallet balance. Needed: $${formatUsd(amountCents)}, available: $${formatUsd(availableCents)}.`
      );
    }

    const fundedCents = dollarsToCents(gig.fundedAmount || 0) + amountCents;
    const budgetCents = dollarsToCents(gig.campaignBudget || 0) + amountCents;
    const updates: {[key: string]: any} = {
      fundedAmount: centsToDollars(fundedCents),
      campaignBudget: centsToDollars(budgetCents),
    };
    if (gig.status === "budget_exhausted") updates.status = "open";

    transaction.update(agencyRef, {
      availableBalance: centsToDollars(availableCents - amountCents),
      escrowBalance: centsToDollars(dollarsToCents(agency.escrowBalance || 0) + amountCents),
    });
    transaction.update(gigRef, updates);
    return {success: true, fundedAmount: centsToDollars(fundedCents)};
  });
});
