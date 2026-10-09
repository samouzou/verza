import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import {db} from "../config/firebase";
import * as params from "../config/params";

/** "lifetime" = AppSumo: paid features with monthly caps, no auto-publishing. */
export type PrismPlanTier = "free" | "lifetime" | "launch" | "enterprise";
export type PrismPlanId =
  | "prism_launch_monthly"
  | "prism_launch_yearly"
  | "prism_enterprise_monthly"
  | "prism_enterprise_yearly";

/** Monthly AI actions (one channel written = 1, month plan = 5, weekly plan = 2). Enterprise is unlimited. */
export const PRISM_AI_LIMITS: Record<Exclude<PrismPlanTier, "enterprise">, number> = {
  free: 15,
  lifetime: 300,
  launch: 1000,
};
/** One-time taste of Launch on Free; never resets. */
export const PRISM_FREE_STUDIO_RUNS = 1;
export const PRISM_FREE_SLIDE_RENDERS = 3;
/** Feed graphics a month on Lifetime (each is a paid image-model call). */
export const PRISM_LIFETIME_GRAPHICS = 30;

export const PRISM_AI_COST = {monthPlan: 5, weeklyPlan: 2, repurpose: 1} as const;

/** X API fees included each month on Launch, in millionths of a dollar. Enterprise is by contract. */
export const PRISM_X_INCLUDED_MICROS = 5_000_000;
/** Added to X fees above the allowance to cover card processing and Stripe Billing. */
export const PRISM_X_MARKUP = 0.05;

const STRIPE_API_VERSION = "2026-04-22.dahlia";
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export type PrismEntitlements = {
  tier: PrismPlanTier;
  periodKey: string;
  aiUsed: number;
  aiLimit: number | null;
  studioRunsUsed: number;
  slideRendersUsed: number;
  graphicsUsed: number;
  /** Launch and Enterprise only. */
  canPublish: boolean;
};

export type PrismUsage = {
  /** AI actions. Ignored for a Free plan's one-time Studio run. */
  ai?: number;
  studioRun?: boolean;
  slideRender?: boolean;
  /** A feed graphic (also pass slideRender). */
  graphic?: boolean;
};

/**
 * Current usage period (UTC calendar month).
 * @return {string} YYYY-MM.
 */
