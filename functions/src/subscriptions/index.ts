
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";
import type {UserProfileFirestoreData, SubscriptionPlanId} from "./../types";
import * as params from "../config/params";
import {sendSubscriptionReceiptEmail} from "../notifications";

/**
 * Helper function to map a Stripe Price ID to our internal plan details.
 * This function takes a Stripe Price ID and returns an object containing
 * the corresponding internal plan ID and the associated talent limit.
 * If the provided `priceId` does not match any known plan, it returns an
 * object with `planId` as `null` and `talentLimit` as `0`.
 * @param {string} priceId The Stripe Price ID received from a Stripe event or API call.
 * @return {{planId: (SubscriptionPlanId | null), talentLimit: number}} An object with 'planId'
 * (the internal identifier, or `null` if not found)
 * and 'talentLimit' (the number of talents allowed for that plan).
 */
function getPlanDetailsFromPriceId(priceId: string): { planId: SubscriptionPlanId | null; talentLimit: number } {
  const priceIdMap: { [key: string]: { planId: SubscriptionPlanId; talentLimit: number } } = {
    [params.STRIPE_INDIVIDUAL_PRO_PRICE_ID.value() || ""]: {planId: "individual_monthly", talentLimit: 3},
    [params.STRIPE_INDIVIDUAL_PRO_YEARLY_PRICE_ID.value() || ""]: {planId: "individual_yearly", talentLimit: 3},

    [params.STRIPE_AGENCY_PILOT_MONTHLY_PRICE_ID.value() || ""]: {planId: "agency_pilot_monthly", talentLimit: 9},
    [params.STRIPE_AGENCY_PILOT_YEARLY_PRICE_ID.value() || ""]: {planId: "agency_pilot_yearly", talentLimit: 9},

    [params.STRIPE_AGENCY_PRO_MONTHLY_PRICE_ID.value() || ""]: {planId: "agency_pro_monthly", talentLimit: 24},
    [params.STRIPE_AGENCY_PRO_YEARLY_PRICE_ID.value() || ""]: {planId: "agency_pro_yearly", talentLimit: 24},

    [params.STRIPE_AGENCY_NETWORK_MONTHLY_PRICE_ID.value() || ""]: {planId: "agency_network_monthly", talentLimit: 124},
    [params.STRIPE_AGENCY_NETWORK_YEARLY_PRICE_ID.value() || ""]: {planId: "agency_network_yearly", talentLimit: 124},

    [params.STRIPE_AGENCY_ENTERPRISE_MONTHLY_PRICE_ID.value() || ""]: {planId: "agency_enterprise_monthly", talentLimit: 500},
    [params.STRIPE_AGENCY_ENTERPRISE_YEARLY_PRICE_ID.value() || ""]: {planId: "agency_enterprise_yearly", talentLimit: 500},
  };

  return priceIdMap[priceId] || {planId: null, talentLimit: 3};
}

/**
 * Helper to derive talent limit from SubscriptionPlanId if Price ID lookup fails.
 * @param {string} planId The internal plan identifier string.
 * @return {number} The number of talents allowed for that plan.
 */
function getTalentLimitFromPlanId(planId: string): number {
  if (planId.includes("enterprise")) return 500;
  if (planId.includes("network")) return 124;
  if (planId.includes("pro")) return 24;
  if (planId.includes("pilot")) return 9;
  return 3;
}


