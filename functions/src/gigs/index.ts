
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import {db} from "../config/firebase";
import type {Gig, UserProfileFirestoreData, Notification} from "./../types";
import * as params from "../config/params";
import * as admin from "firebase-admin";

export const payoutCreatorForGig = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const {gigId, creatorId} = request.data;
  if (!gigId || !creatorId) {
    throw new HttpsError("invalid-argument", "Gig ID and Creator ID are required.");
  }

  const requesterId = request.auth.uid;
  const gigDocRef = db.collection("gigs").doc(gigId);
  const creatorDocRef = db.collection("users").doc(creatorId);

  try {
    const gigSnap = await gigDocRef.get();
    if (!gigSnap.exists) {
      throw new HttpsError("not-found", "Gig not found.");
    }
    const gigData = gigSnap.data() as Gig;

    // Security Check: Only the brand that created the gig can trigger a payout.
    if (gigData.brandId !== requesterId) {
      const agencyDoc = await db.collection("agencies").doc(gigData.brandId).get();
      const agencyData = agencyDoc.data();
      const isTeamMember = agencyData?.team?.some((m: any) => m.userId === requesterId &&
        (m.role === "admin" || m.role === "member"));
      if (agencyData?.ownerId !== requesterId && !isTeamMember) {
        throw new HttpsError("permission-denied", "You do not have permission to trigger payouts for this gig.");
      }
    }

    if (!gigData.acceptedCreatorIds.includes(creatorId)) {
      throw new HttpsError("failed-precondition", "This creator has not accepted the gig.");
    }

    if (gigData.paidCreatorIds?.includes(creatorId)) {
      throw new HttpsError("already-exists", "This creator has already been paid for this gig.");
    }

    if (!gigData.fundingPaymentIntentId) {
      throw new HttpsError("failed-precondition", "The funding source for this gig is missing.");
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

    // Retrieve the charge from the payment intent
    const paymentIntent = await stripe.paymentIntents.retrieve(gigData.fundingPaymentIntentId);
    const chargeId = paymentIntent.latest_charge as string;

    if (!chargeId) {
      throw new HttpsError("failed-precondition", "Could not find the original charge to source the transfer from.");
    }

    // Deduct 15% platform fee from the creator's payout as requested
    const rawPayoutAmountInCents = Math.round(gigData.ratePerCreator * 100);
    const platformFeeInCents = Math.round(rawPayoutAmountInCents * 0.15);
    const finalPayoutAmountInCents = rawPayoutAmountInCents - platformFeeInCents;

    // Create a transfer to the creator's Stripe account
    await stripe.transfers.create({
      amount: finalPayoutAmountInCents,
      currency: "usd",
      destination: creatorData.stripeAccountId,
      source_transaction: chargeId,
      description: `Payout for gig: ${gigData.title} (less 15% platform fee)`,
      metadata: {
        gigId: gigId,
        creatorId: creatorId,
        brandId: gigData.brandId,
        platformFee: platformFeeInCents.toString(),
      },
    });

    // Update the gig document to mark the creator as paid
    await gigDocRef.update({
      paidCreatorIds: admin.firestore.FieldValue.arrayUnion(creatorId),
    });

    // Notify Creator
    await db.collection("notifications").add({
      userId: creatorId,
      title: "Payout Received!",
      message: `Your submission for "${gigData.title}" has been approved and paid.`,
      type: "payout_received",
      read: false,
      link: "/wallet",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    } as Omit<Notification, "id">);

    logger.info(`Successfully processed payout of $${finalPayoutAmountInCents / 100} to creator
      ${creatorId} for gig ${gigId}. Platform fee: $${platformFeeInCents / 100}.`);
    return {success: true, message: "Payout processed successfully."};
  } catch (error: any) {
    logger.error(`Error processing payout for gig ${gigId} to creator ${creatorId}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", error.message || "An unexpected error occurred during payout.");
  }
});