export function prismPeriodKey(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Non-negative integer from a Firestore field.
 * @param {unknown} raw Raw value.
 * @return {number} Count.
 */
function count(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

/**
 * Reads plan and usage from an agency doc.
 * @param {Record<string, unknown>} d Agency data.
 * @return {PrismEntitlements} Entitlements.
 */
export function prismEntitlementsFrom(d: Record<string, unknown>): PrismEntitlements {
  const active = ACTIVE_STATUSES.has(String(d.prismSubscriptionStatus ?? ""));
  const plan = String(d.prismPlan ?? "");
  const subscribed = active && (plan === "launch" || plan === "enterprise");
  const tier: PrismPlanTier = subscribed ? plan : d.prismLifetime === true ? "lifetime" : "free";
  const periodKey = prismPeriodKey();
  const thisPeriod = d.prismUsagePeriodKey === periodKey;
  return {
    tier,
    periodKey,
    aiUsed: thisPeriod ? count(d.prismAiActionsThisPeriod) : 0,
    aiLimit: tier === "enterprise" ? null : PRISM_AI_LIMITS[tier],
    studioRunsUsed: count(d.prismStudioRunsUsed),
    slideRendersUsed: count(d.prismSlideRendersUsed),
    graphicsUsed: thisPeriod ? count(d.prismGraphicsThisPeriod) : 0,
    canPublish: subscribed,
  };
}

/**
 * Throws a friendly "upgrade" error.
 * @param {string} message What ran out.
 */
function upgradeError(message: string): never {
  throw new HttpsError("resource-exhausted", message, {upgrade: true, pricingPath: "/prism/pricing"});
}

/**
 * Checks the plan's limits and records usage atomically. Throws resource-exhausted when over.
 * @param {string} agencyId Agency id.
 * @param {PrismUsage} usage What the action uses.
 * @return {!Promise<object>} What was recorded (pass to releasePrismUsage on failure).
 */
export async function reservePrismUsage(
  agencyId: string,
  usage: PrismUsage
): Promise<PrismReservation> {
  const ref = db.collection("agencies").doc(agencyId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("failed-precondition", "Brand workspace not found.");
    const e = prismEntitlementsFrom(snap.data() ?? {});
    const studioRun = usage.studioRun === true;
    const slideRender = usage.slideRender === true;
    const graphic = usage.graphic === true;
    const ai = e.tier === "free" && studioRun ? 0 : Math.max(0, Math.floor(usage.ai ?? 0));

    if (e.tier === "free") {
      if (studioRun && e.studioRunsUsed >= PRISM_FREE_STUDIO_RUNS) {
        upgradeError("You've used your free Studio run. Upgrade to Prism Launch to batch a week of drafts any time.");
      }
      if (slideRender && e.slideRendersUsed >= PRISM_FREE_SLIDE_RENDERS) {
        upgradeError(
          `You've used your ${PRISM_FREE_SLIDE_RENDERS} free slide renders. Upgrade to Prism Launch for unlimited slides.`
        );
      }
    }
    if (e.tier === "lifetime" && graphic && e.graphicsUsed >= PRISM_LIFETIME_GRAPHICS) {
      upgradeError(
        `You've made your ${PRISM_LIFETIME_GRAPHICS} feed graphics this month. They reset on the 1st, ` +
          "or upgrade to Prism Launch for unlimited graphics."
      );
    }
    if (ai > 0 && e.aiLimit !== null && e.aiUsed + ai > e.aiLimit) {
      const left = Math.max(0, e.aiLimit - e.aiUsed);
      const needs = `That needs ${ai} AI action${ai === 1 ? "" : "s"} and you have ${left} left this month`;
      upgradeError(
        e.tier === "free" || e.tier === "lifetime" ?
          `${needs} on Prism ${e.tier === "free" ? "Free" : "Lifetime"}. Upgrade to Prism Launch for 1,000 a month.` :
          `${needs}. Contact us about Prism Enterprise.`
      );
    }

    const update: Record<string, string | number | FieldValue> = {
      prismUsagePeriodKey: e.periodKey,
      prismAiActionsThisPeriod: e.aiUsed + ai,
      prismGraphicsThisPeriod: e.graphicsUsed + (graphic ? 1 : 0),
    };
    if (studioRun) update.prismStudioRunsUsed = FieldValue.increment(1);
    if (slideRender) update.prismSlideRendersUsed = FieldValue.increment(1);
    tx.update(ref, update);
    return {periodKey: e.periodKey, ai, studioRun, slideRender, graphic};
  });
}

export type PrismReservation = {periodKey: string; ai: number; studioRun: boolean; slideRender: boolean; graphic: boolean};

/**
 * Gives usage back after the action failed (best effort, same period only).
 * @param {string} agencyId Agency id.
 * @param {object} r Result of reservePrismUsage.
 * @return {!Promise<void>}
 */
export async function releasePrismUsage(agencyId: string, r: PrismReservation): Promise<void> {
  const ref = db.collection("agencies").doc(agencyId);
  await db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data() ?? {};
    const update: Record<string, number> = {};
    if (r.ai > 0 && d.prismUsagePeriodKey === r.periodKey) {
      update.prismAiActionsThisPeriod = Math.max(0, count(d.prismAiActionsThisPeriod) - r.ai);
    }
    if (r.graphic && d.prismUsagePeriodKey === r.periodKey) {
      update.prismGraphicsThisPeriod = Math.max(0, count(d.prismGraphicsThisPeriod) - 1);
    }
    if (r.studioRun) update.prismStudioRunsUsed = Math.max(0, count(d.prismStudioRunsUsed) - 1);
    if (r.slideRender) update.prismSlideRendersUsed = Math.max(0, count(d.prismSlideRendersUsed) - 1);
    if (Object.keys(update).length) tx.update(ref, update);
  }).catch((e) => logger.warn("[Prism billing] Could not release usage", {agencyId, e: String(e)}));
}

