import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import {db} from "../config/firebase";
import * as params from "../config/params";
import {OPTIC_WORKER_SHARED_SECRET} from "../config/params";
import {checkOpticLowCreditWarning, trySendOpticReceiptFromInvoice} from "./emails";

export const OPTIC_PILOT_MONTHLY_ALLOWANCE = 1000;
export const OPTIC_ENTERPRISE_MONTHLY_ALLOWANCE = 3500;
export const OPTIC_TOP_UP_LEADS = 250;
export const OPTIC_TOP_UP_AMOUNT_CENTS = 50_000;
export const OPTIC_MAX_TOP_UP_BLOCKS_PER_MONTH = 8;

export type OpticPlanTier = "none" | "pilot" | "enterprise" | "appsumo";
export type OpticPlanId =
  | "optic_pilot_monthly"
  | "optic_pilot_yearly"
  | "optic_enterprise_monthly"
  | "optic_enterprise_yearly";

export type AgencyOpticBilling = {
  agencyId: string;
  plan: OpticPlanTier;
  subscriptionActive: boolean;
  balance: number;
  allowance: number;
  overageThisPeriod: number;
  topUpBlocksThisPeriod: number;
};

const TEAM_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);

/**
 * Maps Stripe price id to Optic plan details.
 * @param {string} priceId Stripe Price id from a subscription item.
 * @return {object} Resolved plan (opticPlanId, tier, allowance, interval).
 */
export function getOpticPlanFromPriceId(priceId: string): {
  opticPlanId: OpticPlanId | null;
  tier: OpticPlanTier;
  allowance: number;
  interval: "month" | "year";
} {
  const map: Record<string, {opticPlanId: OpticPlanId; tier: OpticPlanTier; allowance: number; interval: "month" | "year"}> = {
    [params.STRIPE_OPTIC_PILOT_MONTHLY_PRICE_ID.value() || ""]: {
      opticPlanId: "optic_pilot_monthly",
      tier: "pilot",
      allowance: OPTIC_PILOT_MONTHLY_ALLOWANCE,
      interval: "month",
    },
    [params.STRIPE_OPTIC_PILOT_YEARLY_PRICE_ID.value() || ""]: {
      opticPlanId: "optic_pilot_yearly",
      tier: "pilot",
      allowance: OPTIC_PILOT_MONTHLY_ALLOWANCE,
      interval: "year",
    },
    [params.STRIPE_OPTIC_ENTERPRISE_MONTHLY_PRICE_ID.value() || ""]: {
      opticPlanId: "optic_enterprise_monthly",
      tier: "enterprise",
      allowance: OPTIC_ENTERPRISE_MONTHLY_ALLOWANCE,
      interval: "month",
    },
    [params.STRIPE_OPTIC_ENTERPRISE_YEARLY_PRICE_ID.value() || ""]: {
      opticPlanId: "optic_enterprise_yearly",
      tier: "enterprise",
      allowance: OPTIC_ENTERPRISE_MONTHLY_ALLOWANCE,
      interval: "year",
    },
  };
  const hit = map[priceId];
  if (!hit) {
    return {opticPlanId: null, tier: "none", allowance: 0, interval: "month"};
  }
  return {opticPlanId: hit.opticPlanId, tier: hit.tier, allowance: hit.allowance, interval: hit.interval};
}

/**
 * Resolves plan details from checkout metadata when Price env vars are unset.
 * @param {string} opticPlanId Internal plan id from Stripe subscription metadata.
 * @return {object} Same shape as getOpticPlanFromPriceId.
 */
