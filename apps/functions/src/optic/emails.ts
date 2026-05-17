import {FieldValue, Timestamp} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import {db} from "../config/firebase";
import {
  sendOpticLowCreditsEmail,
  sendOpticSubscriptionReceiptEmail,
} from "../notifications";
import type {OpticPlanId} from "./billing";

const LOW_CREDIT_REMAINING_FRACTION = 0.2;

/**
 * Readable Optic plan label for emails.
 * @param {string | null | undefined} opticPlanId Internal plan id.
 * @return {string} Display name.
 */
export function getOpticPlanDisplayName(opticPlanId: string | null | undefined): string {
  if (!opticPlanId) return "Optic";
  if (opticPlanId.includes("enterprise")) return "Optic Enterprise";
  if (opticPlanId.includes("pilot")) return "Optic Studio";
  return "Optic";
}

/**
 * Resolves billing contact email for an agency (subscriber uid, else owner).
 * @param {string} agencyId Agency document id.
 * @param {string=} firebaseUID Stripe metadata uid when available.
 * @return {Promise<object | null>} Recipient email and name.
 */
async function resolveOpticBillingRecipient(
  agencyId: string,
  firebaseUID?: string
): Promise<{email: string; name: string} | null> {
  const tryUid = async (uid: string) => {
    const snap = await db.collection("users").doc(uid).get();
    if (!snap.exists) return null;
    const d = snap.data()!;
    const email = typeof d.email === "string" ? d.email.trim() : "";
    if (!email) return null;
    return {email, name: String(d.displayName ?? "there")};
  };

  if (firebaseUID) {
    const hit = await tryUid(firebaseUID);
    if (hit) return hit;
  }

  const agencySnap = await db.collection("agencies").doc(agencyId).get();
  if (!agencySnap.exists) return null;
  const ownerId = agencySnap.data()?.ownerId;
  if (typeof ownerId === "string" && ownerId) {
    return tryUid(ownerId);
  }
  return null;
}

/**
 * Sends Optic subscription receipt once per dedupe key (invoice or checkout session).
 * @param {object} params Receipt context.
 * @return {Promise<void>}
 */
export async function trySendOpticSubscriptionReceipt(params: {
  dedupeKey: string;
  agencyId: string;
  firebaseUID?: string;
  opticPlanId: string;
  interval: "month" | "year";
  amountPaidCents: number;
  nextBillingUnix: number;
  transactionId: string;
  type: "new" | "renewal";
  monthlyAllowance: number;
}): Promise<void> {
  const receiptRef = db.collection("optic_subscription_receipts").doc(params.dedupeKey);
  const existing = await receiptRef.get();
  if (existing.exists) {
    return;
  }

  const recipient = await resolveOpticBillingRecipient(params.agencyId, params.firebaseUID);
  if (!recipient) {
    logger.warn("[Optic email] No recipient for subscription receipt", {agencyId: params.agencyId});
    return;
  }

  await sendOpticSubscriptionReceiptEmail(recipient.email, recipient.name, {
    opticPlanId: params.opticPlanId,
    interval: params.interval,
    amountPaid: params.amountPaidCents,
    nextBillingDate: params.nextBillingUnix,
    transactionId: params.transactionId,
    type: params.type,
    monthlyAllowance: params.monthlyAllowance,
  });

  await receiptRef.set({
    agencyId: params.agencyId,
    type: params.type,
    opticPlanId: params.opticPlanId,
    sentAt: FieldValue.serverTimestamp(),
    to: recipient.email,
  });
}

/**
 * Sends receipt after invoice.paid for new subscription or renewal.
 * @param {string} agencyId Agency id.
 * @param {Stripe.Invoice} invoice Paid invoice.
 * @param {Stripe.Subscription} subscription Stripe subscription.
 * @param {number} monthlyAllowance Included leads per period.
 * @return {Promise<void>}
 */
export async function trySendOpticReceiptFromInvoice(
  agencyId: string,
  invoice: Stripe.Invoice,
  subscription: Stripe.Subscription,
  monthlyAllowance: number
): Promise<void> {
  const isNew = invoice.billing_reason === "subscription_create";
  const isRenewal = invoice.billing_reason === "subscription_cycle";
  if (!isNew && !isRenewal) {
    return;
  }

  const opticPlanId =
    (subscription.metadata?.opticPlanId as OpticPlanId | undefined) || "optic_pilot_monthly";
  const interval =
    (subscription.items.data[0]?.price?.recurring?.interval as "month" | "year" | undefined) || "month";
  const subAny = subscription as Stripe.Subscription & {current_period_end?: number};
  const periodEnd = typeof subAny.current_period_end === "number" ? subAny.current_period_end : 0;
  const firebaseUID = subscription.metadata?.firebaseUID;

  await trySendOpticSubscriptionReceipt({
    dedupeKey: `invoice_${invoice.id}`,
    agencyId,
    firebaseUID: typeof firebaseUID === "string" ? firebaseUID : undefined,
    opticPlanId,
    interval,
    amountPaidCents: invoice.amount_paid ?? 0,
    nextBillingUnix: periodEnd,
    transactionId: invoice.id ?? subscription.id,
    type: isNew ? "new" : "renewal",
    monthlyAllowance,
  });
}

/**
 * Emails agency billing contact when included credits drop to 20% or below (80% used).
 * @param {string} agencyId Agency document id.
 * @return {Promise<void>}
 */
export async function checkOpticLowCreditWarning(agencyId: string): Promise<void> {
  const agencyRef = db.collection("agencies").doc(agencyId);
  const snap = await agencyRef.get();
  if (!snap.exists) return;

  const d = snap.data()!;
  const status = String(d.opticSubscriptionStatus ?? "");
  const subscriptionActive = status === "active" || status === "trialing";
  if (!subscriptionActive) return;

  const allowance =
    typeof d.opticMonthlyAllowance === "number" && Number.isFinite(d.opticMonthlyAllowance) ?
      Math.max(0, Math.floor(d.opticMonthlyAllowance)) :
      0;
  if (allowance <= 0) return;

  const balance =
    typeof d.opticCreditsBalance === "number" && Number.isFinite(d.opticCreditsBalance) ?
      Math.max(0, Math.floor(d.opticCreditsBalance)) :
      0;

  const threshold = Math.floor(allowance * LOW_CREDIT_REMAINING_FRACTION);
  if (balance > threshold) return;

  const periodEnd = d.opticPeriodEnd as Timestamp | null | undefined;
  const subId = typeof d.opticStripeSubscriptionId === "string" ? d.opticStripeSubscriptionId : "";
  const periodKey =
    periodEnd && typeof periodEnd.seconds === "number" ?
      `${subId}_${periodEnd.seconds}` :
      subId || "default";

  if (d.opticLowCreditWarningPeriodKey === periodKey) {
    return;
  }

  const recipient = await resolveOpticBillingRecipient(agencyId);
  if (!recipient) {
    logger.warn("[Optic email] No recipient for low-credit warning", {agencyId});
    return;
  }

  const plan = (d.opticPlan as string) || "pilot";
  const opticPlanId =
    plan === "enterprise" ? "optic_enterprise_monthly" : "optic_pilot_monthly";

  await sendOpticLowCreditsEmail(recipient.email, recipient.name, {
    balance,
    allowance,
    planName: getOpticPlanDisplayName(opticPlanId),
    planTier: plan === "enterprise" ? "enterprise" : "pilot",
  });

  await agencyRef.update({
    opticLowCreditWarningPeriodKey: periodKey,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
