
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";
import * as logger from "firebase-functions/logger";
import type {Agency, Talent, UserProfileFirestoreData, AgencyMembership, InternalPayout, TeamMember} from "../../../src/types";
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
    apiVersion: "2025-05-28", // Use a fixed API version
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
    const existingAgencyQuery = await agenciesColRef.where("ownerId", "==", userId).limit(1).get();
    if (!existingAgencyQuery.empty) {
      throw new HttpsError("already-exists", "You already own an agency.");
    }

    const newAgencyRef = agenciesColRef.doc();
    const newAgency: Agency = {
      id: newAgencyRef.id,
      name: name.trim(),
      ownerId: userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp() as admin.firestore.Timestamp,
      talent: [],
      team: [], // Initialize team array
    };

    const userUpdate: Partial<UserProfileFirestoreData> = {
      role: "agency_owner",
      isAgencyOwner: true,
      agencyMemberships: admin.firestore.FieldValue.arrayUnion({
        agencyId: newAgency.id,
        agencyName: newAgency.name,
        role: "owner",
        status: "active",
      }) as any,
    };

    const batch = db.batch();
    batch.set(newAgencyRef, newAgency);
    batch.update(userDocRef, userUpdate);

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
    const agencyData = agencySnap.data() as Agency;

    const requesterIsAdmin = agencyData.ownerId === agencyOwnerId ||
      agencyData.team?.some((m) => m.userId === agencyOwnerId && m.role === "admin");

    if (!agencySnap.exists || !requesterIsAdmin) {
      throw new HttpsError("permission-denied", "You do not have permission to manage this agency.");
    }

    let talentUser;
    try {
      talentUser = await admin.auth().getUserByEmail(talentEmailCleaned);
    } catch (error: any) {
      if (error.code === "auth/user-not-found") {
        const invitationsRef = db.collection("agencyInvitations").doc(talentEmailCleaned);
        await invitationsRef.set({
          agencyId: agencyId,
          agencyName: agencyData.name,
          inviteeEmail: talentEmailCleaned,
          type: "talent",
          status: "pending",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await sendAgencyInvitationEmail(talentEmailCleaned, agencyData.name, false, "talent");
        logger.info(`Invitation sent to new user ${talentEmailCleaned} for agency ${agencyData.name}.`);
        return {success: true, message: "Invitation sent successfully to the new user."};
      }
      throw new HttpsError("internal", "Error checking for user by email.");
    }

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

    await sendAgencyInvitationEmail(talentEmailCleaned, agencyData.name, true, "talent");

    logger.info(`Talent ${talentEmailCleaned} invited to agency ${agencyId} by ${agencyOwnerId}.`);
    return {success: true, message: "Talent invited successfully."};
  } catch (error) {
    logger.error(`Error inviting talent to agency ${agencyId}:`, error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "An unexpected error occurred while inviting talent.");
  }
});


export const inviteTeamMemberToAgency = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated.");
  }
  const requesterId = request.auth.uid;
  const {agencyId, memberEmail, role} = request.data;
  if (!agencyId || !memberEmail || !role) {
    throw new HttpsError("invalid-argument", "Agency ID, member email, and role are required.");
  }
  if (!["admin", "member"].includes(role)) {
    throw new HttpsError("invalid-argument", "Role must be 'admin' or 'member'.");
  }

  const memberEmailCleaned = memberEmail.trim().toLowerCase();

  try {
    const agencyDocRef = db.collection("agencies").doc(agencyId);
    const agencySnap = await agencyDocRef.get();
    const agencyData = agencySnap.data() as Agency;

    if (!agencySnap.exists || agencyData.ownerId !== requesterId) {
      throw new HttpsError("permission-denied", "Only the agency owner can invite team members.");
    }
    if (agencyData.team.some((m) => m.email === memberEmailCleaned) || agencyData.ownerId === requesterId) {
      throw new HttpsError("already-exists", "This user is already on the team.");
    }

    let memberUser;
    try {
      memberUser = await admin.auth().getUserByEmail(memberEmailCleaned);
    } catch (error: any) {
      if (error.code === "auth/user-not-found") {
        const invitationsRef = db.collection("agencyInvitations").doc(memberEmailCleaned);
        await invitationsRef.set({
          agencyId: agencyId,
          agencyName: agencyData.name,
          inviteeEmail: memberEmailCleaned,
          type: "team",
          role,
          status: "pending",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await sendAgencyInvitationEmail(memberEmailCleaned, agencyData.name, false, "team", role);
        return {success: true, message: `Invitation sent to new user ${memberEmailCleaned}.`};
      }
      throw new HttpsError("internal", "Error checking for user by email.");
    }

    const memberUserId = memberUser.uid;
    const memberUserDocRef = db.collection("users").doc(memberUserId);

    const newTeamMember: TeamMember = {
      userId: memberUserId,
      email: memberEmailCleaned,
      displayName: memberUser.displayName || "Invited Member",
      role,
      status: "pending",
    };
    const teamAgencyMembership: AgencyMembership = {
      agencyId,
      agencyName: agencyData.name,
      role,
      status: "pending",
    };

    const batch = db.batch();
    batch.update(agencyDocRef, {team: admin.firestore.FieldValue.arrayUnion(newTeamMember)});
    batch.update(memberUserDocRef, {agencyMemberships: admin.firestore.FieldValue.arrayUnion(teamAgencyMembership)});
    await batch.commit();

    await sendAgencyInvitationEmail(memberEmailCleaned, agencyData.name, true, "team", role);

    return {success: true, message: "Team member invited successfully."};
  } catch (error) {
    logger.error("Error inviting team member:", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "An unexpected error occurred.");
  }
});


