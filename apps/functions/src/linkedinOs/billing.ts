import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import {db} from "../config/firebase";
import * as params from "../config/params";

/** "lifetime" = AppSumo: Starter's limits for good, no auto-publishing. */
export type PrismPlanTier = "free" | "lifetime" | "starter" | "launch" | "pro" | "enterprise";
/** Tiers sold as Stripe subscriptions. */
export type PrismSubscriptionTier = "starter" | "launch" | "pro" | "enterprise";
/** Tiers sold through self-serve Checkout. */
export type PrismSelfServeTier = "starter" | "launch" | "pro";
export type PrismPlanId = `prism_${PrismSubscriptionTier}_${"monthly" | "yearly"}`;

export const PRISM_SELF_SERVE_TIERS: readonly PrismSelfServeTier[] = ["starter", "launch", "pro"];

export type PrismTierLimits = {
  /** AI actions a month (one channel written = 1, month plan = 5, weekly plan = 2). null = unlimited. */
  ai: number | null;
  /** Feed graphics a month (each is a paid image-model call). null = no monthly cap. */
  graphics: number | null;
  /** Auto-publishing through connected accounts. */
  publish: boolean;
  /** X API fees included each month, in millionths of a dollar. Enterprise is by contract. */
  xIncludedMicros: number;
};

export const PRISM_TIERS: Record<PrismPlanTier, PrismTierLimits> = {
  free: {ai: 15, graphics: null, publish: false, xIncludedMicros: 0},
  lifetime: {ai: 300, graphics: 30, publish: false, xIncludedMicros: 0},
  starter: {ai: 300, graphics: 30, publish: false, xIncludedMicros: 0},
  launch: {ai: 1000, graphics: 100, publish: true, xIncludedMicros: 5_000_000},
  pro: {ai: 3000, graphics: null, publish: true, xIncludedMicros: 10_000_000},
  enterprise: {ai: null, graphics: null, publish: true, xIncludedMicros: 0},
};

/** Where an upgrade message points each tier. */
const NEXT_TIER: Record<PrismPlanTier, PrismPlanTier> = {
  free: "starter",
  lifetime: "launch",
  starter: "launch",
  launch: "pro",
  pro: "enterprise",
  enterprise: "enterprise",
};

const TIER_NAME: Record<PrismPlanTier, string> = {
  free: "Free",
  lifetime: "Lifetime",
  starter: "Starter",
  launch: "Launch",
  pro: "Pro",
  enterprise: "Enterprise",
};

/** One-time taste of the paid plans on Free; never resets. */
export const PRISM_FREE_STUDIO_RUNS = 1;
export const PRISM_FREE_SLIDE_RENDERS = 3;

export const PRISM_AI_COST = {monthPlan: 5, weeklyPlan: 2, repurpose: 1} as const;

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
  /** null = no monthly cap. */
  graphicsLimit: number | null;
  /** Launch, Pro and Enterprise only. */
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
  const subscribed = active && isPrismSubscriptionTier(plan);
  const tier: PrismPlanTier = subscribed ? plan : d.prismLifetime === true ? "lifetime" : "free";
  const periodKey = prismPeriodKey();
  const thisPeriod = d.prismUsagePeriodKey === periodKey;
  const limits = PRISM_TIERS[tier];
  return {
    tier,
    periodKey,
    aiUsed: thisPeriod ? count(d.prismAiActionsThisPeriod) : 0,
    aiLimit: limits.ai,
    studioRunsUsed: count(d.prismStudioRunsUsed),
    slideRendersUsed: count(d.prismSlideRendersUsed),
    graphicsUsed: thisPeriod ? count(d.prismGraphicsThisPeriod) : 0,
    graphicsLimit: limits.graphics,
    canPublish: subscribed && limits.publish,
  };
}

/**
 * Whether a value names a subscription tier.
 * @param {string} v Value.
 * @return {boolean} True for starter, launch, pro or enterprise.
 */
function isPrismSubscriptionTier(v: string): v is PrismSubscriptionTier {
  return v === "starter" || v === "launch" || v === "pro" || v === "enterprise";
}

/**
 * "Upgrade to Prism X for …" for the tier above this one.
 * @param {PrismPlanTier} tier Current tier.
 * @param {function(PrismTierLimits): string} perk What the next tier offers, from its limits.
 * @return {string} Sentence.
 */
