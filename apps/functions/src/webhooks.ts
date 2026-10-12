import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import {db} from "./config/firebase";
import {FieldValue, type DocumentReference, type DocumentSnapshot} from "firebase-admin/firestore";

const STRIPE_API_VERSION = "2026-04-22.dahlia" as any;
/** Server-only: the brand's Stripe signing secret and optional restricted key. */
const stripeSettingsRef = (agencyId: string) => db.collection("agencies").doc(agencyId).collection("private").doc("stripeConversions");

/**
 * Finds the brand's affiliate link for a promo code.
 * @param {string} agencyId Brand agency id.
 * @param {string} code Promo code as entered.
 * @return {!Promise<?DocumentSnapshot>} Link.
 */
async function linkForCode(agencyId: string, code: string): Promise<DocumentSnapshot | null> {
  const qs = await db.collection("affiliateLinks")
    .where("brandId", "==", agencyId)
    .where("promoCode", "==", code.trim().toUpperCase())
    .limit(1)
    .get();
  return qs.empty ? null : qs.docs[0]!;
}

/**
 * Finds an affiliate link by id (the `verza_ref` a tracking link passes on), only if it belongs to the brand.
 * @param {string} agencyId Brand agency id.
 * @param {string} ref Link id.
 * @return {!Promise<?DocumentSnapshot>} Link.
 */
async function linkForRef(agencyId: string, ref: string): Promise<DocumentSnapshot | null> {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(ref)) return null;
  const snap = await db.collection("affiliateLinks").doc(ref).get();
  return snap.exists && snap.get("brandId") === agencyId ? snap : null;
}

/**
 * Counts one conversion on a link and pays the campaign's per-conversion reward from the brand's wallet, pausing the
 * campaign when the wallet can't cover it. With `dedupe`, a conversion already recorded under that doc is skipped.
 * @param {object} o Inputs.
 * @param {DocumentReference} o.agencyRef Brand agency.
 * @param {DocumentSnapshot} o.link Affiliate link.
 * @param {string} o.label How the sale was matched, for the creator notification (e.g. a code).
 * @param {?DocumentReference} [o.dedupe] Ledger doc that makes the conversion count once.
 * @param {object} [o.record] Fields stored on the ledger doc.
 * @return {!Promise<{counted: boolean, reward: number}>} Whether it counted and the reward paid.
 */
