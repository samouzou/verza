
import {onCall, onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";
import type {UserProfileFirestoreData} from "../../../src/types";

// Define PlanId type matching the frontend for consistency
type PlanId =
"individual_monthly" | "individual_yearly" | "agency_start_monthly" | "agency_start_yearly"
| "agency_pro_monthly" | "agency_pro_yearly";


// Initialize Stripe
let stripe: Stripe;
try {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    logger.warn("STRIPE_SECRET_KEY is not set - using mock Stripe instance for development");
    // Create a mock Stripe instance for development
    stripe = {
      customers: {
        create: async () => ({id: "mock_customer_id"}),
        retrieve: async () => ({id: "mock_customer_id", metadata: {firebaseUID: "mock_uid"}}),
      },
      checkout: {
        sessions: {
          create: async () => ({id: "mock_session_id"}),
        },
      },
      billingPortal: {
        sessions: {
          create: async () => ({url: "https://mock-portal-url"}),
        },
      },
      webhooks: {
        constructEvent: () => ({type: "mock_event", data: {object: {}}}),
      },
      subscriptions: {
        retrieve: async () => ({
          id: "mock_subscription_id",
          status: "active",
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days from now
          items: {data: [{price: {recurring: {interval: "month"}}}]}, // Mock interval
        }),
      },
    } as unknown as Stripe;
  } else {
    stripe = new Stripe(stripeKey, {
      apiVersion: "2025-05-28.basil",
    });
  }
} catch (error) {
  logger.error("Error initializing Stripe:", error);
  throw error;
}

/**
 * Helper function to map a Stripe Price ID to our internal plan details.
 *
 * This function takes a Stripe Price ID and returns an object containing
 * the corresponding internal plan ID and the associated talent limit.
 *
 * If the provided `priceId` does not match any known plan, it returns an
 * object with `planId` as `null` and `talentLimit` as `0`.
 *
 * @param {string} priceId The Stripe Price ID received from a Stripe event or API call.
 * @return {{planId: (PlanId | null), talentLimit: number}} An object with 'planId'
 * (the internal identifier, or `null` if not found)
 * and 'talentLimit' (the number of talents allowed for that plan).
 */
function getPlanDetailsFromPriceId(priceId: string): { planId: PlanId | null; talentLimit: number } {
  const priceIdMap: { [key: string]: { planId: PlanId; talentLimit: number } } = {
    [process.env.STRIPE_INDIVIDUAL_PRO_PRICE_ID || ""]: {planId: "individual_monthly", talentLimit: 0},
    [process.env.STRIPE_INDIVIDUAL_PRO_YEARLY_PRICE_ID || ""]: {planId: "individual_yearly", talentLimit: 0},
    [process.env.STRIPE_AGENCY_START_PRICE_ID || ""]: {planId: "agency_start_monthly", talentLimit: 10},
    [process.env.STRIPE_AGENCY_START_YEARLY_PRICE_ID || ""]: {planId: "agency_start_yearly", talentLimit: 10},
    [process.env.STRIPE_AGENCY_PRO_PRICE_ID || ""]: {planId: "agency_pro_monthly", talentLimit: 25},
    [process.env.STRIPE_AGENCY_PRO_YEARLY_PRICE_ID || ""]: {planId: "agency_pro_yearly", talentLimit: 25},
  };

  return priceIdMap[priceId] || {planId: null, talentLimit: 0};
}


