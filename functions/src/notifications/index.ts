
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
        <strong>Browse the Campaign Network</strong>. Brands are looking for performance content right now.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/campaigns" style="${btnStyle}">Browse Active Campaigns</a>
        </div>
        ${signature}
      `;
    break;
  case 1: // AI Edge & Verza Score
    subject = "How the Verza Score works — and why it matters for your payouts";
    content = `
        <h1 style="color: #333; font-size: 22px;">Brands only pay for content that performs.</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">Every piece of content you submit on Verza runs through
        <strong>"The Gauntlet"</strong> — an AI simulation that predicts how your content will perform
        with a real audience. It doesn't matter if you make 60-second clips or 60-minute deep dives.
        The Gauntlet evaluates what works for <em>your</em> format and platform.</p>
        <p style="color: #555; line-height: 1.6;">Hit the <strong>65% benchmark</strong> and your submission
        is approved. Miss it and you get specific AI feedback telling you exactly what to improve — so you
        can resubmit with confidence instead of guessing.</p>
        <p style="color: #555; line-height: 1.6;">Use our <strong>AI Studio</strong> to prototype and
        refine your content before you submit. Less rework, faster approvals, more payouts.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/ai-studio" style="${btnStyle}">Try AI Studio</a>
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
 * Maps an internal subscription plan ID to a human-readable plan name.
 * @param {string | undefined} planId The internal plan identifier.
 * @return {string} A readable plan name.
 */
function getPlanDisplayName(planId: string | null | undefined): string {
  if (!planId) return "Verza Plan";
  if (planId.includes("enterprise")) return "Agency Enterprise";
  if (planId.includes("network")) return "Agency Network";
  if (planId.includes("agency_pro")) return "Agency Pro";
  if (planId.includes("pilot")) return "Agency Pilot";
  if (planId.includes("individual")) return "Individual Pro";
  return "Verza Plan";
}

/**
 * Sends a subscription receipt email to a user on new subscription or renewal.
 * @param {string} toEmail The recipient's email address.
 * @param {string} name The recipient's display name.
 * @param {object} details Receipt details.
 * @param {string} details.planId The internal plan identifier.
 * @param {string} details.interval The billing interval ('month' or 'year').
 * @param {number} details.amountPaid The amount paid in cents.
 * @param {number} details.nextBillingDate Unix timestamp of the next billing date.
 * @param {string} details.transactionId The Stripe invoice or payment intent ID.
 * @param {'new' | 'renewal'} details.type Whether this is a new subscription or a renewal.
 * @return {Promise<void>}
 */
