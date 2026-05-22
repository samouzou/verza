import {FieldValue} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {db} from "../config/firebase";
import {loadAgencyOpticBilling} from "./billing";

export const INSUFFICIENT_OPTIC_CREDITS = "Insufficient Optic Credits";

/**
 * Reads the agency Optic credit balance (missing field = 0).
 * @param {string} agencyId Agency document id.
 * @return {Promise<number>} Non-negative balance.
 */
export async function getAgencyOpticCreditsBalance(agencyId: string): Promise<number> {
  const billing = await loadAgencyOpticBilling(agencyId);
  return billing.balance;
}

/**
 * Ensures the agency can run a discovery batch.
 * Active Pilot/Enterprise subscribers may run with auto top-up or overage at save time.
 * @param {string} agencyId Agency document id.
 * @param {number} requiredCredits Leads requested for the batch.
 * @return {Promise<void>} Resolves when the batch may start.
 */
export async function assertSufficientOpticCredits(
  agencyId: string,
  requiredCredits: number
): Promise<void> {
  const needed = Math.max(1, Math.floor(requiredCredits));
  const billing = await loadAgencyOpticBilling(agencyId);

  if (billing.subscriptionActive && billing.plan === "enterprise") {
    return;
  }

  if (billing.subscriptionActive && billing.plan === "pilot") {
    return;
  }

  if (billing.balance < needed) {
    throw new HttpsError(
      "failed-precondition",
      `${INSUFFICIENT_OPTIC_CREDITS}. Subscribe to Optic or add credits. This batch needs ${needed}; you have ${billing.balance}.`
    );
  }
}

/**
 * Grants Optic credits to an agency (admin / billing flows).
 * @param {string} agencyId Agency document id.
 * @param {number} amount Credits to add (positive integer).
 * @return {Promise<number>} Balance after grant.
 */
export async function grantAgencyOpticCredits(
  agencyId: string,
  amount: number
): Promise<number> {
  const delta = Math.floor(amount);
  if (delta <= 0) {
    throw new HttpsError("invalid-argument", "amount must be a positive integer.");
  }
  const ref = db.collection("agencies").doc(agencyId);
  await ref.update({
    opticCreditsBalance: FieldValue.increment(delta),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return getAgencyOpticCreditsBalance(agencyId);
}
