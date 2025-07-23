
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";
import * as logger from "firebase-functions/logger";
import type { Agency, Talent, UserProfileFirestoreData } from "../../../src/types";

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
    const userUpdate = {
      role: "agency_owner",
      agencyMemberships: admin.firestore.FieldValue.arrayUnion({
        agencyId: newAgency.id,
        agencyName: newAgency.name,
        role: "owner",
      }),
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
  const { agencyId, talentEmail } = request.data;

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
      if (error.code === 'auth/user-not-found') {
        // Here you could implement sending an actual email invite to sign up
        throw new HttpsError("not-found", "No user found with this email address. They must have a Verza account to be invited.");
      }
      throw new HttpsError("internal", "Error finding user by email.");
    }

    const talentUserId = talentUser.uid;
    const talentUserDocRef = db.collection("users").doc(talentUserId);

    // 3. Check if the user is already in the agency
    const agencyData = agencySnap.data() as Agency;
    if (agencyData.talent.some(t => t.userId === talentUserId)) {
      throw new HttpsError("already-exists", "This user is already a member of your agency.");
    }
    
    // 4. Update both the agency and the user's document
    const talentDocSnap = await talentUserDocRef.get();
    const talentDocData = talentDocSnap.data() as UserProfileFirestoreData | undefined;

    const newTalentMember: Talent = {
      userId: talentUserId,
      email: talentEmailCleaned,
      displayName: talentDocData?.displayName || talentUser.displayName || 'Invited User',
      status: 'pending', // Will become 'active' when they accept
    };
    
    const talentAgencyMembership = {
      agencyId: agencyId,
      agencyName: agencyData.name,
      role: 'talent',
    };

    const batch = db.batch();
    batch.update(agencyDocRef, { talent: admin.firestore.FieldValue.arrayUnion(newTalentMember) });
    batch.update(talentUserDocRef, { agencyMemberships: admin.firestore.FieldValue.arrayUnion(talentAgencyMembership) });
    
    await batch.commit();

    // TODO: In a real implementation, send an email notification to the talent
    // For now, we just add them directly.

    logger.info(`Talent ${talentEmailCleaned} invited to agency ${agencyId} by owner ${agencyOwnerId}.`);
    return { success: true, message: "Talent invited successfully." };

  } catch (error) {
    logger.error(`Error inviting talent to agency ${agencyId}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "An unexpected error occurred while inviting talent.");
  }
});
