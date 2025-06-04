import {onCall, onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";

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


// Create subscription checkout session
export const createStripeSubscriptionCheckoutSession = onCall(async (request) => {
  if (!request.auth) {
    throw new Error("The function must be called while authenticated.");
  }

  const userId = request.auth.uid;
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

    // Prepare subscription data
    const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
      metadata: {
        firebaseUID: userId,
      },
    };

    // Handle trial period
    if (userData.trialEndsAt && userData.subscriptionStatus === "trialing") {
      const trialEnd = admin.firestore.Timestamp.fromDate(
        new Date(userData.trialEndsAt.seconds * 1000)
      );
      subscriptionData.trial_end = trialEnd.seconds;
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1,
      }],
      success_url: `${process.env.APP_URL}/dashboard?subscription_success=true`,
      cancel_url: `${process.env.APP_URL}/subscribe`,
      subscription_data: subscriptionData,
      metadata: {
        firebaseUID: userId,
      },
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
      return_url: `${process.env.APP_URL}/dashboard`,
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
    const eventObject = event.data.object;

    if ("metadata" in eventObject && eventObject.metadata?.firebaseUID) {
      firebaseUID = eventObject.metadata.firebaseUID;
    } else if ("customer" in eventObject && eventObject.customer) {
      const customer = await stripe.customers.retrieve(eventObject.customer as string);
      if (!customer.deleted && "metadata" in customer) {
        firebaseUID = customer.metadata.firebaseUID;
      }
    }

    if (!firebaseUID) {
      logger.error("No Firebase UID found in event metadata");
      response.json({received: true});
      return;
    }

    const userDocRef = db.collection("users").doc(firebaseUID);

    // Handle different event types
    switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription" && session.subscription) {
        // First, get the full subscription details
        const subscriptionResponse = await stripe.subscriptions.retrieve(session.subscription as string);
        const subscription = subscriptionResponse as unknown as Stripe.Subscription & {
          current_period_end: number;
          trial_end?: number;
        };

        logger.info("Retrieved subscription details:", {
          id: subscription.id,
          current_period_end: subscription.current_period_end,
          trial_end: subscription.trial_end,
          status: subscription.status,
        });

        let firestoreSubscriptionEndsAt: admin.firestore.Timestamp | null = null;
        if (typeof subscription.current_period_end === "number") {
          firestoreSubscriptionEndsAt = admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000);
        } else {
          logger.warn(`Subscription ${subscription.id} (event: ${event.type}) - current_period_end is not a number:`,
            subscription.current_period_end);
        }

        let firestoreTrialEndsAt: admin.firestore.Timestamp | null = null;
        if (typeof subscription.trial_end === "number") {
          firestoreTrialEndsAt = admin.firestore.Timestamp.fromMillis(subscription.trial_end * 1000);
        } else if (subscription.trial_end !== undefined && subscription.trial_end !== null) {
          logger.warn(`Subscription ${subscription.id} (event: ${event.type}) - trial_end is not a number:`,
            subscription.trial_end);
        }

        await userDocRef.update({
          stripeSubscriptionId: subscription.id,
          stripeCustomerId: session.customer,
          subscriptionStatus: subscription.status,
          subscriptionEndsAt: firestoreSubscriptionEndsAt,
          trialEndsAt: firestoreTrialEndsAt,
        });

        logger.info("Updated user subscription in Firestore:", {
          userId: firebaseUID,
          subscriptionId: subscription.id,
          status: subscription.status,
          endsAt: firestoreSubscriptionEndsAt?.toDate(),
          trialEndsAt: firestoreTrialEndsAt?.toDate(),
        });
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription & {
        current_period_end: number;
        trial_end?: number;
      };

      let firestoreSubscriptionEndsAt: admin.firestore.Timestamp | null = null;
      if (typeof subscription.current_period_end === "number") {
        firestoreSubscriptionEndsAt = admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000);
      } else {
        logger.warn(`Subscription ${subscription.id} (event: ${event.type}) - current_period_end is not a number:`,
          subscription.current_period_end);
      }

      let firestoreTrialEndsAt: admin.firestore.Timestamp | null = null;
      if (typeof subscription.trial_end === "number") {
        firestoreTrialEndsAt = admin.firestore.Timestamp.fromMillis(subscription.trial_end * 1000);
      } else if (subscription.trial_end !== undefined && subscription.trial_end !== null) {
        logger.warn(`Subscription ${subscription.id} (event: ${event.type}) - trial_end is not a number:`,
          subscription.trial_end);
      }

      await userDocRef.update({
        stripeSubscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
        subscriptionEndsAt: firestoreSubscriptionEndsAt,
        trialEndsAt: firestoreTrialEndsAt,
      });
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription & {
        current_period_end: number;
        ended_at?: number;
        canceled_at?: number;
      };

      let firestoreSubscriptionEndsAt: admin.firestore.Timestamp | null = null;
      // Prefer ended_at or canceled_at if available
      const endTimestamp = subscription.ended_at || subscription.canceled_at || subscription.current_period_end;

      if (typeof endTimestamp === "number") {
        firestoreSubscriptionEndsAt = admin.firestore.Timestamp.fromMillis(endTimestamp * 1000);
      } else {
        logger.warn(`Subscription ${subscription.id} (event: ${event.type}) - no valid end timestamp found:`, {
          ended_at: subscription.ended_at,
          canceled_at: subscription.canceled_at,
          current_period_end: subscription.current_period_end,
        });
      }

      await userDocRef.update({
        subscriptionStatus: "canceled",
        subscriptionEndsAt: firestoreSubscriptionEndsAt,
      });
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
        } else {
          logger.warn(`Subscription ${subscription.id} (event: ${event.type}) - current_period_end is not a number:`,
            subscription.current_period_end);
        }

        await userDocRef.update({
          subscriptionStatus: "active",
          subscriptionEndsAt: firestoreSubscriptionEndsAt,
        });
      }
      break;
    }

    case "invoice.payment_failed": {
      await userDocRef.update({
        subscriptionStatus: "past_due",
      });
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
