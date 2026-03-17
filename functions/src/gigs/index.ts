
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import {db} from "../config/firebase";
import type {Gig, UserProfileFirestoreData, Notification, Agency} from "./../types";
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

    const stripeKey = params.STRIPE_SECRET_KEY.value();
    const stripe = new Stripe(stripeKey, {apiVersion: "2025-05-28.basil"});

    // Determine payout source (Card charge vs Wallet top-up)
    let sourceTransactionId: string | undefined;
    if (gigData.fundingPaymentIntentId) {
      const paymentIntent = await stripe.paymentIntents.retrieve(gigData.fundingPaymentIntentId);
      sourceTransactionId = paymentIntent.latest_charge as string;
    }

    // Deduct 15% platform fee from the creator's payout
    const rawPayoutAmountInCents = Math.round(gigData.ratePerCreator * 100);
    const platformFeeInCents = Math.round(rawPayoutAmountInCents * 0.15);
    const finalPayoutAmountInCents = rawPayoutAmountInCents - platformFeeInCents;

    const transferParams: Stripe.TransferCreateParams = {
      amount: finalPayoutAmountInCents,
      currency: "usd",
      destination: creatorData.stripeAccountId,
      description: `Payout for deployment: ${gigData.title}`,
      metadata: {
        gigId: gigId,
        creatorId: creatorId,
        brandId: gigData.brandId,
        platformFee: platformFeeInCents.toString(),
      },
    };

    if (sourceTransactionId) {
      transferParams.source_transaction = sourceTransactionId;
    }

    // Release funds to creator
    await stripe.transfers.create(transferParams);

    // Update the gig document and agency escrow in a transaction
    await db.runTransaction(async (transaction) => {
      const currentGigSnap = await transaction.get(gigDocRef);
      const currentGigData = currentGigSnap.data() as Gig;
      const currentAgencySnap = await transaction.get(agencyDocRef);
      const currentAgencyData = currentAgencySnap.data() as Agency;

      const newPaidCreatorIds = [...(currentGigData.paidCreatorIds || []), creatorId];
      const isGigFullyPaid = newPaidCreatorIds.length === currentGigData.creatorsNeeded;

      const gigUpdates: Partial<Gig> = {
        paidCreatorIds: admin.firestore.FieldValue.arrayUnion(creatorId) as any,
      };
      if (isGigFullyPaid) gigUpdates.status = "completed";
      transaction.update(gigDocRef, gigUpdates);

      // Burn down the escrow balance
      const currentEscrow = currentAgencyData.escrowBalance || 0;
      transaction.update(agencyDocRef, {escrowBalance: Math.max(0, currentEscrow - gigData.ratePerCreator)});
    });

    // Notify Creator
    await db.collection("notifications").add({
      userId: creatorId,
      title: "Payout Received!",
      message: `Your work for "${gigData.title}" has been approved and paid from the Campaign Vault.`,
      type: "payout_received",
      read: false,
      link: "/wallet",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    } as Omit<Notification, "id">);

    // Notify Brand if the project is now complete
    const agencySnap = await agencyDocRef.get();
    if (agencySnap.exists) {
      const agencyData = agencySnap.data();
      const gigSnapCheck = await gigDocRef.get();
      if (gigSnapCheck.data()?.status === "completed") {
        await db.collection("notifications").add({
          userId: agencyData?.ownerId,
          title: "Deployment Complete!",
          message: `Your campaign "${gigData.title}" is now complete. All ${gigData.creatorsNeeded} creators have been paid.`,
          type: "system",
          read: false,
          link: `/deployments/${gigId}`,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        } as Omit<Notification, "id">);
      }
    }

    logger.info(`Successfully processed payout of $${finalPayoutAmountInCents / 100} to creator
      ${creatorId} for deployment ${gigId}.`);
    return {success: true, message: "Payout processed successfully."};
  } catch (error: any) {
    logger.error(`Error processing payout for deployment ${gigId} to creator ${creatorId}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", error.message || "An unexpected error occurred during payout.");
  }
});