function upgradeHint(tier: PrismPlanTier, perk: (l: PrismTierLimits) => string): string {
  const next = NEXT_TIER[tier];
  if (next === "enterprise") return "Contact us about Prism Enterprise.";
  return `Upgrade to Prism ${TIER_NAME[next]} for ${perk(PRISM_TIERS[next])}.`;
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
        upgradeError("You've used your free Studio run. Upgrade to Prism Starter to batch a week of drafts any time.");
      }
      if (slideRender && e.slideRendersUsed >= PRISM_FREE_SLIDE_RENDERS) {
        upgradeError(
          `You've used your ${PRISM_FREE_SLIDE_RENDERS} free slide renders. Upgrade to Prism Starter for unlimited carousels.`
        );
      }
    }
    if (graphic && e.graphicsLimit !== null && e.graphicsUsed >= e.graphicsLimit) {
      upgradeError(
        `You've made your ${e.graphicsLimit} feed graphics this month. They reset on the 1st, or ` +
          upgradeHint(e.tier, (l) => (l.graphics === null ? "unlimited graphics" : `${l.graphics} a month`))
            .replace(/^./, (c) => c.toLowerCase())
      );
    }
    if (ai > 0 && e.aiLimit !== null && e.aiUsed + ai > e.aiLimit) {
      const left = Math.max(0, e.aiLimit - e.aiUsed);
      const needs = `That needs ${ai} AI action${ai === 1 ? "" : "s"} and you have ${left} left this month`;
      upgradeError(
        `${needs} on Prism ${TIER_NAME[e.tier]}. ` +
          upgradeHint(e.tier, (l) => (l.ai === null ? "unlimited AI actions" : `${l.ai.toLocaleString("en-US")} a month`))
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
function planFromId(id: string): {planId: PrismPlanId; tier: PrismSubscriptionTier; interval: "month" | "year"} | null {
  const m = /^prism_(starter|launch|pro|enterprise)_(monthly|yearly)$/.exec(id.trim());
  if (!m) return null;
  return {
    planId: id.trim() as PrismPlanId,
    tier: m[1] as PrismSubscriptionTier,
    interval: m[2] === "yearly" ? "year" : "month",
  };
}

/**
 * Stripe price lookup key (and plan id) for a self-serve plan.
 * @param {PrismSelfServeTier} tier Tier.
 * @param {string} interval month or year.
 * @return {PrismPlanId} e.g. prism_launch_yearly.
 */
function planIdFor(tier: PrismSelfServeTier, interval: "month" | "year"): PrismPlanId {
  return `prism_${tier}_${interval === "year" ? "yearly" : "monthly"}`;
}

/**
 * Resolves the Prism plan of a subscription from what it's billed for: the price's lookup key, then
 * price metadata (`prismPlanId`, used by Enterprise Payment Links), then subscription metadata.
 * Launch subscriptions on a price without the current lookup key are on the retired $199 Launch and get Pro.
 * @param {Stripe.Subscription} sub Subscription.
 * @return {?object} Plan, or null when it isn't a Prism subscription.
 */
function resolvePrismPlan(sub: Stripe.Subscription) {
  const price = sub.items.data[0]?.price;
  const priceId = price?.id ?? "";
  const legacyIds = [params.STRIPE_PRISM_LAUNCH_MONTHLY_PRICE_ID.value(), params.STRIPE_PRISM_LAUNCH_YEARLY_PRICE_ID.value()];
  let plan =
    planFromId(String(price?.lookup_key ?? "")) ??
    planFromId(String(price?.metadata?.prismPlanId ?? "")) ??
    planFromId(String(sub.metadata?.prismPlanId ?? ""));
  const legacy = (priceId && legacyIds.includes(priceId)) || (plan?.tier === "launch" && price?.lookup_key !== plan.planId);
  if (legacy) plan = planFromId(price?.recurring?.interval === "year" ? "prism_pro_yearly" : "prism_pro_monthly");
  if (plan && price?.recurring?.interval === "year") plan.interval = "year";
  if (plan && price?.recurring?.interval === "month") plan.interval = "month";
  return plan;
}

type PlanPrice = {tier: PrismSelfServeTier; interval: "month" | "year"; cents: number; currency: string; priceId: string};

/**
 * Active self-serve plan prices from Stripe, found by lookup key.
 * @param {Stripe} stripe Stripe client.
 * @return {!Promise<!Array<PlanPrice>>} Prices.
 */
async function planPrices(stripe: Stripe): Promise<PlanPrice[]> {
  const keys = PRISM_SELF_SERVE_TIERS.flatMap((t) => [planIdFor(t, "month"), planIdFor(t, "year")]);
  const {data} = await stripe.prices.list({lookup_keys: keys, active: true, limit: keys.length});
  const out: PlanPrice[] = [];
  for (const p of data) {
    const plan = planFromId(p.lookup_key ?? "");
    if (!plan || plan.tier === "enterprise" || typeof p.unit_amount !== "number") continue;
    out.push({tier: plan.tier, interval: plan.interval, cents: p.unit_amount, currency: p.currency, priceId: p.id});
  }
  return out;
}

/**
 * Parses a requested self-serve plan.
 * @param {unknown} data Callable data.
 * @return {object} Tier and interval.
 */
function requestedPlan(data: unknown): {tier: PrismSelfServeTier; interval: "month" | "year"} {
  const d = (data ?? {}) as {plan?: unknown; interval?: unknown};
  const tier = d.plan === undefined ? "launch" : d.plan;
  if (!PRISM_SELF_SERVE_TIERS.includes(tier as PrismSelfServeTier)) {
    throw new HttpsError("invalid-argument", "Pick Starter, Launch or Pro.");
  }
  return {tier: tier as PrismSelfServeTier, interval: d.interval === "year" ? "year" : "month"};
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

/** Live self-serve prices from Stripe, so the pricing page always matches what Checkout charges. */
export const getPrismPricing = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to see pricing.");
  const prices = await planPrices(stripeClient());
  const plans = Object.fromEntries(
    PRISM_SELF_SERVE_TIERS.map((tier) => [tier, {
      monthlyCents: prices.find((p) => p.tier === tier && p.interval === "month")?.cents ?? null,
      yearlyCents: prices.find((p) => p.tier === tier && p.interval === "year")?.cents ?? null,
    }])
  );
  return {currency: prices[0]?.currency ?? "usd", plans};
});

/** Stripe Checkout for Prism Starter, Launch or Pro (monthly or yearly). Free and Lifetime brands only. */
export const createPrismSubscriptionCheckoutSession = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to subscribe to Prism.");
  const uid = request.auth.uid;
  const {tier, interval} = requestedPlan(request.data);
  const planId = planIdFor(tier, interval);

  const {agencyId, user} = await prismBillingAdmin(uid);
  const agency = (await db.collection("agencies").doc(agencyId).get()).data() ?? {};
  const current = prismEntitlementsFrom(agency);
  if (current.tier !== "free" && current.tier !== "lifetime") {
    throw new HttpsError("failed-precondition", "This brand already has a Prism plan. Switch plans from the pricing page.");
  }
  if (current.tier === "lifetime" && tier === "starter") {
    throw new HttpsError("failed-precondition", "Lifetime already includes everything in Starter. Pick Launch or Pro.");
  }

  const stripe = stripeClient();
  const price = (await planPrices(stripe)).find((p) => p.tier === tier && p.interval === interval);
  if (!price) throw new HttpsError("failed-precondition", "Prism pricing isn't configured yet.");
  const customer = await stripeCustomerFor(stripe, uid, user);
  const metadata = {firebaseUID: uid, agencyId, productType: "prism", prismPlanId: planId};
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{price: price.priceId, quantity: 1}],
    success_url: `${params.APP_URL.value()}/prism?prism_subscribe_success=${tier}`,
    cancel_url: `${params.APP_URL.value()}/prism/pricing`,
    subscription_data: {metadata},
    metadata,
    allow_promotion_codes: true,
  });
  return {url: session.url};
});