function getOpticPlanFromOpticPlanId(opticPlanId: string): {
  opticPlanId: OpticPlanId | null;
  tier: OpticPlanTier;
  allowance: number;
  interval: "month" | "year";
} {
  switch (opticPlanId) {
  case "optic_pilot_monthly":
    return {
      opticPlanId: "optic_pilot_monthly",
      tier: "pilot",
      allowance: OPTIC_PILOT_MONTHLY_ALLOWANCE,
      interval: "month",
    };
  case "optic_pilot_yearly":
    return {
      opticPlanId: "optic_pilot_yearly",
      tier: "pilot",
      allowance: OPTIC_PILOT_MONTHLY_ALLOWANCE,
      interval: "year",
    };
  case "optic_enterprise_monthly":
    return {
      opticPlanId: "optic_enterprise_monthly",
      tier: "enterprise",
      allowance: OPTIC_ENTERPRISE_MONTHLY_ALLOWANCE,
      interval: "month",
    };
  case "optic_enterprise_yearly":
    return {
      opticPlanId: "optic_enterprise_yearly",
      tier: "enterprise",
      allowance: OPTIC_ENTERPRISE_MONTHLY_ALLOWANCE,
      interval: "year",
    };
  default:
    return {opticPlanId: null, tier: "none", allowance: 0, interval: "month"};
  }
}

type InvoiceWithSubscriptionRef = Stripe.Invoice & {
  subscription?: string | {id: string} | null;
  parent?: {subscription_details?: {subscription?: string | {id: string} | null}};
};

/**
 * Reads subscription id from invoice payloads (incl. Stripe billing API parent nesting).
 * @param {InvoiceWithSubscriptionRef} invoice Stripe invoice object.
 * @return {string | null} Subscription id if present.
 */
function getSubscriptionIdFromInvoice(invoice: InvoiceWithSubscriptionRef): string | null {
  if (typeof invoice.subscription === "string") {
    return invoice.subscription;
  }
  if (invoice.subscription && typeof invoice.subscription === "object" && "id" in invoice.subscription) {
    return invoice.subscription.id ?? null;
  }
  const fromParent = invoice.parent?.subscription_details?.subscription;
  if (typeof fromParent === "string") {
    return fromParent;
  }
  if (fromParent && typeof fromParent === "object" && "id" in fromParent) {
    return fromParent.id ?? null;
  }
  return null;
}

const OPTIC_SUBSCRIPTION_WEBHOOK_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
]);

/**
 * Coerces a Firestore numeric field to a non-negative integer balance.
 * @param {unknown} raw Raw field value.
 * @return {number} Parsed balance.
 */
function parseBalance(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  return 0;
}

/**
 * Loads Optic billing context for gating and worker decisions.
 * @param {string} agencyId Agency document id.
 * @return {Promise<AgencyOpticBilling>} Current plan, balance, and usage counters.
 */
export async function loadAgencyOpticBilling(agencyId: string): Promise<AgencyOpticBilling> {
  const snap = await db.collection("agencies").doc(agencyId).get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "Brand workspace not found.");
  }
  const d = snap.data()!;
  const status = String(d.opticSubscriptionStatus ?? "");
  const plan = (d.opticPlan as OpticPlanTier) || "none";
  const isAppSumo = d.opticBillingSource === "appsumo" || plan === "appsumo";
  const subscriptionActive =
    status === "active" || status === "trialing" || isAppSumo;
  return {
    agencyId,
    plan: subscriptionActive ? (isAppSumo ? "appsumo" : plan) : "none",
    subscriptionActive,
    balance: parseBalance(d.opticCreditsBalance),
    allowance: parseBalance(d.opticMonthlyAllowance),
    overageThisPeriod: parseBalance(d.opticOverageLeadsThisPeriod),
    topUpBlocksThisPeriod: parseBalance(d.opticTopUpBlocksThisPeriod),
  };
}

/**
 * Resets included credits at period start / renewal (monthly allowance, counters cleared).
 * @param {string} agencyId Agency document id.
 * @param {object} opts Subscription snapshot fields to persist.
 * @param {OpticPlanTier} opts.tier pilot or enterprise.
 * @param {number} opts.allowance Monthly included leads.
 * @param {string} opts.subscriptionId Stripe subscription id.
 * @param {string} opts.status Stripe subscription status.
 * @param {"month" | "year"} opts.interval Billing interval.
 * @param {Timestamp | null} opts.periodEnd Current period end.
 * @return {Promise<void>}
 */
