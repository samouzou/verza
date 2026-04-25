
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onDocumentCreated, onDocumentUpdated} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import type {Gig, UserProfileFirestoreData, Notification, Agency, InternalPayout} from "./../types";
import * as admin from "firebase-admin";
import {sendDeploymentEmailSequence} from "../notifications";

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

    // Determine if this was an agency-managed assignment
    const assignment = gigData.assignments?.[creatorId];

    // Calculate payout amounts
    const rawPayoutAmountInCents = Math.round(gigData.ratePerCreator * 100);
    let creatorPayoutInCents = 0;

    if (rawPayoutAmountInCents > 0) {
      const platformFeeInCents = Math.round(rawPayoutAmountInCents * 0.15);
      const netPayoutInCents = rawPayoutAmountInCents - platformFeeInCents;

      if (assignment) {
        const agencyCommissionInCents = Math.round(netPayoutInCents * (assignment.commissionRate / 100));
        creatorPayoutInCents = netPayoutInCents - agencyCommissionInCents;
      } else {
        creatorPayoutInCents = netPayoutInCents;
      }
    }

    // Update the documents and credit wallets in a transaction
    let talentAgencyOwnerId: string | null = null;

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

      // 3. Credit creator's Verza wallet and record the transaction
      if (creatorPayoutInCents > 0) {
        transaction.update(creatorDocRef, {
          walletBalance: admin.firestore.FieldValue.increment(creatorPayoutInCents / 100),
        });

        const earningsRef = db.collection("internalPayouts").doc();
        transaction.set(earningsRef, {
          id: earningsRef.id,
          type: "creator_payment",
          agencyId: agencyId,
          agencyName: brandAgencyData.name || "Brand",
          agencyOwnerId: brandAgencyData.ownerId,
          talentId: creatorId,
          talentName: creatorData.displayName || "Unknown Creator",
          amount: creatorPayoutInCents / 100,
          description: `Payment for deployment: ${gigData.title}`,
          status: "pending",
          initiatedAt: admin.firestore.FieldValue.serverTimestamp(),
          paidAt: null,
        } as unknown as InternalPayout);
      }

      // 4. If agency assignment, credit talent agency's available balance
      if (assignment && rawPayoutAmountInCents > 0) {
        const talentAgencyDocRef = db.collection("agencies").doc(assignment.agencyId);
        const talentAgencySnap = await transaction.get(talentAgencyDocRef);

        if (talentAgencySnap.exists) {
          const talentAgencyData = talentAgencySnap.data() as Agency;
          talentAgencyOwnerId = talentAgencyData.ownerId;
          const commissionAmount =
            (rawPayoutAmountInCents - Math.round(rawPayoutAmountInCents * 0.15)) * (assignment.commissionRate / 100) / 100;

          transaction.update(talentAgencyDocRef, {
            availableBalance: (talentAgencyData.availableBalance || 0) + commissionAmount,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          const payoutRef = db.collection("internalPayouts").doc();
          transaction.set(payoutRef, {
            id: payoutRef.id,
            type: "agency_commission",
            agencyId: assignment.agencyId,
            agencyName: talentAgencyData.name,
            agencyOwnerId: talentAgencyData.ownerId,
            talentId: creatorId,
            talentName: creatorData.displayName || "Unknown Creator",
            amount: commissionAmount,
            description: `Commission (${assignment.commissionRate}%) for ${gigData.title}`,
            status: "pending",
            initiatedAt: admin.firestore.FieldValue.serverTimestamp(),
            paidAt: null,
          } as unknown as InternalPayout);
        }
      }
    });

    // Notify Creator
    await db.collection("notifications").add({
      userId: creatorId,
      title: "Funds Added to Wallet!",
      message: `Your work for "${gigData.title}" has been approved.
       $${(creatorPayoutInCents / 100).toFixed(2)} has been added to your Verza wallet.`,
      type: "payout_received",
      read: false,
      link: "/wallet",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    } as unknown as Omit<Notification, "id">);

    // Notify Brand if the project is now complete
    const updatedGigSnap = await gigDocRef.get();
    if (updatedGigSnap.data()?.status === "completed") {
      const brandAgencySnap = await agencyDocRef.get();
      const brandAgencyData = brandAgencySnap.data() as Agency;
      await db.collection("notifications").add({
        userId: brandAgencyData.ownerId,
        title: "Campaign Complete!",
        message: `Your campaign "${gigData.title}" is now complete. All ${gigData.creatorsNeeded} creators have been paid.`,
        type: "system",
        read: false,
        link: `/campaigns/${gigId}`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      } as unknown as Omit<Notification, "id">);
    }

    // Notify talent agency owner if commission was processed
    if (assignment && talentAgencyOwnerId) {
      await db.collection("notifications").add({
        userId: talentAgencyOwnerId,
        title: "Agency Commission Added!",
        message: `Your commission for ${creatorData.displayName}'s work on "${gigData.title}"
         has been added to your agency balance.`,
        type: "payout_received",
        read: false,
        link: "/agency/dashboard",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      } as unknown as Omit<Notification, "id">);
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


/**
 * Looks up the agency owner for a gig, then sends deployment email step 0
 * and initializes the drip sequence on the gig doc.
 * @param {string} gigId The Firestore document ID of the gig.
 * @param {Gig} gigData The gig document data.
 */
async function initDeploymentEmailSequence(gigId: string, gigData: Gig): Promise<void> {
  try {
    const agencySnap = await db.collection("agencies").doc(gigData.brandId).get();
    if (!agencySnap.exists) return;
    const agencyData = agencySnap.data() as Agency;

    const ownerUserId = agencyData.ownerId;
    const ownerSnap = await db.collection("users").doc(ownerUserId).get();
    if (!ownerSnap.exists) return;
    const ownerData = ownerSnap.data() as UserProfileFirestoreData;
    if (!ownerData.email) return;

    const twoDaysFromNow = new admin.firestore.Timestamp(
      admin.firestore.Timestamp.now().seconds + 2 * 24 * 60 * 60, 0
    );

    await db.collection("gigs").doc(gigId).update({
      deploymentEmailSequence: {step: 1, nextEmailAt: twoDaysFromNow, ownerUserId},
    });

    await sendDeploymentEmailSequence(
      ownerData.email, ownerData.displayName || "there", gigData.title, gigId, 0
    );
  } catch (error) {
    logger.error(`Failed to init deployment email sequence for gig ${gigId}:`, error);
  }
}

// Fires for performance-only deployments created directly as 'open'
export const onGigCreated = onDocumentCreated("gigs/{gigId}", async (event) => {
  const gigData = event.data?.data() as Gig | undefined;
  if (!gigData || gigData.status !== "open") return;
  await initDeploymentEmailSequence(event.params.gigId, gigData);
});

// Fires for paid deployments when Stripe flips status from 'pending_payment' to 'open'
// Also covers wallet-funded deployments via fundGigFromWallet
export const onGigStatusOpened = onDocumentUpdated("gigs/{gigId}", async (event) => {
  const before = event.data?.before.data() as Gig | undefined;
  const after = event.data?.after.data() as Gig | undefined;
  if (!before || !after) return;
  if (before.status === after.status) return; // no status change
  if (after.status !== "open") return; // not becoming open
  if (before.status === "open") return; // was already open (shouldn't happen, but guard)
  await initDeploymentEmailSequence(event.params.gigId, after);
});
