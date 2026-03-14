
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import {db} from "../config/firebase";
import sgMail from "@sendgrid/mail";
import * as admin from "firebase-admin";
import type {UserProfileFirestoreData, Contract, Agency, PaymentMilestone, CreditTransaction, Gig} from "./../types";
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
        const match = targetMilestone && lineItems.some((item) =>
          item.isMilestone && item.description === targetMilestone?.description);
        if (match) {
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

      const platformFee = Math.round(amountInCents * 0.15);
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

      const platformFee = Math.round(amountInCents * 0.15);
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
      const paymentIntent = event.data.object as any;
      let metadata = paymentIntent.metadata || {};
      const amount = paymentIntent.amount;
      const latestCharge = paymentIntent["latest_charge"];

      // Support manual invoices: if payment metadata is empty, check linked invoice
      if (paymentIntent.invoice && Object.keys(metadata).length === 0) {
        const invoice = await stripe.invoices.retrieve(paymentIntent.invoice as string);
        metadata = invoice.metadata || {};
        logger.info(`Extracted metadata from manual invoice ${invoice.id} for payment ${paymentIntent.id}.`);
      }

      const {
        contractId, userId, paymentType, internalPayoutId, agencyId,
        milestoneId, purchaseType, gigId, firebaseUID, creditAmount, priceId,
      } = metadata;

      if (internalPayoutId) {
        const payoutDocRef = db.collection("internalPayouts").doc(internalPayoutId);
        await payoutDocRef.update({
          status: "paid",
          paidAt: admin.firestore.Timestamp.now(),
        });
        logger.info(`Internal payout ${internalPayoutId} status updated to 'paid'.`);
      } else if (purchaseType === "agencyTopUp" && agencyId) {
        const agencyRef = db.collection("agencies").doc(agencyId);
        await db.runTransaction(async (transaction) => {
          const agencyDoc = await transaction.get(agencyRef);
          if (!agencyDoc.exists) throw new Error("Agency not found for top-up.");
          const currentBalance = agencyDoc.data()?.availableBalance || 0;
          const topUpAmount = amount / 100;
          transaction.update(agencyRef, {availableBalance: currentBalance + topUpAmount});
        });
        logger.info(`Agency ${agencyId} wallet topped up with $${amount / 100}.`);
      } else if (purchaseType === "creditPurchase" && firebaseUID && creditAmount) {
        const targetUserId = firebaseUID;
        const creditsToAdd = parseInt(creditAmount, 10);
        if (!isNaN(creditsToAdd)) {
          try {
            const userRef = db.collection("users").doc(targetUserId);
            const transactionRef = db.collection("credit_transactions").doc();
            await db.runTransaction(async (transaction) => {
              const userDoc = await transaction.get(userRef);
              if (!userDoc.exists) throw new Error(`User with ID ${targetUserId} not found.`);
              transaction.update(userRef, {credits: admin.firestore.FieldValue.increment(creditsToAdd)});
              transaction.set(transactionRef, {
                userId: targetUserId,
                creditAmount: creditsToAdd,
                priceId: priceId || "unknown",
                paymentIntentId: paymentIntent.id,
                status: "completed",
                createdAt: admin.firestore.FieldValue.serverTimestamp() as any,
              } as Omit<CreditTransaction, "id">);
            });
            logger.info(`Successfully added ${creditsToAdd} credits to user ${targetUserId} via handlePaymentSuccess.`);
          } catch (error) {
            logger.error(`Error updating user credits in handlePaymentSuccess for user ${targetUserId}:`, error);
          }
        }
      } else if (purchaseType === "gigFunding" && gigId && agencyId) {
        try {
          const gigRef = db.collection("gigs").doc(gigId);
          const agencyRef = db.collection("agencies").doc(agencyId);

          await db.runTransaction(async (transaction) => {
            const agencyDoc = await transaction.get(agencyRef);
            if (!agencyDoc.exists) throw new Error("Agency not found for gig funding.");
            const currentEscrow = agencyDoc.data()?.escrowBalance || 0;
            const fundingAmount = amount / 100;
            transaction.update(gigRef, {
              status: "open",
              fundingPaymentIntentId: paymentIntent.id,
            });
            transaction.update(agencyRef, {escrowBalance: currentEscrow + fundingAmount});
          });

          logger.info(`Successfully activated gig "${gigId}" and updated agency escrow.`);

          const ownerId = firebaseUID;
          const ownerDoc = await db.collection("users").doc(ownerId).get();
          const ownerData = ownerDoc.data() as UserProfileFirestoreData;

          if (ownerData?.email) {
            const sendgridKey = params.SENDGRID_API_KEY.value();
            if (sendgridKey) {
              sgMail.setApiKey(sendgridKey);
              const gigSnap = await gigRef.get();
              const gigData = gigSnap.data() as Gig;

              const receiptHtml = `
                <!DOCTYPE html><html><head><meta charset="utf-8"></head>
                <body style="background-color: #f4f4f7; padding: 40px 20px; font-family: 'Helvetica Neue', Helvetica, 
                Arial, sans-serif; -webkit-font-smoothing: antialiased;">
                <div style="max-width: 600px; margin: auto; padding: 40px; border: 1px solid #e2e8f0; border-radius: 16px; 
                background-color: #ffffff; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);">
                  <div style="text-align: center; margin-bottom: 32px;">
                    <div style="display: inline-block; padding: 8px 16px; background-color: #6B37FF; border-radius: 8px; 
                    color: #ffffff; font-weight: bold; font-size: 14px; margin-bottom: 16px;">VERZA SECURE</div>
                    <h1 style="color: #1a202c; margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.025em;">
                    Payment Confirmed</h1>
                    <p style="color: #718096; margin-top: 8px; font-size: 16px;">Project: ${gigData.title}</p>
                  </div>

                  <div style="background-color: #f8fafc; padding: 24px; border-radius: 12px; border: 1px solid #edf2f7; 
                  margin-bottom: 32px;">
                    <h2 style="font-size: 12px; font-weight: 700; text-transform: uppercase; tracking: 0.05em; 
                    color: #a0aec0; margin: 0 0 16px 0;">Funding Breakdown</h2>
                    <table style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <td style="padding: 12px 0; color: #4a5568; font-size: 15px;">Rate per Creator</td>
                        <td style="padding: 12px 0; color: #1a202c; font-size: 15px; font-weight: 600; 
                        text-align: right;">$${gigData.ratePerCreator.toLocaleString()}</td>
                      </tr>
                      <tr>
                        <td style="padding: 12px 0; color: #4a5568; font-size: 15px;">Creator Capacity</td>
                        <td style="padding: 12px 0; color: #1a202c; font-size: 15px; font-weight: 600; 
                        text-align: right;">${gigData.creatorsNeeded} Creators</td>
                      </tr>
                      <tr style="border-top: 2px solid #edf2f7;">
                        <td style="padding: 20px 0 0 0; color: #1a202c; font-weight: 800; font-size: 18px;">Total Funded</td>
                        <td style="padding: 20px 0 0 0; color: #6B37FF; font-weight: 800; text-align: right; 
                        font-size: 24px;">$${(amount / 100).toLocaleString()}</td>
                      </tr>
                    </table>
                  </div>

                  <div style="margin-bottom: 32px;">
                    <h2 style="font-size: 12px; font-weight: 700; text-transform: uppercase; tracking: 0.05em; 
                    color: #a0aec0; margin: 0 0 12px 0;">Legal & Usage</h2>
                    <div style="grid-template-columns: 1fr 1fr; display: grid; gap: 16px;">
                      <div style="padding: 16px; border: 1px solid #edf2f7; border-radius: 8px;">
                        <p style="margin: 0; font-size: 11px; color: #a0aec0; text-transform: uppercase; 
                        font-weight: bold;">Campaign Type</p>
                        <p style="margin: 4px 0 0 0; font-size: 14px; color: #2d3748; 
                        font-weight: 600;">${gigData.campaignType?.replace(/_/g, " ") || "Sponsorship"}</p>
                      </div>
                      <div style="padding: 16px; border: 1px solid #edf2f7; border-radius: 8px;">
                        <p style="margin: 0; font-size: 11px; color: #a0aec0; text-transform: uppercase; 
                        font-weight: bold;">Usage Rights</p>
                        <p style="margin: 4px 0 0 0; font-size: 14px; color: #2d3748; 
                        font-weight: 600;">${gigData.usageRights?.replace(/_/g, " ") || "1 Year"}</p>
                      </div>
                    </div>
                  </div>

                  <div style="padding: 20px; border-radius: 12px; background-color: #fffaf0; border: 1px solid #feebc8; 
                  margin-bottom: 32px;">
                    <p style="margin: 0; font-size: 13px; color: #7b341e; line-height: 1.6;">
                      <strong>Escrow Lock:</strong> These funds are now held in the Verza Campaign Vault. 
                      They will be released to creators only upon your approval of verified submissions.
                    </p>
                  </div>

                  <div style="text-align: center; border-top: 1px solid #edf2f7; padding-top: 32px;">
                    <p style="color: #a0aec0; font-size: 12px;">Transaction ID: ${paymentIntent.id}</p>
                    <p style="color: #a0aec0; font-size: 12px; margin-top: 4px;">
                    Powered by Verza &bull; Secure Financial Operations</p>
                  </div>
                </div>
                </body></html>`;
              await sgMail.send({
                to: ownerData.email,
                from: {name: "Verza", email: params.SENDGRID_FROM_EMAIL.value() || "invoices@tryverza.com"},
                subject: `Receipt: Funding for "${gigData.title}"`,
                html: receiptHtml,
              });
            }
          }
        } catch (error) {
          logger.error(`Error updating gig in handlePaymentSuccess for gig ${gigId}:`, error);
        }
      } else if (contractId) {
        const contractDocRef = db.collection("contracts").doc(contractId);
        const contractDoc = await contractDocRef.get();
        const contractData = contractDoc.data() as Contract;

        const updates: {[key: string]: unknown} = {
          updatedAt: admin.firestore.Timestamp.now(),
          invoiceHistory: admin.firestore.FieldValue.arrayUnion({
            timestamp: admin.firestore.Timestamp.now(),
            action: `Payment Received for ${milestoneId ? "Milestone" : "Invoice"}`,
            details: `PaymentIntent ID: ${paymentIntent.id}`,
          }),
        };

        let allMilestonesPaid = false;
        if (milestoneId && contractData.milestones) {
          const updatedMilestones = contractData.milestones.map((m) =>
            m.id === milestoneId ? {...m, status: "paid"} : m
          );
          updates.milestones = updatedMilestones;
          allMilestonesPaid = updatedMilestones.every((m) => m.status === "paid");
          updates.invoiceStatus = allMilestonesPaid ? "paid" : "partially_paid";
          updates.status = allMilestonesPaid ? "paid" : "partially_paid";
        } else {
          updates.invoiceStatus = "paid";
          updates.status = "paid";
          allMilestonesPaid = true;
        }

        await contractDocRef.update(updates);

        if (paymentType === "agency_payment" && agencyId) {
          const latestChargeId = latestCharge;
          if (latestChargeId) {
            const agencyDoc = await db.collection("agencies").doc(agencyId).get();
            const agencyData = agencyDoc.data() as Agency;
            const talentInfo = agencyData.talent.find((t) => t.userId === contractData.userId);

            if (agencyData && talentInfo && typeof talentInfo.commissionRate === "number") {
              const agencyOwnerUserDoc = await db.collection("users").doc(agencyData.ownerId).get();
              const agencyOwnerData = agencyOwnerUserDoc.data() as UserProfileFirestoreData;
              const talentUserDoc = await db.collection("users").doc(contractData.userId).get();
              const talentUserData = talentUserDoc.data() as UserProfileFirestoreData;

              if (agencyOwnerData.stripeAccountId && talentUserData.stripeAccountId) {
                const stripeFeeRaw = Math.round(amount * 0.029) + 30;
                const platformFeeRaw = Math.round(amount * 0.15);
                const netForDistribution = amount - stripeFeeRaw - platformFeeRaw;
                const agencyCommRaw = Math.round(netForDistribution * (talentInfo.commissionRate / 100));
                const talentShareAmount = netForDistribution - agencyCommRaw;

                if (agencyCommRaw > 0) {
                  await stripe.transfers.create({
                    amount: agencyCommRaw,
                    currency: "usd",
                    destination: agencyOwnerData.stripeAccountId,
                    source_transaction: latestChargeId,
                  });
                }
                if (talentShareAmount > 0) {
                  await stripe.transfers.create({
                    amount: talentShareAmount,
                    currency: "usd",
                    destination: talentUserData.stripeAccountId,
                    source_transaction: latestChargeId,
                  });
                }
              }
            }
          }
        }

        await db.collection("payments").add({
          paymentIntentId: paymentIntent.id,
          contractId,
          userId: userId || "",
          amount,
          currency: "usd",
          status: "succeeded",
          timestamp: admin.firestore.Timestamp.now(),
        });
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
      const dbInstance = admin.firestore();

      const usersRef = dbInstance.collection("users");
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

export const createGigFundingCheckoutSession = onCall(async (request) => {
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
  const {
    id: existingGigId,
    title,
    description,
    platforms,
    ratePerCreator,
    creatorsNeeded,
    videosPerCreator,
    campaignType,
    usageRights,
    allowWhitelisting,
  } = request.data;

  if (!title || !description || !platforms || !ratePerCreator || !creatorsNeeded || !videosPerCreator || !campaignType) {
    throw new HttpsError("invalid-argument", "Missing required gig details.");
  }

  const userDoc = await db.collection("users").doc(userId).get();
  const userData = userDoc.data() as UserProfileFirestoreData;
  if (!userData || !userData.primaryAgencyId) {
    throw new HttpsError("failed-precondition", "You must be part of an agency to post a gig.");
  }

  const agencyDoc = await db.collection("agencies").doc(userData.primaryAgencyId).get();
  if (!agencyDoc.exists) {
    throw new HttpsError("not-found", "Agency not found.");
  }
  const agencyData = agencyDoc.data() as Agency;
  const agencyOwnerDoc = await db.collection("users").doc(agencyData.ownerId).get();
  const agencyOwnerData = agencyOwnerDoc.data() as UserProfileFirestoreData;

  const now = Date.now();
  const isSubscribed = agencyOwnerData.subscriptionStatus === "active" ||
                      (agencyOwnerData.subscriptionStatus === "trialing" &&
                       agencyOwnerData.trialEndsAt &&
                       (agencyOwnerData.trialEndsAt as any).toMillis() > now);

  const hasAgencyPlan = agencyOwnerData.subscriptionPlanId?.startsWith("agency_");

  if (!isSubscribed || !hasAgencyPlan) {
    throw new HttpsError("failed-precondition",
      "An active Agency subscription is required to post gigs. Please upgrade your plan.");
  }

  let stripeCustomerId = agencyOwnerData.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: agencyOwnerData.email || undefined,
      name: agencyOwnerData.displayName || undefined,
      metadata: {firebaseUID: agencyData.ownerId},
    });
    stripeCustomerId = customer.id;
    await agencyOwnerDoc.ref.update({stripeCustomerId});
  }

  const gigRef = existingGigId ? db.collection("gigs").doc(existingGigId) : db.collection("gigs").doc();
  const gigDataToSet: Omit<Gig, "id"> = {
    brandId: userData.primaryAgencyId,
    brandName: agencyData.name,
    brandLogoUrl: agencyOwnerData.companyLogoUrl || null,
    title,
    description,
    platforms,
    ratePerCreator: Number(ratePerCreator),
    creatorsNeeded: Number(creatorsNeeded),
    videosPerCreator: Number(videosPerCreator),
    campaignType,
    usageRights: usageRights || null,
    allowWhitelisting: !!allowWhitelisting,
    acceptedCreatorIds: [],
    paidCreatorIds: [],
    status: "pending_payment",
    createdAt: admin.firestore.FieldValue.serverTimestamp() as any,
    fundedAmount: 0,
  };

  if (existingGigId) {
    const existingGigSnap = await gigRef.get();
    if (existingGigSnap.exists) {
      const existingData = existingGigSnap.data() as Gig;
      gigDataToSet.acceptedCreatorIds = existingData.acceptedCreatorIds || [];
      gigDataToSet.paidCreatorIds = existingData.paidCreatorIds || [];
    }
  }

  await gigRef.set(gigDataToSet, {merge: true});

  const totalAmount = ratePerCreator * creatorsNeeded;
  const totalAmountInCents = Math.round(totalAmount * 100);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: stripeCustomerId,
      invoice_creation: {enabled: true},
      payment_method_types: ["us_bank_account", "customer_balance"] as any[],
      payment_method_options: {
        customer_balance: {
          funding_type: "bank_transfer",
          bank_transfer: {
            type: "us_bank_transfer",
          },
        },
      },
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: `Funding for Gig: ${title}`,
            description: `Funding for ${creatorsNeeded} creators at $${ratePerCreator} each.`,
          },
          unit_amount: totalAmountInCents,
        },
        quantity: 1,
      }],
      success_url: `${params.APP_URL.value()}/gigs/${gigRef.id}?funding_success=true`,
      cancel_url: `${params.APP_URL.value()}/gigs/${gigRef.id}`,
      payment_intent_data: {
        metadata: {
          purchaseType: "gigFunding",
          firebaseUID: userId,
          agencyId: userData.primaryAgencyId,
          gigId: gigRef.id,
        },
      },
      metadata: {
        purchaseType: "gigFunding",
        firebaseUID: userId,
        agencyId: userData.primaryAgencyId,
        gigId: gigRef.id,
      },
    } as any);
    return {url: session.url};
  } catch (error: any) {
    logger.error(`Error creating gig funding checkout for user ${userId}:`, error);
    if (!existingGigId) {
      await gigRef.delete();
    }
    throw new Error(error.message || "Could not create checkout session.");
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
    throw new HttpsError("not-found", "User found.");
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
      invoice_creation: {enabled: true},
      line_items: [{price: priceId, quantity: 1}],
      success_url: `${params.APP_URL.value()}/scene-spawner?purchase_success=true`,
      cancel_url: `${params.APP_URL.value()}/scene-spawner`,
      payment_intent_data: {
        metadata: {
          firebaseUID: userId,
          creditAmount: creditAmount.toString(),
          priceId: priceId,
          purchaseType: "creditPurchase",
        },
      },
      metadata: {
        firebaseUID: userId,
        creditAmount: creditAmount.toString(),
        priceId: priceId,
        purchaseType: "creditPurchase",
      },
    } as any);

    return {url: session.url};
  } catch (error: any) {
    logger.error(`Error creating credit checkout session for user ${userId}:`, error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error.message || "Could not create checkout session.");
  }
});

