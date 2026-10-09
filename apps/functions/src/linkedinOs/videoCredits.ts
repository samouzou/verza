import {FieldValue, type Transaction} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import type Stripe from "stripe";
import {db} from "../config/firebase";
import * as params from "../config/params";
import {
  prismBillingAdmin,
  prismEntitlementsFrom,
  prismPeriodKey,
  stripeClient,
  stripeCustomerFor,
  type PrismPlanTier,
} from "./billing";
import {prismCaller} from "./posts";
import type {PrismVideoSpend} from "./types";

export const PRISM_VIDEO_CREDITS = "prism_video_credits";

/** 1 credit = 1 second of finished 1080p video. Monthly allowance, no rollover. */
export const PRISM_VIDEO_ALLOWANCE: Record<PrismPlanTier, number> = {
  free: 0,
  lifetime: 0,
  starter: 0,
  launch: 30,
  pro: 120,
  enterprise: 120,
};
/** One-time credits on Free: enough for one 10-second video. */
export const PRISM_FREE_VIDEO_CREDITS = 10;
/** Pack size → Stripe price lookup key. */
export const PRISM_VIDEO_PACKS: Record<number, string> = {
  60: "prism_video_credits_60",
  200: "prism_video_credits_200",
  600: "prism_video_credits_600",
};
const PURPOSE = "prism_video_credits";

export type PrismVideoBalance = {
  tier: PrismPlanTier;
  allowance: number;
  allowanceLeft: number;
  freeLeft: number;
  purchased: number;
  total: number;
};

/**
 * Non-negative integer from a Firestore field.
 * @param {unknown} raw Raw value.
 * @return {number} Count.
 */
