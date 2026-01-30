
"use client";

import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import type {AgencyMembership, Talent, TeamMember, UserProfileFirestoreData} from "./types";
import {sendEmailSequence} from "../notifications";


export const processNewUser = functions.auth.user().onCreate(async (user) => {
  const {uid, email, displayName, photoURL, emailVerified} = user;
  const userDocRef = db.collection("users").doc(uid);
  const createdAt = admin.firestore.Timestamp.now();
  const trialEndsAt = new admin.firestore.Timestamp(createdAt.seconds + 7 * 24 * 60 * 60, createdAt.nanoseconds);
  const twoDaysFromNow = new admin.firestore.Timestamp(createdAt.seconds + 2 * 24 * 60 * 60, createdAt.nanoseconds);

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
          batch.update(agencyDocRef, {talent: admin.firestore.FieldValue.arrayUnion(newTalentMember)});
        } else if (type === "team") {
          const newTeamMember: TeamMember = {
            userId: uid,
            email: email,
            displayName: displayName || "New Team Member",
            role: inviteRole,
            status: "pending",
          };
          batch.update(agencyDocRef, {team: admin.firestore.FieldValue.arrayUnion(newTeamMember)});
        }

        // Mark the invitation as claimed
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
  }

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
    primaryAgencyId: null, // This is only set upon accepting an invitation
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
    credits: 5,
  };

  await userDocRef.set(newUserDoc, {merge: true});

  if (email) {
    await sendEmailSequence(email, displayName || "Creator", 0);
  }

  return null;
});
