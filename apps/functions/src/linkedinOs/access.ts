import {FieldValue} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {db} from "../config/firebase";

const TEAM_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);
const CREATOR_ROLES = new Set(["individual_creator", "talent"]);

/**
 * True when this user runs Prism on their own, not through a brand team.
 * @param {string} role User role.
 * @return {boolean} Whether the role is a creator.
 */
export function isPrismCreatorRole(role: string): boolean {
  return CREATOR_ROLES.has(role);
}

/**
 * Brand teams use their primary agency. Creators get a personal Prism workspace
 * that is not their primary agency, so campaign and Optic tools stay brand-only.
 * @param {string} uid Firebase Auth user id.
 * @return {!Promise<string>} Agency id Prism should read and write.
 */
export async function assertAgencyTeamForLinkedInOs(uid: string): Promise<string> {
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new HttpsError("failed-precondition", "User profile not found.");
  }
  const user = userSnap.data();
  if (!user) {
    throw new HttpsError("failed-precondition", "User profile not found.");
  }
  const role = String(user.role ?? "");
  const primary = typeof user.primaryAgencyId === "string" ? user.primaryAgencyId : "";
  if (TEAM_ROLES.has(role)) {
    if (!primary) {
      throw new HttpsError("failed-precondition", "Set a primary agency before using Prism.");
    }
    return primary;
  }
  if (!CREATOR_ROLES.has(role)) {
    throw new HttpsError(
      "permission-denied",
      "Prism requires an agency owner, admin, or member account."
    );
  }

  const existing = typeof user.prismWorkspaceId === "string" ? user.prismWorkspaceId : "";
  if (existing) {
    const owned = await db.collection("agencies").doc(existing).get();
    if (owned.exists && owned.data()?.ownerId === uid) return existing;
  }

  const agencyId = `prism_${uid}`;
  const agencyRef = db.collection("agencies").doc(agencyId);
  const name = String(user.displayName || user.email || "My Prism").slice(0, 80);
  await db.runTransaction(async (tx) => {
    const [freshUser, agencySnap] = await Promise.all([tx.get(userRef), tx.get(agencyRef)]);
    if (!agencySnap.exists) {
      tx.set(agencyRef, {
        id: agencyId,
        name,
        ownerId: uid,
        prismPersonal: true,
        availableBalance: 0,
        escrowBalance: 0,
        opticCreditsBalance: 0,
        createdAt: FieldValue.serverTimestamp(),
        talent: [],
        team: [],
      });
    }
    if (freshUser.data()?.prismWorkspaceId !== agencyId) {
      tx.set(userRef, {prismWorkspaceId: agencyId}, {merge: true});
    }
  });
  return agencyId;
}

/** Opens a creator's Prism workspace and returns its id. Brand teams get their primary agency. */
export const ensurePrismWorkspace = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to use Prism.");
  const agencyId = await assertAgencyTeamForLinkedInOs(request.auth.uid);
  return {agencyId};
});
