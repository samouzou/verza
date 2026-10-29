import * as admin from "firebase-admin";
import {FieldValue, type DocumentSnapshot} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import {assertAgencyTeamForLinkedInOs, isPrismCreatorRole} from "./access";
import type {Agency, AgencyMembership, UserProfileFirestoreData} from "../types";

export const APPSUMO_PRISM_CODES_COLLECTION = "appsumo_prism_codes";

const TEAM_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);

/**
 * Normalizes an AppSumo Prism code for lookup.
 * @param {unknown} raw Raw code from the client.
 * @return {string} Uppercase code without spaces.
 */
export function normalizeAppSumoPrismCode(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toUpperCase().replace(/\s+/g, "") : "";
}

/**
 * Waits briefly for processNewUser to write the profile after sign-up.
 * @param {string} uid Auth uid.
 * @return {!Promise<DocumentSnapshot>} User snapshot.
 */
async function waitForUserDoc(uid: string) {
  const ref = db.collection("users").doc(uid);
  for (let i = 0; i < 12; i++) {
    const snap = await ref.get();
    if (snap.exists) return snap;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new HttpsError("failed-precondition", "Your account is still setting up. Wait a moment and try again.");
}

/**
 * Brand or personal Prism workspace to attach Lifetime to. New AppSumo buyers get a brand.
 * @param {string} uid Auth uid.
 * @param {DocumentSnapshot} userSnap User doc.
 * @return {!Promise<string>} Agency id.
 */
async function workspaceForAppSumoRedeem(
  uid: string,
  userSnap: DocumentSnapshot
): Promise<string> {
  const user = userSnap.data() as UserProfileFirestoreData | undefined;
  if (!user) throw new HttpsError("failed-precondition", "User profile not found.");
  const role = String(user.role ?? "");
  const primary = typeof user.primaryAgencyId === "string" ? user.primaryAgencyId : "";
  const prismWorkspaceId = (userSnap.data() as {prismWorkspaceId?: unknown} | undefined)?.prismWorkspaceId;
  if (role === "agency_member") {
    throw new HttpsError("permission-denied", "Ask your brand's owner or an admin to redeem this AppSumo code.");
  }
  if (TEAM_ROLES.has(role) && primary) {
    return assertAgencyTeamForLinkedInOs(uid);
  }
  if (isPrismCreatorRole(role) && typeof prismWorkspaceId === "string" && prismWorkspaceId) {
    return assertAgencyTeamForLinkedInOs(uid);
  }
  if (isPrismCreatorRole(role) && user.hasCompletedOnboarding === true) {
    return assertAgencyTeamForLinkedInOs(uid);
  }

  const existing = await db.collection("agencies").where("ownerId", "==", uid).limit(5).get();
  const owned = existing.docs.find((d) => d.data().prismPersonal !== true);
  if (owned) return owned.id;

  const nameFromEmail = typeof user.email === "string" && user.email.includes("@") ?
    user.email.split("@")[1].split(".")[0] :
    "";
  const name = (user.displayName || nameFromEmail || "My brand").toString().slice(0, 80);
  const agencyRef = db.collection("agencies").doc();
  const membership: AgencyMembership = {
    agencyId: agencyRef.id,
    agencyName: name,
    role: "owner",
    status: "active",
  };
  const agency: Agency = {
    id: agencyRef.id,
    name,
    ownerId: uid,
    availableBalance: 0,
    escrowBalance: 0,
    opticCreditsBalance: 0,
    createdAt: FieldValue.serverTimestamp() as unknown as Agency["createdAt"],
    talent: [],
    team: [],
  };
  const batch = db.batch();
  batch.set(agencyRef, agency);
  batch.update(userSnap.ref, {
    role: "agency_owner",
    isAgencyOwner: true,
    isBrandAccount: true,
    primaryAgencyId: agencyRef.id,
    hasCompletedOnboarding: true,
    referralSource: user.referralSource || "AppSumo",
    agencyMemberships: FieldValue.arrayUnion(membership),
  });
  await batch.commit();
  try {
    await admin.auth().setCustomUserClaims(uid, {isAgencyOwner: true, primaryAgencyId: agencyRef.id});
  } catch (err) {
    logger.warn("[AppSumo Prism] Custom claims not set", err);
  }
  logger.info("[AppSumo Prism] Created brand for redeem", {uid, agencyId: agencyRef.id});
  return agencyRef.id;
}

/**
 * Redeems one AppSumo code onto the caller's brand: Prism Lifetime, one code per brand.
 * Creates a brand workspace when the buyer just signed up from the public redeem page.
 * @return {!Promise<{tier: string, agencyId: string}>} Result.
 */
export const redeemAppSumoPrismCode = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to redeem your AppSumo code.");
  const uid = request.auth.uid;
  const code = normalizeAppSumoPrismCode(request.data?.code);
  if (code.length < 6 || code.length > 64) throw new HttpsError("invalid-argument", "Enter a valid AppSumo code.");
  const userSnap = await waitForUserDoc(uid);
  const agencyId = await workspaceForAppSumoRedeem(uid, userSnap);
  const email = typeof userSnap.data()?.email === "string" ? userSnap.data()?.email : request.auth.token.email || null;

  const codeRef = db.collection(APPSUMO_PRISM_CODES_COLLECTION).doc(code);
  const agencyRef = db.collection("agencies").doc(agencyId);
  await db.runTransaction(async (tx) => {
    const [codeSnap, agencySnap] = await Promise.all([tx.get(codeRef), tx.get(agencyRef)]);
    if (!codeSnap.exists) throw new HttpsError("not-found", "That code wasn't found. Check it and try again.");
    const c = codeSnap.data() ?? {};
    if (c.status !== "unused") {
      if (c.agencyId === agencyId && c.status === "redeemed") {
        throw new HttpsError("already-exists", "This code is already redeemed on your brand.");
      }
      throw new HttpsError("failed-precondition", "This code has already been used.");
    }
    if (!agencySnap.exists) throw new HttpsError("failed-precondition", "Brand workspace not found.");
    if (agencySnap.data()?.prismLifetime === true) {
      throw new HttpsError("already-exists", "This brand already has Prism Lifetime. Use the code on another brand.");
    }
    tx.update(codeRef, {
      status: "redeemed",
      agencyId,
      redeemedBy: uid,
      redeemedEmail: email,
      redeemedAt: FieldValue.serverTimestamp(),
    });
    tx.update(agencyRef, {
      prismLifetime: true,
      prismLifetimeSource: "appsumo",
      prismLifetimeCode: code,
      prismLifetimeSince: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info("[AppSumo Prism] Code redeemed", {agencyId, uid, email});
  return {tier: "lifetime", agencyId};
});
