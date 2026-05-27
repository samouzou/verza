import {HttpsError} from "firebase-functions/v2/https";
import {db} from "../config/firebase";

const TEAM_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);

/**
 * Ensures the caller is an agency team member with a primary agency (same gate as Optic).
 * @param {string} uid Firebase Auth user id.
 * @return {!Promise<string>} The user's primaryAgencyId.
 */
export async function assertAgencyTeamForLinkedInOs(uid: string): Promise<string> {
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("failed-precondition", "User profile not found.");
  }
  const user = userSnap.data();
  if (!user) {
    throw new HttpsError("failed-precondition", "User profile not found.");
  }
  const role = String(user.role ?? "");
  if (!TEAM_ROLES.has(role)) {
    throw new HttpsError(
      "permission-denied",
      "LinkedIn OS requires an agency owner, admin, or member account."
    );
  }
  const agencyId = user.primaryAgencyId as string | undefined;
  if (!agencyId) {
    throw new HttpsError(
      "failed-precondition",
      "Set a primary agency before using LinkedIn OS."
    );
  }
  return agencyId;
}
