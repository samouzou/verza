import {FieldValue} from "firebase-admin/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import type Stripe from "stripe";
import {db} from "../config/firebase";
import {PRISM_X_INCLUDED_MICROS, PRISM_X_MARKUP, stripeClient} from "./billing";

/** Yearly and canceled plans get their own invoice once the pending X charges reach this much. */
const STANDALONE_INVOICE_MIN_CENTS = 1000;

/**
 * The UTC month before the current one.
 * @return {string} YYYY-MM.
 */
function previousPeriodKey(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

/**
 * Amount to bill for a month's X fees: what's above the allowance, plus the processing markup.
 * @param {number} costMicros X fees in millionths of a dollar.
 * @return {{overageMicros: number, cents: number}} Overage and charge.
 */
export function xCharge(costMicros: number): {overageMicros: number; cents: number} {
  const overageMicros = Math.max(0, Math.round(costMicros) - PRISM_X_INCLUDED_MICROS);
  return {overageMicros, cents: Math.round((overageMicros * (1 + PRISM_X_MARKUP)) / 10_000)};
}

/**
 * Bills one brand's X overage for a month as an invoice item.
 * Monthly plans: the item rides on the next renewal invoice. Yearly or canceled plans: an invoice is
 * created once pending X charges reach the minimum, so nobody waits a year or gets a $0.30-fee micro-charge.
 * @param {Stripe} stripe Stripe client.
 * @param {string} agencyId Agency id.
 * @param {Record<string, unknown>} agency Agency data.
 * @param {string} periodKey Month billed.
 * @return {!Promise<void>}
 */
async function billBrand(stripe: Stripe, agencyId: string, agency: Record<string, unknown>, periodKey: string): Promise<void> {
  const ref = db.collection("prism_usage").doc(agencyId).collection("months").doc(periodKey);
  const month = (await ref.get()).data();
  if (!month || month.xBilling) return;
  const x = (month.x ?? {}) as {tweets?: number; linkTweets?: number; costMicros?: number};
  const {overageMicros, cents} = xCharge(Number(x.costMicros ?? 0));
  if (cents < 1) {
    await ref.set({xBilling: {cents: 0, overageMicros, billedAt: FieldValue.serverTimestamp()}}, {merge: true});
    return;
  }

  const subId = String(agency.prismStripeSubscriptionId ?? "");
  if (!subId) {
    logger.warn("[Prism X billing] Overage but no subscription", {agencyId, periodKey, cents});
    return;
  }
  const sub = await stripe.subscriptions.retrieve(subId);
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const monthlyLive = agency.prismBillingInterval === "month" && (sub.status === "active" || sub.status === "trialing");
  const tweets = Number(x.tweets ?? 0);
  const links = Number(x.linkTweets ?? 0);
  const item = await stripe.invoiceItems.create({
    customer,
    currency: sub.currency || "usd",
    amount: cents,
    description: `Prism X API usage, ${periodKey}: ${tweets} tweets (${links} with links). ` +
      `$${(overageMicros / 1e6).toFixed(2)} above the $${(PRISM_X_INCLUDED_MICROS / 1e6).toFixed(0)} included, ` +
      `plus ${Math.round(PRISM_X_MARKUP * 100)}% card processing`,
    metadata: {kind: "prism_x_usage", agencyId, periodKey},
    ...(monthlyLive ? {subscription: subId} : {}),
  }, {idempotencyKey: `prism-x-usage-${agencyId}-${periodKey}`});

  let invoiceId: string | null = null;
  if (!monthlyLive) {
    const pending = await stripe.invoiceItems.list({customer, pending: true, limit: 100});
    const total = pending.data
      .filter((i) => i.metadata?.kind === "prism_x_usage")
      .reduce((n, i) => n + i.amount, 0);
    if (total >= STANDALONE_INVOICE_MIN_CENTS) {
      const invoice = await stripe.invoices.create({
        customer,
        collection_method: "charge_automatically",
        pending_invoice_items_behavior: "include",
        auto_advance: true,
        metadata: {kind: "prism_x_usage", agencyId, periodKey},
      }, {idempotencyKey: `prism-x-invoice-${agencyId}-${periodKey}`});
      invoiceId = invoice.id ?? null;
    }
  }

  await ref.set({
    xBilling: {
      cents,
      overageMicros,
      invoiceItemId: item.id,
      ...(invoiceId ? {invoiceId} : {}),
      billedAt: FieldValue.serverTimestamp(),
    },
  }, {merge: true});
  logger.info("[Prism X billing] Billed", {agencyId, periodKey, cents, invoiceId});
}

/**
 * 1st of each month: bills last month's X fees above each Launch brand's allowance.
 * Enterprise X usage is covered by contract.
 */
export const billPrismXUsage = onSchedule(
  {schedule: "0 6 1 * *", timeZone: "Etc/UTC", timeoutSeconds: 540, memory: "512MiB"},
  async () => {
    const periodKey = previousPeriodKey();
    const stripe = stripeClient();
    const brands = await db.collection("agencies").where("prismPlan", "==", "launch").get();
    for (const doc of brands.docs) {
      try {
        await billBrand(stripe, doc.id, doc.data(), periodKey);
      } catch (e) {
        logger.error("[Prism X billing] Failed", {agencyId: doc.id, periodKey, e: String(e)});
      }
    }
  }
);
