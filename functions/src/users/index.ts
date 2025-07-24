
import {onUserCreate} from "firebase-functions/v2/auth";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import type {AgencyMembership, Talent, UserProfileFirestoreData} from "../../../src/types";

export const processNewUser = onUserCreate(async (user) => {
  const {uid, email, displayName} = user.data;

  if (!email) {
    logger.info(`User ${uid} created without an email, skipping invitation check.`);
    return null;
  }

  // Check for pending agency invitations
  const invitationRef = db.collection("agencyInvitations").doc(email);
  const invitationDoc = await invitationRef.get();

  if (invitationDoc.exists) {
    logger.info(`Found pending invitation for new user ${email}.`);
    const invitationData = invitationDoc.data();
    if (invitationData && invitationData.status === "pending") {
      const {agencyId, agencyName} = invitationData;
      const userDocRef = db.collection("users").doc(uid);
      const agencyDocRef = db.collection("agencies").doc(agencyId);

      const newTalentMember: Talent = {
        userId: uid,
        email: email,
        displayName: displayName || "New Talent",
        status: "pending",
      };

      const talentAgencyMembership: AgencyMembership = {
        agencyId: agencyId,
        agencyName: agencyName,
        role: "talent",
        status: "pending",
      };

      // Use a batch to perform updates atomically
      const batch = db.batch();

      // Update the user's document with the membership
      const userUpdate: Partial<UserProfileFirestoreData> = {
        agencyMemberships: admin.firestore.FieldValue.arrayUnion(talentAgencyMembership) as any,
      };
      batch.set(userDocRef, userUpdate, {merge: true});

      // Add the user to the agency's talent array
      batch.update(agencyDocRef, {
        talent: admin.firestore.FieldValue.arrayUnion(newTalentMember),
      });

      // Mark the invitation as claimed
      batch.update(invitationRef, {
        status: "claimed",
        claimedBy: uid,
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      try {
        await batch.commit();
        logger.info(`Successfully linked new user ${email} to agency ${agencyName} (${agencyId}).`);
      } catch (error) {
        logger.error(`Error processing new user invitation for ${email}:`, error);
      }
    }
  }

  return null;
});
