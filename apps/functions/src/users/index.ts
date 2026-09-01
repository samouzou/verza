
import * as functions from "firebase-functions/v1";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import type {AgencyMembership, Talent, TeamMember, UserProfileFirestoreData} from "./../types";

const NEW_USER_BONUS = 50;

export const processNewUser = functions.auth.user().onCreate(async (user) => {
  const {uid, email, displayName, photoURL, emailVerified} = user;
  const userDocRef = db.collection("users").doc(uid);
  const createdAt = Timestamp.now();
  const trialEndsAt = new Timestamp(createdAt.seconds + 7 * 24 * 60 * 60, createdAt.nanoseconds);

  let finalRole: UserProfileFirestoreData["role"] = "individual_creator";
  const agencyMemberships: AgencyMembership[] = [];

  // Check for a pending invitation BEFORE creating the user document
  if (email) {
    const invitationRef = db.collection("agencyInvitations").doc(email);
    const invitationDoc = await invitationRef.get();

    if (invitationDoc.exists) {
      logger.info(`Found pending invitation for new user ${email}.`);
      const invitationData = invitationDoc.data();
      if (invitationData && invitationData.status === "pending") {
        const {agencyId, agencyName, type, role: inviteRole} = invitationData;

        // Determine the user's top-level role from the invitation
        if (type === "team") {
          if (inviteRole === "admin") {
            finalRole = "agency_admin";
          } else if (inviteRole === "member") {
            finalRole = "agency_member";
          }
        }

        // Prepare the membership object to be added to the user's document
        agencyMemberships.push({
          agencyId,
          agencyName,
          role: inviteRole || type,
          status: "pending",
        });

        const batch = db.batch();
        const agencyDocRef = db.collection("agencies").doc(agencyId);

        if (type === "talent") {
          const newTalentMember: Talent = {
            userId: uid,
            email: email,
            displayName: displayName || "New Talent",
            status: "pending",
          };
          batch.update(agencyDocRef, {talent: FieldValue.arrayUnion(newTalentMember)});
        } else if (type === "team") {
          const newTeamMember: TeamMember = {
            userId: uid,
            email: email,
            displayName: displayName || "New Team Member",
            role: inviteRole,
            status: "pending",
          };
          batch.update(agencyDocRef, {team: FieldValue.arrayUnion(newTeamMember)});
        }

        // Mark the invitation as claimed
        batch.update(invitationRef, {
          status: "claimed",
          claimedBy: uid,
          claimedAt: FieldValue.serverTimestamp(),
        });

        try {
          await batch.commit();
          logger.info(`Successfully linked new user ${email} to agency ${agencyName} (${agencyId}) as pending member.`);
        } catch (error) {
          logger.error(`Error processing new user invitation for ${email}:`, error);
        }
      }
    }
  }

  const isIndividualCreator = finalRole === "individual_creator";

  const newUserDoc: UserProfileFirestoreData = {
    uid: uid,
    email: email || null,
    displayName: displayName || email?.split("@")[0] || "New User",
    avatarUrl: photoURL || null,
    companyLogoUrl: null,
    emailVerified: emailVerified,
    createdAt: createdAt as any,
    role: finalRole, // Set the role determined from the invitation check
    isAgencyOwner: false, // This is only set when an agency is created
    agencyMemberships: agencyMemberships,
    giggingForAgencies: [],
    primaryAgencyId: null, // This is only set upon accepting an invitation
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: isIndividualCreator ? "active" : "trialing",
    subscriptionPlanId: isIndividualCreator ? "individual_free" : null,
    talentLimit: 3,
    subscriptionInterval: null,
    trialEndsAt: isIndividualCreator ? null : trialEndsAt as any,
    subscriptionEndsAt: null,
    trialExtensionUsed: false,
    stripeAccountId: null,
    stripeAccountStatus: "none",
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    stripeAccountCountry: "US",
    address: null,
    tin: null,
    hasCompletedOnboarding: false,
    hasCompletedCareerPath: false,
    hasCompletedBrandJourney: false,
    // Creator drip starts in sendOnboardingWelcomeEmail after role selection.
    credits: NEW_USER_BONUS,
  };

  await userDocRef.set(newUserDoc, {merge: true});

  // Welcome email is sent after onboarding role selection (sendOnboardingWelcomeEmail)
  // so brands/agencies never get the creator welcome.

  return null;
});
