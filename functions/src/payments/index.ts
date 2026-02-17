
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import {db} from "../config/firebase";
import sgMail from "@sendgrid/mail";
import * as admin from "firebase-admin";
import type {UserProfileFirestoreData, Contract, Agency, PaymentMilestone, CreditTransaction} from "./../types";
import * as params from "../config/params";

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
  let stripe: Stripe;
  try {
    const stripeKey = params.STRIPE_SECRET_KEY.value();
    stripe = new Stripe(stripeKey, {apiVersion: "2025-05-28.basil"});
  } catch (e) {
    logger.error("Stripe not configured", e);
    throw new HttpsError("failed-precondition", "Stripe is not configured.");
  }

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
  let stripe: Stripe;
  try {
    const stripeKey = params.STRIPE_SECRET_KEY.value();
    stripe = new Stripe(stripeKey, {apiVersion: "2025-05-28.basil"});
  } catch (e) {
    logger.error("Stripe not configured", e);
    throw new HttpsError("failed-precondition", "Stripe is not configured.");
  }

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
      refresh_url: `${params.APP_URL.value()}/reauth`,
      return_url: `${params.APP_URL.value()}/settings?stripe_connect_return=true`,
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

export const getStripeAccountBalance = onCall(async (request) => {
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

  try {
    const userDocRef = db.collection("users").doc(userId);
    const userDoc = await userDocRef.get();
    const userData = userDoc.data() as UserProfileFirestoreData | undefined;

    if (!userData || !userData.stripeAccountId) {
      logger.info(`User ${userId} has no Stripe account connected.`);
      return {available: [], pending: []};
    }

    const balance = await stripe.balance.retrieve({
      stripeAccount: userData.stripeAccountId,
    });

    return {
      available: balance.available,
      pending: balance.pending,
    };
  } catch (error) {
    logger.error(`Error retrieving Stripe balance for user ${userId}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    // Don't throw a generic internal error, which could crash client.
    // Return a structured error instead.
    return {error: "Could not retrieve balance from Stripe."};
  }
});


// Create payment intent
export const createPaymentIntent = onRequest(async (request, response) => {
  let stripe: Stripe;
  try {
    const stripeKey = params.STRIPE_SECRET_KEY.value();
    stripe = new Stripe(stripeKey, {apiVersion: "2025-05-28.basil"});
  } catch (e) {
    logger.error("Stripe not configured", e);
    // Cannot throw HttpsError in onRequest, so send error response.
    response.status(500).json({error: "Stripe service not configured."});
    return;
  }

  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).send("Method Not Allowed");
    return;
  }

  try {
    const {amount: requestedAmount, currency = "usd", contractId, milestoneId} = request.body;
    if (!contractId) {
      throw new Error("contractId is required");
    }

    const contractDoc = await db.collection("contracts").doc(contractId).get();
    const contractData = contractDoc.data() as Contract | undefined;
    if (!contractDoc.exists || !contractData) {
      throw new Error("Contract not found");
    }

    let amountToCharge = 0;
    const finalMilestoneId: string | null = milestoneId || null;

    // Prioritize editableInvoiceDetails for amount calculation
    if (contractData.editableInvoiceDetails?.deliverables && contractData.editableInvoiceDetails.deliverables.length > 0) {
      const lineItems = contractData.editableInvoiceDetails.deliverables;
      if (milestoneId) {
        // Check if the invoice was for a specific milestone
        const targetMilestone = contractData.milestones?.find((m) => m.id === milestoneId);
        if (targetMilestone && lineItems.some((item) => item.isMilestone && item.description === targetMilestone.description)) {
          // If this specific milestone invoice has line items, sum them up.
          amountToCharge = lineItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
        }
      } else {
        // If it's a general invoice, sum up all line items.
        amountToCharge = lineItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
      }
    }

    // Fallback logic if editable details don't provide an amount
    if (amountToCharge === 0) {
      if (milestoneId) {
        const milestone = contractData.milestones?.find((m: PaymentMilestone) => m.id === milestoneId);
        if (!milestone) throw new Error("Milestone not found on contract.");
        amountToCharge = milestone.amount;
      } else {
        amountToCharge = contractData.amount;
      }
    }

    // Security check: if an amount is passed from an unauthenticated user, it MUST match the calculated amount.
    if (requestedAmount && requestedAmount !== amountToCharge) {
      let isAuthenticatedUser = false;
      if (request.headers.authorization) {
        try {
          await verifyAuthToken(request.headers.authorization);
          isAuthenticatedUser = true;
        } catch {/* treat as unauthenticated */}
      }
      if (!isAuthenticatedUser) {
        logger.error("Amount mismatch for unauthenticated payment:", {provided: requestedAmount, expected: amountToCharge});
        throw new Error("Invalid payment amount.");
      }
    }

    if (!amountToCharge || amountToCharge <= 0) {
      throw new Error("A valid amount is required to create a payment intent.");
    }

    let userId: string | null = null;
    const emailForReceiptAndMetadata = contractData.clientEmail || null;

    if (request.headers.authorization) {
      try {
        userId = await verifyAuthToken(request.headers.authorization);
      } catch {
        logger.info("No valid auth token, treating as public payment");
      }
    }

    let paymentIntentParams: Stripe.PaymentIntentCreateParams;
    const amountInCents = Math.round(amountToCharge * 100);

    const metadataForStripe: Stripe.MetadataParam = {
      contractId,
      userId: userId || "",
      creatorId: contractData.userId,
      clientEmail: emailForReceiptAndMetadata,
      paymentType: userId === contractData.userId ? "creator_payment" : "public_payment",
    };

    if (finalMilestoneId) {
      metadataForStripe.milestoneId = finalMilestoneId;
    }

    if (contractData.ownerType === "agency" && contractData.ownerId) {
      metadataForStripe.agencyId = contractData.ownerId;
      metadataForStripe.paymentType = "agency_payment";

      const agencyDoc = await db.collection("agencies").doc(contractData.ownerId).get();
      const agencyData = agencyDoc.data() as Agency;

      const talentUserDoc = await db.collection("users").doc(contractData.userId).get();
      const talentUserData = talentUserDoc.data() as UserProfileFirestoreData;

      const isForTalent = agencyData.talent.some((t) => t.userId === contractData.userId);

      const platformFee = Math.round(amountInCents * 0.01);
      const stripeFee = Math.round(amountInCents * 0.029) + 30;
      const totalApplicationFee = platformFee + stripeFee;

      if (isForTalent) {
        if (!talentUserData?.stripeAccountId || !talentUserData.stripePayoutsEnabled) {
          throw new Error("The creator/talent for this contract does not have a valid," +
            " active bank account for receiving payouts.");
        }
        // For talent contracts, charge the client and hold funds on the platform balance
        // The webhook will handle splitting the funds.
        paymentIntentParams = {
          amount: amountInCents,
          currency,
          metadata: metadataForStripe,
          receipt_email: emailForReceiptAndMetadata || undefined,
        };
      } else { // Contract is for the agency itself (created by owner or team member)
        const agencyOwnerUserDoc = await db.collection("users").doc(agencyData.ownerId).get();
        const agencyOwnerData = agencyOwnerUserDoc.data() as UserProfileFirestoreData;
        if (!agencyOwnerData?.stripeAccountId || !agencyOwnerData.stripePayoutsEnabled) {
          throw new Error("Agency owner does not have a valid, active bank account for receiving payments.");
        }
        paymentIntentParams = {
          amount: amountInCents,
          currency,
          application_fee_amount: totalApplicationFee,
          metadata: metadataForStripe,
          receipt_email: emailForReceiptAndMetadata || undefined,
          transfer_data: {
            destination: agencyOwnerData.stripeAccountId,
          },
        };
      }
    } else {
      // Logic for individual creator contracts
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
        metadata: metadataForStripe,
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
      milestoneId: finalMilestoneId,
      userId: userId || "",
      creatorId: contractData.userId,
      amount: amountInCents,
      currency,
      status: paymentIntent.status,
      created: new Date(),
      paymentType: userId === contractData.userId ? "creator_payment" : "public_payment",
    });

    response.json({clientSecret: paymentIntent.client_secret});
  } catch (error: any) {
    logger.error("Payment intent creation error:", error);
    response.status(400).json({error: "Invalid request", message: error.message});
  }
});


// Handle successful payment
export const handlePaymentSuccess = onRequest(async (request, response) => {
  let stripe: Stripe;
  try {
    const stripeKey = params.STRIPE_SECRET_KEY.value();
    stripe = new Stripe(stripeKey, {apiVersion: "2025-05-28.basil"});
  } catch (e) {
    logger.error("Stripe not configured", e);
    response.status(500).send("Webhook Error: Stripe service not configured.");
    return;
  }

  const sig = request.headers["stripe-signature"];
  const endpointSecret = params.STRIPE_WEBHOOK_SECRET.value();

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
      const {contractId, userId, clientEmail, paymentType, internalPayoutId, agencyId, milestoneId} = metadata;

      if (internalPayoutId) {
        const payoutDocRef = db.collection("internalPayouts").doc(internalPayoutId);
        await payoutDocRef.update({
          status: "paid",
          paidAt: admin.firestore.Timestamp.now(),
        });
        logger.info(`Internal payout ${internalPayoutId} status updated to 'paid'.`);
      } else if (contractId) {
        const contractDocRef = db.collection("contracts").doc(contractId);
        const contractDoc = await contractDocRef.get();
        const contractData = contractDoc.data() as Contract;

        const updates: {[key: string]: any} = {
          updatedAt: admin.firestore.Timestamp.now(),
          invoiceHistory: admin.firestore.FieldValue.arrayUnion({
            timestamp: admin.firestore.Timestamp.now(),
            action: `Payment Received for ${milestoneId ? "Milestone" : "Invoice"}`,
            details: `PaymentIntent ID: ${paymentIntent.id}`,
          }),
        };

        if (milestoneId && contractData.milestones) {
          const updatedMilestones = contractData.milestones.map((m) =>
            m.id === milestoneId ? {...m, status: "paid"} : m
          );
          updates.milestones = updatedMilestones;

          const allMilestonesPaid = updatedMilestones.every((m) => m.status === "paid");
          if (allMilestonesPaid) {
            updates.invoiceStatus = "paid";
            updates.status = "paid";
          } else {
            updates.invoiceStatus = "partially_paid";
            updates.status = "partially_paid";
          }
        } else {
          updates.invoiceStatus = "paid";
          updates.status = "paid";
        }
        await contractDocRef.update(updates);

        if (paymentType === "agency_payment" && agencyId) {
          const chargeId = typeof latestCharge === "string" ? latestCharge : latestCharge?.id;
          if (!chargeId) {
            throw new Error("Missing charge ID for agency payment split.");
          }

          const agencyDoc = await db.collection("agencies").doc(agencyId).get();
          const agencyData = agencyDoc.data() as Agency;

          const talentInfo = agencyData.talent.find((t) => t.userId === contractData.userId);

          // This logic now correctly handles transfers for talent contracts
          if (agencyData && talentInfo && typeof talentInfo.commissionRate === "number") {
            const agencyOwnerUserDoc = await db.collection("users").doc(agencyData.ownerId).get();
            const agencyOwnerData = agencyOwnerUserDoc.data() as UserProfileFirestoreData;
            const talentUserDoc = await db.collection("users").doc(contractData.userId).get();
            const talentUserData = talentUserDoc.data() as UserProfileFirestoreData;

            if (agencyOwnerData.stripeAccountId && talentUserData.stripeAccountId) {
              const stripeFeeInCents = Math.round(amount * 0.029) + 30;
              const platformFeeInCents = Math.round(amount * 0.01);
              const totalPlatformCut = stripeFeeInCents + platformFeeInCents;
              const netForDistribution = amount - totalPlatformCut;

              const agencyCommissionAmount = Math.round(netForDistribution * (talentInfo.commissionRate / 100));
              const talentShareAmount = netForDistribution - agencyCommissionAmount;

              if (agencyCommissionAmount > 0) {
                await stripe.transfers.create({
                  amount: agencyCommissionAmount,
                  currency: "usd",
                  destination: agencyOwnerData.stripeAccountId,
                  source_transaction: chargeId,
                  description: `Commission for contract ${contractId}`,
                });
              }

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
          const sendgridKey = params.SENDGRID_API_KEY.value();
          if (sendgridKey) {
            sgMail.setApiKey(sendgridKey);
            const msg: any = {
              to: emailForUserConfirmation,
              from: {
                name: "Verza",
                email: params.SENDGRID_FROM_EMAIL.value() || "invoices@tryverza.com",
              },
              subject: `Payment Receipt for: ${contractData.projectName || contractId}`,
              text: `Your payment of $${(amount / 100).toLocaleString()} for contract ${contractId} has been received. A copy of your paid invoice is attached.`,
              html: `
                <h2>Payment Confirmation</h2>
                <p>Thank you for your payment. We've received <strong>$${(amount / 100).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${currency.toUpperCase()}</strong> for the invoice related to contract "${contractData.projectName || contractId}".</p>
                <p>A copy of the paid invoice is attached for your records.</p>
                <p>Thank you!</p>
                <p>The Verza Team</p>
              `,
            };

            // Attach invoice HTML content
            if (contractData?.invoiceHtmlContent) {
              msg.attachments = [
                {
                  content: Buffer.from(contractData.invoiceHtmlContent).toString("base64"),
                  filename: `invoice-${contractData.invoiceNumber || contractId}.html`,
                  type: "text/html",
                  disposition: "attachment",
                  content_id: "invoice_html",
                },
              ];
            }

            try {
              await sgMail.send(msg);
              logger.info("Payment confirmation email sent successfully with invoice attachment.");
            } catch (emailError) {
              logger.error("Failed to send payment confirmation email:", emailError);
            }
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
  let stripe: Stripe;
  try {
    const stripeKey = params.STRIPE_SECRET_KEY.value();
    stripe = new Stripe(stripeKey, {apiVersion: "2025-05-28.basil"});
  } catch (e) {
    logger.error("Stripe not configured", e);
    response.status(500).send("Webhook Error: Stripe service not configured.");
    return;
  }
  const sig = request.headers["stripe-signature"];
  const endpointSecret = params.STRIPE_ACCOUNT_WEBHOOK_SECRET.value();

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

export const createCreditCheckoutSession = onCall(async (request) => {
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
  const {planKey} = request.data as { planKey: "starter" | "agency" };

  if (!planKey || !["starter", "agency"].includes(planKey)) {
    throw new HttpsError("invalid-argument", "A valid plan key ('starter' or 'agency') is required.");
  }

  const userDoc = await db.collection("users").doc(userId).get();
  const userData = userDoc.data() as UserProfileFirestoreData;
  if (!userData) {
    throw new HttpsError("not-found", "User not found.");
  }

  try {
    let stripeCustomerId = userData.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: userData.email || undefined,
        name: userData.displayName || undefined,
        metadata: {firebaseUID: userId},
      });
      stripeCustomerId = customer.id;
      await userDoc.ref.update({stripeCustomerId});
    }

    let priceId;
    let creditAmount;

    switch (planKey) {
    case "starter":
      priceId = params.STRIPE_SCENE_SPAWNER_STARTER_PRICE_ID.value();
      creditAmount = 250;
      break;
    case "agency":
      priceId = params.STRIPE_SCENE_SPAWNER_AGENCY_PRICE_ID.value();
      creditAmount = 1000;
      break;
    }

    if (!priceId) {
      throw new HttpsError("failed-precondition", `Price ID for plan '${planKey}' is not configured.`);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: stripeCustomerId,
      line_items: [{price: priceId, quantity: 1}],
      success_url: `${params.APP_URL.value()}/scene-spawner?purchase_success=true`,
      cancel_url: `${params.APP_URL.value()}/scene-spawner`,
      metadata: {
        firebaseUID: userId,
        creditAmount: creditAmount.toString(),
        priceId: priceId,
      },
    });

    return {url: session.url};
  } catch (error: any) {
    logger.error(`Error creating credit checkout session for user ${userId}:`, error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error.message || "Could not create checkout session.");
  }
});

export const stripeCreditWebhookHandler = onRequest(async (request, response) => {
  let stripe: Stripe;
  try {
    const stripeKey = params.STRIPE_SECRET_KEY.value();
    stripe = new Stripe(stripeKey, {apiVersion: "2025-05-28.basil"});
  } catch (e) {
    logger.error("Stripe not configured", e);
    response.status(500).send("Webhook Error: Stripe service not configured.");
    return;
  }
  const sig = request.headers["stripe-signature"];
  const webhookSecret = params.STRIPE_CREDIT_PURCHASE_WEBHOOK_SECRET.value();

  if (!sig || !webhookSecret) {
    logger.error("Missing stripe signature or credit purchase webhook secret");
    response.status(400).send("Webhook Error: Missing signature or secret.");
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(request.rawBody, sig, webhookSecret);
  } catch (err: any) {
    logger.error("Webhook signature verification failed:", err);
    response.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const {firebaseUID, creditAmount, priceId} = session.metadata || {};

    if (!firebaseUID || !creditAmount) {
      logger.warn("Webhook received checkout.session.completed without required metadata.", session.id);
      response.status(200).send("Received but missing metadata.");
      return;
    }

    const userId = firebaseUID;
    const creditsToAdd = parseInt(creditAmount, 10);
    if (isNaN(creditsToAdd)) {
      logger.error("Invalid creditAmount in webhook metadata:", creditAmount);
      response.status(400).send("Invalid credit amount in metadata.");
      return;
    }

    try {
      const userRef = db.collection("users").doc(userId);
      const transactionRef = db.collection("credit_transactions").doc();

      await db.runTransaction(async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists) {
          throw new Error(`User with ID ${userId} not found.`);
        }
        transaction.update(userRef, {
          credits: admin.firestore.FieldValue.increment(creditsToAdd),
        });
        transaction.set(transactionRef, {
          userId: userId,
          creditAmount: creditsToAdd,
          priceId: priceId || "unknown",
          checkoutSessionId: session.id,
          status: "completed",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        } as Omit<CreditTransaction, "id">);
      });

      logger.info(`Successfully added ${creditsToAdd} credits to user ${userId}.`);
    } catch (error: any) {
      logger.error(`Error updating user credits for user ${userId}:`, error);
      response.status(500).send("Internal server error while updating credits.");
      return;
    }
  }

  response.status(200).send("Received");
});