export async function resetAgencyOpticBillingPeriod(
  agencyId: string,
  opts: {
    tier: OpticPlanTier;
    allowance: number;
    subscriptionId: string;
    status: string;
    interval: "month" | "year";
    periodEnd: Timestamp | null;
  }
): Promise<void> {
  await db.collection("agencies").doc(agencyId).update({
    opticPlan: opts.tier,
    opticSubscriptionStatus: opts.status,
    opticStripeSubscriptionId: opts.subscriptionId,
    opticBillingInterval: opts.interval,
    opticPeriodEnd: opts.periodEnd,
    opticMonthlyAllowance: opts.allowance,
    opticCreditsBalance: opts.allowance,
    opticOverageLeadsThisPeriod: 0,
    opticTopUpBlocksThisPeriod: 0,
    opticLowCreditWarningPeriodKey: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  logger.info("[Optic billing] Period reset", {agencyId, tier: opts.tier, allowance: opts.allowance});
}

/**
 * Ensures the caller is an agency owner or admin for the given brand workspace.
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
    throw new HttpsError("permission-denied", "Only your brand team can manage Optic billing.");
  }
  if (role !== "agency_owner" && role !== "agency_admin") {
    throw new HttpsError("permission-denied", "Optic billing requires a brand owner or admin.");
  }
}

/**
 * Returns the user's Stripe customer id, creating one if needed.
 * @param {Stripe} stripe Stripe client.
 * @param {string} uid Firebase Auth user id.
 * @return {Promise<string>} Stripe customer id.
 */
async function getOrCreateStripeCustomer(stripe: Stripe, uid: string): Promise<string> {
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  const userData = userSnap.data();
  if (!userData) {
    throw new HttpsError("not-found", "User not found.");
  }
  let stripeCustomerId = userData.stripeCustomerId as string | undefined;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: userData.email,
      name: userData.displayName,
      metadata: {firebaseUID: uid},
    });
    stripeCustomerId = customer.id;
    await userRef.update({stripeCustomerId});
  }
  return stripeCustomerId;
}

/**
 * Resolves env-configured Stripe Price id for an Optic plan key.
 * @param {OpticPlanId} opticPlanId Internal plan identifier.
 * @return {string} Stripe Price id or empty string if unset.
 */
function opticPriceIdForPlan(opticPlanId: OpticPlanId): string {
  switch (opticPlanId) {
  case "optic_pilot_monthly":
    return params.STRIPE_OPTIC_PILOT_MONTHLY_PRICE_ID.value();
  case "optic_pilot_yearly":
    return params.STRIPE_OPTIC_PILOT_YEARLY_PRICE_ID.value();
  case "optic_enterprise_monthly":
    return params.STRIPE_OPTIC_ENTERPRISE_MONTHLY_PRICE_ID.value();
  case "optic_enterprise_yearly":
    return params.STRIPE_OPTIC_ENTERPRISE_YEARLY_PRICE_ID.value();
  default:
    return "";
  }
}

