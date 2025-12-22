
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import type {AgencyMembership, Talent, TeamMember, UserProfileFirestoreData} from "../../../src/types";
import {sendEmailSequence} from "../notifications";


export const processNewUser = functions.auth.user().onCreate(async (user) => {
  const {uid, email, displayName, photoURL, emailVerified} = user;

  // Create the base user document first.
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
    createdAt: createdAt as any,
    role: "individual_creator",
    isAgencyOwner: false,
    agencyMemberships: [],
    primaryAgencyId: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: "trialing",
    subscriptionPlanId: null,
    talentLimit: 0,
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
    hasCompletedOnboarding: false,
    emailSequence: {step: 1, nextEmailAt: twoDaysFromNow as any},
  };

  await userDocRef.set(newUserDoc, {merge: true});

  if (email) {
    await sendEmailSequence(email, displayName || "Creator", 0);
  }

  if (!email) {
    logger.info(`User ${uid} created without an email, skipping invitation check.`);
    return null;
  }

  // Check for pending agency invitations for this email
  const invitationRef = db.collection("agencyInvitations").doc(email);
  const invitationDoc = await invitationRef.get();

  if (invitationDoc.exists) {
    logger.info(`Found pending invitation for new user ${email}.`);
    const invitationData = invitationDoc.data();
    if (invitationData && invitationData.status === "pending") {
      const {agencyId, agencyName, type, role} = invitationData;
      const agencyDocRef = db.collection("agencies").doc(agencyId);

      const agencyMembership: AgencyMembership = {
        agencyId,
        agencyName,
        role: role || type, // Use 'role' if present (for team), otherwise fallback to 'type' (for talent)
        status: "pending",
      };

      const userUpdate: Partial<UserProfileFirestoreData> = {
        agencyMemberships: admin.firestore.FieldValue.arrayUnion(agencyMembership) as any,
        // Do NOT set primaryAgencyId here. It's set upon *acceptance* of the invitation.
      };

      const batch = db.batch();
      batch.update(userDocRef, userUpdate);

      if (type === "talent") {
        const newTalentMember: Talent = {
          userId: uid,
          email: email,
          displayName: displayName || "New Talent",
          status: "pending",
        };
        batch.update(agencyDocRef, {talent: admin.firestore.FieldValue.arrayUnion(newTalentMember)});
      } else if (type === "team") {
        const newTeamMember: TeamMember = {
          userId: uid,
          email: email,
          displayName: displayName || "New Team Member",
          role: role,
          status: "pending",
        };
        batch.update(agencyDocRef, {team: admin.firestore.FieldValue.arrayUnion(newTeamMember)});
      }

      batch.update(invitationRef, {
        status: "claimed",
        claimedBy: uid,
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      try {
        await batch.commit();
        logger.info(`Successfully linked new user ${email} to agency ${agencyName} (${agencyId}) as pending member.`);
      } catch (error) {
        logger.error(`Error processing new user invitation for ${email}:`, error);
      }
    }
  }
  return null;
});
