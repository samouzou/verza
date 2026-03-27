
import {onRequest, onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import sgMail from "@sendgrid/mail";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";
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

  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (sendgridKey) {
    sgMail.setApiKey(sendgridKey);
  } else {
    logger.error("SENDGRID_API_KEY is not set. Emails will not be sent.");
    response.status(500).json({error: "Email service is not configured."});
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
      response.status(400).json({
        error: "Bad Request",
        message: "Missing required fields: to, subject, text, html.",
      });
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
  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set, skipping agency invitation email.");
    return;
  }
  sgMail.setApiKey(sendgridKey);

  const appUrl = params.APP_URL.value();
  const subject = `You've been invited to join ${agencyName} on Verza`;
  const actionUrl = isExistingUser ? `${appUrl}/agency` : `${appUrl}/login`;
  const actionText = isExistingUser ? "View Invitation" : "Sign Up & Accept";

  const emailLogoHeader = `
    <div style="text-align: center; margin-bottom: 30px;">
      <img src="https://app.tryverza.com/verza-icon.svg" alt="Verza" width="24" height="18" 
        style="vertical-align: middle; margin-right: 8px;">
      <span style="font-weight: bold; font-size: 24px; color: #000000; 
        vertical-align: middle; font-family: sans-serif;">Verza</span>
    </div>
  `;

  let bodyContent: string;

  if (type === "talent") {
    bodyContent = `
      <h2 style="color: #333; font-size: 20px;">You've been invited to join ${agencyName}'s Roster!</h2>
      <p style="color: #555; line-height: 1.6;">Hello,</p>
      <p style="color: #555; line-height: 1.6;"><strong>${agencyName}</strong> is using Verza to manage their contracts 
      and has invited you to join their talent roster.
      ${isExistingUser ? "Log in to your account to view and accept your invitation." :
    "Create your free Verza account to accept the invitation and start collaborating."}</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${actionUrl}" style="background-color: #6B37FF; color: white; padding: 12px 24px; 
        text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">${actionText}</a>
      </div>
    `;
  } else { // Team member
    bodyContent = `
      <h2 style="color: #333; font-size: 20px;">You've been invited to join the ${agencyName} Team!</h2>
      <p style="color: #555; line-height: 1.6;">Hello,</p>
      <p style="color: #555; line-height: 1.6;">You have been invited to join the management team for 
      <strong>${agencyName}</strong> on Verza as an <strong>${role}</strong>.
      ${isExistingUser ? "Log in to your account to view and accept your invitation." :
    "Create your free Verza account to accept the invitation and start collaborating."}</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${actionUrl}" style="background-color: #6B37FF; color: white; padding: 12px 24px; 
        text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">${actionText}</a>
      </div>
    `;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background-color: #f9f9f9; padding: 20px; font-family: sans-serif; margin: 0;">
      <div style="max-width: 600px; margin: auto; padding: 30px; border: 1px solid #eee; 
        border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        ${emailLogoHeader}
        ${bodyContent}
        <p style="color: #555; line-height: 1.6;">Thanks,<br/>The Verza Team</p>
      </div>
    </body>
    </html>
  `;

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
  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set, skipping email sequence.");
    return;
  }
  sgMail.setApiKey(sendgridKey);

  const appUrl = params.APP_URL.value();

  let subject = "";
  let content = "";
  const signature = `
    <p style="margin-top: 30px; font-size: 14px; color: #666;">
      Cheers,<br/>
      <strong>Serge Amouzou</strong><br/>
      Founder & CEO of Verza
    </p>
  `;

  const btnStyle = "background-color: #6B37FF; color: white; padding: 12px 24px; " +
                   "text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;";

  switch (step) {
  case 0: // Welcome & Deployment Network
    subject = "Welcome to Verza | The Operating System for Creators";
    content = `
        <h1 style="color: #333; font-size: 22px;">Welcome to the family, ${name}!</h1>
        <p style="color: #555; line-height: 1.6;">I'm Serge, the founder of Verza. We built this platform because the creator 
        economy is broken. High fees, slow payments, and "guesswork" marketing are holding us back.</p>
        <p style="color: #555; line-height: 1.6;">Verza is your new command center. Your first mission? 
        <strong>Browse the Deployment Network</strong>. Brands are looking for performance content right now.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/deployments" style="${btnStyle}">Browse Active Deployments</a>
        </div>
        ${signature}
      `;
    break;
  case 1: // AI Edge & Verza Score
    subject = "Master the \"Verza Score\" with AI";
    content = `
        <h1 style="color: #333; font-size: 22px;">Stop Guessing. Start Spawning.</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">On Verza,
        every piece of content passes through <strong>"The Gauntlet"</strong>—an 
        AI simulation of 10,000 Gen Z scrollers. Brands only pay for what performs.</p>
        <p style="color: #555; line-height: 1.6;">Use our <strong>Scene Spawner</strong> AI to iterate on your hooks and 
        visuals before you submit. It's your secret weapon to hitting that 65% benchmark and securing your payout.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/scene-spawner" style="${btnStyle}">Spawn Your First Scene</a>
        </div>
        ${signature}
      `;
    break;
  case 2: // Verified Metrics & Stripe
    subject = "Verified Metrics = Instant Payouts";
    content = `
        <h1 style="color: #333; font-size: 22px;">Turn Your Reach into Revenue</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">Brands prioritize creators with <strong>Verified Metrics</strong>. 
        By connecting your social accounts via our Insights tool, you show brands live engagement data they can trust.</p>
        <p style="color: #555; line-height: 1.6;">Once your work is verified and approved, funds are released 
        <strong>instantly</strong> from the Campaign Vault to your bank via Stripe. No more chasing invoices.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/insights" style="${btnStyle}">Verify Your Reach</a>
        </div>
        ${signature}
      `;
    break;
  default:
    logger.info(`No email template configured for step ${step}.`);
    return;
  }

  const emailLogoHeader = `
    <div style="text-align: center; margin-bottom: 30px;">
      <img src="https://app.tryverza.com/verza-icon.svg" alt="Verza" width="24" height="18" 
        style="vertical-align: middle; margin-right: 8px;">
      <span style="font-weight: bold; font-size: 24px; color: #000000; 
        vertical-align: middle; font-family: sans-serif;">Verza</span>
    </div>
  `;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${subject}</title>
    </head>
    <body style="background-color: #f9f9f9; padding: 20px; font-family: sans-serif; margin: 0;">
      <div style="max-width: 600px; margin: auto; padding: 30px; border: 1px solid #eee; 
        border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        ${emailLogoHeader}
        
        <div style="padding: 10px 0;">
          ${content}
        </div>

        <div style="text-align: center; border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">
          <p style="font-size: 12px; color: #999; margin: 0;">
            Verza &copy; ${new Date().getFullYear()} | The operating system for the creator economy.
          </p>
          <div style="margin-top: 10px;">
            <a href="${appUrl}/profile" style="font-size: 11px; color: #6B37FF; text-decoration: none;">Notification Settings</a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  const msg = {
    to: toEmail,
    from: {
      name: "Serge from Verza",
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

/**
 * Handles incoming feedback from users and routes it to support team.
 */
export const submitFeedback = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated to submit feedback.");
  }

  const {subject, message} = request.data;
  if (!subject || !message) {
    throw new HttpsError("invalid-argument", "Subject and message are required.");
  }

  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set.");
    throw new HttpsError("failed-precondition", "Email service not configured.");
  }
  sgMail.setApiKey(sendgridKey);

  const userId = request.auth.uid;
  const userDoc = await db.collection("users").doc(userId).get();
  const userData = userDoc.data();

  const fromEmail = userData?.email || "unknown@user.com";
  const fromName = userData?.displayName || "Verza User";

  const msg = {
    to: "support@tryverza.com",
    from: {
      name: "Verza App Feedback",
      email: params.SENDGRID_FROM_EMAIL.value(),
    },
    replyTo: fromEmail,
    subject: `[Feedback] ${subject}`,
    text: `Feedback from ${fromName} (${fromEmail}, UID: ${userId}):\n\nSubject: ${subject}\n\nMessage:\n${message}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px;">
        <h3>New Feedback Received</h3>
        <p><strong>From:</strong> ${fromName} (${fromEmail})</p>
        <p><strong>User ID:</strong> ${userId}</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <hr />
        <p style="white-space: pre-wrap; font-size: 16px; line-height: 1.5; color: #333;">${message}</p>
      </div>
    `,
  };

  try {
    await sgMail.send(msg);
    return {success: true};
  } catch (error: any) {
    logger.error("Error sending feedback email:", error);
    throw new HttpsError("internal", error.message || "Failed to send feedback.");
  }
});
