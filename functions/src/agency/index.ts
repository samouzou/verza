
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";
import * as logger from "firebase-functions/logger";
import type {Agency, Talent, UserProfileFirestoreData, AgencyMembership, InternalPayout} from "../../../src/types";
import Stripe from "stripe";
import {sendAgencyInvitationEmail} from "../notifications";

// Initialize Stripe
let stripe: Stripe;
try {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  stripe = new Stripe(stripeKey, {
    apiVersion: "2025-05-28.basil",
  });
} catch (error) {
  logger.error("Error initializing Stripe:", error);
  // Create a mock Stripe instance for local testing
  stripe = {
    paymentIntents: {
      create: async () => ({client_secret: "mock_secret"}),
      retrieve: async () => ({status: "succeeded"}),
    },
  } as unknown as Stripe;
}


export const createAgency = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const {name} = request.data;
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new HttpsError("invalid-argument", "A valid agency name is required.");
  }

  const userId = request.auth.uid;
  const userDocRef = db.collection("users").doc(userId);
  const agenciesColRef = db.collection("agencies");

  try {
    // Check if user already owns an agency to prevent creating multiple
    const existingAgencyQuery = await agenciesColRef.where("ownerId", "==", userId).limit(1).get();
    if (!existingAgencyQuery.empty) {
      throw new HttpsError("already-exists", "You already own an agency.");
    }

    // Create new agency document
    const newAgencyRef = agenciesColRef.doc();
    const newAgency: Agency = {
      id: newAgencyRef.id,
      name: name.trim(),
      ownerId: userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp() as any,
      updatedAt: admin.firestore.FieldValue.serverTimestamp() as any,
      talent: [],
    };

    // Update user's role and add agency membership
    const userUpdate: Partial<UserProfileFirestoreData> = {
      role: "agency_owner",
      isAgencyOwner: true, // Add the isAgencyOwner field to the Firestore document
      agencyMemberships: admin.firestore.FieldValue.arrayUnion({
        agencyId: newAgency.id,
        agencyName: newAgency.name,
        role: "owner",
        status: "active",
      }) as any,
    };

    // Use a batch to ensure both writes succeed or fail together
    const batch = db.batch();
    batch.set(newAgencyRef, newAgency);
    batch.update(userDocRef, userUpdate);

    // Set a custom claim on the user to identify them as an agency owner
    await admin.auth().setCustomUserClaims(userId, {isAgencyOwner: true});

    await batch.commit();

    logger.info(`Agency "${name}" created successfully for user ${userId}. Custom claim and Firestore field set.`);

    return {success: true, agencyId: newAgency.id};
  } catch (error) {
    logger.error("Error creating agency for user:", userId, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "An unexpected error occurred while creating the agency.");
  }
});


