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
    const {to, subject, text, html} = request.body;
    if (!to || !subject || !text || !html) {
      throw new Error("Missing required fields in request body");
    }

    // Optional: Verify user has permission to send to this email
    // This could be based on your business logic, e.g., checking if the email
    // is associated with a contract the user has access to
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      throw new Error("User not found");
    }

    const msg = {
      to,
      from: process.env.SENDGRID_FROM_EMAIL || "serge@datatrixs.com",
      subject,
      text,
      html,
    };

    await sgMail.send(msg);

    // Log the email sending
    await db.collection("emailLogs").add({
      userId,
      to,
      subject,
      timestamp: admin.firestore.Timestamp.now(),
      status: "sent",
    });

    // Add invoice history entry if this is an invoice email
    if (subject.toLowerCase().includes("invoice")) {
      const contractId = request.body.contractId;
      if (contractId) {
        await db.collection("contracts").doc(contractId).update({
          invoiceHistory: admin.firestore.FieldValue.arrayUnion({
            timestamp: admin.firestore.Timestamp.now(),
            action: "Invoice Sent to Client",
            details: `To: ${to}`,
          }),
        });
      }
    }

    response.json({status: "success"});
  } catch (error) {
    logger.error("Error sending email:", error);
    response.status(401).json({
      error: "Failed to send email",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Send payment reminder
export const sendPaymentReminder = onRequest(async (request, response) => {
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
    const {to, contractId, dueDate, amount} = request.body;
    if (!to || !contractId || !dueDate || !amount) {
      throw new Error("Missing required fields in request body");
    }

    // Verify user has access to this contract
    const contractDoc = await db.collection("contracts").doc(contractId).get();
    if (!contractDoc.exists || contractDoc.data()?.userId !== userId) {
      throw new Error("Contract not found or access denied");
    }

    const msg = {
      to,
      from: process.env.SENDGRID_FROM_EMAIL || "serge@datatrixs.com",
      subject: "Payment Reminder",
      text: `This is a reminder that your payment of $${amount} for ` +
        `contract ${contractId} is due on ${dueDate}.`,
      html: `
        <h2>Payment Reminder</h2>
        <p>This is a reminder that your payment of $${amount} for ` +
        `contract ${contractId} is due on ${dueDate}.</p>
        <p>Please ensure your payment is made on time to avoid any late fees.</p>
        <p>Thank you,<br>The Verza Team</p>
      `,
    };

    await sgMail.send(msg);

    // Log the email sending
    await db.collection("emailLogs").add({
      userId,
      to,
      contractId,
      type: "payment_reminder",
      timestamp: admin.firestore.Timestamp.now(),
      status: "sent",
    });

    response.json({status: "success"});
  } catch (error) {
    logger.error("Error sending payment reminder:", error);
    response.status(401).json({
      error: "Failed to send payment reminder",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});
