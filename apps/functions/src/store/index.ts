import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import {FieldValue} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import * as params from "../config/params";
import type {StoreProduct, UserProfileFirestoreData} from "../types";
import {connectTransferMetadata, transferToConnectAccountIfNeeded} from "../payments/stripeConnect";

/** Verza take rate on creator Store sales (Stripe card fees deducted separately). */
export const STORE_PLATFORM_FEE_FRACTION = 0.1;

const MIN_PRICE_CENTS = 100; // $1
const MAX_PRICE_CENTS = 10_000_00; // $10,000

function getStripe(): Stripe {
  const stripeKey = params.STRIPE_SECRET_KEY.value();
  return new Stripe(stripeKey, {apiVersion: "2026-04-22.dahlia" as any});
}

function assertCreatorRole(role: string | undefined): void {
  if (role !== "individual_creator" && role !== "talent") {
    throw new HttpsError(
      "permission-denied",
      "Only creators can sell products in the Store."
    );
  }
}

function sanitizeProductInput(data: {
  title?: unknown;
  description?: unknown;
  priceCents?: unknown;
  accessUrl?: unknown;
  status?: unknown;
}): {
  title: string;
  description: string;
  priceCents: number;
  accessUrl: string;
  status: StoreProduct["status"];
} {
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const description =
    typeof data.description === "string" ? data.description.trim() : "";
  const accessUrl =
    typeof data.accessUrl === "string" ? data.accessUrl.trim() : "";
  const priceCents =
    typeof data.priceCents === "number"
      ? Math.round(data.priceCents)
      : Number.NaN;
  const status =
    data.status === "draft" ||
    data.status === "active" ||
    data.status === "archived"
      ? data.status
      : "draft";

  if (!title || title.length > 120) {
    throw new HttpsError(
      "invalid-argument",
      "Title is required (max 120 characters)."
    );
  }
  if (description.length > 2000) {
    throw new HttpsError(
      "invalid-argument",
      "Description must be under 2,000 characters."
    );
  }
  if (!Number.isFinite(priceCents) ||
    priceCents < MIN_PRICE_CENTS ||
    priceCents > MAX_PRICE_CENTS) {
    throw new HttpsError(
      "invalid-argument",
      "Price must be between $1 and $10,000."
    );
  }
  if (!accessUrl || accessUrl.length > 2000) {
    throw new HttpsError(
      "invalid-argument",
      "Access URL / delivery link is required."
    );
  }
  try {
    // Allow https URLs and simple mailto/discord-style deeplinks as plain text
    if (accessUrl.startsWith("http://") || accessUrl.startsWith("https://")) {
      // eslint-disable-next-line no-new
      new URL(accessUrl);
    }
  } catch {
    throw new HttpsError("invalid-argument", "Access URL is not a valid URL.");
  }

  return {title, description, priceCents, accessUrl, status};
}

/**
 * Create or update a Store product. Publishing (active) requires Connect payouts.
 */
