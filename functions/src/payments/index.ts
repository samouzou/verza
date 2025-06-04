import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import {db} from "../config/firebase";
import sgMail from "@sendgrid/mail";
import * as admin from "firebase-admin";

// Initialize Stripe
let stripe: Stripe;
try {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  stripe = new Stripe(stripeKey, {
    apiVersion: "2025-05-28.basil",
  });
} catch (error) {
  logger.error("Error initializing Stripe:", error);
  // Create a mock Stripe instance for local testing
  stripe = {
    paymentIntents: {
      create: async () => ({client_secret: "mock_secret"}),
      retrieve: async () => ({status: "succeeded"}),
    },
  } as unknown as Stripe;
}

// Initialize SendGrid
const sendgridKey = process.env.SENDGRID_API_KEY;
if (sendgridKey) {
  sgMail.setApiKey(sendgridKey);
} else {
  logger.warn("SENDGRID_API_KEY is not set. Emails will not be sent.");
}

interface UserData {
  stripeAccountId?: string;
  stripeAccountStatus?: string;
  stripeChargesEnabled?: boolean;
  stripePayoutsEnabled?: boolean;
  email?: string;
}

/**
 * Verifies the Firebase ID token from the Authorization header
 * @param {string | undefined} authHeader - The Authorization header from the request
 * @return {Promise<string>} The user ID if the token is valid
 * @throws {Error} If the token is missing or invalid
 */
async function verifyAuthToken(authHeader: string | undefined): Promise<string> {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("No token provided");
  }

  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken.uid;
  } catch (error) {
    logger.error("Error verifying auth token:", error);
    throw new Error("Invalid token");
  }
}

