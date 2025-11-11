
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import type {AgencyMembership, Talent, UserProfileFirestoreData} from "../../../src/types";
import { sendEmailSequence } from "../notifications";


export const processNewUser = functions.auth.user().onCreate(async (user) => {
  const { uid, email, displayName, photoURL, emailVerified } = user;

  // Create the base user document first, regardless of invitation status.
  const userDocRef = db.collection("users").doc(uid);
  const createdAt = admin.firestore.Timestamp.now();
  const trialEndsAt = new admin.firestore.Timestamp(createdAt.seconds + 7 * 24 * 60 * 60, createdAt.nanoseconds);
  const twoDaysFromNow = new admin.firestore.Timestamp(createdAt.seconds + 2 * 24 * 60 * 60, createdAt.nanoseconds);


  const newUserDoc: UserProfileFirestoreData = {
    uid: uid,
    email: email || null,
    displayName: displayName || email?.split("@")[0] || "New User",
    avatarUrl: photoURL || null,
    companyLogoUrl: null,
    emailVerified: emailVerified,
    createdAt: createdAt as any, // Cast for compatibility
    role: "individual_creator", // Default role
    isAgencyOwner: false,
    agencyMemberships: [],
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: "trialing", // Start with a 7-day free trial
    subscriptionPlanId: undefined, // User hasn't chosen a specific plan yet
    talentLimit: 0, // No talent limit for individuals
    subscriptionInterval: null,
    trialEndsAt: trialEndsAt as any,
    subscriptionEndsAt: null,
    trialExtensionUsed: false,
    stripeAccountId: null,
    stripeAccountStatus: "none",
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    address: null,
    tin: null,
    hasCompletedOnboarding: false, // Initialize onboarding tour flag
    emailSequence: {
        step: 1, // Start at step 1 (Welcome email sent)
        nextEmailAt: twoDaysFromNow as any, // Schedule next email
    }
  };

  await userDocRef.set(newUserDoc, { merge: true });

  // Send welcome email immediately
  if (email) {
    await sendEmailSequence(email, displayName || "Creator", 0);
  }


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