/**
 * Moves a self-serve subscription to another plan or interval. Upgrades are charged the prorated
 * difference now and only take effect once that payment succeeds; downgrades leave a credit for later invoices.
 */
export const changePrismPlan = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to change your Prism plan.");
  const {tier, interval} = requestedPlan(request.data);
  const {agencyId} = await prismBillingAdmin(request.auth.uid);
  const agency = (await db.collection("agencies").doc(agencyId).get()).data() ?? {};
  const current = prismEntitlementsFrom(agency);
  const subId = String(agency.prismStripeSubscriptionId ?? "");
  if (current.tier === "enterprise") {
    throw new HttpsError("failed-precondition", "Enterprise plans are changed by contract. Email serge@tryverza.com.");
  }
  if (!PRISM_SELF_SERVE_TIERS.includes(current.tier as PrismSelfServeTier) || !subId) {
    throw new HttpsError("failed-precondition", "This brand has no Prism subscription to change. Pick a plan to subscribe.");
  }

  const stripe = stripeClient();
  const price = (await planPrices(stripe)).find((p) => p.tier === tier && p.interval === interval);
  if (!price) throw new HttpsError("failed-precondition", "Prism pricing isn't configured yet.");
  const sub = await stripe.subscriptions.retrieve(subId);
  const item = sub.items.data[0];
  if (!item) throw new HttpsError("failed-precondition", "This subscription has no plan to change.");
  if (item.price.id === price.priceId) return {tier, interval, changed: false};

  const updated = await stripe.subscriptions.update(sub.id, {
    items: [{id: item.id, price: price.priceId}],
    proration_behavior: "always_invoice",
    payment_behavior: "pending_if_incomplete",
  });
  if (updated.pending_update) {
    throw new HttpsError(
      "failed-precondition",
      "Your card didn't go through, so your plan hasn't changed. Update your card in Manage billing and try again."
    );
  }
  if (updated.cancel_at_period_end) {
    await stripe.subscriptions.update(sub.id, {cancel_at_period_end: false});
  }
  const plan = resolvePrismPlan(updated);
  if (plan) await applyPrismSubscription(agencyId, updated, plan);
  logger.info("[Prism billing] Plan changed", {agencyId, subId, from: current.tier, to: tier, interval});
  return {tier, interval, changed: true};
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

  if (
    sub.metadata?.productType !== "prism" ||
    sub.metadata?.agencyId !== agencyId ||
    sub.metadata?.prismPlanId !== plan.planId
  ) {
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