// Create Stripe Connected Account
export const createStripeConnectedAccount = onRequest(async (request, response) => {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Methods", "POST");
  response.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  try {
    const userId = await verifyAuthToken(request.headers.authorization);
    const userRef = db.collection("users").doc(userId);

    // Check if user already has a Stripe account
    const userDoc = await userRef.get();
    const userData = userDoc.data() as UserData;

    if (userData?.stripeAccountId) {
      response.json({stripeAccountId: userData.stripeAccountId});
      return;
    }

    // Get user email
    const userRecord = await admin.auth().getUser(userId);
    const email = userRecord.email;

    if (!email) {
      throw new Error("User must have an email address");
    }

    // Create Stripe Connected Account
    const account = await stripe.accounts.create({
      type: "express",
      email,
      capabilities: {
        card_payments: {requested: true},
        transfers: {requested: true},
      },
    });

    // Update user document with Stripe account info
    await userRef.update({
      stripeAccountId: account.id,
      stripeAccountStatus: "onboarding_incomplete",
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
    });

    response.json({stripeAccountId: account.id});
  } catch (error) {
    logger.error("Error creating Stripe account:", error);
    response.status(401).json({
      error: "Failed to create Stripe account",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Create Stripe Account Link
export const createStripeAccountLink = onRequest(async (request, response) => {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Methods", "POST");
  response.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  try {
    const userId = await verifyAuthToken(request.headers.authorization);
    const userRef = db.collection("users").doc(userId);

    const userDoc = await userRef.get();
    const userData = userDoc.data() as UserData;

    if (!userData?.stripeAccountId) {
      throw new Error("No Stripe account found");
    }

    const accountLink = await stripe.accountLinks.create({
      account: userData.stripeAccountId,
      refresh_url: `${process.env.APP_URL}/reauth`,
      return_url: `${process.env.APP_URL}/settings?stripe_connect_return=true`,
      type: "account_onboarding",
    });

    response.json({url: accountLink.url});
  } catch (error) {
    logger.error("Error creating account link:", error);
    response.status(401).json({
      error: "Failed to create account link",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Create payment intent
export const createPaymentIntent = onRequest(async (request, response) => {
  // Set CORS headers
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Methods", "POST");
  response.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Handle preflight requests
  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  try {
    // Validate request body
    const {amount, currency = "usd", contractId} = request.body;
    if (!amount || !contractId) {
      throw new Error("Amount and contractId are required");
    }

    // Get contract data
    const contractDoc = await db.collection("contracts").doc(contractId).get();
    const contractData = contractDoc.data();

    if (!contractDoc.exists || !contractData) {
      throw new Error("Contract not found");
    }

    // Determine if this is an authenticated creator payment or public client payment
    let isAuthenticatedCreator = false;
    let userId: string | null = null;
    const emailForReceiptAndMetadata = contractData.clientEmail || null;


    try {
      // Try to verify auth token if present
      if (request.headers.authorization) {
        userId = await verifyAuthToken(request.headers.authorization);
        // Check if the authenticated user is the creator
        isAuthenticatedCreator = userId === contractData.userId;
      }
    } catch (error) {
      // If auth fails, treat as unauthenticated public payment
      logger.info("No valid auth token, treating as public payment");
    }

    // For public payments, verify the amount matches the contract
    if (!isAuthenticatedCreator) {
      if (amount !== contractData.amount) {
        logger.error("Amount mismatch:", {
          provided: amount,
          expected: contractData.amount,
        });
        throw new Error("Invalid payment amount");
      }
      // For public payments, the payer is the contract's userId
      userId = contractData.userId;
    }

    // Get creator's Stripe account information
    const creatorUserId = contractData.userId;
    const creatorDoc = await db.collection("users").doc(creatorUserId).get();
    const creatorData = creatorDoc.data();

    if (!creatorData?.stripeAccountId || !creatorData.stripeChargesEnabled) {
      throw new Error("Creator does not have a valid Stripe account");
    }

    // Convert amount to cents for Stripe (amount is in dollars)
    const amountInCents = Math.round(amount * 100);

    // Create payment intent with transfer to creator's account
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency,
      transfer_data: {
        destination: creatorData.stripeAccountId,
      },
      metadata: {
        contractId,
        userId: userId || "",
        creatorId: creatorUserId,
        clientEmail: emailForReceiptAndMetadata,
        paymentType: isAuthenticatedCreator ? "creator_payment" : "public_payment",
      },
      receipt_email: emailForReceiptAndMetadata,
    });

    // Log the payment intent creation
    await db.collection("paymentIntents").add({
      paymentIntentId: paymentIntent.id,
      contractId,
      userId: userId || "",
      creatorId: creatorUserId,
      amount: amountInCents,
      currency,
      status: paymentIntent.status,
      created: new Date(),
      paymentType: isAuthenticatedCreator ? "creator_payment" : "public_payment",
    });

    response.json({clientSecret: paymentIntent.client_secret});
  } catch (error) {
    logger.error("Error creating payment intent:", error);
    response.status(401).json({
      error: "Failed to create payment intent",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Handle successful payment
export const handlePaymentSuccess = onRequest(async (request, response) => {
  const sig = request.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !endpointSecret) {
    logger.error("Missing stripe signature or webhook secret");
    response.status(400).send("Missing stripe signature or webhook secret");
    return;
  }

  // let event: Stripe.Event;

  try {
    // Get the raw request body as a string
    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new Error("No raw body found in request");
    }

    // Verify the event using the raw body and signature
    const event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      endpointSecret
    );

    // Handle the event
    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const {amount, currency, customer, metadata} = paymentIntent;
      const {contractId, userId, clientEmail, paymentType} = metadata;

      if (!contractId || !userId) {
        logger.error("Missing contractId or userId in payment intent metadata");
        response.status(400).send("Invalid payment intent metadata");
        return;
      }

      // Update contract status
      await db.collection("contracts").doc(contractId).update({
        invoiceStatus: "paid",
        updatedAt: new Date(),
        invoiceHistory: admin.firestore.FieldValue.arrayUnion({
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          action: "Invoice Paid",
          details: `PaymentIntent ID: ${paymentIntent.id}`,
        }),
      });

      // Get customer email from Stripe
      let emailForUserConfirmation = "";
      if (clientEmail) {
        emailForUserConfirmation = clientEmail;
      } else if (paymentType === "creator_payment" && userId) {
        try {
          const userRecord = await admin.auth().getUser(userId);
          emailForUserConfirmation = userRecord.email || "";
        } catch (e) {
          logger.error("Could not fetch creator email for confirmation", e);
        }
      } else if (customer) {
        const customerData = await stripe.customers.retrieve(customer as string);
        if (!customerData.deleted) {
          emailForUserConfirmation = (customerData as Stripe.Customer).email || "";
        }
      }

      // Send confirmation email
      if (emailForUserConfirmation) {
        const msg = {
          to: emailForUserConfirmation,
          from: process.env.SENDGRID_FROM_EMAIL || "serge@datatrixs.com",
          subject: "Payment Confirmation",
          text: `Your payment of ${amount / 100} ${currency.toUpperCase()} for contract ${contractId} has been received.`,
          html: `
            <h2>Payment Confirmation</h2>
            <p>Your payment of ${amount / 100} ${currency.toUpperCase()} for contract ${contractId} has been received.</p>
            <p>Thank you for your business!</p>
            <p>The Verza Team</p>
          `,
        };

        try {
          await sgMail.send(msg);
          logger.info("Payment confirmation email sent successfully");
        } catch (emailError) {
          logger.error("Failed to send payment confirmation email:", emailError);
        }
      }

      // Log the successful payment
      await db.collection("payments").add({
        paymentIntentId: paymentIntent.id,
        contractId,
        userId,
        amount,
        currency,
        customerId: customer,
        emailForUserConfirmation,
        status: "succeeded",
        timestamp: new Date(),
      });
    }
    response.json({received: true});
  } catch (error) {
    logger.error("Webhook error:", error);
    response.status(400).send("Webhook error");
  }
});

// Handle Stripe Connected Account webhook
export const handleStripeAccountWebhook = onRequest(async (request, response) => {
  const sig = request.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_ACCOUNT_WEBHOOK_SECRET;

  if (!sig || !endpointSecret) {
    logger.error("Missing stripe signature or webhook secret");
    response.status(400).send("Missing stripe signature or webhook secret");
    return;
  }

  try {
    // Get the raw request body as a string
    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new Error("No raw body found in request");
    }

    // Verify the event using the raw body and signature
    const event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      endpointSecret
    );

    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      const db = admin.firestore();

      // Find user with this Stripe account ID
      const usersRef = db.collection("users");
      const snapshot = await usersRef
        .where("stripeAccountId", "==", account.id)
        .get();

      if (snapshot.empty) {
        logger.error("No user found with Stripe account ID:", account.id);
        response.status(200).send("No user found");
        return;
      }

      const userDoc = snapshot.docs[0];
      const updates: Partial<UserData> = {
        stripeChargesEnabled: account.charges_enabled,
        stripePayoutsEnabled: account.payouts_enabled,
        stripeAccountStatus: account.details_submitted ?
          "active" :
          "onboarding_incomplete",
      };

      await userDoc.ref.update(updates);
    }

    response.status(200).send("Webhook processed");
  } catch (error) {
    logger.error("Webhook error:", error);
    response.status(400).send("Webhook error");
  }
});
