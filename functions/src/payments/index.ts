
import {onCall, onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import {db} from "../config/firebase";
import sgMail from "@sendgrid/mail";
import * as admin from "firebase-admin";
import type {UserProfileFirestoreData, Contract, Agency} from "../../../src/types";

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
    const userData = userDoc.data() as UserProfileFirestoreData;

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
    const userData = userDoc.data() as UserProfileFirestoreData;

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

// Create payment intent - CHANGED TO onRequest
export const createPaymentIntent = onRequest(async (request, response) => {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Methods", "POST");
  response.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== 'POST') {
    response.status(405).send('Method Not Allowed');
    return;
  }

  try {
    // Validate request body
    const { amount, currency = "usd", contractId } = request.body;
    if (!amount || !contractId) {
      throw new Error("Amount and contractId are required");
    }

    // Get contract data
    const contractDoc = await db.collection("contracts").doc(contractId).get();
    const contractData = contractDoc.data() as Contract | undefined;

    if (!contractDoc.exists || !contractData) {
      throw new Error("Contract not found");
    }

    let userId: string | null = null;
    let isAuthenticatedCreator = false;
    const emailForReceiptAndMetadata = contractData.clientEmail || null;

    if (request.headers.authorization) {
        try {
            userId = await verifyAuthToken(request.headers.authorization);
            isAuthenticatedCreator = userId === contractData.userId;
        } catch {
            logger.info("No valid auth token, treating as public payment");
        }
    }
    
    if (!isAuthenticatedCreator && amount !== contractData.amount) {
        logger.error("Amount mismatch:", { provided: amount, expected: contractData.amount });
        throw new Error("Invalid payment amount");
    }

    let paymentIntentParams: Stripe.PaymentIntentCreateParams;
    const amountInCents = Math.round(amount * 100);

    if (contractData.ownerType === "agency" && contractData.ownerId) {
      paymentIntentParams = {
        amount: amountInCents,
        currency,
        metadata: {
          contractId,
          userId: userId || "",
          creatorId: contractData.userId, // The talent's ID
          agencyId: contractData.ownerId,
          paymentType: "agency_payment",
        },
        receipt_email: emailForReceiptAndMetadata || undefined,
      };
    } else {
      const creatorDoc = await db.collection("users").doc(contractData.userId).get();
      const creatorData = creatorDoc.data() as UserProfileFirestoreData;
      if (!creatorData?.stripeAccountId || !creatorData.stripeChargesEnabled) {
        throw new Error("Creator does not have a valid Stripe account");
      }
      const platformFee = Math.round(amountInCents * 0.01);
      const stripeFee = Math.round(amountInCents * 0.029) + 30;
      const totalApplicationFee = platformFee + stripeFee;

      paymentIntentParams = {
        amount: amountInCents,
        currency,
        application_fee_amount: totalApplicationFee,
        metadata: {
          contractId,
          userId: userId || "",
          creatorId: contractData.userId,
          clientEmail: emailForReceiptAndMetadata,
          paymentType: isAuthenticatedCreator ? "creator_payment" : "public_payment",
        },
        receipt_email: emailForReceiptAndMetadata || undefined,
        transfer_data: {
          destination: creatorData.stripeAccountId,
        },
      };
    }
    
    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

    await db.collection("paymentIntents").add({
      paymentIntentId: paymentIntent.id,
      contractId,
      userId: userId || "",
      creatorId: contractData.userId,
      amount: amountInCents,
      currency,
      status: paymentIntent.status,
      created: new Date(),
      paymentType: isAuthenticatedCreator ? "creator_payment" : "public_payment",
    });

    response.json({ clientSecret: paymentIntent.client_secret });

  } catch (error: any) {
    logger.error("Payment intent creation error:", error);
    response.status(400).json({ error: "Invalid request", message: error.message });
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

  try {
    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new Error("No raw body found in request");
    }

    const event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);

    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const {metadata, amount, currency, customer, latest_charge: latestCharge} = paymentIntent;
      const {contractId, userId, clientEmail, paymentType, internalPayoutId, agencyId} = metadata;

      if (internalPayoutId) {
        const payoutDocRef = db.collection("internalPayouts").doc(internalPayoutId);
        await payoutDocRef.update({
          status: "paid",
          paidAt: admin.firestore.Timestamp.now(),
        });
        logger.info(`Internal payout ${internalPayoutId} status updated to 'paid'.`);
      } else if (contractId) {
        const contractDocRef = db.collection("contracts").doc(contractId);
        await contractDocRef.update({
          invoiceStatus: "paid",
          updatedAt: admin.firestore.Timestamp.now(),
          invoiceHistory: admin.firestore.FieldValue.arrayUnion({
            timestamp: admin.firestore.Timestamp.now(),
            action: "Invoice Paid",
            details: `PaymentIntent ID: ${paymentIntent.id}`,
          }),
        });
        
        if (paymentType === "agency_payment" && agencyId) {
            const chargeId = typeof latestCharge === "string" ? latestCharge : latestCharge?.id;
            if (!chargeId) {
                throw new Error("Missing charge ID for agency payment split.");
            }

            const contractDoc = await contractDocRef.get();
            const contractData = contractDoc.data() as Contract;
            
            const agencyDoc = await db.collection("agencies").doc(agencyId).get();
            const agencyData = agencyDoc.data() as Agency;

            const talentInfo = agencyData.talent.find((t) => t.userId === contractData.userId);
            
            if (agencyData && talentInfo && typeof talentInfo.commissionRate === "number") {
                const agencyOwnerUserDoc = await db.collection("users").doc(agencyData.ownerId).get();
                const agencyOwnerData = agencyOwnerUserDoc.data() as UserProfileFirestoreData;
                const talentUserDoc = await db.collection("users").doc(contractData.userId).get();
                const talentUserData = talentUserDoc.data() as UserProfileFirestoreData;

                if (agencyOwnerData.stripeAccountId && talentUserData.stripeAccountId) {
                    
                    const stripeFeeInCents = Math.round(amount * 0.029) + 30;
                    const platformFeeInCents = Math.round(amount * 0.01);
                    const netForDistribution = amount - stripeFeeInCents - platformFeeInCents;
                    
                    const agencyCommissionAmount = Math.round(netForDistribution * (talentInfo.commissionRate / 100));
                    const talentShareAmount = netForDistribution - agencyCommissionAmount;

                    // 1. Transfer Agency Commission
                    if (agencyCommissionAmount > 0) {
                      await stripe.transfers.create({
                          amount: agencyCommissionAmount,
                          currency: "usd",
                          destination: agencyOwnerData.stripeAccountId,
                          source_transaction: chargeId,
                          description: `Commission for contract ${contractId}`,
                      });
                    }

                    // 2. Transfer Talent Share
                    if (talentShareAmount > 0) {
                      await stripe.transfers.create({
                          amount: talentShareAmount,
                          currency: "usd",
                          destination: talentUserData.stripeAccountId,
                          source_transaction: chargeId,
                          description: `Payout for contract ${contractId}`,
                      });
                    }

                    logger.info(`Agency payment split processed for contract ${contractId}.
                      Agency: ${agencyCommissionAmount/100}, Talent: ${talentShareAmount/100}`);
                } else {
                    logger.error("Stripe account ID missing for agency owner or talent, cannot split funds.", 
                      {agencyId, talentId: contractData.userId});
                }
            }
        }

        let emailForUserConfirmation = "";
        if (clientEmail) {
          emailForUserConfirmation = clientEmail;
        } else if (paymentType === "creator_payment" && userId) {
          try {
            const userRecord = await admin.auth().getUser(userId);
            emailForUserConfirmation = userRecord.email || "";
          } catch {
            logger.error("Could not fetch creator email for confirmation");
          }
        } else if (customer) {
          const customerData = await stripe.customers.retrieve(customer as string);
          if (!customerData.deleted) {
            emailForUserConfirmation = (customerData as Stripe.Customer).email || "";
          }
        }

        if (emailForUserConfirmation) {
          const msg = {
            to: emailForUserConfirmation,
            from: process.env.SENDGRID_FROM_EMAIL || "invoices@tryverza.com",
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

        await db.collection("payments").add({
          paymentIntentId: paymentIntent.id,
          contractId,
          userId: userId || "",
          amount,
          currency,
          customerId: customer,
          emailForUserConfirmation,
          status: "succeeded",
          timestamp: admin.firestore.Timestamp.now(),
        });
      } else {
        logger.warn("Webhook received for payment_intent.succeeded without contractId or internalPayoutId in metadata.",
          metadata);
      }
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
    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new Error("No raw body found in request");
    }

    const event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      endpointSecret
    );

    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      const db = admin.firestore();

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
      const updates: Partial<UserProfileFirestoreData> = {
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