export async function sendSubscriptionReceiptEmail(
  toEmail: string,
  name: string,
  details: {
    planId: string | null | undefined;
    interval: string;
    amountPaid: number;
    nextBillingDate: number;
    transactionId: string;
    type: "new" | "renewal";
  }
): Promise<void> {
  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set, skipping subscription receipt email.");
    return;
  }
  sgMail.setApiKey(sendgridKey);

  const appUrl = params.APP_URL.value();
  const planName = getPlanDisplayName(details.planId);
  const intervalLabel = details.interval === "year" ? "Annual" : "Monthly";
  const amountFormatted = "$" + (details.amountPaid / 100)
    .toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const nextDate = details.nextBillingDate && details.nextBillingDate > 0 ?
    new Date(details.nextBillingDate * 1000)
      .toLocaleDateString("en-US", {year: "numeric", month: "long", day: "numeric"}) :
    "—";

  const isNew = details.type === "new";
  const subject = isNew ? "You're subscribed to Verza — receipt inside" : "Your Verza subscription has renewed";
  const headline = isNew ? "Subscription Confirmed" : "Renewal Confirmed";
  const subheadline = isNew ?
    `Welcome to ${planName}. Your account is fully active.` :
    `Your ${planName} plan has been successfully renewed.`;
  const vaultNote = isNew ?
    "Your plan is now active. Head to your dashboard to get started." :
    "Nothing changes on your end — your plan continues uninterrupted.";

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="background-color: #f4f4f7; padding: 40px 20px;
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
      <div style="max-width: 600px; margin: auto; padding: 40px; border: 1px solid #e2e8f0;
        border-radius: 16px; background-color: #ffffff;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);">

        <div style="text-align: center; margin-bottom: 30px;">
          <img src="https://app.tryverza.com/verza-icon.svg" alt="Verza" width="24" height="18"
            style="vertical-align: middle; margin-right: 8px;">
          <span style="font-weight: bold; font-size: 24px; color: #000000;
            vertical-align: middle; font-family: sans-serif;">Verza</span>
        </div>
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #1a202c; margin: 0; font-size: 28px; font-weight: 800;
            letter-spacing: -0.025em;">${headline}</h1>
          <p style="color: #718096; margin-top: 8px; font-size: 16px;">${subheadline}</p>
        </div>

        <div style="background-color: #f8fafc; padding: 24px; border-radius: 12px;
          border: 1px solid #edf2f7; margin-bottom: 32px;">
          <h2 style="font-size: 12px; font-weight: 700; text-transform: uppercase;
            color: #a0aec0; margin: 0 0 16px 0;">Subscription Breakdown</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 12px 0; color: #4a5568; font-size: 15px;">Plan</td>
              <td style="padding: 12px 0; color: #1a202c; font-size: 15px; font-weight: 600; text-align: right;">${planName}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; color: #4a5568; font-size: 15px;">Billing Interval</td>
              <td style="padding: 12px 0; color: #1a202c; font-size: 15px;
                font-weight: 600; text-align: right;">${intervalLabel}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; color: #4a5568; font-size: 15px;">Next Billing Date</td>
              <td style="padding: 12px 0; color: #1a202c; font-size: 15px; font-weight: 600; text-align: right;">${nextDate}</td>
            </tr>
            <tr style="border-top: 2px solid #edf2f7;">
              <td style="padding: 20px 0 0 0; color: #1a202c; font-weight: 800; font-size: 18px;">Amount Paid</td>
              <td style="padding: 20px 0 0 0; color: #6B37FF; font-weight: 800;
                text-align: right; font-size: 24px;">${amountFormatted}</td>
            </tr>
          </table>
        </div>

        <div style="padding: 20px; border-radius: 12px; background-color: #fffaf0;
          border: 1px solid #feebc8; margin-bottom: 32px;">
          <p style="margin: 0; font-size: 13px; color: #7b341e; line-height: 1.6;">
            <strong>Hi ${name} —</strong> ${vaultNote}
          </p>
        </div>

        <div style="text-align: center; margin-bottom: 32px;">
          <a href="${appUrl}/settings" style="background-color: #6B37FF; color: white;
            padding: 12px 28px; text-decoration: none; border-radius: 8px;
            font-weight: bold; font-size: 15px; display: inline-block;">Manage Subscription</a>
        </div>

        <div style="text-align: center; border-top: 1px solid #edf2f7; padding-top: 32px;">
          <p style="color: #a0aec0; font-size: 12px; margin: 0;">Transaction ID: ${details.transactionId}</p>
          <p style="color: #a0aec0; font-size: 12px; margin-top: 4px;">
            Powered by Verza &bull; High-Performance Financial Infrastructure</p>
        </div>

      </div>
    </body>
    </html>
  `;

  const msg = {
    to: toEmail,
    from: {name: "Verza", email: params.SENDGRID_FROM_EMAIL.value()},
    subject,
    html,
  };

  try {
    await sgMail.send(msg);
    logger.info(`Subscription receipt (${details.type}) sent to ${toEmail} for plan ${details.planId}.`);
    await db.collection("emailLogs").add({
      to: toEmail,
      subject,
      html,
      type: "subscription_receipt",
      timestamp: admin.firestore.Timestamp.now(),
      status: "sent",
    });
  } catch (error) {
    logger.error(`Failed to send subscription receipt to ${toEmail}:`, error);
  }
}

/**
 * Sends an email from the deployment onboarding sequence to the brand who posted it.
 * Step 0 is sent immediately when the deployment goes live. Steps 1–4 are drip emails.
 * @param {string} toEmail The recipient's email address.
 * @param {string} name The recipient's name.
 * @param {string} gigTitle The title of the deployment.
 * @param {string} gigId The Firestore ID of the deployment (for deep links).
 * @param {number} step The step number (0–4).
 */
export async function sendDeploymentEmailSequence(
  toEmail: string, name: string, gigTitle: string, gigId: string, step: number
): Promise<void> {
  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set, skipping deployment email sequence.");
    return;
  }
  sgMail.setApiKey(sendgridKey);

  const appUrl = params.APP_URL.value();
  const deploymentUrl = `${appUrl}/campaigns/${gigId}`;

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
  case 0: // Immediate — deployment is live
    subject = `Your deployment "${gigTitle}" is live`;
    content = `
      <h1 style="color: #333; font-size: 22px;">Your deployment is live, ${name}!</h1>
      <p style="color: #555; line-height: 1.6;"><strong>"${gigTitle}"</strong> is now visible to creators
      in the Verza marketplace. Here's what happens next:</p>
      <ul style="color: #555; line-height: 2;">
        <li>Creators will discover your campaign and apply for spots</li>
        <li>You review and accept the creators you want</li>
        <li>Accepted creators submit their work for your approval</li>
        <li>You approve and pay — funds go straight to their bank account</li>
      </ul>
      <p style="color: #555; line-height: 1.6;">Over the next week I'll walk you through each step as your
      campaign runs. Head to your deployment now to see who's applying.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${deploymentUrl}" style="${btnStyle}">View Your Deployment</a>
      </div>
      ${signature}
    `;
    break;

  case 1: // Day 2 — managing applications
    subject = `Creators are applying to "${gigTitle}" — here's how to manage them`;
    content = `
      <h1 style="color: #333; font-size: 22px;">Your first applications are in</h1>
      <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
      <p style="color: #555; line-height: 1.6;">Creators are discovering <strong>"${gigTitle}"</strong> in
      the marketplace. Here's how the acceptance flow works:</p>
      <ul style="color: #555; line-height: 2;">
        <li>Open your deployment and scroll to the creator list</li>
        <li>Review each applicant's profile, follower count, and engagement rate</li>
        <li>Accept the creators you want — they'll be notified immediately and get access to submit work</li>
      </ul>
      <p style="color: #555; line-height: 1.6;">Tip: the best creators move fast and take multiple campaigns
      at once. Fill your spots early.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${deploymentUrl}" style="${btnStyle}">Review Applications</a>
      </div>
      ${signature}
    `;
    break;

  case 2: // Day 4 — submissions and Verza Score
    subject = "How submissions and the Verza Score work";
    content = `
      <h1 style="color: #333; font-size: 22px;">Your creators are submitting work</h1>
      <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
      <p style="color: #555; line-height: 1.6;">Once a creator is accepted into <strong>"${gigTitle}"</strong>,
      they can upload their videos or links directly on the deployment page. Here's what you'll see:</p>
      <ul style="color: #555; line-height: 2;">
        <li><strong>Verza Score</strong> — an AI simulation of how the content performs with a real audience.
        If you required a score threshold, creators must hit it before their submission counts</li>
        <li><strong>AI Feedback</strong> — a breakdown of what's working and what isn't, so creators
        can improve before resubmitting</li>
        <li>You can see all scores and feedback before deciding to approve</li>
      </ul>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${deploymentUrl}" style="${btnStyle}">Review Submissions</a>
      </div>
      ${signature}
    `;
    break;

  case 3: // Day 7 — approving and paying
    subject = "Approve work and pay creators in one click";
    content = `
      <h1 style="color: #333; font-size: 22px;">Ready to pay your creators?</h1>
      <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
      <p style="color: #555; line-height: 1.6;">Once you're satisfied with a creator's submission on
      <strong>"${gigTitle}"</strong>, paying them is one step. Hit <strong>Approve & Pay</strong> on the
      deployment page — funds go directly to their bank account, no manual transfers needed.</p>
      <ul style="color: #555; line-height: 2;">
        <li>Every payout is logged and tracked on the deployment page</li>
        <li>The creator is notified the moment their payment is processed</li>
        <li>When all creators are paid, the campaign is automatically marked complete</li>
      </ul>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${deploymentUrl}" style="${btnStyle}">Process Payouts</a>
      </div>
      ${signature}
    `;
    break;

  case 4: // Day 10 — tracking performance
    subject = `Track the real-world results of "${gigTitle}"`;
    content = `
      <h1 style="color: #333; font-size: 22px;">See what your campaign actually drove</h1>
      <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
      <p style="color: #555; line-height: 1.6;">If you enabled affiliate tracking on
      <strong>"${gigTitle}"</strong>, each creator has their own unique link or promo code.
      From the deployment page you can see:</p>
      <ul style="color: #555; line-height: 2;">
        <li><strong>Clicks and conversions</strong> per creator — see who actually drove results</li>
        <li><strong>Earned rewards</strong> — tracked automatically against each creator's link</li>
        <li>Use this data to know exactly who to bring back for your next campaign</li>
      </ul>
      <p style="color: #555; line-height: 1.6;">The brands that win at performance marketing are the ones
      who double down on what worked. Your data is waiting.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${deploymentUrl}" style="${btnStyle}">View Deployment Results</a>
      </div>
      ${signature}
    `;
    break;

  default:
    logger.info(`No deployment email template configured for step ${step}.`);
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
    subject,
    html,
  };

  try {
    await sgMail.send(msg);
    logger.info(`Deployment email sequence step ${step} sent to ${toEmail} for gig ${gigId}.`);
    await db.collection("emailLogs").add({
      to: toEmail,
      subject,
      html,
      type: "deployment_onboarding",
      timestamp: admin.firestore.Timestamp.now(),
      status: "sent",
    });
  } catch (error) {
    logger.error(`Failed to send deployment email sequence step ${step} to ${toEmail}:`, error);
  }
}