export const createAgencyTopUpSession = onCall(async (request) => {
  let stripe: Stripe;
  try {
    const stripeKey = params.STRIPE_SECRET_KEY.value();
    stripe = new Stripe(stripeKey, {apiVersion: "2025-05-28.basil"});
  } catch (e) {
    logger.error("Stripe not configured", e);
    throw new HttpsError("failed-precondition", "Stripe is not configured.");
  }
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated.");
  }

  const {amount, agencyId} = request.data;
  if (!amount || amount < 10 || !agencyId) {
    throw new HttpsError("invalid-argument", "Minimum top-up is $10.");
  }

  const userId = request.auth.uid;
  const userDoc = await db.collection("users").doc(userId).get();
  const userData = userDoc.data() as UserProfileFirestoreData;

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

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: stripeCustomerId,
      invoice_creation: {enabled: true},
      payment_method_types: ["us_bank_account", "customer_balance"] as any[],
      payment_method_options: {
        customer_balance: {
          funding_type: "bank_transfer",
          bank_transfer: {
            type: "us_bank_transfer",
          },
        },
      },
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: "Verza Agency Budget Top-Up",
            description: "General funds for gig payments and bonuses.",
          },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      }],
      success_url: `${params.APP_URL.value()}/agency?topup_success=true`,
      cancel_url: `${params.APP_URL.value()}/agency`,
      payment_intent_data: {
        metadata: {
          purchaseType: "agencyTopUp",
          firebaseUID: userId,
          agencyId: agencyId,
        },
      },
      metadata: {
        purchaseType: "agencyTopUp",
        firebaseUID: userId,
        agencyId: agencyId,
      },
    } as any);
    return {url: session.url};
  } catch (error: any) {
    logger.error("Error creating top-up session:", error);
    throw new HttpsError("internal", "Could not create checkout session.");
  }
});