// Create subscription checkout session
export const createStripeSubscriptionCheckoutSession = onCall(async (request) => {
  if (!request.auth) {
    throw new Error("The function must be called while authenticated.");
  }

  const userId = request.auth.uid;
  const planId = request.data?.planId;
  logger.info(`Creating checkout session for user ${userId} with planId: ${planId}`);


  const userDoc = await db.collection("users").doc(userId).get();
  const userData = userDoc.data();

  if (!userData) {
    throw new Error("User not found");
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
      priceId = process.env.STRIPE_INDIVIDUAL_PRO_PRICE_ID;
      break;
    case "individual_yearly":
      priceId = process.env.STRIPE_INDIVIDUAL_PRO_YEARLY_PRICE_ID;
      break;
    case "agency_start_monthly":
      priceId = process.env.STRIPE_AGENCY_START_PRICE_ID;
      break;
    case "agency_start_yearly":
      priceId = process.env.STRIPE_AGENCY_START_YEARLY_PRICE_ID;
      break;
    case "agency_pro_monthly":
      priceId = process.env.STRIPE_AGENCY_PRO_PRICE_ID;
      break;
    case "agency_pro_yearly":
      priceId = process.env.STRIPE_AGENCY_PRO_YEARLY_PRICE_ID;
      break;
    default:
      throw new Error(`Invalid or disallowed planId: ${planId}`);
    }

    if (!priceId) {
      logger.error(`Stripe Price ID for plan ${planId} is not set in environment variables.`);
      throw new Error("The selected pricing option is not available at this moment.");
    }


    // Prepare subscription data
    const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
      metadata: {
        firebaseUID: userId,
        planId: planId, // Store planId for webhook
      },
    };

    // Add trial period if user is not currently subscribed and has no subscription history
    const hasActiveSubscription = userData.stripeSubscriptionId && userData.subscriptionStatus === "active";
    if (!hasActiveSubscription) {
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
      success_url: `${process.env.APP_URL}/dashboard?subscription_success=true`,
      cancel_url: `${process.env.APP_URL}/settings`, // Changed cancel URL to settings page
      subscription_data: subscriptionData,
      metadata: { // Top-level metadata for session itself
        firebaseUID: userId,
        planId: planId,
      },
      allow_promotion_codes: true,
    });

    return {sessionId: session.id};
  } catch (error) {
    logger.error("Error creating subscription checkout session:", error);
    throw new Error("Failed to create subscription checkout session");
  }
});

// Create customer portal session
export const createStripeCustomerPortalSession = onCall(async (request) => {
  if (!request.auth) {
    throw new Error("The function must be called while authenticated.");
  }

  const userId = request.auth.uid;
  const userDoc = await db.collection("users").doc(userId).get();
  const userData = userDoc.data();

  if (!userData?.stripeCustomerId) {
    throw new Error("No active subscription found");
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: userData.stripeCustomerId,
      return_url: `${process.env.APP_URL}/settings`, // Return to settings page
    });

    return {url: session.url};
  } catch (error) {
    logger.error("Error creating customer portal session:", error);
    throw new Error("Failed to create customer portal session");
  }
});

// Handle Stripe webhooks
export const stripeSubscriptionWebhookHandler = onRequest(async (request, response) => {
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
  const webhookSecret = process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET;

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
    if ("metadata" in event.data.object && event.data.object.metadata?.firebaseUID) {
      firebaseUID = event.data.object.metadata.firebaseUID;
    } else if ("customer" in event.data.object && typeof event.data.object.customer === "string") {
      const customer = await stripe.customers.retrieve(event.data.object.customer);
      if (!customer.deleted && "metadata" in customer) {
        firebaseUID = customer.metadata.firebaseUID;
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

        const planId = session.metadata?.planId as PlanId;
        const interval = subscription.items.data[0]?.price?.recurring?.interval || "month";
        const {talentLimit} = getPlanDetailsFromPriceId(subscription.items.data[0]?.price.id);

        await userDocRef.update({
          stripeSubscriptionId: subscription.id,
          stripeCustomerId: session.customer,
          subscriptionStatus: subscription.status,
          subscriptionInterval: interval,
          subscriptionPlanId: planId,
          talentLimit,
          subscriptionEndsAt: firestoreSubscriptionEndsAt,
          trialEndsAt: firestoreTrialEndsAt,
        });
        logger.info("Updated user subscription from checkout.session.completed:",
          {userId: firebaseUID, subId: subscription.id, status: subscription.status, interval: interval, planId});
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription & {
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

      const priceId = subscription.items.data[0]?.price.id;
      const {planId, talentLimit} = getPlanDetailsFromPriceId(priceId);
      const interval = subscription.items.data[0]?.price?.recurring?.interval || "month";

      const updates: Partial<UserProfileFirestoreData> = {
        stripeSubscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
        subscriptionInterval: interval,
        subscriptionEndsAt: firestoreSubscriptionEndsAt as any, // Use `as any` to bypass TS conflict
        trialEndsAt: firestoreTrialEndsAt as any, // Use `as any` to bypass TS conflict
        talentLimit: talentLimit,
      };

      if (planId) {
        updates.subscriptionPlanId = planId;
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
        talentLimit: 0, // Reset talent limit on cancellation
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

        await userDocRef.update({
          subscriptionStatus: "active",
          subscriptionInterval: interval,
          subscriptionEndsAt: firestoreSubscriptionEndsAt as any,
        });
        logger.info("Updated user subscription from invoice.payment_succeeded:",
          {userId: firebaseUID, subId: subscription.id, status: "active", interval: interval});
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
