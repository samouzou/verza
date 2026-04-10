
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import {db} from "../config/firebase";
import type {Gig, UserProfileFirestoreData, Notification, Agency, InternalPayout} from "./../types";
import * as params from "../config/params";
import * as admin from "firebase-admin";

export const payoutCreatorForGig = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const {gigId, creatorId} = request.data;
  if (!gigId || !creatorId) {
    throw new HttpsError("invalid-argument", "Deployment ID and Creator ID are required.");
  }

  const requesterId = request.auth.uid;
  const gigDocRef = db.collection("gigs").doc(gigId);
  const creatorDocRef = db.collection("users").doc(creatorId);

  try {
    const gigSnap = await gigDocRef.get();
    if (!gigSnap.exists) {
      throw new HttpsError("not-found", "Deployment not found.");
    }
    const gigData = gigSnap.data() as Gig;

    const agencyId = gigData.brandId;
    const agencyDocRef = db.collection("agencies").doc(agencyId);

    // Security Check: Only the brand that created the gig can trigger a payout.
    if (gigData.brandId !== requesterId) {
      const agencySnap = await agencyDocRef.get();
      const agencyData = agencySnap.data() as Agency;
      const isTeamMember = agencyData?.team?.some((m: any) => m.userId === requesterId &&
        (m.role === "admin" || m.role === "member"));
      if (agencyData?.ownerId !== requesterId && !isTeamMember) {
        throw new HttpsError("permission-denied", "You do not have permission to trigger payouts for this deployment.");
      }
    }

    if (!gigData.acceptedCreatorIds.includes(creatorId)) {
      throw new HttpsError("failed-precondition", "This creator has not secured the deployment.");
    }

    if (gigData.paidCreatorIds?.includes(creatorId)) {
      throw new HttpsError("already-exists", "This creator has already been paid for this deployment.");
    }

    const creatorSnap = await creatorDocRef.get();
    if (!creatorSnap.exists) {
      throw new HttpsError("not-found", "Creator profile not found.");
    }
    const creatorData = creatorSnap.data() as UserProfileFirestoreData;

    if (!creatorData.stripeAccountId || !creatorData.stripePayoutsEnabled) {
      throw new HttpsError("failed-precondition", "The creator does not have a valid Stripe account ready for payouts.");
    }

    // Determine if this was an agency-managed assignment
    const assignment = gigData.assignments?.[creatorId];
    let agentProfile: UserProfileFirestoreData | null = null;
    if (assignment) {
      const talentAgencySnap = await db.collection("agencies").doc(assignment.agencyId).get();
      if (talentAgencySnap.exists) {
        const talentAgencyData = talentAgencySnap.data() as Agency;
        // Use paymentDelegateId if set, otherwise fall back to ownerId
        const commissionReceiverId = talentAgencyData.paymentDelegateId || talentAgencyData.ownerId;
        const agentSnap = await db.collection("users").doc(commissionReceiverId).get();
        if (agentSnap.exists) {
          agentProfile = agentSnap.data() as UserProfileFirestoreData;
        }
      }
    }

    const stripeKey = params.STRIPE_SECRET_KEY.value();
    const stripe = new Stripe(stripeKey, {apiVersion: "2025-05-28.basil"});

    // Determine payout source (Card charge vs Wallet top-up)
    let sourceTransactionId: string | undefined;
    if (gigData.fundingPaymentIntentId) {
      const paymentIntent = await stripe.paymentIntents.retrieve(gigData.fundingPaymentIntentId);
      sourceTransactionId = paymentIntent.latest_charge as string;
    }

    // Payout Logic with Agency Split
    const rawPayoutAmountInCents = Math.round(gigData.ratePerCreator * 100);

    if (rawPayoutAmountInCents > 0) {
      const platformFeeInCents = Math.round(rawPayoutAmountInCents * 0.15);
      const netPayoutInCents = rawPayoutAmountInCents - platformFeeInCents;

      let creatorPayoutInCents = netPayoutInCents;
      let agencyCommissionInCents = 0;

      if (assignment) {
        agencyCommissionInCents = Math.round(netPayoutInCents * (assignment.commissionRate / 100));
        creatorPayoutInCents = netPayoutInCents - agencyCommissionInCents;
      }

      // 1. Transfer to Creator
      const creatorTransferParams: Stripe.TransferCreateParams = {
        amount: creatorPayoutInCents,
        currency: "usd",
        destination: creatorData.stripeAccountId,
        description: `Payout for deployment: ${gigData.title}`,
        metadata: {
          gigId: gigId,
          creatorId: creatorId,
          brandId: gigData.brandId,
          assignmentMode: assignment ? "agency" : "direct",
        },
      };

      if (sourceTransactionId) {
        creatorTransferParams.source_transaction = sourceTransactionId;
      }

      await stripe.transfers.create(creatorTransferParams);

      // 2. Transfer to Agency Owner (if applicable)
      if (agencyCommissionInCents > 0 && agentProfile?.stripeAccountId && agentProfile?.stripePayoutsEnabled) {
        const agencyTransferParams: Stripe.TransferCreateParams = {
          amount: agencyCommissionInCents,
          currency: "usd",
          destination: agentProfile.stripeAccountId,
          description: `Agency Commission (${assignment?.commissionRate}%)
           for ${creatorData.displayName} on deployment: ${gigData.title}`,
          metadata: {
            gigId: gigId,
            creatorId: creatorId,
            agencyId: assignment?.agencyId || "unknown",
            platformFeeShare: "split_from_net",
          },
        };

        if (sourceTransactionId) {
          agencyTransferParams.source_transaction = sourceTransactionId;
        }

        await stripe.transfers.create(agencyTransferParams);
      } else if (agencyCommissionInCents > 0 && assignment) {
        // Fallback: If no Stripe account, we'll need to settle this manually or
        // via Wallet (outside of this simple Stripe flow)
        logger.warn(`Agency commission of ${agencyCommissionInCents} cents pending for agency
          ${assignment.agencyId} - No Stripe account found.`);
        // For now, we'll keep the logic simple and only do Stripe transfers if possible.
      }
    }

    // Update the documents and record payouts in a transaction
    await db.runTransaction(async (transaction) => {
      const currentGigSnap = await transaction.get(gigDocRef);
      const currentGigData = currentGigSnap.data() as Gig;
      const brandAgencySnap = await transaction.get(agencyDocRef);
      const brandAgencyData = brandAgencySnap.data() as Agency;

      // 1. Update Gig status and paid creators
      const newPaidCreatorIds = [...(currentGigData.paidCreatorIds || []), creatorId];
      const isGigFullyPaid = newPaidCreatorIds.length === currentGigData.creatorsNeeded;

      const gigUpdates: any = {
        paidCreatorIds: admin.firestore.FieldValue.arrayUnion(creatorId),
      };
      if (isGigFullyPaid) gigUpdates.status = "completed";
      transaction.update(gigDocRef, gigUpdates);

      // 2. Burn down the Brand Agency's escrow balance
      const currentEscrow = brandAgencyData.escrowBalance || 0;
      transaction.update(agencyDocRef, {
        escrowBalance: Math.max(0, currentEscrow - gigData.ratePerCreator),
      });

      // 3. If agency assignment, update Talent Agency's revenue/internal payout
      if (assignment && rawPayoutAmountInCents > 0) {
        const talentAgencyDocRef = db.collection("agencies").doc(assignment.agencyId);
        const talentAgencySnap = await transaction.get(talentAgencyDocRef);

        if (talentAgencySnap.exists) {
          const talentAgencyData = talentAgencySnap.data() as Agency;
          const commissionAmount =
            (rawPayoutAmountInCents - Math.round(rawPayoutAmountInCents * 0.15)) * (assignment.commissionRate / 100) / 100;

          // Update Talent Agency's available balance (revenue)
          transaction.update(talentAgencyDocRef, {
            availableBalance: (talentAgencyData.availableBalance || 0) + commissionAmount,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          // Create Internal Payout record for the agency
          const payoutRef = db.collection("internalPayouts").doc();
          transaction.set(payoutRef, {
            id: payoutRef.id,
            agencyId: assignment.agencyId,
            agencyName: talentAgencyData.name,
            agencyOwnerId: talentAgencyData.ownerId,
            talentId: creatorId,
            talentName: creatorData.displayName || "Unknown Creator",
            amount: commissionAmount,
            description: `Commission (${assignment.commissionRate}%) for ${gigData.title}`,
            status: agentProfile?.stripeAccountId ? "paid" : "pending",
            initiatedAt: admin.firestore.FieldValue.serverTimestamp(),
            paidAt: agentProfile?.stripeAccountId ? admin.firestore.FieldValue.serverTimestamp() : null,
          } as InternalPayout);
        }
      }
    });

    // Notify Creator
    await db.collection("notifications").add({
      userId: creatorId,
      title: "Payout Received!",
      message: `Your work for "${gigData.title}" has been approved and paid.`,
      type: "payout_received",
      read: false,
      link: "/wallet",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    } as Omit<Notification, "id">);

    // Notify Brand if the project is now complete
    const updatedGigSnap = await gigDocRef.get();
    if (updatedGigSnap.data()?.status === "completed") {
      const brandAgencySnap = await agencyDocRef.get();
      const brandAgencyData = brandAgencySnap.data() as Agency;
      await db.collection("notifications").add({
        userId: brandAgencyData.ownerId,
        title: "Deployment Complete!",
        message: `Your campaign "${gigData.title}" is now complete. All ${gigData.creatorsNeeded} creators have been paid.`,
        type: "system",
        read: false,
        link: `/deployments/${gigId}`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      } as Omit<Notification, "id">);
    }

    // Notify Agent if commission was processed
    if (assignment && agentProfile) {
      await db.collection("notifications").add({
        userId: agentProfile.uid,
        title: "Agency Commission Received!",
        message: `You earned a commission for ${creatorData.displayName}'s work on "${gigData.title}".`,
        type: "payout_received",
        read: false,
        link: "/agency/dashboard",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      } as Omit<Notification, "id">);
    }

    logger.info(`Successfully processed payout for creator ${creatorId} for deployment ${gigId}.`);
    return {success: true, message: "Payout processed successfully."};
  } catch (error: any) {
    logger.error(`Error processing payout for deployment ${gigId} to creator ${creatorId}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", error.message || "An unexpected error occurred during payout.");
  }
});
