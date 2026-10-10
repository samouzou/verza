import {randomInt} from "crypto";
import {FieldValue} from "firebase-admin/firestore";
import {onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import type Stripe from "stripe";
import {db} from "../config/firebase";
import * as params from "../config/params";
import {
  PRISM_SELF_SERVE_TIERS,
  planPrices,
  prismEntitlementsFrom,
  stripeClient,
  type PrismSelfServeTier,
} from "./billing";
import {prismCaller} from "./posts";
import {
  PRISM_REFERRAL_CODES,
  PRISM_REFERRAL_PERCENT_OFF,
  PRISM_REFERRALS,
} from "./referralCodes";
import {PRISM_VIDEO_CREDITS} from "./videoCredits";

/** Rewards a brand can earn per calendar year (UTC). */
export const PRISM_REFERRAL_CAP_PER_YEAR = 12;
/** Lifetime brands have no subscription to credit, so they earn video seconds instead. */
export const PRISM_REFERRAL_VIDEO_SECONDS = 60;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAID_EVENTS = new Set(["invoice.paid", "invoice.payment_succeeded"]);

type RewardKind = "credit" | "video";
type CreditReward = {kind: "credit"; cents: number; currency: string; tier: PrismSelfServeTier; subscriptionId: string};

/**
 * Non-negative integer from a Firestore field.
 * @param {unknown} raw Raw value.
 * @return {number} Count.
 */
function count(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

/**
 * What a brand earns per referral: account credit on Starter, Launch or Pro, video seconds on Lifetime.
 * @param {Record<string, unknown>} agency Agency data.
 * @return {?RewardKind} Reward kind, or null when the brand can't refer.
 */
function rewardKind(agency: Record<string, unknown>): RewardKind | null {
  const {tier} = prismEntitlementsFrom(agency);
  if ((PRISM_SELF_SERVE_TIERS as readonly string[]).includes(tier)) return "credit";
  return tier === "lifetime" ? "video" : null;
}

/**
 * Rewards used this year.
 * @param {Record<string, unknown>} agency Agency data.
 * @return {number} Count.
 */
function rewardsThisYear(agency: Record<string, unknown>): number {
  return agency.prismReferralYear === new Date().getUTCFullYear() ? count(agency.prismReferralRewards) : 0;
}

/**
 * The brand's referral code, creating a unique one (e.g. VERZA-7Q2K) on first use.
 * @param {string} agencyId Agency id.
 * @param {Record<string, unknown>} agency Agency data.
 * @return {!Promise<string>} Code.
 */
async function referralCodeFor(agencyId: string, agency: Record<string, unknown>): Promise<string> {
  if (typeof agency.prismReferralCode === "string" && agency.prismReferralCode) return agency.prismReferralCode;
  const prefix = String(agency.name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "PRISM";
  const agencyRef = db.collection("agencies").doc(agencyId);
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = Array.from({length: 4}, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    const code = `${prefix}-${suffix}`;
    const created = await db.runTransaction(async (tx) => {
      const [codeSnap, agencySnap] = await Promise.all([
        tx.get(db.collection(PRISM_REFERRAL_CODES).doc(code)),
        tx.get(agencyRef),
      ]);
      const existing = agencySnap.data()?.prismReferralCode;
      if (typeof existing === "string" && existing) return existing;
      if (codeSnap.exists) return null;
      tx.set(codeSnap.ref, {agencyId, createdAt: FieldValue.serverTimestamp()});
      tx.update(agencyRef, {prismReferralCode: code});
      return code;
    });
    if (created) return created;
  }
  throw new Error("Could not create a unique referral code");
}

/** The brand's share link, what it earns and how its referrals are going. */
export const getPrismReferral = onCall(async (request) => {
  const c = await prismCaller(request.auth?.uid);
  const agency = (await db.collection("agencies").doc(c.agencyId).get()).data() ?? {};
  const reward = rewardKind(agency);
  const base = {
    friendPercentOff: PRISM_REFERRAL_PERCENT_OFF,
    capPerYear: PRISM_REFERRAL_CAP_PER_YEAR,
    videoSeconds: PRISM_REFERRAL_VIDEO_SECONDS,
  };
  if (!reward) return {...base, eligible: false};

  const code = await referralCodeFor(c.agencyId, agency);
  const {tier} = prismEntitlementsFrom(agency);
  const [referrals, monthCents] = await Promise.all([
    db.collection(PRISM_REFERRALS).where("referrerAgencyId", "==", c.agencyId).limit(500).get(),
    reward === "credit" ?
      planPrices(stripeClient()).then((p) => p.find((x) => x.tier === tier && x.interval === "month")?.cents ?? null)
        .catch(() => null) :
      Promise.resolve(null),
  ]);
  const statuses = referrals.docs.map((d) => String(d.data().status ?? ""));
  return {
    ...base,
    eligible: true,
    code,
    url: `${params.APP_URL.value()}/prism/pricing?ref=${code}`,
    reward,
    monthCents,
    joined: statuses.length,
    rewarded: statuses.filter((s) => s === "rewarded").length,
    rewardsThisYear: rewardsThisYear(agency),
  };
});

/**
 * Subscription id on a subscription or invoice event.
 * @param {Stripe.Event} event Event.
 * @return {?string} Subscription id.
 */
function subscriptionIdOf(event: Stripe.Event): string | null {
  const obj = event.data.object as unknown as Record<string, unknown>;
  if (event.type.startsWith("customer.subscription.")) return String(obj.id ?? "") || null;
  const inv = obj as {
    subscription?: string | {id: string} | null;
    parent?: {subscription_details?: {subscription?: string | {id: string} | null}};
  };
  const ref = inv.subscription ?? inv.parent?.subscription_details?.subscription;
  if (typeof ref === "string") return ref;
  return ref && typeof ref === "object" ? ref.id ?? null : null;
}

/**
 * Tracks referred subscriptions and rewards the referrer once the friend pays a non-zero invoice:
 * one month of the referrer's plan as Stripe account credit, or video seconds for Lifetime brands.
 * Runs after the Prism subscription sync.
 * @param {Stripe} stripe Stripe client.
 * @param {Stripe.Event} event Verified event.
 * @return {!Promise<void>}
 */
export async function handlePrismReferralEvent(stripe: Stripe, event: Stripe.Event): Promise<void> {
  const paid = PAID_EVENTS.has(event.type);
  if (!paid && event.type !== "customer.subscription.created") return;
  if (paid && count((event.data.object as Stripe.Invoice).amount_paid) === 0) return;
  const subId = subscriptionIdOf(event);
  if (!subId) return;
  const sub = event.type === "customer.subscription.created" ?
    (event.data.object as Stripe.Subscription) :
    await stripe.subscriptions.retrieve(subId);
  const referrerAgencyId = sub.metadata?.prismReferrerAgencyId;
  if (sub.metadata?.productType !== "prism" || !referrerAgencyId) return;

  const refDoc = db.collection(PRISM_REFERRALS).doc(sub.id);
  const base = {
    referrerAgencyId,
    refereeAgencyId: sub.metadata.agencyId ?? null,
    code: sub.metadata.prismReferralCode ?? null,
  };
  if (!paid) {
    await refDoc.create({...base, status: "pending", createdAt: FieldValue.serverTimestamp()}).catch(() => undefined);
    return;
  }

  const prices = await planPrices(stripe);
  const invoiceId = (event.data.object as Stripe.Invoice).id ?? null;
  const agencyRef = db.collection("agencies").doc(referrerAgencyId);
  const claim = await db.runTransaction(async (tx): Promise<CreditReward | null> => {
    const [refSnap, agencySnap] = await Promise.all([tx.get(refDoc), tx.get(agencyRef)]);
    const current = refSnap.data();
    if (current?.status === "crediting") return current.reward as CreditReward;
    if (current && current.status !== "pending") return null;

    const agency = agencySnap.data() ?? {};
    const now = FieldValue.serverTimestamp();
    const record = (status: string, extra: Record<string, unknown> = {}) => tx.set(refDoc, {
      ...base, status, invoiceId, ...extra, createdAt: current?.createdAt ?? now, updatedAt: now,
    }, {merge: true});

    const kind = rewardKind(agency);
    const {tier} = prismEntitlementsFrom(agency);
    const cents = prices.find((p) => p.tier === tier && p.interval === "month")?.cents;
    const subscriptionId = String(agency.prismStripeSubscriptionId ?? "");
    if (!kind || (kind === "credit" && (!cents || !subscriptionId))) {
      record("ineligible");
      return null;
    }
    const used = rewardsThisYear(agency);
    if (used >= PRISM_REFERRAL_CAP_PER_YEAR) {
      record("capped");
      return null;
    }
    tx.update(agencyRef, {prismReferralYear: new Date().getUTCFullYear(), prismReferralRewards: used + 1});

    if (kind === "video") {
      const creditsRef = db.collection(PRISM_VIDEO_CREDITS).doc(referrerAgencyId);
      tx.set(creditsRef, {
        agencyId: referrerAgencyId,
        purchased: FieldValue.increment(PRISM_REFERRAL_VIDEO_SECONDS),
        updatedAt: now,
      }, {merge: true});
      tx.set(creditsRef.collection("ledger").doc(`referral_${sub.id}`), {
        type: "referral",
        credits: PRISM_REFERRAL_VIDEO_SECONDS,
        refereeSubscriptionId: sub.id,
        createdAt: now,
      });
      record("rewarded", {reward: {kind: "video", seconds: PRISM_REFERRAL_VIDEO_SECONDS}, rewardedAt: now});
      return null;
    }

    const reward: CreditReward = {
      kind: "credit",
      cents: cents as number,
      currency: prices[0]?.currency ?? "usd",
      tier: tier as PrismSelfServeTier,
      subscriptionId,
    };
    record("crediting", {reward});
    return reward;
  });
  if (!claim) return;

  const referrerSub = await stripe.subscriptions.retrieve(claim.subscriptionId);
  const customer = typeof referrerSub.customer === "string" ? referrerSub.customer : referrerSub.customer.id;
  const tierName = claim.tier[0].toUpperCase() + claim.tier.slice(1);
  const txn = await stripe.customers.createBalanceTransaction(customer, {
    amount: -claim.cents,
    currency: claim.currency,
    description: `Prism referral: 1 free month of ${tierName}`,
    metadata: {refereeSubscriptionId: sub.id, productType: "prism"},
  }, {idempotencyKey: `prism_referral_${sub.id}`});
  await refDoc.update({
    "status": "rewarded",
    "reward.customer": customer,
    "reward.balanceTransactionId": txn.id,
    "rewardedAt": FieldValue.serverTimestamp(),
  });
  logger.info("[Prism referral] Rewarded", {referrerAgencyId, refereeSubscriptionId: sub.id, cents: claim.cents});
}