/** Stripe Checkout for Optic Pilot or Enterprise (separate from Verza agency SaaS). */
export const createOpticSubscriptionCheckoutSession = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to subscribe to Optic.");
  }
  const uid = request.auth.uid;
  const {opticPlanId} = request.data as {opticPlanId?: unknown};
  const planId = opticPlanId as OpticPlanId;
  const valid: OpticPlanId[] = [
    "optic_pilot_monthly",
    "optic_pilot_yearly",
    "optic_enterprise_monthly",
    "optic_enterprise_yearly",
  ];
  if (!valid.includes(planId)) {
    throw new HttpsError("invalid-argument", "Invalid Optic plan.");
  }

  const userSnap = await db.collection("users").doc(uid).get();
  const agencyId = userSnap.data()?.primaryAgencyId as string | undefined;
  if (!agencyId) {
    throw new HttpsError("failed-precondition", "Set a primary brand workspace first.");
  }
  await assertAgencyBillingAdmin(uid, agencyId);

  const agencySnap = await db.collection("agencies").doc(agencyId).get();
  const agency = agencySnap.data();
  if (agency?.opticBillingSource === "appsumo" || agency?.opticPlan === "appsumo") {
    throw new HttpsError(
      "failed-precondition",
      "This workspace uses AppSumo Optic. Redeem more codes for a higher monthly allowance, or contact support to switch to a paid plan."
    );
  }

  const stripe = new Stripe(params.STRIPE_SECRET_KEY.value(), {apiVersion: "2026-04-22.dahlia" as any});
  const priceId = opticPriceIdForPlan(planId);
  if (!priceId) {
    throw new HttpsError("failed-precondition", "Optic pricing is not configured yet.");
  }

  const stripeCustomerId = await getOrCreateStripeCustomer(stripe, uid);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: stripeCustomerId,
    line_items: [{price: priceId, quantity: 1}],
    success_url: `${params.APP_URL.value()}/optic?optic_subscribe_success=true`,
    cancel_url: `${params.APP_URL.value()}/optic/pricing`,
    subscription_data: {
      metadata: {
        firebaseUID: uid,
        agencyId,
        productType: "optic",
        opticPlanId: planId,
      },
    },
    metadata: {
      firebaseUID: uid,
      agencyId,
      productType: "optic",
      opticPlanId: planId,
    },
    allow_promotion_codes: true,
  });

  return {url: session.url};
});