export const acceptAgencyInvitation = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated to accept an invitation.");
  }
  const userId = request.auth.uid;
  const { agencyId } = request.data;

  if (!agencyId) {
    throw new HttpsError("invalid-argument", "Agency ID is required.");
  }

  const agencyDocRef = db.collection("agencies").doc(agencyId);
  const userDocRef = db.collection("users").doc(userId);

  return db.runTransaction(async (transaction) => {
    const agencyDoc = await transaction.get(agencyDocRef);
    const userDoc = await transaction.get(userDocRef);

    if (!agencyDoc.exists) throw new HttpsError("not-found", "Agency not found.");
    if (!userDoc.exists) throw new HttpsError("not-found", "User profile not found.");

    const agencyData = agencyDoc.data() as Agency;
    const userData = userDoc.data() as UserProfileFirestoreData;

    const membershipIndex = userData.agencyMemberships?.findIndex((m) => m.agencyId === agencyId && m.status === "pending");
    if (membershipIndex === -1 || membershipIndex === undefined) {
      throw new HttpsError("failed-precondition", "No pending invitation found for this user.");
    }
    
    const membership = userData.agencyMemberships![membershipIndex];
    const updatedMembershipsArray = [...(userData.agencyMemberships || [])];
    updatedMembershipsArray[membershipIndex] = { ...membership, status: "active" };
    
    if (membership.role === 'talent') {
        const talentIndex = agencyData.talent.findIndex((t) => t.userId === userId && t.status === "pending");
        if (talentIndex !== -1) {
            const updatedTalentArray = [...agencyData.talent];
            updatedTalentArray[talentIndex] = { ...updatedTalentArray[talentIndex], status: "active", joinedAt: admin.firestore.Timestamp.now() };
            transaction.update(agencyDocRef, { talent: updatedTalentArray });
        }
    } else if (membership.role === 'admin' || membership.role === 'member') {
        const teamMemberIndex = agencyData.team.findIndex((t) => t.userId === userId && t.status === "pending");
        if (teamMemberIndex !== -1) {
            const updatedTeamArray = [...agencyData.team];
            updatedTeamArray[teamMemberIndex] = { ...updatedTeamArray[teamMemberIndex], status: "active", joinedAt: admin.firestore.Timestamp.now() };
            transaction.update(agencyDocRef, { team: updatedTeamArray });
            
            // Set custom claim for admin
            if (membership.role === 'admin') {
              const currentClaims = (await admin.auth().getUser(userId)).customClaims || {};
              await admin.auth().setCustomUserClaims(userId, {...currentClaims, isAgencyAdmin: true});
            }
        }
    } else {
       throw new HttpsError("invalid-argument", "Invalid membership role found.");
    }

    transaction.update(userDocRef, { agencyMemberships: updatedMembershipsArray });

    return { success: true, message: "Invitation accepted successfully." };
  }).catch((error) => {
    logger.error(`Error accepting invitation for user ${userId} to agency ${agencyId}:`, error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "An unexpected error occurred while accepting the invitation.");
  });
});