/**
 * Runs an action against the plan's limits; usage is returned if the action throws.
 * @param {string} agencyId Agency id.
 * @param {PrismUsage} usage What the action uses.
 * @param {function(): Promise<T>} fn The action.
 * @return {!Promise<T>} Action result.
 * @template T
 */
export async function withPrismUsage<T>(agencyId: string, usage: PrismUsage, fn: () => Promise<T>): Promise<T> {
  const reserved = await reservePrismUsage(agencyId, usage);
  try {
    return await fn();
  } catch (e) {
    await releasePrismUsage(agencyId, reserved);
    throw e;
  }
}

/**
 * Maps a Prism plan id to tier and interval.
 * @param {string} id e.g. prism_launch_yearly.
 * @return {?object} Plan, or null when unknown.
 */
function planFromId(id: string): {planId: PrismPlanId; tier: "launch" | "enterprise"; interval: "month" | "year"} | null {
  const m = /^prism_(launch|enterprise)_(monthly|yearly)$/.exec(id.trim());
  if (!m) return null;
  return {
    planId: id.trim() as PrismPlanId,
    tier: m[1] as "launch" | "enterprise",
    interval: m[2] === "yearly" ? "year" : "month",
  };
}

/**
 * Resolves the Prism plan of a subscription: configured Launch prices, then subscription
 * metadata, then price metadata (`prismPlanId`, used by Enterprise Payment Links).
 * @param {Stripe.Subscription} sub Subscription.
 * @return {?object} Plan, or null when it isn't a Prism subscription.
 */
function resolvePrismPlan(sub: Stripe.Subscription) {
  const price = sub.items.data[0]?.price;
  const priceId = price?.id ?? "";
  const monthly = params.STRIPE_PRISM_LAUNCH_MONTHLY_PRICE_ID.value();
  const yearly = params.STRIPE_PRISM_LAUNCH_YEARLY_PRICE_ID.value();
  let plan = null as ReturnType<typeof planFromId>;
  if (priceId && priceId === monthly) plan = planFromId("prism_launch_monthly");
  else if (priceId && priceId === yearly) plan = planFromId("prism_launch_yearly");
  plan = plan ?? planFromId(String(sub.metadata?.prismPlanId ?? "")) ?? planFromId(String(price?.metadata?.prismPlanId ?? ""));
  if (plan && price?.recurring?.interval === "year") plan.interval = "year";
  if (plan && price?.recurring?.interval === "month") plan.interval = "month";
  return plan;
}

/**
 * Ensures the caller is an owner or admin of their primary brand.
 * @param {string} uid Auth uid.
 * @return {!Promise<object>} Agency id and user data.
 */
export async function prismBillingAdmin(uid: string): Promise<{agencyId: string; user: Record<string, unknown>}> {
  const user = (await db.collection("users").doc(uid).get()).data();
  const agencyId = String(user?.primaryAgencyId ?? "");
  if (!user || !agencyId) throw new HttpsError("failed-precondition", "Set a primary brand workspace first.");
  const role = String(user.role ?? "");
  if (role !== "agency_owner" && role !== "agency_admin") {
    throw new HttpsError("permission-denied", "Ask your brand's owner or an admin to manage Prism billing.");
  }
  return {agencyId, user};
}

/**
 * Returns the user's Stripe customer id, creating one if needed.
 * @param {Stripe} stripe Stripe client.
 * @param {string} uid Auth uid.
 * @param {Record<string, unknown>} user User data.
 * @return {!Promise<string>} Customer id.
 */
export async function stripeCustomerFor(stripe: Stripe, uid: string, user: Record<string, unknown>): Promise<string> {
  const existing = user.stripeCustomerId;
  if (typeof existing === "string" && existing) return existing;
  const customer = await stripe.customers.create({
    email: typeof user.email === "string" ? user.email : undefined,
    name: typeof user.displayName === "string" ? user.displayName : undefined,
    metadata: {firebaseUID: uid},
  });
  await db.collection("users").doc(uid).update({stripeCustomerId: customer.id});
  return customer.id;
}

/**
 * Stripe client.
 * @return {Stripe} Client.
 */
export function stripeClient(): Stripe {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Stripe(params.STRIPE_SECRET_KEY.value(), {apiVersion: STRIPE_API_VERSION as any});
}