async function awardConversion(o: {
  agencyRef: DocumentReference;
  link: DocumentSnapshot;
  label: string;
  dedupe?: DocumentReference | null;
  record?: Record<string, unknown>;
}): Promise<{counted: boolean; reward: number}> {
  const linkData = o.link.data() ?? {};
  const gigRef = db.collection("gigs").doc(String(linkData.gigId ?? "_"));
  let budgetExhausted = false;
  let reward = 0;
  const result = await db.runTransaction(async (tx) => {
    const [seen, gigSnap, agencySnap] = await Promise.all([
      o.dedupe ? tx.get(o.dedupe) : Promise.resolve(null),
      tx.get(gigRef),
      tx.get(o.agencyRef),
    ]);
    if (seen?.exists) return {counted: false, gig: gigSnap.data(), agency: agencySnap.data()};
    const rewardAmount = Number(gigSnap.data()?.affiliateSettings?.rewardAmount) || 0;
    tx.update(o.link.ref, {conversions: FieldValue.increment(1)});
    if (rewardAmount > 0) {
      if ((Number(agencySnap.data()?.availableBalance) || 0) >= rewardAmount) {
        tx.update(o.link.ref, {earnedRewards: FieldValue.increment(rewardAmount)});
        tx.update(o.agencyRef, {availableBalance: FieldValue.increment(-rewardAmount)});
        reward = rewardAmount;
      } else if (gigSnap.exists) {
        budgetExhausted = true;
        tx.update(gigRef, {status: "budget_exhausted"});
      }
    }
    if (o.dedupe) {
      tx.set(o.dedupe, {
        agencyId: o.agencyRef.id, linkId: o.link.id, gigId: linkData.gigId ?? null, creatorId: linkData.creatorId ?? null,
        reward, ...o.record, createdAt: FieldValue.serverTimestamp(),
      });
    }
    return {counted: true, gig: gigSnap.data(), agency: agencySnap.data()};
  });
  if (!result.counted) return {counted: false, reward: 0};

  if (budgetExhausted) {
    await db.collection("notifications").add({
      userId: result.agency?.ownerId,
      title: "Campaign Paused: Insufficient Funds",
      message: `Your campaign "${result.gig?.title}" tracking links have been paused due to insufficient wallet funds.`,
      type: "system",
      read: false,
      link: "/wallet",
      createdAt: FieldValue.serverTimestamp(),
    });
    logger.warn(`Agency ${o.agencyRef.id} exhausted budget on gig ${linkData.gigId} during conversion.`);
  } else if (reward > 0) {
    await db.collection("notifications").add({
      userId: linkData.creatorId,
      title: "Performance Bonus Earned!",
      message: `${o.label} generated a sale! You earned $${reward}.`,
      type: "system",
      read: false,
      link: `/campaigns/${linkData.gigId}`,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  return {counted: true, reward};
}

export const conversionWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const agencyId = req.query.agencyId as string;
  if (!agencyId) {
    res.status(400).send("Missing agencyId query parameter");
    return;
  }

  try {
    const agencyRef = db.collection("agencies").doc(agencyId);
    const agencySnap = await agencyRef.get();
    if (!agencySnap.exists) {
      res.status(404).send("Agency not found");
      return;
    }

    const payload = req.body;
    let matchingPromoCode = "";

    // Shopify sends discount_codes; WooCommerce sends coupon_lines.
    const codes = [
      ...(Array.isArray(payload?.discount_codes) ? payload.discount_codes : []),
      ...(Array.isArray(payload?.coupon_lines) ? payload.coupon_lines : []),
    ];
    for (const codeObj of codes) {
      if (codeObj?.code) {
        matchingPromoCode = String(codeObj.code).toUpperCase();
        break;
      }
    }

    if (!matchingPromoCode) {
      res.status(200).send({message: "No relevant tracking parameters found"});
      return;
    }

    const link = await linkForCode(agencyId, matchingPromoCode);
    if (!link) {
      res.status(200).send({message: "No matching affiliate link found"});
      return;
    }
    if (!link.get("gigId")) {
      res.status(404).send("Gig not found");
      return;
    }

    await awardConversion({agencyRef, link, label: `Your code ${matchingPromoCode}`});
    logger.info(`Processed conversion for agency ${agencyId}, code ${matchingPromoCode}`);
    res.status(200).send({message: "Conversion processed successfully"});
  } catch (error: any) {
    logger.error("Error processing conversion webhook:", error);
    res.status(500).send({error: "Internal Server Error"});
  }
});

/**
 * The creator reference and promo code on a Stripe event, plus who converted (one conversion per customer).
 * @param {Stripe.Event} event Verified event.
 * @param {?Stripe} brandStripe Client on the brand's restricted key, for resolving promotion codes.
 * @return {!Promise<?object>} Attribution, or null when the event isn't a conversion.
 */
async function stripeAttribution(event: Stripe.Event, brandStripe: Stripe | null): Promise<{
  ref: string; code: string; customerKey: string; kind: "purchase" | "signup"; amount: number; currency: string;
} | null> {
  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    if (s.status !== "complete" || (s.payment_status !== "paid" && s.payment_status !== "no_payment_required")) {
      return null;
    }
    let code = "";
    const promo = s.discounts?.find((d) => d.promotion_code)?.promotion_code;
    if (promo) {
      if (typeof promo !== "string") {
        code = promo.code;
      } else if (brandStripe) {
        code = await brandStripe.promotionCodes.retrieve(promo).then((p) => p.code).catch((e) => {
          logger.warn("[Stripe conversions] Could not read promotion code", {e: String(e)});
          return "";
        });
      }
    }
    const customer = typeof s.customer === "string" ? s.customer : s.customer?.id;
    return {
      ref: String(s.client_reference_id ?? s.metadata?.verza_ref ?? "").trim(),
      code,
      customerKey: customer || s.customer_details?.email?.toLowerCase() || s.id,
      kind: s.mode === "payment" ? "purchase" : "signup",
      amount: s.amount_total ?? 0,
      currency: s.currency ?? "",
    };
  }
  if (event.type === "customer.created") {
    const c = event.data.object as Stripe.Customer;
    const ref = String(c.metadata?.verza_ref ?? "").trim();
    if (!ref) return null;
    return {ref, code: "", customerKey: c.id, kind: "signup", amount: 0, currency: ""};
  }
  return null;
}

/**
 * Conversion webhook for brands that sell through Stripe. The brand adds this URL as a webhook endpoint in their own
 * Stripe account and saves its signing secret in Verza. A checkout (paid, free trial, or 100% off) or a new customer
 * counts once per customer when it carries a Verza link reference (client_reference_id or metadata.verza_ref) or a
 * creator's promotion code (resolved with the brand's optional read-only restricted key).
 */
