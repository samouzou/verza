import type {Firestore} from "firebase-admin/firestore";
import {getAuth} from "firebase-admin/auth";

const TEAM_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);

export type VerzaActor = {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: string;
  agencyId: string;
  agencyName: string;
  opticCreditsBalance: number;
  opticPlan: string | null;
  opticSubscriptionActive: boolean;
};

function numOrZero(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Resolves the MCP-acting user + primary agency from Firestore.
 */
export async function resolveActor(
  db: Firestore,
  opts: {uid?: string | null; email?: string | null}
): Promise<VerzaActor> {
  let uid = opts.uid?.trim() || null;

  if (!uid && opts.email) {
    const email = opts.email.trim();
    try {
      const rec = await getAuth().getUserByEmail(email);
      uid = rec.uid;
    } catch {
      const snap = await db
        .collection("users")
        .where("email", "==", email.toLowerCase())
        .limit(1)
        .get();
      if (snap.empty) {
        throw new Error(`No Verza user found for email ${email}`);
      }
      uid = snap.docs[0].id;
    }
  }

  if (!uid) {
    throw new Error("Could not resolve Verza user (set VERZA_UID or VERZA_USER_EMAIL)");
  }

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new Error(`No Verza user profile for uid ${uid}`);
  }
  const user = userSnap.data()!;
  const role = String(user.role ?? "");
  if (!TEAM_ROLES.has(role)) {
    throw new Error(
      `User ${uid} role "${role}" cannot use Optic MCP tools (need agency_owner/admin/member).`
    );
  }
  const agencyId = typeof user.primaryAgencyId === "string" ? user.primaryAgencyId : "";
  if (!agencyId) {
    throw new Error(`User ${uid} has no primaryAgencyId — link a brand workspace first.`);
  }

  const agencySnap = await db.collection("agencies").doc(agencyId).get();
  if (!agencySnap.exists) {
    throw new Error(`Agency ${agencyId} not found`);
  }
  const agency = agencySnap.data()!;

  const status = String(agency.opticSubscriptionStatus ?? "");
  const plan = typeof agency.opticPlan === "string" ? agency.opticPlan : null;
  const isAppSumo =
    agency.opticBillingSource === "appsumo" || plan === "appsumo";
  const subscriptionActive =
    isAppSumo || status === "active" || status === "trialing";

  return {
    uid,
    email: typeof user.email === "string" ? user.email : null,
    displayName: typeof user.displayName === "string" ? user.displayName : null,
    role,
    agencyId,
    agencyName: typeof agency.name === "string" ? agency.name : "Brand",
    opticCreditsBalance: numOrZero(agency.opticCreditsBalance),
    opticPlan: subscriptionActive ? plan : null,
    opticSubscriptionActive: subscriptionActive,
  };
}

export function isActiveRecruitingStatus(status: unknown): boolean {
  return status === "open" || status === "in-progress";
}

export {numOrZero};