function count(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

/**
 * Computes what a brand can spend now.
 * @param {Record<string, unknown>} agency Agency doc data.
 * @param {Record<string, unknown>} credits prism_video_credits doc data.
 * @return {PrismVideoBalance} Balance.
 */
export function videoBalanceFrom(agency: Record<string, unknown>, credits: Record<string, unknown>): PrismVideoBalance {
  const {tier} = prismEntitlementsFrom(agency);
  const allowance = PRISM_VIDEO_ALLOWANCE[tier];
  const used = credits.allowancePeriodKey === prismPeriodKey() ? count(credits.allowanceUsed) : 0;
  const allowanceLeft = Math.max(0, allowance - used);
  const freeLeft = tier === "free" ? Math.max(0, PRISM_FREE_VIDEO_CREDITS - count(credits.freeUsed)) : 0;
  const purchased = count(credits.purchased);
  return {tier, allowance, allowanceLeft, freeLeft, purchased, total: allowanceLeft + freeLeft + purchased};
}

/**
 * Takes credits inside a transaction: monthly allowance first, then Free credits, then purchased ones.
 * Throws resource-exhausted when the brand doesn't have enough.
 * @param {Transaction} tx Transaction (no writes may precede this call).
 * @param {string} agencyId Agency id.
 * @param {number} credits Credits needed.
 * @param {string} jobId Render job id, for the ledger.
 * @param {string} uid Who started the render.
 * @return {!Promise<PrismVideoSpend>} Where the credits came from.
 */
export async function spendVideoCredits(
  tx: Transaction,
  agencyId: string,
  credits: number,
  jobId: string,
  uid: string
): Promise<PrismVideoSpend> {
  const creditsRef = db.collection(PRISM_VIDEO_CREDITS).doc(agencyId);
  const [agencySnap, creditsSnap] = await Promise.all([
    tx.get(db.collection("agencies").doc(agencyId)),
    tx.get(creditsRef),
  ]);
  const data = creditsSnap.data() ?? {};
  const b = videoBalanceFrom(agencySnap.data() ?? {}, data);
  if (b.total < credits) {
    throw new HttpsError(
      "resource-exhausted",
      `That video needs ${credits} credits and you have ${b.total}. Buy a credit pack or pick a shorter length.`,
      {videoCredits: true, needed: credits, available: b.total}
    );
  }
  const periodKey = prismPeriodKey();
  const allowance = Math.min(credits, b.allowanceLeft);
  const free = Math.min(credits - allowance, b.freeLeft);
  const purchased = credits - allowance - free;
  const used = data.allowancePeriodKey === periodKey ? count(data.allowanceUsed) : 0;
  tx.set(creditsRef, {
    agencyId,
    allowancePeriodKey: periodKey,
    allowanceUsed: used + allowance,
    freeUsed: count(data.freeUsed) + free,
    purchased: b.purchased - purchased,
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
  const spend = {periodKey, allowance, free, purchased};
  tx.set(creditsRef.collection("ledger").doc(), {
    type: "render", credits: -credits, spend, jobId, uid, createdAt: FieldValue.serverTimestamp(),
  });
  return spend;
}

/**
 * Gives a failed render's credits back. Allowance credits only return within the same month.
 * @param {Transaction} tx Transaction (no writes may precede this call).
 * @param {string} agencyId Agency id.
 * @param {PrismVideoSpend} spend What the render took.
 * @param {string} jobId Render job id, for the ledger.
 * @return {!Promise<void>}
 */
export async function refundVideoCredits(
  tx: Transaction,
  agencyId: string,
  spend: PrismVideoSpend,
  jobId: string
): Promise<void> {
  const creditsRef = db.collection(PRISM_VIDEO_CREDITS).doc(agencyId);
  const data = (await tx.get(creditsRef)).data() ?? {};
  const allowance = data.allowancePeriodKey === spend.periodKey ? spend.allowance : 0;
  tx.set(creditsRef, {
    agencyId,
    allowanceUsed: Math.max(0, count(data.allowanceUsed) - allowance),
    freeUsed: Math.max(0, count(data.freeUsed) - spend.free),
    purchased: count(data.purchased) + spend.purchased,
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
  tx.set(creditsRef.collection("ledger").doc(), {
    type: "refund",
    credits: allowance + spend.free + spend.purchased,
    spend: {...spend, allowance},
    jobId,
    createdAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Active credit-pack prices from Stripe, smallest first.
 * @param {Stripe} stripe Stripe client.
 * @return {!Promise<!Array<object>>} Packs.
 */
async function packPrices(stripe: Stripe): Promise<Array<{credits: number; cents: number; priceId: string}>> {
  const {data} = await stripe.prices.list({lookup_keys: Object.values(PRISM_VIDEO_PACKS), active: true, limit: 10});
  return Object.entries(PRISM_VIDEO_PACKS)
    .map(([credits, key]) => {
      const p = data.find((x) => x.lookup_key === key);
      return p?.unit_amount ? {credits: Number(credits), cents: p.unit_amount, priceId: p.id} : null;
    })
    .filter((p): p is {credits: number; cents: number; priceId: string} => p !== null);
}

/** The brand's video credits and the packs it can buy. */
export const getPrismVideoCredits = onCall(async (request) => {
  const c = await prismCaller(request.auth?.uid);
  const [agencySnap, creditsSnap] = await Promise.all([
    db.collection("agencies").doc(c.agencyId).get(),
    db.collection(PRISM_VIDEO_CREDITS).doc(c.agencyId).get(),
  ]);
  const balance = videoBalanceFrom(agencySnap.data() ?? {}, creditsSnap.data() ?? {});
  const packs = await packPrices(stripeClient()).catch((e) => {
    logger.warn("[Prism video] Could not load credit packs", {e: String(e)});
    return [];
  });
  return {
    ...balance,
    packs: packs.map(({credits, cents}) => ({credits, cents})),
    canBuy: c.role === "agency_owner" || c.role === "agency_admin",
  };
});

/** Stripe Checkout for a one-time video credit pack. Bought credits never expire. */
export const createPrismVideoCreditCheckout = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to buy video credits.");
  const credits = Number(request.data?.credits);
  if (!PRISM_VIDEO_PACKS[credits]) throw new HttpsError("invalid-argument", "Pick a credit pack.");
  const {agencyId, user} = await prismBillingAdmin(request.auth.uid);
  const stripe = stripeClient();
  const pack = (await packPrices(stripe)).find((p) => p.credits === credits);
  if (!pack) throw new HttpsError("failed-precondition", "Video credit packs aren't configured yet.");
  const customer = await stripeCustomerFor(stripe, request.auth.uid, user);
  const returnTo = typeof request.data?.returnPath === "string" && request.data.returnPath.startsWith("/prism") ?
    request.data.returnPath.slice(0, 200) : "/prism";
  const sep = returnTo.includes("?") ? "&" : "?";
  const metadata = {purpose: PURPOSE, agencyId, credits: String(credits), firebaseUID: request.auth.uid};
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer,
    line_items: [{price: pack.priceId, quantity: 1}],
    success_url: `${params.APP_URL.value()}${returnTo}${sep}video_credits=success`,
    cancel_url: `${params.APP_URL.value()}${returnTo}`,
    metadata,
    payment_intent_data: {metadata, description: `Prism video credits: ${credits}`},
  });
  return {url: session.url};
});

/**
 * Grants a paid credit pack once per Checkout Session.
 * @param {Stripe.Event} event Verified Stripe event.
 * @return {!Promise<boolean>} True when the event was a video credit purchase.
 */
export async function handlePrismVideoCreditsEvent(event: Stripe.Event): Promise<boolean> {
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return false;
  }
  const s = event.data.object as Stripe.Checkout.Session;
  if (s.mode !== "payment" || s.metadata?.purpose !== PURPOSE) return false;
  if (s.payment_status !== "paid") return true;
  const agencyId = String(s.metadata.agencyId ?? "");
  const credits = Number(s.metadata.credits);
  if (!agencyId || !PRISM_VIDEO_PACKS[credits]) {
    logger.error("[Prism video] Credit purchase without a brand or pack", {sessionId: s.id});
    return true;
  }
  const creditsRef = db.collection(PRISM_VIDEO_CREDITS).doc(agencyId);
  const grantRef = creditsRef.collection("ledger").doc(`purchase_${s.id}`);
  const granted = await db.runTransaction(async (tx) => {
    if ((await tx.get(grantRef)).exists) return false;
    tx.set(creditsRef, {
      agencyId, purchased: FieldValue.increment(credits), updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    tx.set(grantRef, {
      type: "purchase",
      credits,
      sessionId: s.id,
      paymentIntentId: typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null,
      amountCents: s.amount_total ?? null,
      uid: s.metadata?.firebaseUID ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  logger.info("[Prism video] Credit pack", {agencyId, credits, sessionId: s.id, granted});
  return true;
}