export const stripeConversionWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }
  const agencyId = String(req.query.agencyId ?? "");
  const sig = req.headers["stripe-signature"];
  if (!agencyId || !sig || !req.rawBody) {
    res.status(400).send("Missing agencyId, signature or body");
    return;
  }
  const settings = (await stripeSettingsRef(agencyId).get()).data();
  const secret = typeof settings?.signingSecret === "string" ? settings.signingSecret : "";
  if (!secret) {
    res.status(400).send("Stripe isn't connected for this brand in Verza yet");
    return;
  }
  const restrictedKey = typeof settings?.restrictedKey === "string" ? settings.restrictedKey : "";
  const brandStripe = restrictedKey ? new Stripe(restrictedKey, {apiVersion: STRIPE_API_VERSION}) : null;

  let event: Stripe.Event;
  try {
    event = (brandStripe ?? new Stripe("sk_verify_only", {apiVersion: STRIPE_API_VERSION}))
      .webhooks.constructEvent(req.rawBody, sig, secret);
  } catch (e) {
    logger.warn("[Stripe conversions] Bad signature", {agencyId, e: String(e)});
    res.status(400).send("Invalid signature");
    return;
  }

  const agencyRef = db.collection("agencies").doc(agencyId);
  try {
    await agencyRef.update({"stripeConversions.lastEventAt": FieldValue.serverTimestamp()});
    const a = await stripeAttribution(event, brandStripe);
    if (!a || (!a.ref && !a.code)) {
      res.status(200).send({message: "No Verza attribution on this event"});
      return;
    }
    const link = (a.ref ? await linkForRef(agencyId, a.ref) : null) ?? (a.code ? await linkForCode(agencyId, a.code) : null);
    if (!link) {
      res.status(200).send({message: "No matching affiliate link found"});
      return;
    }
    const key = a.customerKey.replace(/[^A-Za-z0-9@._-]/g, "_").slice(0, 200);
    const {counted, reward} = await awardConversion({
      agencyRef,
      link,
      label: a.code ? `Your code ${a.code.toUpperCase()}` : "Your link",
      dedupe: db.collection("conversionEvents").doc(`stripe_${agencyId}_${key}`),
      record: {
        source: "stripe", kind: a.kind, eventId: event.id, eventType: event.type, livemode: event.livemode,
        amount: a.amount, currency: a.currency, matchedBy: link.id === a.ref ? "link" : "code",
      },
    });
    if (counted) {
      await agencyRef.update({"stripeConversions.lastConversionAt": FieldValue.serverTimestamp()});
    }
    logger.info("[Stripe conversions] Processed", {agencyId, eventId: event.id, linkId: link.id, counted, reward});
    res.status(200).send({message: counted ? "Conversion processed" : "Customer already converted"});
  } catch (e) {
    logger.error("[Stripe conversions] Failed", {agencyId, eventId: event.id, e: String(e)});
    res.status(500).send({error: "Internal Server Error"});
  }
});

/**
 * Saves (or clears) the brand's Stripe conversion settings: the webhook signing secret and an optional restricted key
 * with read access to promotion codes. Both are write-only from the app; the agency doc only shows what's connected.
 */
export const saveStripeConversionSettings = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const data = (request.data ?? {}) as {
    agencyId?: unknown; signingSecret?: unknown; restrictedKey?: unknown; disconnect?: unknown;
  };
  const user = (await db.collection("users").doc(uid).get()).data() ?? {};
  const agencyId = String(data.agencyId || user.primaryAgencyId || "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(agencyId)) throw new HttpsError("failed-precondition", "Pick a workspace first.");
  const agencyRef = db.collection("agencies").doc(agencyId);
  const agency = (await agencyRef.get()).data();
  const admin = agency?.ownerId === uid ||
    (user.primaryAgencyId === agencyId && (user.role === "agency_owner" || user.role === "agency_admin"));
  if (!agency || !admin) throw new HttpsError("permission-denied", "Only workspace owners and admins can connect Stripe.");

  const ref = stripeSettingsRef(agencyId);
  if (data.disconnect === true) {
    await ref.delete();
    await agencyRef.update({stripeConversions: FieldValue.delete()});
    return {connected: false, promoCodes: false};
  }

  const update: Record<string, unknown> = {updatedAt: FieldValue.serverTimestamp(), updatedBy: uid};
  if (typeof data.signingSecret === "string" && data.signingSecret.trim()) {
    const s = data.signingSecret.trim();
    if (!/^whsec_[A-Za-z0-9+/=]{16,}$/.test(s)) {
      throw new HttpsError("invalid-argument", "That isn't a Stripe signing secret. It starts with whsec_.");
    }
    update.signingSecret = s;
  }
  if (typeof data.restrictedKey === "string" && data.restrictedKey.trim()) {
    const k = data.restrictedKey.trim();
    if (/^sk_/.test(k)) {
      throw new HttpsError("invalid-argument", "Use a restricted key (rk_…) with read access to promotion codes, not a secret key.");
    }
    if (!/^rk_(live|test)_[A-Za-z0-9]{16,}$/.test(k)) {
      throw new HttpsError("invalid-argument", "That isn't a Stripe restricted key. It starts with rk_live_ or rk_test_.");
    }
    try {
      await new Stripe(k, {apiVersion: STRIPE_API_VERSION}).promotionCodes.list({limit: 1});
    } catch {
      throw new HttpsError("invalid-argument", "Stripe rejected that key. Give it Read access to Promotion Codes and try again.");
    }
    update.restrictedKey = k;
  }
  if (Object.keys(update).length === 2) throw new HttpsError("invalid-argument", "Paste a signing secret or a restricted key.");

  await ref.set(update, {merge: true});
  const saved = (await ref.get()).data() ?? {};
  const status = {connected: Boolean(saved.signingSecret), promoCodes: Boolean(saved.restrictedKey)};
  await agencyRef.update({
    "stripeConversions.connected": status.connected,
    "stripeConversions.promoCodes": status.promoCodes,
    "stripeConversions.updatedAt": FieldValue.serverTimestamp(),
  });
  return status;
});
