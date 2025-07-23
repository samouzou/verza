
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";
import * as logger from "firebase-functions/logger";
import type {Agency, Talent, UserProfileFirestoreData, AgencyMembership} from "../../../src/types";

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

    await batch.commit();

    logger.info(`Agency "${name}" created successfully for user ${userId}.`);

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
    // 1. Verify the caller owns the agency
    const agencyDocRef = db.collection("agencies").doc(agencyId);
    const agencySnap = await agencyDocRef.get();
    if (!agencySnap.exists || agencySnap.data()?.ownerId !== agencyOwnerId) {
      throw new HttpsError("permission-denied", "You do not have permission to manage this agency.");
    }

    // 2. Find the user by email
    let talentUser;
    try {
      talentUser = await admin.auth().getUserByEmail(talentEmailCleaned);
    } catch (error: any) {
      if (error.code === "auth/user-not-found") {
        throw new HttpsError("not-found", "No user found with this email address. They must have a Verza account to be invited.");
      }
      throw new HttpsError("internal", "Error finding user by email.");
    }

    const talentUserId = talentUser.uid;
    const talentUserDocRef = db.collection("users").doc(talentUserId);

    // 3. Check if the user is already in the agency
    const agencyData = agencySnap.data() as Agency;
    if (agencyData.talent.some((t) => t.userId === talentUserId)) {
      throw new HttpsError("already-exists", "This user is already a member of your agency.");
    }

    // 4. Update both the agency and the user's document
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

    if (!userData.agencyMemberships) {
      throw new HttpsError("failed-precondition", "User does not have a corresponding pending membership record.");
    }
    const membershipIndex = userData.agencyMemberships.findIndex((m) => m.agencyId === agencyId && m.status === "pending");
    if (membershipIndex === -1) {
      throw new HttpsError("failed-precondition", "User does not have a corresponding pending membership.");
    }

    const updatedTalentArray = [...agencyData.talent];
    updatedTalentArray[talentIndex] =
      {...updatedTalentArray[talentIndex], status: "active", joinedAt: admin.firestore.Timestamp.now() as any};

    const updatedMembershipsArray = [...userData.agencyMemberships];
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
    }

    return {success: true, message: "Invitation declined successfully."};
  }).catch((error) => {
    logger.error(`Error declining invitation for user ${talentUserId} to agency ${agencyId}:`, error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "An unexpected error occurred while declining the invitation.");
  });
});