export const upsertStoreProduct = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to manage your Store.");
  }

  const creatorId = request.auth.uid;
  const userSnap = await db.collection("users").doc(creatorId).get();
  const userData = userSnap.data() as UserProfileFirestoreData | undefined;
  if (!userData) {
    throw new HttpsError("not-found", "User profile not found.");
  }
  assertCreatorRole(userData.role);

  const {productId, ...raw} = request.data as {
    productId?: string;
  } & Record<string, unknown>;

  const fields = sanitizeProductInput(raw);

  if (fields.status === "active") {
    if (!userData.stripeAccountId || !userData.stripePayoutsEnabled) {
      throw new HttpsError(
        "failed-precondition",
        "Connect payouts must be enabled in Settings before publishing a product."
      );
    }
  }

  const now = FieldValue.serverTimestamp();

  if (productId && typeof productId === "string") {
    const ref = db.collection("storeProducts").doc(productId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Product not found.");
    }
    const existing = snap.data() as StoreProduct;
    if (existing.creatorId !== creatorId) {
      throw new HttpsError("permission-denied", "Not your product.");
    }
    await ref.update({
      title: fields.title,
      description: fields.description,
      priceCents: fields.priceCents,
      accessUrl: fields.accessUrl,
      status: fields.status,
      creatorDisplayName: userData.displayName || null,
      creatorAvatarUrl: userData.avatarUrl || null,
      updatedAt: now,
    });
    return {id: productId};
  }

  const ref = db.collection("storeProducts").doc();
  await ref.set({
    creatorId,
    creatorDisplayName: userData.displayName || null,
    creatorAvatarUrl: userData.avatarUrl || null,
    title: fields.title,
    description: fields.description,
    priceCents: fields.priceCents,
    currency: "usd",
    accessUrl: fields.accessUrl,
    status: fields.status,
    salesCount: 0,
    revenueCents: 0,
    createdAt: now,
    updatedAt: now,
  });
  return {id: ref.id};
});

/**
 * Public Checkout for a Store product. Buyer does not need a Verza account.
 */
export const createStoreCheckoutSession = onCall({
  enforceAppCheck: false,
  cors: true,
}, async (request) => {
  const productId =
    typeof request.data?.productId === "string" ? request.data.productId : "";
  const buyerEmail =
    typeof request.data?.buyerEmail === "string"
      ? request.data.buyerEmail.trim().toLowerCase()
      : "";

  if (!productId) {
    throw new HttpsError("invalid-argument", "productId is required.");
  }
  if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    throw new HttpsError("invalid-argument", "A valid buyer email is required.");
  }

  const productSnap = await db.collection("storeProducts").doc(productId).get();
  if (!productSnap.exists) {
    throw new HttpsError("not-found", "Product not found.");
  }
  const product = {id: productSnap.id, ...productSnap.data()} as StoreProduct;
  if (product.status !== "active") {
    throw new HttpsError("failed-precondition", "This product is not for sale.");
  }

  const creatorSnap = await db.collection("users").doc(product.creatorId).get();
  const creator = creatorSnap.data() as UserProfileFirestoreData | undefined;
  if (!creator?.stripeAccountId || !creator.stripePayoutsEnabled) {
    throw new HttpsError(
      "failed-precondition",
      "This creator cannot receive Store payments right now."
    );
  }

  const amountCents = product.priceCents;
  const platformFee = Math.round(amountCents * STORE_PLATFORM_FEE_FRACTION);
  const stripeFee = Math.round(amountCents * 0.029) + 30;
  const totalFee = platformFee + stripeFee;
  const creatorNet = Math.max(0, amountCents - totalFee);

  if (creatorNet <= 0) {
    throw new HttpsError(
      "failed-precondition",
      "Product price is too low to cover fees."
    );
  }

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (e) {
    logger.error("Stripe not configured", e);
    throw new HttpsError("failed-precondition", "Payments are not configured.");
  }

  const appUrl = params.APP_URL.value();
  const creatorName = creator.displayName || "Creator";

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: buyerEmail,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: product.currency || "usd",
            unit_amount: amountCents,
            product_data: {
              name: product.title,
              description:
                product.description?.slice(0, 400) ||
                `Purchase from ${creatorName} on Verza Store`,
            },
          },
        },
      ],
      success_url: `${appUrl}/s/${productId}?purchase=success`,
      cancel_url: `${appUrl}/s/${productId}?purchase=cancelled`,
      payment_intent_data: {
        metadata: {
          purchaseType: "storeSale",
          productId,
          creatorId: product.creatorId,
          buyerEmail,
          platformFeeCents: String(totalFee),
          creatorNetCents: String(creatorNet),
          ...connectTransferMetadata(creator.stripeAccountId, creatorNet),
        },
      },
      metadata: {
        purchaseType: "storeSale",
        productId,
        creatorId: product.creatorId,
        buyerEmail,
        platformFeeCents: String(totalFee),
        creatorNetCents: String(creatorNet),
        ...connectTransferMetadata(creator.stripeAccountId, creatorNet),
      },
    });

    if (!session.url) {
      throw new HttpsError("internal", "Checkout session missing URL.");
    }
    return {url: session.url};
  } catch (error: any) {
    logger.error("createStoreCheckoutSession failed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error?.message || "Could not start checkout."
    );
  }
});