/**
 * Sends an email from the agency onboarding sequence to a new agency owner.
 * Step 0 is sent immediately on agency creation. Steps 1–5 are drip emails.
 * @param {string} toEmail The recipient's email address.
 * @param {string} name The recipient's name.
 * @param {string} agencyName The name of the agency they created.
 * @param {number} step The step number (0–5).
 */
export async function sendAgencyEmailSequence(
  toEmail: string, name: string, agencyName: string, step: number
): Promise<void> {
  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set, skipping agency email sequence.");
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
  case 0: // Immediate — agency is live
    subject = `${agencyName} is officially live on Verza`;
    content = `
      <h1 style="color: #333; font-size: 22px;">Congrats, ${name} — your agency is live!</h1>
      <p style="color: #555; line-height: 1.6;"><strong>${agencyName}</strong> is now set up on Verza.
      You have a full command center waiting for you — here's what's ready to go:</p>
      <ul style="color: #555; line-height: 2;">
        <li><strong>Talent Roster</strong> — invite creators and manage your roster</li>
        <li><strong>Team Management</strong> — bring in admins and team members</li>
        <li><strong>Payouts</strong> — pay talent directly to their bank account</li>
        <li><strong>Deployments</strong> — run brand campaigns across your entire roster</li>
        <li><strong>AI Contracts</strong> — generate and send contracts in seconds</li>
      </ul>
      <p style="color: #555; line-height: 1.6;">Head to your dashboard to get started.
      Over the next two weeks I'll walk you through each feature one by one.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${appUrl}/agency" style="${btnStyle}">Go to Your Agency Dashboard</a>
      </div>
      ${signature}
    `;
    break;

  case 1: // Day 2 — invite talent
    subject = "Step 1: Build your roster — invite your first creator";
    content = `
      <h1 style="color: #333; font-size: 22px;">Your roster starts with one invite</h1>
      <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
      <p style="color: #555; line-height: 1.6;">The first thing to do inside <strong>${agencyName}</strong> is build
      your roster. From the agency dashboard, hit <strong>Invite Talent</strong> and enter a creator's email.</p>
      <p style="color: #555; line-height: 1.6;">They'll get an invitation, and once they accept they're live on
      your roster. You can also set a <strong>per-creator commission rate</strong> so every deal they close
      through Verza automatically calculates your cut.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${appUrl}/agency" style="${btnStyle}">Invite Your First Creator</a>
      </div>
      ${signature}
    `;
    break;

  case 2: // Day 4 — invite team
    subject = "Step 2: You don't have to run this alone";
    content = `
      <h1 style="color: #333; font-size: 22px;">Add your team to ${agencyName}</h1>
      <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
      <p style="color: #555; line-height: 1.6;">Running an agency is a team sport. Verza lets you bring in
      <strong>admins</strong> and <strong>members</strong> to help manage things:</p>
      <ul style="color: #555; line-height: 2;">
        <li><strong>Admins</strong> — full management access, plus automatic access to all agency contracts</li>
        <li><strong>Members</strong> — read-only access to keep everyone in the loop</li>
      </ul>
      <p style="color: #555; line-height: 1.6;">Invite anyone on your team and they'll be up to speed
      instantly — no back-and-forth needed.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${appUrl}/agency" style="${btnStyle}">Invite a Team Member</a>
      </div>
      ${signature}
    `;
    break;

  case 3: // Day 7 — payouts
    subject = "Step 3: Pay your talent fast — no more Venmo, no more chasing";
    content = `
      <h1 style="color: #333; font-size: 22px;">Payouts that actually work</h1>
      <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
      <p style="color: #555; line-height: 1.6;">Forget Venmo, wire transfers, and "I'll get you this week."
      Verza lets you pay your talent <strong>directly to their bank account</strong> in a few clicks —
      every payout is logged and tracked automatically.</p>
      <p style="color: #555; line-height: 1.6;">Your talent connects their bank account once, and every
      future payout lands there automatically. No chasing, no confusion.</p>
      <p style="color: #555; line-height: 1.6;">Head to your agency dashboard and try <strong>Create a Payout</strong>.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${appUrl}/agency" style="${btnStyle}">Create a Payout</a>
      </div>
      ${signature}
    `;
    break;

  case 4: // Day 10 — deployments
    subject = "Step 4: Launch a deployment campaign for your entire roster";
    content = `
      <h1 style="color: #333; font-size: 22px;">Run campaigns across your whole roster</h1>
      <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
      <p style="color: #555; line-height: 1.6;">Deployments let you run brand campaigns at scale.
      Create a deployment, set the rate per creator and how many you need, then fund it from your agency wallet.</p>
      <p style="color: #555; line-height: 1.6;">Assign creators from your roster, track submissions,
      and when work is approved <strong>payouts release automatically</strong> to their bank account.
      No manual steps, no delays.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${appUrl}/campaigns" style="${btnStyle}">Create a Campaign</a>
      </div>
      ${signature}
    `;
    break;

  case 5: // Day 14 — upgrade push
    subject = "Unlock the full agency suite on Verza";
    content = `
      <h1 style="color: #333; font-size: 22px;">You've seen the basics — here's what's next</h1>
      <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
      <p style="color: #555; line-height: 1.6;">You've set up <strong>${agencyName}</strong>, built your roster,
      and started running operations. The agency plan unlocks the tools that make everything faster:</p>
      <ul style="color: #555; line-height: 2;">
        <li><strong>AI Contract Generator</strong> — generate agency-ready contracts in seconds,
        no lawyers required</li>
        <li><strong>Webhook Integrations</strong> — connect your external tools and automate your workflow</li>
        <li><strong>Unlimited Talent</strong> — grow your roster without hitting a ceiling</li>
      </ul>
      <p style="color: #555; line-height: 1.6;">These are the tools serious agencies use to move faster
      than the competition.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${appUrl}/settings" style="${btnStyle}">Upgrade Your Plan</a>
      </div>
      ${signature}
    `;
    break;

  default:
    logger.info(`No agency email template configured for step ${step}.`);
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
    subject,
    html,
  };

  try {
    await sgMail.send(msg);
    logger.info(`Agency email sequence step ${step} sent to ${toEmail}.`);
    await db.collection("emailLogs").add({
      to: toEmail,
      subject,
      html,
      type: "agency_onboarding",
      timestamp: admin.firestore.Timestamp.now(),
      status: "sent",
    });
  } catch (error) {
    logger.error(`Failed to send agency email sequence step ${step} to ${toEmail}:`, error);
  }
}

