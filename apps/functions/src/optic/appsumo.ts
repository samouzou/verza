import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";

export const APPSUMO_OPTIC_LEADS_PER_CODE = 50;
export const APPSUMO_OPTIC_MAX_CODES = 10;
export const APPSUMO_OPTIC_CODES_COLLECTION = "appsumo_optic_codes";

const TEAM_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);

/**
 * Normalizes an AppSumo Optic redemption code for lookup.
 * @param {unknown} raw Raw code from the client.
 * @return {string} Uppercase trimmed code.
 */
export function normalizeAppSumoOpticCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * UTC calendar month key used for AppSumo Optic period resets.
 * @param {Date=} date Date to key (defaults to now).
 * @return {string} YYYY-MM
 */
export function appsumoOpticPeriodKey(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Ensures the caller can redeem Optic codes for their brand workspace.
 * @param {string} uid Firebase Auth user id.
 * @param {string} agencyId Agency document id.
 * @return {Promise<void>}
 */
async function assertAgencyBillingAdmin(uid: string, agencyId: string): Promise<void> {
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("failed-precondition", "User profile not found.");
  }
  const u = userSnap.data()!;
  const role = String(u.role ?? "");
  if (!TEAM_ROLES.has(role) || u.primaryAgencyId !== agencyId) {
    throw new HttpsError("permission-denied", "Only your brand team can redeem Optic codes.");
  }
  if (role !== "agency_owner" && role !== "agency_admin") {
    throw new HttpsError("permission-denied", "Optic redemption requires a brand owner or admin.");
  }
}

/**
 * Redeems one AppSumo Optic code onto the caller's primary agency (+50 leads/mo, stackable).
 */
