
import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import sgMail from "@sendgrid/mail";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";

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

// Send contract notification
export const sendContractNotification = onRequest(async (request, response) => {
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
    // Verify authentication
    const userId = await verifyAuthToken(request.headers.authorization);

    // Validate request body
    const {to, subject, text, html, contractId} = request.body;
    if (!to || !subject || !text || !html) {
      response.status(400).json({error: "Bad Request", message: "Missing required fields: to, subject, text, html."});
      return;
    }

    const msg: sgMail.MailDataRequired = {
      to,
      from: process.env.SENDGRID_FROM_EMAIL || "serge@tryverza.com",
      subject,
      text,
      html,
      customArgs: {
        userId,
        contractId: contractId || "", // Pass contractId as a custom argument
      },
    };

    await sgMail.send(msg);

    // Log the email to Firestore
    const emailLogRef = db.collection("emailLogs").doc();
    await emailLogRef.set({
      userId,
      to,
      subject,
      text,
      html, // Storing the HTML content
      contractId: contractId || null,
      type: subject.toLowerCase().includes("invoice") ? "invoice" : "generic",
      timestamp: admin.firestore.Timestamp.now(),
      status: "sent",
    });

    // Update contract history with the emailLogId
    if (contractId) {
      await db.collection("contracts").doc(contractId).update({
        invoiceHistory: admin.firestore.FieldValue.arrayUnion({
          timestamp: admin.firestore.Timestamp.now(),
          action: "Invoice Sent to Client",
          details: `To: ${to}`,
          emailLogId: emailLogRef.id, // Link to the log entry
        }),
      });
    }

    response.json({status: "success", emailLogId: emailLogRef.id});
  } catch (error) {
    logger.error("Error sending email:", error);
    response.status(500).json({
      error: "Failed to send email",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});


export const handleSendGridEmailWebhook = onRequest(async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).send("Method Not Allowed");
    return;
  }

  // SendGrid sends events in an array
  const events = request.body;
  if (!Array.isArray(events)) {
    logger.warn("Received non-array payload for SendGrid webhook:", request.body);
    response.status(400).send("Bad Request: Expected an array of events.");
    return;
  }

  logger.info(`Received ${events.length} event(s) from SendGrid.`);

  // Process events without waiting for Firestore writes to complete
  for (const event of events) {
    const {event: eventType, contractId, email} = event;

    if (eventType === "open" && contractId) {
      logger.info(`Processing 'open' event for contract ID: ${contractId}`);
      try {
        const contractRef = db.collection("contracts").doc(contractId);

        // Use a transaction or batched write if you need to perform multiple reads/writes atomically.
        // For this case, a simple update is sufficient, but we should be careful about race conditions.
        // We can check if the "viewed" status already exists to avoid duplicate history entries.
        const contractDoc = await contractRef.get();
        if (contractDoc.exists) {
          const contractData = contractDoc.data();
          const history = contractData?.invoiceHistory || [];
          const alreadyViewed = history.some((h: any) => h.action === "Invoice Viewed by Client");

          if (!alreadyViewed) {
            await contractRef.update({
              invoiceStatus: "viewed",
              invoiceHistory: admin.firestore.FieldValue.arrayUnion({
                timestamp: admin.firestore.Timestamp.now(),
                action: "Invoice Viewed by Client",
                details: `Email opened by ${email}`,
              }),
            });
            logger.info(`Updated contract ${contractId} to 'viewed'.`);
          } else {
            logger.info(`Contract ${contractId} already marked as viewed. Skipping update.`);
          }
        }
      } catch (error) {
        logger.error(`Error processing webhook for contract ${contractId}:`, error);
        // Don't throw error, just log and continue, so SendGrid doesn't retry this event.
      }
    }
  }

  // Respond to SendGrid immediately to acknowledge receipt of the event(s)
  response.status(200).send("Webhook received");
});


/**
 * Sends an invitation email to a talent for an agency.
 * @param {string} talentEmail The email of the talent to invite.
 * @param {string} agencyName The name of the agency inviting the talent.
 * @param {boolean} isExistingUser Whether the talent is already a Verza user.
 * @return {Promise<void>}
 */
export async function sendAgencyInvitationEmail(talentEmail: string, agencyName: string, isExistingUser: boolean): Promise<void> {
  const appUrl = process.env.APP_URL || "http://localhost:9002";
  const subject = `You've been invited to join ${agencyName} on Verza`;
  let text;
  let html;
  const actionUrl = isExistingUser ? `${appUrl}/agency` : `${appUrl}/login`;
  const actionText = isExistingUser ? "View Invitation" : "Sign Up & Accept";

  if (isExistingUser) {
    text = `You've been invited to join ${agencyName} on Verza.
    Log in to your account to accept the invitation and start collaborating. Visit: ${actionUrl}`;
    html = `
      <h2>Invitation to Join ${agencyName}</h2>
      <p>Hello,</p>
      <p>You have been invited to join <strong>${agencyName}</strong> on the Verza platform.
      Log in to your account to view and accept your invitation.</p>
      <p><a href="${actionUrl}"
      style="padding: 10px 15px; background-color: #007bff; color: white;
      text-decoration: none; border-radius: 5px;">${actionText}</a></p>
      <p>Thanks,<br/>The Verza Team</p>
    `;
  } else {
    text = `${agencyName} has invited you to join them on Verza, a platform for creator contract management.
    Sign up to get started. Visit: ${actionUrl}`;
    html = `
      <h2>${agencyName} Wants to Collaborate!</h2>
      <p>Hello,</p>
      <p><strong>${agencyName}</strong> is using Verza to manage their contracts and has invited you to join them.
      Create your free Verza account to accept the invitation and start collaborating.</p>
      <p><a href="${actionUrl}" style="padding: 10px 15px; background-color: #007bff; color: white;
      text-decoration: none; border-radius: 5px;">${actionText}</a></p>
      <p>Thanks,<br/>The Verza Team</p>
    `;
  }

  const msg = {
    to: talentEmail,
    from: process.env.SENDGRID_FROM_EMAIL || "serge@tryverza.com",
    subject,
    text,
    html,
  };

  try {
    await sgMail.send(msg);
    logger.info(`Agency invitation email sent to ${talentEmail} for agency ${agencyName}.`);
  } catch (error) {
    logger.error(`Failed to send agency invitation email to ${talentEmail}:`, error);
    // We don't throw an error here to avoid failing the parent function, but we log it.
  }
}
