
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import type {AgencyMembership, Talent, UserProfileFirestoreData} from "../../../src/types";


export const processNewUser = functions.auth.user().onCreate(async (user) => {
  const {uid, email, displayName, photoURL, emailVerified} = user;

  // Create the base user document first, regardless of invitation status.
  const userDocRef = db.collection("users").doc(uid);
  const createdAt = admin.firestore.Timestamp.now();

  const newUserDoc: UserProfileFirestoreData = {
    uid: uid,
    email: email || null,
    displayName: displayName || email?.split("@")[0] || "New User",
    avatarUrl: photoURL || null,
    emailVerified: emailVerified,
    createdAt: createdAt as any, // Cast for compatibility
    role: "individual_creator", // Default role
    isAgencyOwner: false,
    agencyMemberships: [],
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: "active", // Individuals are on a permanent free plan
    subscriptionPlanId: "individual_free", // Identifier for the free plan
    talentLimit: 0, // No talent limit for individuals
    subscriptionInterval: null,
    trialEndsAt: null, // No trial period
    subscriptionEndsAt: null, // No end date for the free plan
    trialExtensionUsed: false,
    stripeAccountId: null,
    stripeAccountStatus: "none",
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    address: null,
    tin: null,
  };

  await userDocRef.set(newUserDoc, {merge: true});


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
      // Note: userDocRef already exists from the set() above, so we update
      batch.update(userDocRef, userUpdate);

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

