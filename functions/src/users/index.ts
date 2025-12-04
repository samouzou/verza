
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import type {AgencyMembership, Talent, UserProfileFirestoreData, AgencyMember} from "../../../src/types";
import {sendEmailSequence} from "../notifications";


export const processNewUser = functions.auth.user().onCreate(async (user) => {
  const {uid, email, displayName, photoURL, emailVerified} = user;

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
    subscriptionPlanId: null, // User hasn't chosen a specific plan yet
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
    },
  };

  await userDocRef.set(newUserDoc, {merge: true});

  // Send welcome email immediately
  if (email) {
    await sendEmailSequence(email, displayName || "Creator", 0);
  }


  if (!email) {
    logger.info(`User ${uid} created without an email, skipping invitation check.`);
    return null;
  }

  // --- Check for and process any pending invitations ---
  const talentInvitationRef = db.collection("agencyInvitations").doc(email);
  const teamInvitationRef = db.collection("teamInvitations").doc(email);

  const [talentInvitationDoc, teamInvitationDoc] = await Promise.all([
    talentInvitationRef.get(),
    teamInvitationRef.get(),
  ]);

  if (talentInvitationDoc.exists) {
    logger.info(`Found pending talent invitation for new user ${email}.`);
    const invitationData = talentInvitationDoc.data();
    if (invitationData && invitationData.status === "pending") {
      await processTalentInvitation(user, invitationData);
    }
  }

  if (teamInvitationDoc.exists) {
    logger.info(`Found pending team invitation for new user ${email}.`);
    const invitationData = teamInvitationDoc.data();
    if (invitationData && invitationData.status === "pending") {
        await processTeamInvitation(user, invitationData);
    }
  }

  return null;
});

async function processTalentInvitation(user: functions.auth.UserRecord, invitationData: any) {
  const {agencyId, agencyName} = invitationData;
  const agencyDocRef = db.collection("agencies").doc(agencyId);
  const userDocRef = db.collection("users").doc(user.uid);
  const talentInvitationRef = db.collection("agencyInvitations").doc(user.email!);

  const newTalentMember: Talent = {
    userId: user.uid,
    email: user.email!,
    displayName: user.displayName || "New Talent",
    status: "pending",
  };

  const talentAgencyMembership: AgencyMembership = {
    agencyId: agencyId,
    agencyName: agencyName,
    role: "talent",
    status: "pending",
  };

  const batch = db.batch();
  batch.update(userDocRef, { agencyMemberships: admin.firestore.FieldValue.arrayUnion(talentAgencyMembership) });
  batch.update(agencyDocRef, { talent: admin.firestore.FieldValue.arrayUnion(newTalentMember) });
  batch.update(talentInvitationRef, { status: "claimed", claimedBy: user.uid, claimedAt: admin.firestore.FieldValue.serverTimestamp() });

  try {
    await batch.commit();
    logger.info(`Successfully linked new user ${user.email} as TALENT to agency ${agencyName} (${agencyId}).`);
  } catch (error) {
    logger.error(`Error processing new user talent invitation for ${user.email}:`, error);
  }
}

async function processTeamInvitation(user: functions.auth.UserRecord, invitationData: any) {
    const { agencyId, agencyName, role } = invitationData;
    const agencyDocRef = db.collection("agencies").doc(agencyId);
    const userDocRef = db.collection("users").doc(user.uid);
    const teamInvitationRef = db.collection("teamInvitations").doc(user.email!);

    const newMember: AgencyMember = {
        userId: user.uid,
        email: user.email!,
        displayName: user.displayName || "Invited Member",
        role: role,
        status: "pending",
    };

    const teamAgencyMembership: AgencyMembership = {
        agencyId: agencyId,
        agencyName: agencyName,
        role: "team",
        status: "pending",
    };

    const batch = db.batch();
    batch.update(userDocRef, { agencyMemberships: admin.firestore.FieldValue.arrayUnion(teamAgencyMembership) });
    batch.update(agencyDocRef, { members: admin.firestore.FieldValue.arrayUnion(newMember) });
    batch.update(teamInvitationRef, { status: "claimed", claimedBy: user.uid, claimedAt: admin.firestore.FieldValue.serverTimestamp() });

    try {
        await batch.commit();
        logger.info(`Successfully linked new user ${user.email} as a TEAM MEMBER to agency ${agencyName} (${agencyId}).`);
    } catch (error) {
        logger.error(`Error processing new user team invitation for ${user.email}:`, error);
    }
}