/** Stripe Customer Portal scoped to the Optic subscription. */
export const createOpticBillingPortalSession = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to manage Optic billing.");
  }
  const uid = request.auth.uid;
  const userSnap = await db.collection("users").doc(uid).get();
  const agencyId = userSnap.data()?.primaryAgencyId as string | undefined;
  if (!agencyId) {
    throw new HttpsError("failed-precondition", "No brand workspace.");
  }
  await assertAgencyBillingAdmin(uid, agencyId);

  const agencySnap = await db.collection("agencies").doc(agencyId).get();
  const subId = agencySnap.data()?.opticStripeSubscriptionId as string | undefined;
  const stripeCustomerId = userSnap.data()?.stripeCustomerId as string | undefined;
  if (!stripeCustomerId || !subId) {
    throw new HttpsError("failed-precondition", "No active Optic subscription.");
  }

  const stripe = new Stripe(params.STRIPE_SECRET_KEY.value(), {apiVersion: "2026-04-22.dahlia" as any});
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${params.APP_URL.value()}/optic`,
  });
  return {url: session.url};
});

/**
 * Charges a Pilot top-up block ($500 → 250 leads). Used by worker via internal HTTP.
 * @param {string} agencyId Agency document id.
 * @return {Promise<object>} Charge outcome with ok flag and optional reason.
 */
export async function chargeOpticPilotTopUpBlock(agencyId: string): Promise<{ok: true} | {ok: false; reason: string}> {
  const agencySnap = await db.collection("agencies").doc(agencyId).get();
  if (!agencySnap.exists) {
    return {ok: false, reason: "agency_not_found"};
  }
  const agency = agencySnap.data()!;
  if (agency.opticBillingSource === "appsumo" || agency.opticPlan === "appsumo") {
    return {ok: false, reason: "appsumo_no_top_up"};
  }
  if (agency.opticPlan !== "pilot" || agency.opticSubscriptionStatus !== "active") {
    return {ok: false, reason: "not_pilot_active"};
  }
  const blocks = parseBalance(agency.opticTopUpBlocksThisPeriod);
  if (blocks >= OPTIC_MAX_TOP_UP_BLOCKS_PER_MONTH) {
    return {ok: false, reason: "top_up_cap_reached"};
  }

  const ownerId = String(agency.ownerId ?? "");
  const ownerSnap = await db.collection("users").doc(ownerId).get();
  const owner = ownerSnap.data();
  const stripeCustomerId = owner?.stripeCustomerId as string | undefined;
  if (!stripeCustomerId) {
    return {ok: false, reason: "no_stripe_customer"};
  }

  const stripe = new Stripe(params.STRIPE_SECRET_KEY.value(), {apiVersion: "2026-04-22.dahlia" as any});
  const customer = await stripe.customers.retrieve(stripeCustomerId);
  if (customer.deleted) {
    return {ok: false, reason: "customer_deleted"};
  }

  const defaultPm =
    (customer as Stripe.Customer).invoice_settings?.default_payment_method ||
    (customer as Stripe.Customer).default_source;
  let paymentMethodId: string | null = null;
  if (typeof defaultPm === "string") {
    paymentMethodId = defaultPm;
  } else if (defaultPm && typeof defaultPm === "object" && "id" in defaultPm) {
    paymentMethodId = (defaultPm as {id: string}).id;
  }
  if (!paymentMethodId) {
    const pms = await stripe.paymentMethods.list({customer: stripeCustomerId, type: "card", limit: 1});
    paymentMethodId = pms.data[0]?.id ?? null;
  }
  if (!paymentMethodId) {
    return {ok: false, reason: "no_payment_method"};
  }

  try {
    const pi = await stripe.paymentIntents.create({
      amount: OPTIC_TOP_UP_AMOUNT_CENTS,
      currency: "usd",
      customer: stripeCustomerId,
      payment_method: paymentMethodId,
      confirm: true,
      off_session: true,
      metadata: {
        purchaseType: "opticTopUp",
        agencyId,
        creditAmount: String(OPTIC_TOP_UP_LEADS),
      },
      description: `Optic top-up: ${OPTIC_TOP_UP_LEADS} leads`,
    });
    if (pi.status !== "succeeded") {
      return {ok: false, reason: `payment_${pi.status}`};
    }
    await fulfillOpticTopUp(agencyId, pi.id);
    return {ok: true};
  } catch (e) {
    logger.error("[Optic billing] Top-up charge failed", {agencyId, error: e});
    return {ok: false, reason: "charge_failed"};
  }
}

/**
 * Grants 250 credits and increments top-up block counter (idempotent when paymentIntentId is set).
 * @param {string} agencyId Agency document id.
 * @param {string=} paymentIntentId Optional Stripe PaymentIntent id for idempotency.
 * @return {Promise<void>}
 */
export async function fulfillOpticTopUp(agencyId: string, paymentIntentId?: string): Promise<void> {
  if (paymentIntentId) {
    const eventRef = db.collection("optic_top_up_events").doc(paymentIntentId);
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(eventRef);
      if (existing.exists) return;
      tx.set(eventRef, {
        agencyId,
        credits: OPTIC_TOP_UP_LEADS,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.update(db.collection("agencies").doc(agencyId), {
        opticCreditsBalance: FieldValue.increment(OPTIC_TOP_UP_LEADS),
        opticTopUpBlocksThisPeriod: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return;
  }
  await db.collection("agencies").doc(agencyId).update({
    opticCreditsBalance: FieldValue.increment(OPTIC_TOP_UP_LEADS),
    opticTopUpBlocksThisPeriod: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/** Internal endpoint for the Optic worker to trigger Pilot auto top-up. */
export const opticInternalTopUp = onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }
  const secret = OPTIC_WORKER_SHARED_SECRET.value().trim();
  const incoming = String(req.headers["x-verza-optic-secret"] ?? "");
  if (!secret || incoming !== secret) {
    res.status(401).json({error: "unauthorized"});
    return;
  }
  const agencyId = req.body?.agencyId;
  if (typeof agencyId !== "string" || !agencyId.trim()) {
    res.status(400).json({error: "agencyId required"});
    return;
  }
  const result = await chargeOpticPilotTopUpBlock(agencyId.trim());
  if (!result.ok) {
    res.status(402).json(result);
    return;
  }
  res.status(200).json({ok: true, creditsAdded: OPTIC_TOP_UP_LEADS});
}
);

/**
 * Reads Optic routing fields from a Stripe event object's metadata.
 * @param {object} obj Stripe event data object.
 * @return {object} Parsed metadata (agencyId, firebaseUID, opticPlanId, productType).
 */
function extractOpticMetadata(obj: Record<string, unknown>): {
  agencyId?: string;
  firebaseUID?: string;
  opticPlanId?: string;
  productType?: string;
} {
  return {
    agencyId: (obj.metadata as Record<string, string> | undefined)?.agencyId,
    firebaseUID: (obj.metadata as Record<string, string> | undefined)?.firebaseUID,
    opticPlanId: (obj.metadata as Record<string, string> | undefined)?.opticPlanId,
    productType: (obj.metadata as Record<string, string> | undefined)?.productType,
  };
}

type OpticStripeMeta = {
  agencyId?: string;
  firebaseUID?: string;
  opticPlanId?: string;
  productType?: string;
};

/**
 * Resolves Optic agency + metadata from assorted Stripe webhook payload shapes.
 * @param {Stripe} stripe Stripe client.
 * @param {Stripe.Event} event Webhook event.
 * @param {Record<string, unknown>} obj Event data object.
 * @return {Promise<object | null>} Optic context `{agencyId, meta}` or null.
 */
async function resolveOpticAgencyFromEvent(
  stripe: Stripe,
  event: Stripe.Event,
  obj: Record<string, unknown>
): Promise<{agencyId: string; meta: OpticStripeMeta} | null> {
  let meta: OpticStripeMeta = extractOpticMetadata(obj);
  if (meta.productType !== "optic" && obj.parent) {
    const parent = obj.parent as Record<string, unknown>;
    const subDetails = parent.subscription_details as Record<string, unknown> | undefined;
    if (subDetails?.metadata) {
      meta = {
        agencyId: (subDetails.metadata as Record<string, string>).agencyId,
        firebaseUID: (subDetails.metadata as Record<string, string>).firebaseUID,
        opticPlanId: (subDetails.metadata as Record<string, string>).opticPlanId,
        productType: (subDetails.metadata as Record<string, string>).productType,
      };
    }
  }

  if (meta.productType === "optic" && meta.agencyId) {
    return {agencyId: meta.agencyId, meta};
  }

  const subIdFromObj =
    (typeof obj.subscription === "string" ? obj.subscription : null) ||
    ((obj as {id?: string}).id && String(event.type).startsWith("customer.subscription") ?
      (obj as {id: string}).id :
      null);
  if (subIdFromObj) {
    const sub = await stripe.subscriptions.retrieve(subIdFromObj);
    if (sub.metadata?.productType === "optic" && sub.metadata?.agencyId) {
      return {
        agencyId: sub.metadata.agencyId,
        meta: {
          agencyId: sub.metadata.agencyId,
          firebaseUID: sub.metadata.firebaseUID,
          opticPlanId: sub.metadata.opticPlanId,
          productType: "optic",
        },
      };
    }
  }

  if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
    const invoice = obj as unknown as InvoiceWithSubscriptionRef;
    const subId = getSubscriptionIdFromInvoice(invoice);
    if (subId) {
      const sub = await stripe.subscriptions.retrieve(subId);
      if (sub.metadata?.productType === "optic" && sub.metadata?.agencyId) {
        return {
          agencyId: sub.metadata.agencyId,
          meta: {
            agencyId: sub.metadata.agencyId,
            firebaseUID: sub.metadata.firebaseUID,
            opticPlanId: sub.metadata.opticPlanId,
            productType: "optic",
          },
        };
      }
    }
  }

  return null;
}

/**
 * Handles Stripe subscription webhook events for Optic (productType=optic).
 * @param {Stripe} stripe Stripe client.
 * @param {Stripe.Event} event Verified webhook event.
 * @return {Promise<boolean>} True if the event was handled as Optic.
 */
export async function handleOpticStripeSubscriptionEvent(
  stripe: Stripe,
  event: Stripe.Event
): Promise<boolean> {
  const obj = event.data.object as unknown as Record<string, unknown>;

  // Pilot top-up blocks are one-time charges — not subscription lifecycle.
  if (event.type === "payment_intent.succeeded") {
    const pi = obj as unknown as Stripe.PaymentIntent;
    if (pi.metadata?.purchaseType === "opticTopUp" && pi.metadata?.agencyId) {
      await fulfillOpticTopUp(pi.metadata.agencyId, pi.id);
      logger.info("[Optic billing] Top-up fulfilled", {agencyId: pi.metadata.agencyId});
      return true;
    }
    return false;
  }
  if (event.type.startsWith("payment_intent.")) {
    return false;
  }

  if (!OPTIC_SUBSCRIPTION_WEBHOOK_EVENTS.has(event.type)) {
    return false;
  }

  const resolved = await resolveOpticAgencyFromEvent(stripe, event, obj);
  if (!resolved) {
    return false;
  }

  const {agencyId} = resolved;

  switch (event.type) {
  case "checkout.session.completed": {
    const session = obj as unknown as Stripe.Checkout.Session;
    if (session.mode !== "subscription") break;
    const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (!subId) break;
    const sub = await stripe.subscriptions.retrieve(subId);
    await applyOpticSubscriptionState(agencyId, sub);
    logger.info("[Optic billing] Subscription activated from checkout", {agencyId, subscriptionId: subId});
    break;
  }
  case "customer.subscription.created":
  case "customer.subscription.updated": {
    const sub = obj as unknown as Stripe.Subscription;
    await applyOpticSubscriptionState(agencyId, sub);
    logger.info("[Optic billing] Subscription synced", {agencyId, subscriptionId: sub.id, event: event.type});
    break;
  }
  case "customer.subscription.deleted": {
    const sub = obj as unknown as Stripe.Subscription;
    let periodEnd: Timestamp | null = null;
    const end = sub.ended_at || sub.canceled_at;
    if (typeof end === "number") {
      periodEnd = Timestamp.fromMillis(end * 1000);
    }
    await db.collection("agencies").doc(agencyId).update({
      opticSubscriptionStatus: "canceled",
      opticPeriodEnd: periodEnd,
      updatedAt: FieldValue.serverTimestamp(),
    });
    break;
  }
  case "invoice.paid":
  case "invoice.payment_succeeded": {
    const invoice = obj as unknown as InvoiceWithSubscriptionRef;
    const subId = getSubscriptionIdFromInvoice(invoice);
    if (!subId) {
      logger.warn("[Optic billing] invoice.paid without subscription id", {
        agencyId,
        invoiceId: invoice.id,
        billingReason: invoice.billing_reason,
      });
      break;
    }
    const sub = await stripe.subscriptions.retrieve(subId);
    const activated = await applyOpticSubscriptionState(agencyId, sub, {resetCredits: true});
    if (activated?.resetCredits) {
      await trySendOpticReceiptFromInvoice(agencyId, invoice, sub, activated.allowance).catch((e) => {
        logger.error("[Optic email] Invoice receipt failed", {agencyId, error: e});
      });
    }
    logger.info("[Optic billing] Subscription activated from invoice", {
      agencyId,
      subscriptionId: subId,
      billingReason: invoice.billing_reason,
    });
    break;
  }
  case "invoice.payment_failed": {
    await db.collection("agencies").doc(agencyId).update({
      opticSubscriptionStatus: "past_due",
      updatedAt: FieldValue.serverTimestamp(),
    });
    break;
  }
  default:
    break;
  }
  return true;
}

/**
 * Syncs agency Optic fields from a Stripe subscription (optionally resets monthly credits).
 * @param {string} agencyId Agency document id.
 * @param {Stripe.Subscription} subscription Stripe subscription object.
 * @param {object=} opts Optional flags.
 * @param {boolean=} opts.resetCredits When true, refill balance to plan allowance.
 * @return {Promise<void>}
 */
async function applyOpticSubscriptionState(
  agencyId: string,
  subscription: Stripe.Subscription,
  opts?: {resetCredits?: boolean}
): Promise<{resetCredits: boolean; allowance: number; opticPlanId: string} | null> {
  const priceId = subscription.items.data[0]?.price.id ?? "";
  let plan = getOpticPlanFromPriceId(priceId);
  if (plan.tier === "none") {
    const metaPlanId = subscription.metadata?.opticPlanId;
    if (typeof metaPlanId === "string" && metaPlanId) {
      plan = getOpticPlanFromOpticPlanId(metaPlanId);
    }
  }
  const {tier, allowance, interval} = plan;
  if (tier === "none") {
    logger.warn("[Optic billing] Unknown price on subscription", {
      agencyId,
      priceId,
      opticPlanId: subscription.metadata?.opticPlanId,
    });
    return null;
  }

  const opticPlanId =
    plan.opticPlanId ||
    (subscription.metadata?.opticPlanId as OpticPlanId | undefined) ||
    "optic_pilot_monthly";

  let periodEnd: Timestamp | null = null;
  const subAny = subscription as Stripe.Subscription & {current_period_end?: number};
  if (typeof subAny.current_period_end === "number") {
    periodEnd = Timestamp.fromMillis(subAny.current_period_end * 1000);
  }

  const status = subscription.status;
  const shouldReset =
    opts?.resetCredits === true || status === "active" || status === "trialing";

  if (shouldReset && (status === "active" || status === "trialing")) {
    await resetAgencyOpticBillingPeriod(agencyId, {
      tier,
      allowance,
      subscriptionId: subscription.id,
      status,
      interval,
      periodEnd,
    });
    logger.info("[Optic billing] Agency period reset", {
      agencyId,
      tier,
      allowance,
      subscriptionId: subscription.id,
    });
    return {resetCredits: true, allowance, opticPlanId: opticPlanId ?? "optic_pilot_monthly"};
  }

  await db.collection("agencies").doc(agencyId).update({
    opticPlan: tier,
    opticSubscriptionStatus: status,
    opticStripeSubscriptionId: subscription.id,
    opticBillingInterval: interval,
    opticPeriodEnd: periodEnd,
    opticMonthlyAllowance: allowance,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {resetCredits: false, allowance, opticPlanId: opticPlanId ?? "optic_pilot_monthly"};
}

/** Internal endpoint for the Optic worker to check 80% credit usage after a lead save. */
export const opticInternalLowCreditCheck = onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }
  const secret = OPTIC_WORKER_SHARED_SECRET.value().trim();
  const incoming = String(req.headers["x-verza-optic-secret"] ?? "");
  if (!secret || incoming !== secret) {
    res.status(401).json({error: "unauthorized"});
    return;
  }
  const agencyId = req.body?.agencyId;
  if (typeof agencyId !== "string" || !agencyId.trim()) {
    res.status(400).json({error: "agencyId required"});
    return;
  }
  try {
    await checkOpticLowCreditWarning(agencyId.trim());
    res.status(200).json({ok: true});
  } catch (e) {
    logger.error("[Optic email] Low-credit check failed", {agencyId, error: e});
    res.status(500).json({error: "check_failed"});
  }
});