/**
 * Sends an email to the brand owner when a creator secures a spot on their deployment.
 * @param {string} toEmail The brand owner's email address.
 * @param {string} brandName The brand owner's display name.
 * @param {string} creatorName The name of the creator or talent who joined.
 * @param {string} gigTitle The title of the deployment.
 * @param {string} gigId The Firestore document ID of the deployment.
 * @param {boolean} isAgencyAcceptance Whether the acceptance was made by an agency on behalf of talent.
 * @return {Promise<void>}
 */
export async function sendCreatorSecuredEmail(
  toEmail: string,
  brandName: string,
  creatorName: string,
  gigTitle: string,
  gigId: string,
  isAgencyAcceptance: boolean
): Promise<void> {
  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set, skipping creator secured email.");
    return;
  }
  sgMail.setApiKey(sendgridKey);

  const appUrl = params.APP_URL.value();
  const deploymentUrl = `${appUrl}/campaigns/${gigId}`;

  const emailLogoHeader = `
    <div style="text-align: center; margin-bottom: 30px;">
      <img src="https://app.tryverza.com/verza-icon.svg" alt="Verza" width="24" height="18"
        style="vertical-align: middle; margin-right: 8px;">
      <span style="font-weight: bold; font-size: 24px; color: #000000;
        vertical-align: middle; font-family: sans-serif;">Verza</span>
    </div>
  `;

  const btnStyle = "background-color: #6B37FF; color: white; padding: 12px 24px; " +
    "text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;";

  const subject = isAgencyAcceptance ?
    `An agency has filled a spot on "${gigTitle}"` :
    `${creatorName} secured a spot on "${gigTitle}"`;

  const headline = isAgencyAcceptance ?
    "A new creator just joined your deployment" :
    `${creatorName} is in`;

  const body = isAgencyAcceptance ?
    `An agency has assigned <strong>${creatorName}</strong> to your deployment
       <strong>"${gigTitle}"</strong>. Head to your deployment to review the roster
       and track content submissions.` :
    `<strong>${creatorName}</strong> just secured a spot on your deployment
       <strong>"${gigTitle}"</strong>. Head to your deployment to review the roster
       and track content submissions.`;

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
        <h1 style="color: #333; font-size: 22px;">${headline}</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${brandName},</p>
        <p style="color: #555; line-height: 1.6;">${body}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${deploymentUrl}" style="${btnStyle}">View Deployment</a>
        </div>
        <p style="margin-top: 30px; font-size: 14px; color: #666;">
          Cheers,<br/>
          <strong>Serge Amouzou</strong><br/>
          Founder &amp; CEO of Verza
        </p>
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

  try {
    await sgMail.send({
      to: toEmail,
      from: {name: "Serge from Verza", email: params.SENDGRID_FROM_EMAIL.value()},
      subject,
      html,
    });
    logger.info(`Creator secured email sent to ${toEmail} for deployment ${gigId}.`);
  } catch (error) {
    logger.error(`Failed to send creator secured email to ${toEmail}:`, error);
  }
}

