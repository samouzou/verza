import type Stripe from "stripe";
import {db} from "../config/firebase";

export const PRISM_REFERRAL_CODES = "prism_referral_codes";
export const PRISM_REFERRALS = "prism_referrals";
/** Friend's discount on monthly plans; a "once" coupon on a yearly price would discount the whole year. */
export const PRISM_REFERRAL_COUPON = "prism_referral_half_first_month";
export const PRISM_REFERRAL_PERCENT_OFF = 50;

const CODE = /^[A-Z0-9-]{4,24}$/;

/**
 * Normalizes a referral code from a link.
 * @param {unknown} raw Code from the client.
 * @return {?string} Upper-case code, or null when malformed.
 */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

/**
 * The brand that owns a referral code, unless the code is the caller's own brand, user or Stripe customer.
 * @param {Stripe} stripe Stripe client.
 * @param {unknown} raw Code from the link.
 * @param {object} referee Brand, user and Stripe customer checking out.
 * @return {!Promise<?object>} Referrer brand and code.
 */
export async function resolveReferrer(
  stripe: Stripe,
  raw: unknown,
  referee: {agencyId: string; uid: string; customer: string}
): Promise<{referrerAgencyId: string; code: string} | null> {
  const code = normalizeReferralCode(raw);
  if (!code) return null;
  const owner = (await db.collection(PRISM_REFERRAL_CODES).doc(code).get()).data();
  const referrerAgencyId = String(owner?.agencyId ?? "");
  if (!referrerAgencyId || referrerAgencyId === referee.agencyId) return null;
  const referrer = (await db.collection("agencies").doc(referrerAgencyId).get()).data();
  if (!referrer || referrer.ownerId === referee.uid) return null;
  const subId = String(referrer.prismStripeSubscriptionId ?? "");
  if (subId) {
    const sub = await stripe.subscriptions.retrieve(subId).catch(() => null);
    const customer = typeof sub?.customer === "string" ? sub.customer : sub?.customer?.id;
    if (customer === referee.customer) return null;
  }
  return {referrerAgencyId, code};
}

/**
 * Id of the friend's coupon, creating it on first use.
 * @param {Stripe} stripe Stripe client.
 * @return {!Promise<string>} Coupon id.
 */
export async function referralCoupon(stripe: Stripe): Promise<string> {
  try {
    return (await stripe.coupons.retrieve(PRISM_REFERRAL_COUPON)).id;
  } catch (e) {
    if ((e as {code?: string}).code !== "resource_missing") throw e;
  }
  try {
    const coupon = await stripe.coupons.create({
      id: PRISM_REFERRAL_COUPON,
      name: `Prism referral: ${PRISM_REFERRAL_PERCENT_OFF}% off your first month`,
      percent_off: PRISM_REFERRAL_PERCENT_OFF,
      duration: "once",
      metadata: {productType: "prism", purpose: "referral"},
    });
    return coupon.id;
  } catch (e) {
    if ((e as {code?: string}).code !== "resource_already_exists") throw e;
    return PRISM_REFERRAL_COUPON;
  }
}