export const inviteTalentToAgency = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }
  const agencyOwnerId = request.auth.uid;
  const {agencyId, talentEmail} = request.data;

  if (!agencyId || !talentEmail) {
    throw new HttpsError("invalid-argument", "Agency ID and talent email are required.");
  }

  const talentEmailCleaned = talentEmail.trim().toLowerCase();

  try {
    const agencyDocRef = db.collection("agencies").doc(agencyId);
    const agencySnap = await agencyDocRef.get();
    if (!agencySnap.exists || agencySnap.data()?.ownerId !== agencyOwnerId) {
      throw new HttpsError("permission-denied", "You do not have permission to manage this agency.");
    }
    const agencyData = agencySnap.data() as Agency;

    let talentUser;
    try {
      talentUser = await admin.auth().getUserByEmail(talentEmailCleaned);
    } catch (error: any) {
      if (error.code === "auth/user-not-found") {
        // User does not exist, send an email to invite them to sign up
        const invitationsRef = db.collection("agencyInvitations").doc(talentEmailCleaned);
        await invitationsRef.set({
          agencyId: agencyId,
          agencyName: agencyData.name,
          talentEmail: talentEmailCleaned,
          status: "pending",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await sendAgencyInvitationEmail(talentEmailCleaned, agencyData.name, false);
        logger.info(`Invitation sent to new user ${talentEmailCleaned} for agency ${agencyData.name}.`);
        return {success: true, message: "Invitation sent successfully to the new user."};
      }
      throw new HttpsError("internal", "Error checking for user by email.");
    }

    // User exists
    const talentUserId = talentUser.uid;
    const talentUserDocRef = db.collection("users").doc(talentUserId);

    if (agencyData.talent.some((t) => t.userId === talentUserId)) {
      throw new HttpsError("already-exists", "This user is already a member of your agency.");
    }

    const talentDocSnap = await talentUserDocRef.get();
    const talentDocData = talentDocSnap.data() as UserProfileFirestoreData | undefined;

    const newTalentMember: Talent = {
      userId: talentUserId,
      email: talentEmailCleaned,
      displayName: talentDocData?.displayName || talentUser.displayName || "Invited User",
      status: "pending",
    };

    const talentAgencyMembership: AgencyMembership = {
      agencyId: agencyId,
      agencyName: agencyData.name,
      role: "talent",
      status: "pending",
    };

    const batch = db.batch();
    batch.update(agencyDocRef, {talent: admin.firestore.FieldValue.arrayUnion(newTalentMember)});
    batch.update(talentUserDocRef, {agencyMemberships: admin.firestore.FieldValue.arrayUnion(talentAgencyMembership)});

    await batch.commit();

    // Send email to existing user
    await sendAgencyInvitationEmail(talentEmailCleaned, agencyData.name, true);

    logger.info(`Talent ${talentEmailCleaned} invited to agency ${agencyId} by owner ${agencyOwnerId}.`);
    return {success: true, message: "Talent invited successfully."};
  } catch (error) {
    logger.error(`Error inviting talent to agency ${agencyId}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "An unexpected error occurred while inviting talent.");
  }
});

export const acceptAgencyInvitation = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated to accept an invitation.");
  }
  const talentUserId = request.auth.uid;
  const {agencyId} = request.data;

  if (!agencyId) {
    throw new HttpsError("invalid-argument", "Agency ID is required.");
  }

  const agencyDocRef = db.collection("agencies").doc(agencyId);
  const userDocRef = db.collection("users").doc(talentUserId);

  return db.runTransaction(async (transaction) => {
    const agencyDoc = await transaction.get(agencyDocRef);
    const userDoc = await transaction.get(userDocRef);

    if (!agencyDoc.exists) throw new HttpsError("not-found", "Agency not found.");
    if (!userDoc.exists) throw new HttpsError("not-found", "User profile not found.");

    const agencyData = agencyDoc.data() as Agency;
    const userData = userDoc.data() as UserProfileFirestoreData;

    const talentIndex = agencyData.talent.findIndex((t) => t.userId === talentUserId && t.status === "pending");
    if (talentIndex === -1) {
      throw new HttpsError("failed-precondition", "No pending invitation found for this user in the specified agency.");
    }

    const membershipIndex = userData.agencyMemberships?.findIndex((m) => m.agencyId === agencyId && m.status === "pending");
    if (membershipIndex === -1 || membershipIndex === undefined) {
      throw new HttpsError("failed-precondition", "User does not have a corresponding pending membership.");
    }

    const updatedTalentArray = [...agencyData.talent];
    updatedTalentArray[talentIndex] =
      {...updatedTalentArray[talentIndex], status: "active", joinedAt: admin.firestore.Timestamp.now() as any};

    const updatedMembershipsArray = [...(userData.agencyMemberships || [])];
    updatedMembershipsArray[membershipIndex] = {...updatedMembershipsArray[membershipIndex], status: "active"};


    transaction.update(agencyDocRef, {talent: updatedTalentArray});
    transaction.update(userDocRef, {agencyMemberships: updatedMembershipsArray});

    return {success: true, message: "Invitation accepted successfully."};
  }).catch((error) => {
    logger.error(`Error accepting invitation for user ${talentUserId} to agency ${agencyId}:`, error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "An unexpected error occurred while accepting the invitation.");
  });
});

export const declineAgencyInvitation = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated to decline an invitation.");
  }
  const talentUserId = request.auth.uid;
  const {agencyId} = request.data;
  if (!agencyId) {
    throw new HttpsError("invalid-argument", "Agency ID is required.");
  }

  const agencyDocRef = db.collection("agencies").doc(agencyId);
  const userDocRef = db.collection("users").doc(talentUserId);

  return db.runTransaction(async (transaction) => {
    const agencyDoc = await transaction.get(agencyDocRef);
    const userDoc = await transaction.get(userDocRef);

    if (!agencyDoc.exists) throw new HttpsError("not-found", "Agency not found.");
    if (!userDoc.exists) throw new HttpsError("not-found", "User profile not found.");

    const agencyData = agencyDoc.data() as Agency;
    const userData = userDoc.data() as UserProfileFirestoreData;

    const updatedTalentArray = agencyData.talent.filter((t) => t.userId !== talentUserId);
    const updatedMembershipsArray = userData.agencyMemberships?.filter((m) => m.agencyId !== agencyId) || [];

    // Only update if there's a change to be made
    if (updatedTalentArray.length < agencyData.talent.length) {
      transaction.update(agencyDocRef, {talent: updatedTalentArray});
    }

    if (userData.agencyMemberships && updatedMembershipsArray.length < userData.agencyMemberships.length) {
      transaction.update(userDocRef, {agencyMemberships: updatedMembershipsArray});
    } else if (userData.agencyMemberships && updatedMembershipsArray.length === 0) {
      // If the array becomes empty, ensure it's set to an empty array
      transaction.update(userDocRef, {agencyMemberships: []});
    }

    return {success: true, message: "Invitation declined successfully."};
  }).catch((error) => {
    logger.error(`Error declining invitation for user ${talentUserId} to agency ${agencyId}:`, error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "An unexpected error occurred while declining the invitation.");
  });
});

export const createInternalPayout = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }
  const agencyOwnerId = request.auth.uid;
  const {agencyId, talentId, amount, description, paymentDate} = request.data;

  if (!agencyId || !talentId || !amount || !description || !paymentDate) {
    throw new HttpsError("invalid-argument", "Agency ID, Talent ID, amount, description, and payment date are required.");
  }
  if (typeof amount !== "number" || amount <= 0) {
    throw new HttpsError("invalid-argument", "Amount must be a positive number.");
  }
  if (typeof paymentDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    throw new HttpsError("invalid-argument", "Payment date must be a valid YYYY-MM-DD string.");
  }

  try {
    const agencyDocRef = db.collection("agencies").doc(agencyId);
    const agencySnap = await agencyDocRef.get();

    if (!agencySnap.exists || agencySnap.data()?.ownerId !== agencyOwnerId) {
      throw new HttpsError("permission-denied", "You do not have permission to manage this agency.");
    }
    const agencyData = agencySnap.data() as Agency;

    // Get agency owner's Stripe customer ID to charge them
    const agencyOwnerUserDocRef = db.collection("users").doc(agencyOwnerId);
    const agencyOwnerSnap = await agencyOwnerUserDocRef.get();
    const agencyOwnerData = agencyOwnerSnap.data() as UserProfileFirestoreData;

    if (!agencyOwnerData.stripeCustomerId) {
      throw new HttpsError("failed-precondition", "Agency owner does not have a Stripe Customer ID and cannot make payments.");
    }

    // Get their payment methods
    const paymentMethods = await stripe.paymentMethods.list({
      customer: agencyOwnerData.stripeCustomerId,
    });

    if (!paymentMethods.data || paymentMethods.data.length === 0) {
      throw new HttpsError("failed-precondition", "Agency owner has no saved payment methods in Stripe to charge.");
    }
    const paymentMethodId = paymentMethods.data[0].id; // Use the first available payment method

    const talentInfo = agencyData.talent.find((t) => t.userId === talentId);
    if (!talentInfo) {
      throw new HttpsError("not-found", "The selected talent is not a member of this agency.");
    }

    // Get talent's Stripe Connect account ID
    const talentUserDocRef = db.collection("users").doc(talentId);
    const talentUserSnap = await talentUserDocRef.get();
    const talentUserData = talentUserSnap.data() as UserProfileFirestoreData;

    if (!talentUserData.stripeAccountId || !talentUserData.stripePayoutsEnabled) {
      throw new HttpsError("failed-precondition",
        "The selected talent does not have an active, verified Stripe account ready for payouts.");
    }

    const payoutDocRef = db.collection("internalPayouts").doc();
    const newPayout: Omit<InternalPayout, "stripeChargeId"> = {
      id: payoutDocRef.id,
      agencyId,
      agencyName: agencyData.name,
      agencyOwnerId,
      talentId,
      talentName: talentInfo.displayName || "N/A",
      amount, // The amount the talent receives
      description,
      status: "processing", // This will be updated by a webhook later
      initiatedAt: admin.firestore.Timestamp.now() as any,
      paymentDate: admin.firestore.Timestamp.fromDate(new Date(paymentDate)) as any,
      platformFee: 0, // Will be calculated next
    };

    // Calculate platform fee (Stripe fees + 1% Verza fee) and total charge amount
    const payoutAmountInCents = Math.round(amount * 100);
    // Platform fee is 4% (3% for Stripe + 1% for Verza) + 30 cents
    const platformFeeInCents = Math.round(payoutAmountInCents * 0.04) + 30;
    const totalChargeInCents = payoutAmountInCents + platformFeeInCents;
    newPayout.platformFee = platformFeeInCents / 100;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalChargeInCents, // Charge the agency the total amount
      currency: "usd",
      customer: agencyOwnerData.stripeCustomerId,
      payment_method: paymentMethodId,
      description: `Payout to ${talentInfo.displayName} for: ${description}`,
      transfer_data: {
        destination: talentUserData.stripeAccountId,
        amount: payoutAmountInCents, // Specify the exact amount to transfer to the talent
      },
      confirm: true,
      off_session: true,
      metadata: {
        agencyId: agencyId,
        talentId: talentId,
        payout_description: description,
        paymentDate: paymentDate,
        payout_amount: (amount).toString(),
        platform_fee: (newPayout.platformFee).toString(),
        internalPayoutId: newPayout.id, // Add this crucial piece of metadata
      },
    });

    const finalPayout: InternalPayout = {
      ...newPayout,
      stripeChargeId: paymentIntent.id,
    };

    await payoutDocRef.set(finalPayout);

    logger.info(`Stripe PaymentIntent ${paymentIntent.id} and transfer initiated for talent ${talentId} by agency ${agencyId}.`);
    return {success: true, payoutId: newPayout.id, message: "Payout transfer initiated successfully via Stripe."};
  } catch (error: any) {
    logger.error(`Error creating internal payout by agency ${agencyId}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    if (error.type === "StripeCardError") {
      throw new HttpsError("invalid-argument", `Stripe Error: ${error.message}`);
    }
    throw new HttpsError("internal", error.message || "An unexpected error occurred while creating the payout.");
  }
});