// Create subscription checkout session
export const createStripeSubscriptionCheckoutSession = onCall(async (request) => {
  let stripe: Stripe;
  try {
    const stripeKey = params.STRIPE_SECRET_KEY.value();
    stripe = new Stripe(stripeKey, {apiVersion: "2025-05-28.basil"});
  } catch (e) {
    logger.error("Stripe not configured", e);
    throw new HttpsError("failed-precondition", "Stripe is not configured.");
  }
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const userId = request.auth.uid;
  const planId = request.data?.planId as SubscriptionPlanId;
  logger.info(`Creating checkout session for user ${userId} with planId: ${planId}`);


  const userDoc = await db.collection("users").doc(userId).get();
  const userData = userDoc.data();

  if (!userData) {
    throw new HttpsError("not-found", "User found");
  }

  try {
    // Get or create Stripe customer
    let stripeCustomerId = userData.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: userData.email,
        name: userData.displayName,
        metadata: {
          firebaseUID: userId,
        },
      });
      stripeCustomerId = customer.id;
      await userDoc.ref.update({stripeCustomerId});
    }

    let priceId;
    switch (planId) {
    case "individual_monthly":
      priceId = params.STRIPE_INDIVIDUAL_PRO_PRICE_ID.value();
      break;
    case "individual_yearly":
      priceId = params.STRIPE_INDIVIDUAL_PRO_YEARLY_PRICE_ID.value();
      break;
    case "agency_pilot_monthly":
      priceId = params.STRIPE_AGENCY_PILOT_MONTHLY_PRICE_ID.value();
      break;
    case "agency_pilot_yearly":
      priceId = params.STRIPE_AGENCY_PILOT_YEARLY_PRICE_ID.value();
      break;
    case "agency_pro_monthly":
      priceId = params.STRIPE_AGENCY_PRO_MONTHLY_PRICE_ID.value();
      break;
    case "agency_pro_yearly":
      priceId = params.STRIPE_AGENCY_PRO_YEARLY_PRICE_ID.value();
      break;
    case "agency_network_monthly":
      priceId = params.STRIPE_AGENCY_NETWORK_MONTHLY_PRICE_ID.value();
      break;
    case "agency_network_yearly":
      priceId = params.STRIPE_AGENCY_NETWORK_YEARLY_PRICE_ID.value();
      break;
    case "agency_enterprise_monthly":
      priceId = params.STRIPE_AGENCY_ENTERPRISE_MONTHLY_PRICE_ID.value();
      break;
    case "agency_enterprise_yearly":
      priceId = params.STRIPE_AGENCY_ENTERPRISE_YEARLY_PRICE_ID.value();
      break;
    default:
      throw new HttpsError("invalid-argument", `Invalid or disallowed planId: ${planId}`);
    }

    if (!priceId) {
      logger.error(`Stripe Price ID for plan ${planId} is not set in environment variables.`);
      throw new HttpsError("failed-precondition", "The selected pricing option is not available at this moment.");
    }


    // Prepare subscription data
    const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
      metadata: {
        firebaseUID: userId,
        planId: planId, // Store planId for webhook
      },
    };

    // Add trial period if user is not currently subscribed and has no subscription history
    // EXCEPTION: Agency plans do not get a free trial to ensure talent limits are activated immediately.
    const hasActiveSubscription = userData.stripeSubscriptionId && userData.subscriptionStatus === "active";
    const isAgencyPlan = planId.startsWith("agency_");

    if (!hasActiveSubscription && !isAgencyPlan) {
      subscriptionData.trial_period_days = 7;
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      success_url: `${params.APP_URL.value()}/dashboard?subscription_success=true`,
      cancel_url: `${params.APP_URL.value()}/settings`,
      subscription_data: subscriptionData,
      metadata: { // Top-level metadata for session itself
        firebaseUID: userId,
        planId: planId,
      },
      allow_promotion_codes: true,
    });

    return {sessionId: session.id, url: session.url};
  } catch (error) {
    logger.error("Error creating subscription checkout session:", error);
    throw new HttpsError("internal", "Failed to create subscription checkout session");
  }
});

// Create customer portal session
export const createStripeCustomerPortalSession = onCall(async (request) => {
  let stripe: Stripe;
  try {
    const stripeKey = params.STRIPE_SECRET_KEY.value();
    stripe = new Stripe(stripeKey, {apiVersion: "2025-05-28.basil"});
  } catch (e) {
    logger.error("Stripe not configured", e);
    throw new HttpsError("failed-precondition", "Stripe is not configured.");
  }

  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const userId = request.auth.uid;
  const userDoc = await db.collection("users").doc(userId).get();
  const userData = userDoc.data();

  if (!userData?.stripeCustomerId) {
    throw new HttpsError("failed-precondition", "No active subscription found");
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: userData.stripeCustomerId,
      return_url: `${params.APP_URL.value()}/settings`, // Return to settings page
    });

    return {url: session.url};
  } catch (error) {
    logger.error("Error creating customer portal session:", error);
    throw new Error("Failed to create customer portal session");
  }
});