export const declineAgencyInvitation = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated to decline an invitation.");
  }
  const userId = request.auth.uid;
  const { agencyId } = request.data;
  if (!agencyId) {
    throw new HttpsError("invalid-argument", "Agency ID is required.");
  }

  const agencyDocRef = db.collection("agencies").doc(agencyId);
  const userDocRef = db.collection("users").doc(userId);

  return db.runTransaction(async (transaction) => {
    const agencyDoc = await transaction.get(agencyDocRef);
    const userDoc = await transaction.get(userDocRef);

    if (!agencyDoc.exists) throw new HttpsError("not-found", "Agency not found.");
    if (!userDoc.exists) throw new HttpsError("not-found", "User profile not found.");

    const agencyData = agencyDoc.data() as Agency;
    const userData = userDoc.data() as UserProfileFirestoreData;
    
    const membership = userData.agencyMemberships?.find((m) => m.agencyId === agencyId);

    const updatedMembershipsArray = userData.agencyMemberships?.filter((m) => m.agencyId !== agencyId) || [];
    transaction.update(userDocRef, { agencyMemberships: updatedMembershipsArray });
    
    if (membership?.role === 'talent') {
      const updatedTalentArray = agencyData.talent.filter((t) => t.userId !== userId);
      transaction.update(agencyDocRef, { talent: updatedTalentArray });
    } else if (membership?.role === 'admin' || membership?.role === 'member') {
      const updatedTeamArray = agencyData.team.filter((t) => t.userId !== userId);
      transaction.update(agencyDocRef, { team: updatedTeamArray });
    }

    return { success: true, message: "Invitation declined successfully." };
  }).catch((error) => {
    logger.error(`Error declining invitation for user ${userId} to agency ${agencyId}:`, error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "An unexpected error occurred while declining the invitation.");
  });
});


export const createInternalPayout = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }
  const requesterId = request.auth.uid;
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
    const agencyData = agencySnap.data() as Agency;

    const requesterIsAdmin = agencyData.ownerId === requesterId ||
      agencyData.team?.some((m) => m.userId === requesterId && m.role === "admin");

    if (!agencySnap.exists || !requesterIsAdmin) {
      throw new HttpsError("permission-denied", "You do not have permission to manage this agency.");
    }
    
    // The person initiating the payout must be an admin, but the payment comes from the owner's account.
    const agencyOwnerId = agencyData.ownerId;
    const agencyOwnerUserDocRef = db.collection("users").doc(agencyOwnerId);
    const agencyOwnerSnap = await agencyOwnerUserDocRef.get();
    const agencyOwnerData = agencyOwnerSnap.data() as UserProfileFirestoreData;

    if (!agencyOwnerData.stripeCustomerId) {
      throw new HttpsError("failed-precondition", "Agency owner does not have a Stripe Customer ID and cannot make payments.");
    }

    const paymentMethods = await stripe.paymentMethods.list({ customer: agencyOwnerData.stripeCustomerId });
    const bankAccount = paymentMethods.data.find((pm) => pm.type === "us_bank_account");
    const card = paymentMethods.data.find((pm) => pm.type === "card");
    let paymentMethodId: string | undefined;
    if (bankAccount) paymentMethodId = bankAccount.id;
    else if (card) paymentMethodId = card.id;

    if (!paymentMethodId) {
      throw new HttpsError("failed-precondition",
        "Agency owner has no saved bank account or card in Stripe to charge for this payout.");
    }

    const talentInfo = agencyData.talent.find((t) => t.userId === talentId);
    if (!talentInfo) {
      throw new HttpsError("not-found", "The selected talent is not a member of this agency.");
    }

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
      amount,
      description,
      status: "processing",
      initiatedAt: admin.firestore.Timestamp.now(),
      paymentDate: admin.firestore.Timestamp.fromDate(new Date(paymentDate)),
      platformFee: 0,
    };

    const payoutAmountInCents = Math.round(amount * 100);
    const platformFeeInCents = Math.round(payoutAmountInCents * 0.04) + 30;
    const totalChargeInCents = payoutAmountInCents + platformFeeInCents;
    newPayout.platformFee = platformFeeInCents / 100;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalChargeInCents,
      currency: "usd",
      customer: agencyOwnerData.stripeCustomerId,
      payment_method: paymentMethodId,
      description: `Payout to ${talentInfo.displayName} for: ${description}`,
      transfer_data: {
        destination: talentUserData.stripeAccountId,
        amount: payoutAmountInCents,
      },
      confirm: true,
      off_session: true,
      metadata: {
        agencyId,
        talentId,
        payout_description: description,
        paymentDate,
        payout_amount: (amount).toString(),
        platform_fee: (newPayout.platformFee).toString(),
        internalPayoutId: newPayout.id,
      },
    });

    const finalPayout: InternalPayout = { ...newPayout, stripeChargeId: paymentIntent.id };
    await payoutDocRef.set(finalPayout);

    logger.info(`Stripe PaymentIntent ${paymentIntent.id} and transfer initiated for talent ${talentId} by agency ${agencyId}.`);
    return {success: true, payoutId: newPayout.id, message: "Payout transfer initiated successfully via Stripe."};
  } catch (error: any) {
    logger.error(`Error creating internal payout for agency ${agencyId}:`, error);
    if (error instanceof HttpsError) throw error;
    if (error.type === "StripeCardError") {
      throw new HttpsError("invalid-argument", `Stripe Error: ${error.message}. Please check your saved payment methods.`);
    }
    throw new HttpsError("internal", error.message || "An unexpected error occurred while creating the payout.");
  }
});
