import * as admin from "firebase-admin";
import { getFirestoreDb } from "./storage";
import { logger } from "./logger";

export type AgencyBrandContext = {
  agencyId: string;
  agencyName: string;
  brandSummary: string | null;
  userEmail: string | null;
  userDisplayName: string | null;
};

/**
 * Verifies a Firebase Auth ID token and loads the user's primary agency + brand hints from Firestore.
 * Requires Admin SDK (ADC or service account) with access to the same project as the web app.
 */
export async function loadAgencyContextFromIdToken(
  idToken: string
): Promise<AgencyBrandContext> {
  const db = getFirestoreDb();
  if (!db) {
    throw new Error("Firestore is not configured (check FIREBASE_PROJECT_ID and ADC).");
  }

  if (!admin.apps.length) {
    throw new Error("Firebase Admin is not initialized.");
  }

  const decoded = await admin.auth().verifyIdToken(idToken);
  const uid = decoded.uid;

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new Error("No Verza user profile found for this account.");
  }

  const user = userSnap.data()!;
  const agencyId = user.primaryAgencyId as string | undefined;
  if (!agencyId) {
    throw new Error("This account has no primary agency. Open Verza web and join or create an agency first.");
  }

  const agSnap = await db.collection("agencies").doc(agencyId).get();
  if (!agSnap.exists) {
    throw new Error("Agency document not found.");
  }

  const ag = agSnap.data()!;
  const agencyName = typeof ag.name === "string" && ag.name.trim() ? ag.name.trim() : "Your agency";

  const brandGuide = ag.brandGuide as { missionStatement?: string } | undefined;
  const mission =
    typeof brandGuide?.missionStatement === "string"
      ? brandGuide.missionStatement.trim()
      : "";
  const brandSummary = mission ? mission.slice(0, 220) : null;

  const ctx: AgencyBrandContext = {
    agencyId,
    agencyName,
    brandSummary,
    userEmail: (typeof user.email === "string" ? user.email : null) || decoded.email || null,
    userDisplayName:
      (typeof user.displayName === "string" ? user.displayName : null) ||
      decoded.name ||
      null,
  };

  logger.log(`[Optic] Loaded agency context: ${ctx.agencyName} (${ctx.agencyId})`);
  return ctx;
}