/** Live Launch prices from Stripe, so the pricing page always matches what Checkout charges. */
export const getPrismPricing = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to see pricing.");
  const ids = {
    month: params.STRIPE_PRISM_LAUNCH_MONTHLY_PRICE_ID.value(),
    year: params.STRIPE_PRISM_LAUNCH_YEARLY_PRICE_ID.value(),
  };
  const stripe = stripeClient();
  const [month, year] = await Promise.all(
    [ids.month, ids.year].map((id) => (id ? stripe.prices.retrieve(id).catch(() => null) : Promise.resolve(null)))
  );
  return {
    monthlyCents: month?.unit_amount ?? null,
    yearlyCents: year?.unit_amount ?? null,
    currency: month?.currency ?? "usd",
  };
});

/** Stripe Checkout for Prism Launch (monthly or yearly). */
export const createPrismSubscriptionCheckoutSession = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to subscribe to Prism.");
  const uid = request.auth.uid;
  const interval = request.data?.interval === "year" ? "year" : "month";
  const planId: PrismPlanId = interval === "year" ? "prism_launch_yearly" : "prism_launch_monthly";
  const priceId = interval === "year" ?
    params.STRIPE_PRISM_LAUNCH_YEARLY_PRICE_ID.value() :
    params.STRIPE_PRISM_LAUNCH_MONTHLY_PRICE_ID.value();
  if (!priceId) throw new HttpsError("failed-precondition", "Prism pricing isn't configured yet.");

  const {agencyId, user} = await prismBillingAdmin(uid);
  const agency = (await db.collection("agencies").doc(agencyId).get()).data() ?? {};
  const current = prismEntitlementsFrom(agency);
  if (current.tier !== "free" && current.tier !== "lifetime") {
    throw new HttpsError("failed-precondition", "This brand already has a Prism plan. Use Manage billing to change it.");
  }

  const stripe = stripeClient();
  const customer = await stripeCustomerFor(stripe, uid, user);
  const metadata = {firebaseUID: uid, agencyId, productType: "prism", prismPlanId: planId};
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{price: priceId, quantity: 1}],
    success_url: `${params.APP_URL.value()}/prism?prism_subscribe_success=true`,
    cancel_url: `${params.APP_URL.value()}/prism/pricing`,
    subscription_data: {metadata},
    metadata,
    allow_promotion_codes: true,
  });
  return {url: session.url};
});

/** Stripe Customer Portal for the brand's Prism subscription. */
export const createPrismBillingPortalSession = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to manage Prism billing.");
  const {agencyId, user} = await prismBillingAdmin(request.auth.uid);
  const agency = (await db.collection("agencies").doc(agencyId).get()).data() ?? {};
  const subId = agency.prismStripeSubscriptionId as string | undefined;
  if (!subId) throw new HttpsError("failed-precondition", "This brand has no Prism subscription.");
  const stripe = stripeClient();
  const sub = await stripe.subscriptions.retrieve(subId);
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  if (!customer && typeof user.stripeCustomerId !== "string") {
    throw new HttpsError("failed-precondition", "No billing account found.");
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: customer || String(user.stripeCustomerId),
    return_url: `${params.APP_URL.value()}/prism/pricing`,
  });
  return {url: session.url};
});

const PRISM_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
]);

type InvoiceRef = Stripe.Invoice & {
  subscription?: string | {id: string} | null;
  parent?: {subscription_details?: {subscription?: string | {id: string} | null}};
};

/**
 * Subscription id referenced by a webhook object.
 * @param {Stripe.Event} event Event.
 * @return {?string} Subscription id.
 */
function subscriptionIdOf(event: Stripe.Event): string | null {
  const obj = event.data.object as unknown as Record<string, unknown>;
  if (event.type.startsWith("customer.subscription.")) return String(obj.id ?? "") || null;
  if (event.type === "checkout.session.completed") {
    const s = obj as unknown as Stripe.Checkout.Session;
    if (s.mode !== "subscription") return null;
    return typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null;
  }
  const inv = obj as unknown as InvoiceRef;
  const ref = inv.subscription ?? inv.parent?.subscription_details?.subscription;
  if (typeof ref === "string") return ref;
  return ref && typeof ref === "object" ? ref.id ?? null : null;
}

