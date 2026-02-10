
import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import sgMail from "@sendgrid/mail";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";
import * as params from "../config/params";

// Initialize SendGrid
const sendgridKey = params.SENDGRID_API_KEY.value();
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

    // Fetch user's display name
    const userDoc = await db.collection("users").doc(userId).get();
    const userData = userDoc.data();
    const fromName = userData?.displayName || "Verza";


    // Validate request body
    const {to, subject, text, html, contractId} = request.body;
    if (!to || !subject || !text || !html) {
      response.status(400).json({error: "Bad Request", message: "Missing required fields: to, subject, text, html."});
      return;
    }

    const msg: sgMail.MailDataRequired = {
      to,
      from: {
        name: fromName,
        email: params.SENDGRID_FROM_EMAIL.value(),
      },
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
 * @param {string} inviteeEmail The email of the person to invite.
 * @param {string} agencyName The name of the agency inviting the talent.
 * @param {boolean} isExistingUser Whether the talent is already a Verza user.
 * @param {'talent' | 'team'} type The type of invitation being sent.
 * @param {'admin' | 'member'} [role] The role if it's a team invitation.
 * @return {Promise<void>}
 */
export async function sendAgencyInvitationEmail(inviteeEmail: string, agencyName: string,
  isExistingUser: boolean, type: "talent" | "team", role?: "admin" | "member"): Promise<void> {
  const appUrl = params.APP_URL.value();
  const subject = `You've been invited to join ${agencyName} on Verza`;
  const actionUrl = isExistingUser ? `${appUrl}/agency` : `${appUrl}/login`;
  const actionText = isExistingUser ? "View Invitation" : "Sign Up & Accept";

  let html: string;

  if (type === "talent") {
    html = `
      <h2>You've been invited to join ${agencyName}'s Roster!</h2>
      <p>Hello,</p>
      <p><strong>${agencyName}</strong> is using Verza to manage their contracts and has invited you to join their talent roster.
      ${isExistingUser ? "Log in to your account to view and accept your invitation." :
    "Create your free Verza account to accept the invitation and start collaborating."}</p>
      <p><a href="${actionUrl}" style="padding: 10px 15px; background-color: #6B37FF; color: white;
      text-decoration: none; border-radius: 5px;">${actionText}</a></p>
      <p>Thanks,<br/>The Verza Team</p>
    `;
  } else { // Team member
    html = `
      <h2>You've been invited to join the ${agencyName} Team!</h2>
      <p>Hello,</p>
      <p>You have been invited to join the management team for <strong>${agencyName}</strong>
      on Verza as an <strong>${role}</strong>.
      ${isExistingUser ? "Log in to your account to view and accept your invitation." :
    "Create your free Verza account to accept the invitation and start collaborating."}</p>
      <p><a href="${actionUrl}" style="padding: 10px 15px; background-color: #6B37FF; color: white;
      text-decoration: none; border-radius: 5px;">${actionText}</a></p>
      <p>Thanks,<br/>The Verza Team</p>
    `;
  }

  const msg = {
    to: inviteeEmail,
    from: {name: "Verza", email: params.SENDGRID_FROM_EMAIL.value()},
    subject,
    html,
  };

  try {
    await sgMail.send(msg);
    logger.info(`Agency ${type} invitation email sent to ${inviteeEmail} for agency ${agencyName}.`);
  } catch (error) {
    logger.error(`Failed to send agency invitation email to ${inviteeEmail}:`, error);
  }
}

/**
 * Sends a specific email from a sequence to a user.
 * @param {string} toEmail The recipient's email address.
 * @param {string} name The recipient's name.
 * @param {number} step The step number of the email in the sequence.
 */
export async function sendEmailSequence(toEmail: string, name: string, step: number): Promise<void> {
  const appUrl = params.APP_URL.value();

  let subject = "";
  let html = "";
  const signature = "<p>Cheers,<br/>Serge Amouzou<br/>Founder & CEO of Verza</p>";

  switch (step) {
  case 0: // Welcome Email
    subject = "Welcome to Verza! Your First Step to Smarter Contracts.";
    html = `
        <h1>Welcome, ${name}!</h1>
        <p>I'm Serge, the founder of Verza, and I'm thrilled to have you on board.
        Our goal is to help you manage your contracts, get paid on time, and understand your business like never before.</p>
        <p>The best way to get started is to <strong>add your first contract</strong>.
        Our AI will automatically extract key details and give you negotiation insights.</p>
        <p><a href="${appUrl}/contracts">Click here to add a contract now</a></p>
        ${signature}
      `;
    break;
  case 1: // Educational Email #1: Contract Analysis
    subject = "Don't Just Sign Contracts, Understand Them";
    html = `
        <h1>Unlock Your Contract's Secrets</h1>
        <p>Hi ${name},</p>
        <p>Confusing contract clauses? Verza's AI can help. When you upload a contract,
        we automatically summarize the key terms and provide negotiation suggestions to help you get a better deal.</p>
        <p>Stop guessing and start understanding. Analyze your first contract today.</p>
        <p><a href="${appUrl}/contracts">Analyze a Contract</a></p>
        ${signature}
      `;
    break;
  case 2: // Educational Email #2: Getting Paid
    subject = "From Signed to Paid: The Verza Workflow";
    html = `
        <h1>Get Paid Faster</h1>
        <p>Hi ${name},</p>
        <p>Once your contract is in Verza, getting paid is simple. Generate a professional invoice, send it to your client,
        and accept secure payments with Stripe.</p>
        <p>Stop chasing payments and let Verza handle the reminders.</p>
        <p><a href="${appUrl}/settings">Connect Stripe to Get Paid</a></p>
        ${signature}
      `;
    break;
    // Add more cases for future emails
  default:
    logger.info(`No email template configured for step ${step}.`);
    return;
  }

  const fromName = "Serge from Verza";

  const msg = {
    to: toEmail,
    from: {
      name: fromName,
      email: params.SENDGRID_FROM_EMAIL.value(),
    },
    subject: subject,
    html: html,
  };

  try {
    await sgMail.send(msg);
    logger.info(`Email sequence step ${step} sent to ${toEmail}.`);
    await db.collection("emailLogs").add({
      to: toEmail,
      subject,
      html,
      type: "onboarding",
      timestamp: admin.firestore.Timestamp.now(),
      status: "sent",
    });
  } catch (error) {
    logger.error(`Failed to send email sequence step ${step} to ${toEmail}:`, error);
  }
}