export const redeemAppSumoOpticCode = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to redeem your AppSumo code.");
  }
  const uid = request.auth.uid;
  const code = normalizeAppSumoOpticCode(request.data?.code);
  if (!code || code.length < 3 || code.length > 200) {
    throw new HttpsError("invalid-argument", "Enter a valid AppSumo code.");
  }

  const userSnap = await db.collection("users").doc(uid).get();
  const agencyId = userSnap.data()?.primaryAgencyId as string | undefined;
  if (!agencyId) {
    throw new HttpsError(
      "failed-precondition",
      "Create a brand or agency workspace first, then redeem your code."
    );
  }
  await assertAgencyBillingAdmin(uid, agencyId);

  const codeRef = db.collection(APPSUMO_OPTIC_CODES_COLLECTION).doc(code);
  const agencyRef = db.collection("agencies").doc(agencyId);
  const periodKey = appsumoOpticPeriodKey();

  const result = await db.runTransaction(async (tx) => {
    const [codeSnap, agencySnap] = await Promise.all([tx.get(codeRef), tx.get(agencyRef)]);

    if (!codeSnap.exists) {
      throw new HttpsError("not-found", "That code was not found. Check it and try again.");
    }
    const codeData = codeSnap.data()!;
    const status = String(codeData.status ?? "unused");
    if (status !== "unused") {
      if (codeData.agencyId === agencyId) {
        throw new HttpsError("already-exists", "This code is already redeemed on your workspace.");
      }
      throw new HttpsError("failed-precondition", "This code has already been redeemed.");
    }

    if (!agencySnap.exists) {
      throw new HttpsError("failed-precondition", "Brand workspace not found.");
    }
    const agency = agencySnap.data()!;
    const stripePlan = String(agency.opticPlan ?? "none");
    const stripeStatus = String(agency.opticSubscriptionStatus ?? "");
    const stripeActive =
      (stripeStatus === "active" || stripeStatus === "trialing") &&
      (stripePlan === "launch" || stripePlan === "pilot" || stripePlan === "enterprise" || stripePlan === "flagship");
    if (stripeActive) {
      throw new HttpsError(
        "failed-precondition",
        "This workspace already has an active Optic subscription. Contact support to switch to AppSumo."
      );
    }

    const prevCount =
      typeof agency.appsumoOpticCodeCount === "number" && Number.isFinite(agency.appsumoOpticCodeCount) ?
        Math.max(0, Math.floor(agency.appsumoOpticCodeCount)) :
        0;
    if (prevCount >= APPSUMO_OPTIC_MAX_CODES) {
      throw new HttpsError(
        "resource-exhausted",
        `AppSumo Optic is capped at ${APPSUMO_OPTIC_MAX_CODES} codes (${APPSUMO_OPTIC_MAX_CODES * APPSUMO_OPTIC_LEADS_PER_CODE} leads/mo). Upgrade to a paid Optic plan for more volume.`
      );
    }

    const nextCount = prevCount + 1;
    const nextAllowance = nextCount * APPSUMO_OPTIC_LEADS_PER_CODE;
    const prevBalance =
      typeof agency.opticCreditsBalance === "number" && Number.isFinite(agency.opticCreditsBalance) ?
        Math.max(0, Math.floor(agency.opticCreditsBalance)) :
        0;
    const prevPeriodKey =
      typeof agency.opticAppsumoPeriodKey === "string" ? agency.opticAppsumoPeriodKey : "";

    // First redeem, or new calendar month: start fresh at the new allowance.
    // Same month stack: add this code's leads to the current balance.
    const nextBalance =
      prevCount === 0 || prevPeriodKey !== periodKey ?
        nextAllowance :
        prevBalance + APPSUMO_OPTIC_LEADS_PER_CODE;

    tx.update(codeRef, {
      status: "redeemed",
      agencyId,
      redeemedBy: uid,
      redeemedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.update(agencyRef, {
      opticBillingSource: "appsumo",
      opticPlan: "appsumo",
      opticSubscriptionStatus: "active",
      appsumoOpticCodeCount: nextCount,
      opticMonthlyAllowance: nextAllowance,
      opticCreditsBalance: nextBalance,
      opticAppsumoPeriodKey: periodKey,
      opticBillingInterval: "month",
      opticPeriodEnd: Timestamp.fromDate(
        new Date(Date.UTC(
          new Date().getUTCFullYear(),
          new Date().getUTCMonth() + 1,
          1,
          0,
          0,
          0
        ))
      ),
      opticOverageLeadsThisPeriod: 0,
      opticTopUpBlocksThisPeriod: 0,
      opticStripeSubscriptionId: FieldValue.delete(),
      opticLowCreditWarningPeriodKey: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      codeCount: nextCount,
      allowance: nextAllowance,
      balance: nextBalance,
      leadsPerCode: APPSUMO_OPTIC_LEADS_PER_CODE,
      maxCodes: APPSUMO_OPTIC_MAX_CODES,
    };
  });

  logger.info("[AppSumo Optic] Code redeemed", {
    agencyId,
    uid,
    codeCount: result.codeCount,
    allowance: result.allowance,
  });

  return result;
});

/**
 * Resets AppSumo Optic monthly credit balances on the 1st of each UTC month.
 */
export const resetAppSumoOpticMonthlyAllowances = onSchedule("0 0 1 * *", async () => {
  const periodKey = appsumoOpticPeriodKey();
  const snap = await db
    .collection("agencies")
    .where("opticBillingSource", "==", "appsumo")
    .get();

  let updated = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.opticAppsumoPeriodKey === periodKey) {
      skipped++;
      continue;
    }
    const count =
      typeof d.appsumoOpticCodeCount === "number" && Number.isFinite(d.appsumoOpticCodeCount) ?
        Math.max(0, Math.floor(d.appsumoOpticCodeCount)) :
        0;
    if (count <= 0) {
      skipped++;
      continue;
    }
    const allowance = count * APPSUMO_OPTIC_LEADS_PER_CODE;
    await doc.ref.update({
      opticPlan: "appsumo",
      opticSubscriptionStatus: "active",
      opticMonthlyAllowance: allowance,
      opticCreditsBalance: allowance,
      opticAppsumoPeriodKey: periodKey,
      opticPeriodEnd: Timestamp.fromDate(
        new Date(Date.UTC(
          new Date().getUTCFullYear(),
          new Date().getUTCMonth() + 1,
          1,
          0,
          0,
          0
        ))
      ),
      opticOverageLeadsThisPeriod: 0,
      opticTopUpBlocksThisPeriod: 0,
      opticLowCreditWarningPeriodKey: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    updated++;
  }

  logger.info("[AppSumo Optic] Monthly reset complete", {
    periodKey,
    updated,
    skipped,
    scanned: snap.size,
  });
});