// Handle Stripe webhooks
export const stripeSubscriptionWebhookHandler = onRequest(async (request, response) => {
  let stripe: Stripe;
  try {
    const stripeKey = params.STRIPE_SECRET_KEY.value();
    stripe = new Stripe(stripeKey, {apiVersion: "2025-05-28.basil"});
  } catch (e) {
    logger.error("Stripe not configured", e);
    response.status(500).send("Webhook Error: Stripe service not configured.");
    return;
  }
  // Set CORS headers
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type, Stripe-Signature");

  // Handle preflight requests
  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  const sig = request.headers["stripe-signature"];
  const webhookSecret = params.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET.value();

  if (!sig || !webhookSecret) {
    logger.error("Missing stripe signature or webhook secret");
    response.status(400).send("Missing stripe signature or webhook secret");
    return;
  }

  let event: Stripe.Event;

  try {
    // Get the raw request body as a string
    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new Error("No raw body found in request");
    }

    // Verify the event using the raw body and signature
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      webhookSecret
    );
  } catch (err) {
    logger.error("Webhook signature verification failed:", err);
    response.status(400).send(`Webhook Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    return;
  }

  try {
    // Get Firebase UID from event metadata
    let firebaseUID: string | undefined;
    // Use type narrowing to access metadata or customer property safely
    if ("metadata" in event.data.object && (event.data.object as any).metadata?.firebaseUID) {
      firebaseUID = (event.data.object as any).metadata.firebaseUID;
    } else if ("customer" in event.data.object && typeof (event.data.object as any).customer === "string") {
      const customer = await stripe.customers.retrieve((event.data.object as any).customer);
      if (!customer.deleted && "metadata" in customer) {
        firebaseUID = (customer.metadata as any).firebaseUID;
      }
    }
    if (!firebaseUID) {
      logger.error("No Firebase UID found in event metadata for event:", event.id, event.type);
      response.json({received: true}); // Acknowledge event even if no UID
      return;
    }

    const userDocRef = db.collection("users").doc(firebaseUID);
    logger.info(`Processing webhook event ${event.type} for user ${firebaseUID}`);

    // Handle different event types
    switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session &
      { metadata?: { firebaseUID?: string, planId?: string }};
      if (session.mode === "subscription" && session.subscription) {
        const subscriptionResponse = await stripe.subscriptions.retrieve(session.subscription as string);
        const subscription = subscriptionResponse as unknown as Stripe.Subscription & {
          current_period_end: number;
          trial_end?: number | null;
        };

        let firestoreSubscriptionEndsAt: admin.firestore.Timestamp | null = null;
        if (typeof subscription.current_period_end === "number") {
          firestoreSubscriptionEndsAt = admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000);
        }

        let firestoreTrialEndsAt: admin.firestore.Timestamp | null = null;
        if (typeof subscription.trial_end === "number") {
          firestoreTrialEndsAt = admin.firestore.Timestamp.fromMillis(subscription.trial_end * 1000);
        }

        const planIdFromMeta = session.metadata?.planId as SubscriptionPlanId;
        const priceId = subscription.items.data[0]?.price.id;
        const {talentLimit: limitFromPrice} = getPlanDetailsFromPriceId(priceId);

        // Fallback to deriving from planId if price mapping failed
        const talentLimit = limitFromPrice || getTalentLimitFromPlanId(planIdFromMeta);
        const interval = subscription.items.data[0]?.price?.recurring?.interval ||
        (planIdFromMeta?.endsWith("yearly") ? "year" : "month");

        await userDocRef.update({
          stripeSubscriptionId: subscription.id,
          stripeCustomerId: session.customer,
          subscriptionStatus: subscription.status,
          subscriptionInterval: interval,
          subscriptionPlanId: planIdFromMeta,
          talentLimit,
          subscriptionEndsAt: firestoreSubscriptionEndsAt,
          trialEndsAt: firestoreTrialEndsAt,
        });
        logger.info("Updated user subscription from checkout.session.completed:",
          {userId: firebaseUID, subId: subscription.id, status: subscription.status, interval: interval, planId: planIdFromMeta});

        // Send new subscription receipt
        const userSnap = await userDocRef.get();
        const userData = userSnap.data() as UserProfileFirestoreData;
        if (userData?.email) {
          await sendSubscriptionReceiptEmail(userData.email, userData.displayName || "there", {
            planId: planIdFromMeta,
            interval,
            amountPaid: session.amount_total || 0,
            nextBillingDate: subscription.current_period_end,
            transactionId: subscription.id,
            type: "new",
          });
        }
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription & {
        current_period_end: number;
        trial_end?: number | null;
        metadata?: { planId?: string };
      };

      let firestoreSubscriptionEndsAt: admin.firestore.Timestamp | null = null;
      if (typeof subscription.current_period_end === "number") {
        firestoreSubscriptionEndsAt = admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000);
      }

      let firestoreTrialEndsAt: admin.firestore.Timestamp | null = null;
      if (typeof subscription.trial_end === "number") {
        firestoreTrialEndsAt = admin.firestore.Timestamp.fromMillis(subscription.trial_end * 1000);
      }

      const priceId = subscription.items.data[0]?.price.id;
      const {planId: planFromPrice, talentLimit: limitFromPrice} = getPlanDetailsFromPriceId(priceId);

      const planId = planFromPrice || subscription.metadata?.planId;
      const talentLimit = limitFromPrice || (planId ? getTalentLimitFromPlanId(planId) : 3);
      const interval = subscription.items.data[0]?.price?.recurring?.interval || (planId?.endsWith("yearly") ? "year" : "month");

      const updates: Partial<UserProfileFirestoreData> = {
        stripeSubscriptionId: subscription.id,
        subscriptionStatus: subscription.status as any,
        subscriptionInterval: interval as any,
        subscriptionEndsAt: firestoreSubscriptionEndsAt as any,
        trialEndsAt: firestoreTrialEndsAt as any,
        talentLimit: talentLimit,
      };

      if (planId) {
        updates.subscriptionPlanId = planId as SubscriptionPlanId;
      }

      await userDocRef.update(updates);

      logger.info(`Updated user subscription from ${event.type}:`,
        {userId: firebaseUID, subId: subscription.id, status: subscription.status,
          interval: interval, planId: planId || `(derived from price ${priceId})`});
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription & {
        current_period_end: number;
        ended_at?: number | null;
        canceled_at?: number | null;
      };

      let firestoreSubscriptionEndsAt: admin.firestore.Timestamp | null = null;
      const endTimestamp = subscription.ended_at || subscription.canceled_at || subscription.current_period_end;

      if (typeof endTimestamp === "number") {
        firestoreSubscriptionEndsAt = admin.firestore.Timestamp.fromMillis(endTimestamp * 1000);
      }

      await userDocRef.update({
        subscriptionStatus: "canceled",
        subscriptionEndsAt: firestoreSubscriptionEndsAt as any,
        talentLimit: 3, // Reset down to free tier talent limit on cancellation
      });
      logger.info("Updated user subscription from customer.subscription.deleted:",
        {userId: firebaseUID, subId: subscription.id, status: "canceled"});
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice & {subscription?: string};
      if (invoice.billing_reason === "subscription_cycle" && invoice.subscription) {
        const subscriptionResponse = await stripe.subscriptions.retrieve(invoice.subscription);
        const subscription = subscriptionResponse as unknown as Stripe.Subscription & {
          current_period_end: number;
        };

        let firestoreSubscriptionEndsAt: admin.firestore.Timestamp | null = null;
        if (typeof subscription.current_period_end === "number") {
          firestoreSubscriptionEndsAt = admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000);
        }

        const interval = subscription.items.data[0]?.price?.recurring?.interval || "month";
        const priceId = subscription.items.data[0]?.price.id;
        const {planId: renewedPlanId} = getPlanDetailsFromPriceId(priceId);

        await userDocRef.update({
          subscriptionStatus: "active",
          subscriptionInterval: interval as any,
          subscriptionEndsAt: firestoreSubscriptionEndsAt as any,
        });
        logger.info("Updated user subscription from invoice.payment_succeeded:",
          {userId: firebaseUID, subId: subscription.id, status: "active", interval: interval});

        // Send renewal receipt
        const userSnap = await userDocRef.get();
        const userData = userSnap.data() as UserProfileFirestoreData;
        if (userData?.email) {
          await sendSubscriptionReceiptEmail(userData.email, userData.displayName || "there", {
            planId: renewedPlanId || userData.subscriptionPlanId,
            interval,
            amountPaid: invoice.amount_paid,
            nextBillingDate: subscription.current_period_end,
            transactionId: invoice.id || subscription.id,
            type: "renewal",
          });
        }
      }
      break;
    }

    case "invoice.payment_failed": {
      await userDocRef.update({
        subscriptionStatus: "past_due",
      });
      logger.info("Updated user subscription from invoice.payment_failed:", {userId: firebaseUID, status: "past_due"});
      break;
    }
    }

    response.json({received: true});
  } catch (error) {
    logger.error("Error processing webhook:", error);
    response.status(500).json({
      error: "Failed to process webhook",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});
