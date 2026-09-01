
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import {Timestamp} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import type {UserProfileFirestoreData, SubscriptionPlanId} from "./../types";
import * as params from "../config/params";
import {sendSubscriptionReceiptEmail} from "../notifications";
import {handleOpticStripeSubscriptionEvent} from "../optic/billing";

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
    stripe = new Stripe(stripeKey, {apiVersion: "2026-04-22.dahlia" as any});
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

  if (typeof planId === "string" && planId.startsWith("agency_")) {
    throw new HttpsError(
      "failed-precondition",
      "Agency seat plans are no longer available for new checkout. Existing subscribers can manage billing in the Stripe customer portal. New workspaces use Optic Launch."
    );
  }


  const userDoc = await db.collection("users").doc(userId).get();
  const userData = userDoc.data();

  if (!userData) {
    throw new HttpsError("not-found", "User not found.");
  }

  if (!userData.isAgencyOwner && !userData.role?.startsWith("agency")) {
    throw new HttpsError(
      "failed-precondition",
      "Individual creators on Verza are free forever and do not require a subscription."
    );
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
    stripe = new Stripe(stripeKey, {apiVersion: "2026-04-22.dahlia" as any});
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
    stripe = new Stripe(stripeKey, {apiVersion: "2026-04-22.dahlia" as any});
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
    const opticHandled = await handleOpticStripeSubscriptionEvent(stripe, event);
    if (opticHandled) {
      response.json({received: true});
      return;
    }

    // Get Firebase UID from event metadata
    // In dahlia, invoice.metadata is empty — UID lives in parent.subscription_details.metadata
    let firebaseUID: string | undefined;
    const obj = event.data.object as any;

    firebaseUID = obj.metadata?.firebaseUID ||
      obj.parent?.subscription_details?.metadata?.firebaseUID ||
      obj.subscription_data?.metadata?.firebaseUID;

    if (!firebaseUID && obj.customer && typeof obj.customer === "string") {
      const customer = await stripe.customers.retrieve(obj.customer);
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
      const session = event.data.object as any;
      if (session.mode === "subscription") {
        // In dahlia, subscription may be an object or string — normalize to ID
        const subscriptionId = typeof session.subscription === "object" ?
          session.subscription?.id :
          session.subscription;
        if (!subscriptionId) break;

        const subscriptionResponse = await stripe.subscriptions.retrieve(subscriptionId) as any;

        let firestoreSubscriptionEndsAt: Timestamp | null = null;
        if (typeof subscriptionResponse.current_period_end === "number") {
          firestoreSubscriptionEndsAt = Timestamp.fromMillis(subscriptionResponse.current_period_end * 1000);
        }

        let firestoreTrialEndsAt: Timestamp | null = null;
        if (typeof subscriptionResponse.trial_end === "number") {
          firestoreTrialEndsAt = Timestamp.fromMillis(subscriptionResponse.trial_end * 1000);
        }

        const planIdFromMeta = session.metadata?.planId as SubscriptionPlanId;
        const priceId = subscriptionResponse.items.data[0]?.price.id;
        const {talentLimit: limitFromPrice} = getPlanDetailsFromPriceId(priceId);
        const talentLimit = limitFromPrice || getTalentLimitFromPlanId(planIdFromMeta);
        const interval = subscriptionResponse.items.data[0]?.price?.recurring?.interval ||
          (planIdFromMeta?.endsWith("yearly") ? "year" : "month");

        // customer may be object or string in dahlia
        const customerId = typeof session.customer === "object" ?
          session.customer?.id :
          session.customer;

        await userDocRef.update({
          stripeSubscriptionId: subscriptionResponse.id,
          stripeCustomerId: customerId,
          subscriptionStatus: subscriptionResponse.status,
          subscriptionInterval: interval,
          subscriptionPlanId: planIdFromMeta,
          talentLimit,
          subscriptionEndsAt: firestoreSubscriptionEndsAt,
          trialEndsAt: firestoreTrialEndsAt,
        });
        logger.info("Updated user subscription from checkout.session.completed:",
          {userId: firebaseUID, subId: subscriptionResponse.id, planId: planIdFromMeta});

        const userSnap = await userDocRef.get();
        const userData = userSnap.data() as UserProfileFirestoreData;
        if (userData?.email) {
          await sendSubscriptionReceiptEmail(userData.email, userData.displayName || "there", {
            planId: planIdFromMeta,
            interval,
            amountPaid: session.amount_total || 0,
            nextBillingDate: subscriptionResponse.current_period_end,
            transactionId: subscriptionResponse.id,
            type: "new",
          });
        }
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as any;

      let firestoreSubscriptionEndsAt: Timestamp | null = null;
      if (typeof subscription.current_period_end === "number") {
        firestoreSubscriptionEndsAt = Timestamp.fromMillis(subscription.current_period_end * 1000);
      }

      let firestoreTrialEndsAt: Timestamp | null = null;
      if (typeof subscription.trial_end === "number") {
        firestoreTrialEndsAt = Timestamp.fromMillis(subscription.trial_end * 1000);
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
        {
          userId: firebaseUID, subId: subscription.id, status: subscription.status,
          interval: interval, planId: planId || `(derived from price ${priceId})`,
        });
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as any;

      let firestoreSubscriptionEndsAt: Timestamp | null = null;
      const endTimestamp = subscription.ended_at || subscription.canceled_at || subscription.current_period_end;

      if (typeof endTimestamp === "number") {
        firestoreSubscriptionEndsAt = Timestamp.fromMillis(endTimestamp * 1000);
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

    case "invoice.paid":
    case "invoice.payment_succeeded": {
      const invoice = event.data.object as any;
      const isNewSub = invoice.billing_reason === "subscription_create";
      const isRenewal = invoice.billing_reason === "subscription_cycle";

      // In dahlia, subscription ID moved from invoice.subscription to invoice.parent.subscription_details.subscription
      const subscriptionId = invoice.subscription ||
        invoice.parent?.subscription_details?.subscription;

      if ((isNewSub || isRenewal) && subscriptionId) {
        const subscriptionResponse = await stripe.subscriptions.retrieve(subscriptionId as string);
        const subscription = subscriptionResponse as unknown as Stripe.Subscription & {
          current_period_end: number;
        };

        let firestoreSubscriptionEndsAt: Timestamp | null = null;
        if (typeof subscription.current_period_end === "number") {
          firestoreSubscriptionEndsAt = Timestamp.fromMillis(subscription.current_period_end * 1000);
        }

        const interval = subscription.items.data[0]?.price?.recurring?.interval || "month";
        const priceId = subscription.items.data[0]?.price.id;
        const {planId: derivedPlanId, talentLimit} = getPlanDetailsFromPriceId(priceId);

        // For new subscriptions pull planId from invoice parent metadata (dahlia structure)
        const invoiceObj = invoice as any;
        const metaPlanId = invoiceObj.parent?.subscription_details?.metadata?.planId ||
          invoiceObj.metadata?.planId;
        const resolvedPlanId = derivedPlanId || metaPlanId;

        const updates: any = {
          stripeSubscriptionId: subscription.id,
          subscriptionStatus: "active",
          subscriptionInterval: interval,
          subscriptionEndsAt: firestoreSubscriptionEndsAt,
        };
        if (resolvedPlanId) updates.subscriptionPlanId = resolvedPlanId;
        if (talentLimit) updates.talentLimit = talentLimit;

        await userDocRef.update(updates);
        logger.info(`Updated subscription from invoice.paid (${invoice.billing_reason}):`,
          {userId: firebaseUID, subId: subscription.id, planId: resolvedPlanId});

        const userSnap = await userDocRef.get();
        const userData = userSnap.data() as UserProfileFirestoreData;
        if (userData?.email) {
          await sendSubscriptionReceiptEmail(userData.email, userData.displayName || "there", {
            planId: resolvedPlanId || userData.subscriptionPlanId,
            interval,
            amountPaid: invoice.amount_paid,
            nextBillingDate: subscription.current_period_end,
            transactionId: invoice.id || subscription.id,
            type: isNewSub ? "new" : "renewal",
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
    default:
      if (
        !event.type.startsWith("payment_intent.") &&
        !event.type.startsWith("charge.")
      ) {
        logger.info(`Unhandled event type: ${event.type}`);
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