export const notifyBrandCreatorJoined = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated.");
  }

  const {gigId, creatorName, isAgencyAcceptance} = request.data;
  if (!gigId || !creatorName) {
    throw new HttpsError("invalid-argument", "gigId and creatorName are required.");
  }

  try {
    const gigSnap = await db.collection("gigs").doc(gigId).get();
    if (!gigSnap.exists) {
      throw new HttpsError("not-found", "Campaign not found.");
    }
    const gigData = gigSnap.data() as {title: string; brandId: string};

    const agencySnap = await db.collection("agencies").doc(gigData.brandId).get();
    if (!agencySnap.exists) return {success: true};
    const agencyData = agencySnap.data() as {ownerId: string; name: string};

    const ownerSnap = await db.collection("users").doc(agencyData.ownerId).get();
    if (!ownerSnap.exists) return {success: true};
    const ownerData = ownerSnap.data() as {email: string | null; displayName: string | null};

    if (!ownerData.email) return {success: true};

    await sendCreatorSecuredEmail(
      ownerData.email,
      ownerData.displayName || agencyData.name,
      creatorName,
      gigData.title,
      gigId,
      isAgencyAcceptance ?? false
    );

    return {success: true};
  } catch (error: any) {
    logger.error(`Error in notifyBrandCreatorJoined for gig ${gigId}:`, error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error.message || "Failed to send notification email.");
  }
});

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