/**
 * Fulfill a paid Store sale from Stripe payment_intent.succeeded metadata.
 * Idempotent on paymentIntentId.
 */
export async function fulfillStoreSale(
  stripe: Stripe,
  metadata: Stripe.Metadata | Record<string, string>,
  paymentIntentId: string,
  latestChargeId: string | undefined
): Promise<void> {
  const productId = metadata.productId;
  const creatorId = metadata.creatorId;
  const buyerEmail = metadata.buyerEmail;
  if (!productId || !creatorId || !buyerEmail) {
    logger.warn("storeSale metadata incomplete", {paymentIntentId, metadata});
    return;
  }

  const existing = await db
    .collection("storePurchases")
    .where("paymentIntentId", "==", paymentIntentId)
    .limit(1)
    .get();
  if (!existing.empty) {
    logger.info(`Store sale already fulfilled for ${paymentIntentId}`);
    return;
  }

  await transferToConnectAccountIfNeeded(stripe, metadata, latestChargeId);

  const productRef = db.collection("storeProducts").doc(productId);
  const productSnap = await productRef.get();
  if (!productSnap.exists) {
    logger.error(`Store product ${productId} missing after payment ${paymentIntentId}`);
    return;
  }
  const product = productSnap.data() as StoreProduct;

  const amountCents = product.priceCents;
  const platformFeeCents = parseInt(metadata.platformFeeCents || "0", 10) || 0;
  const creatorNetCents =
    parseInt(metadata.creatorNetCents || "0", 10) ||
    Math.max(0, amountCents - platformFeeCents);

  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(productRef);
    if (!fresh.exists) throw new Error("Product vanished during fulfill");
    tx.update(productRef, {
      salesCount: FieldValue.increment(1),
      revenueCents: FieldValue.increment(creatorNetCents),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const purchaseRef = db.collection("storePurchases").doc();
    tx.set(purchaseRef, {
      productId,
      productTitle: product.title,
      creatorId,
      buyerEmail,
      amountCents,
      platformFeeCents,
      creatorNetCents,
      paymentIntentId,
      accessUrl: product.accessUrl,
      status: "paid",
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info(
    `Store sale fulfilled: product=${productId} creator=${creatorId} pi=${paymentIntentId}`
  );

  // Best-effort delivery email
  try {
    const sendgridKey = params.SENDGRID_API_KEY.value();
    if (!sendgridKey) return;
    const sgMail = (await import("@sendgrid/mail")).default;
    sgMail.setApiKey(sendgridKey);
    const creatorSnap = await db.collection("users").doc(creatorId).get();
    const creatorName =
      (creatorSnap.data() as UserProfileFirestoreData | undefined)?.displayName ||
      "your creator";

    await sgMail.send({
      to: buyerEmail,
      from: {
        name: "Verza Store",
        email: params.SENDGRID_FROM_EMAIL.value() || "invoices@tryverza.com",
      },
      subject: `Your purchase: ${product.title}`,
      html: `
        <p>Thanks for buying <strong>${product.title}</strong> from ${creatorName}.</p>
        <p>Your access link:</p>
        <p><a href="${product.accessUrl}">${product.accessUrl}</a></p>
        <p style="color:#718096;font-size:12px;">Powered by Verza Store</p>
      `,
    });
  } catch (emailErr) {
    logger.warn("Store purchase delivery email failed", emailErr);
  }
}