/**
 * Finds the brand for a Prism subscription: subscription metadata, else the Checkout Session's
 * agencyId metadata or `client_reference_id` (Payment Links).
 * @param {Stripe} stripe Stripe client.
 * @param {Stripe.Event} event Event.
 * @param {Stripe.Subscription} sub Subscription.
 * @return {!Promise<?string>} Agency id.
 */
async function agencyForSubscription(stripe: Stripe, event: Stripe.Event, sub: Stripe.Subscription): Promise<string | null> {
  if (sub.metadata?.productType === "prism" && sub.metadata.agencyId) return sub.metadata.agencyId;
  const sessions: Stripe.Checkout.Session[] = [];
  if (event.type === "checkout.session.completed") sessions.push(event.data.object as Stripe.Checkout.Session);
  else sessions.push(...(await stripe.checkout.sessions.list({subscription: sub.id, limit: 5})).data);
  for (const s of sessions) {
    const id = String(s.metadata?.agencyId || s.client_reference_id || "").trim();
    if (id && (await db.collection("agencies").doc(id).get()).exists) return id;
  }
  return null;
}

/**
 * Writes the subscription's Prism plan onto the agency.
 * @param {string} agencyId Agency id.
 * @param {Stripe.Subscription} sub Subscription.
 * @param {object} plan Resolved plan.
 * @return {!Promise<void>}
 */
async function applyPrismSubscription(
  agencyId: string,
  sub: Stripe.Subscription,
  plan: NonNullable<ReturnType<typeof resolvePrismPlan>>
): Promise<void> {
  const subAny = sub as Stripe.Subscription & {current_period_end?: number};
  const itemEnd = (sub.items.data[0] as {current_period_end?: number} | undefined)?.current_period_end;
  const end = subAny.current_period_end ?? itemEnd;
  await db.collection("agencies").doc(agencyId).update({
    prismPlan: plan.tier,
    prismPlanId: plan.planId,
    prismSubscriptionStatus: sub.status,
    prismStripeSubscriptionId: sub.id,
    prismBillingInterval: plan.interval,
    prismPeriodEnd: typeof end === "number" ? Timestamp.fromMillis(end * 1000) : null,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Handles Stripe webhook events for Prism subscriptions. Runs after the Optic handler.
 * @param {Stripe} stripe Stripe client.
 * @param {Stripe.Event} event Verified event.
 * @return {!Promise<boolean>} True when the event was a Prism event.
 */
export async function handlePrismStripeSubscriptionEvent(stripe: Stripe, event: Stripe.Event): Promise<boolean> {
  if (!PRISM_EVENTS.has(event.type)) return false;
  const subId = subscriptionIdOf(event);
  if (!subId) return false;

  let sub = event.type.startsWith("customer.subscription.") ?
    (event.data.object as Stripe.Subscription) :
    await stripe.subscriptions.retrieve(subId);
  const plan = resolvePrismPlan(sub);
  if (!plan) return false;
  const agencyId = await agencyForSubscription(stripe, event, sub);
  if (!agencyId) {
    logger.warn("[Prism billing] Prism subscription without a brand", {subId, event: event.type});
    return true;
  }

  if (sub.metadata?.productType !== "prism" || sub.metadata?.agencyId !== agencyId || !sub.metadata?.prismPlanId) {
    sub = await stripe.subscriptions.update(sub.id, {
      metadata: {...(sub.metadata ?? {}), productType: "prism", agencyId, prismPlanId: plan.planId},
    });
  }

  if (event.type === "customer.subscription.deleted") {
    await db.collection("agencies").doc(agencyId).update({
      prismSubscriptionStatus: "canceled",
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else if (event.type === "invoice.payment_failed") {
    await db.collection("agencies").doc(agencyId).update({
      prismSubscriptionStatus: "past_due",
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    await applyPrismSubscription(agencyId, sub, plan);
  }
  logger.info("[Prism billing] Subscription synced", {agencyId, subId, tier: plan.tier, event: event.type});
  return true;
}
