
import {onRequest, onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import sgMail from "@sendgrid/mail";
import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import * as params from "../config/params";
import {EMAIL_BRAND_PRIMARY, emailButtonStyle} from "../emailBrand";

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
      timestamp: Timestamp.now(),
      status: "sent",
    });

    // Update contract history with the emailLogId
    if (contractId) {
      await db.collection("contracts").doc(contractId).update({
        invoiceHistory: FieldValue.arrayUnion({
          timestamp: Timestamp.now(),
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
          const history = (contractData?.invoiceHistory || []) as Array<{action?: string}>;
          const alreadyViewed = history.some((h) => h.action === "Invoice Viewed by Client");

          if (!alreadyViewed) {
            await contractRef.update({
              invoiceStatus: "viewed",
              invoiceHistory: FieldValue.arrayUnion({
                timestamp: Timestamp.now(),
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
        <a href="${actionUrl}" style="background-color: ${EMAIL_BRAND_PRIMARY}; color: white; padding: 12px 24px; 
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
        <a href="${actionUrl}" style="background-color: ${EMAIL_BRAND_PRIMARY}; color: white; padding: 12px 24px; 
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
 * @param {{audience?: "creator" | "brand" | "agency"}} [opts] Role-specific welcome copy for step 0.
 */
export async function sendEmailSequence(
  toEmail: string,
  name: string,
  step: number,
  opts?: {audience?: "creator" | "brand" | "agency"}
): Promise<void> {
  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set, skipping email sequence.");
    return;
  }
  sgMail.setApiKey(sendgridKey);

  const appUrl = params.APP_URL.value();
  const audience = opts?.audience ?? "creator";

  let subject = "";
  let content = "";
  const signature = `
    <p style="margin-top: 30px; font-size: 14px; color: #666;">
      Cheers,<br/>
      <strong>Serge Amouzou</strong><br/>
      Founder & CEO of Verza
    </p>
  `;

  const btnStyle = emailButtonStyle("6px");
  const secondaryLinkStyle =
    `color: ${EMAIL_BRAND_PRIMARY}; font-size: 14px; text-decoration: underline;`;

  switch (step) {
  case 0: // Welcome — role-specific
    if (audience === "brand" || audience === "agency") {
      const entity = audience === "brand" ? "brand" : "agency";
      const entityTitle = audience === "brand" ? "Brand" : "Agency";
      subject = `Welcome to Verza | Find creators. Run campaigns. Pay fast.`;
      content = `
        <h1 style="color: #333; font-size: 22px;">Welcome to Verza, ${name}!</h1>
        <p style="color: #555; line-height: 1.6;">I'm Serge, the founder of Verza. We built this so
        ${entity === "brand" ? "brands" : "agencies"} can find the right creators, run campaigns, and
        settle pay without spreadsheet casting or chasing invoices.</p>
        <p style="color: #555; line-height: 1.6;">Your next move: create your ${entity} workspace, then
        use <strong>Optic</strong> to search <strong>200M+ creators</strong> who match your brief —
        each lead lands in your vault with a creator report so you can invite the best fits first.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/agency" style="${btnStyle}">Create your ${entityTitle}</a>
        </div>
        <p style="text-align: center; margin: 0;">
          <a href="${appUrl}/optic" style="${secondaryLinkStyle}">Or open Optic</a>
        </p>
        ${signature}
      `;
    } else {
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
    }
    break;
  case 1: // AI Edge & Verza Score (creators only)
    if (audience !== "creator") {
      logger.info(`Skipping creator drip step ${step} for audience=${audience}.`);
      return;
    }
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
        <p style="color: #555; line-height: 1.6;">Use <strong>Reelwright</strong> to prototype and
        refine your content before you submit. Less rework, faster approvals, more payouts.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/ai-studio" style="${btnStyle}">Open Reelwright</a>
        </div>
        ${signature}
      `;
    break;
  case 2: // Verified Metrics & Stripe (creators only)
    if (audience !== "creator") {
      logger.info(`Skipping creator drip step ${step} for audience=${audience}.`);
      return;
    }
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
            <a href="${appUrl}/profile" style="font-size: 11px; color: ${EMAIL_BRAND_PRIMARY}; text-decoration: none;">Notification Settings</a>
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
      timestamp: Timestamp.now(),
      status: "sent",
    });
  } catch (error) {
    logger.error(`Failed to send email sequence step ${step} to ${toEmail}:`, error);
  }
}

/**
 * Sends the role-specific welcome email after onboarding role selection.
 * Creators keep the creator drip; brands/agencies get a discovery-focused welcome and
 * are removed from the creator drip sequence.
 */
export const sendOnboardingWelcomeEmail = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to finish onboarding.");
  }

  const uid = request.auth.uid;
  const userRef = db.collection("users").doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "User profile not found.");
  }

  const user = snap.data() as {
    email?: string | null;
    displayName?: string | null;
    role?: string | null;
    isBrandAccount?: boolean;
    welcomeEmailSent?: boolean;
    hasCompletedOnboarding?: boolean;
  };

  if (user.welcomeEmailSent) {
    return {ok: true as const, alreadySent: true};
  }
  if (!user.email) {
    throw new HttpsError("failed-precondition", "Add an email to your account first.");
  }

  const name = user.displayName || "there";
  const isCreator = user.role === "individual_creator";
  const isBrand = user.isBrandAccount === true;
  const audience: "creator" | "brand" | "agency" = isCreator ?
    "creator" :
    isBrand ? "brand" : "agency";

  await sendEmailSequence(user.email, name, 0, {audience});

  const twoDaysFromNow = new Timestamp(
    Timestamp.now().seconds + 2 * 24 * 60 * 60,
    0
  );

  if (isCreator) {
    await userRef.update({
      welcomeEmailSent: true,
      emailSequence: {step: 1, nextEmailAt: twoDaysFromNow},
    });
  } else {
    await userRef.update({
      welcomeEmailSent: true,
      emailSequence: FieldValue.delete(),
    });
  }

  logger.info("[Welcome] Onboarding welcome sent", {uid, audience});
  return {ok: true as const, audience};
});

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
              <td style="padding: 20px 0 0 0; color: ${EMAIL_BRAND_PRIMARY}; font-weight: 800;
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
          <a href="${appUrl}/settings" style="background-color: ${EMAIL_BRAND_PRIMARY}; color: white;
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
      timestamp: Timestamp.now(),
      status: "sent",
    });
  } catch (error) {
    logger.error(`Failed to send subscription receipt to ${toEmail}:`, error);
  }
}

/**
 * Readable Optic plan label for transactional emails.
 * @param {string | null | undefined} opticPlanId Internal plan id.
 * @return {string} Display name.
 */
function getOpticPlanDisplayName(opticPlanId: string | null | undefined): string {
  if (!opticPlanId) return "Optic";
  if (opticPlanId.includes("flagship")) return "Optic Flagship";
  if (opticPlanId.includes("enterprise")) return "Optic Enterprise";
  if (opticPlanId.includes("launch")) return "Optic Launch";
  if (opticPlanId.includes("pilot")) return "Optic Studio";
  return "Optic";
}

/**
 * Sends an Optic subscription receipt (new or renewal).
 * @param {string} toEmail Recipient email.
 * @param {string} name Recipient display name.
 * @param {object} details Receipt fields.
 * @return {Promise<void>}
 */
export async function sendOpticSubscriptionReceiptEmail(
  toEmail: string,
  name: string,
  details: {
    opticPlanId: string;
    interval: string;
    amountPaid: number;
    nextBillingDate: number;
    transactionId: string;
    type: "new" | "renewal";
    monthlyAllowance: number;
  }
): Promise<void> {
  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set, skipping Optic subscription receipt email.");
    return;
  }
  sgMail.setApiKey(sendgridKey);

  const appUrl = params.APP_URL.value();
  const planName = getOpticPlanDisplayName(details.opticPlanId);
  const intervalLabel = details.interval === "year" ? "Annual" : "Monthly";
  const amountFormatted = "$" + (details.amountPaid / 100)
    .toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const nextDate = details.nextBillingDate && details.nextBillingDate > 0 ?
    new Date(details.nextBillingDate * 1000)
      .toLocaleDateString("en-US", {year: "numeric", month: "long", day: "numeric"}) :
    "—";
  const leadsLabel = details.monthlyAllowance.toLocaleString("en-US");

  const isNew = details.type === "new";
  const subject = isNew ?
    "You're subscribed to Optic — receipt inside" :
    "Your Optic subscription has renewed";
  const headline = isNew ? "Optic Subscription Confirmed" : "Optic Renewal Confirmed";
  const subheadline = isNew ?
    `Welcome to ${planName}. Your lead credits are ready.` :
    `Your ${planName} plan has renewed and your credits have been refreshed.`;
  const vaultNote = isNew ?
    `You have ${leadsLabel} included leads this period. Run a discovery search in Optic to find creators who match your brief.` :
    `Your balance has been reset to ${leadsLabel} included leads for this billing period.`;

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
            vertical-align: middle; font-family: sans-serif;">Verza Optic</span>
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
              <td style="padding: 12px 0; color: #4a5568; font-size: 15px;">Included Leads</td>
              <td style="padding: 12px 0; color: #1a202c; font-size: 
              15px; font-weight: 600; text-align: right;">${leadsLabel}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; color: #4a5568; font-size: 15px;">Next Billing Date</td>
              <td style="padding: 12px 0; color: #1a202c; font-size: 15px; font-weight: 600; text-align: right;">${nextDate}</td>
            </tr>
            <tr style="border-top: 2px solid #edf2f7;">
              <td style="padding: 20px 0 0 0; color: #1a202c; font-weight: 800; font-size: 18px;">Amount Paid</td>
              <td style="padding: 20px 0 0 0; color: ${EMAIL_BRAND_PRIMARY}; font-weight: 800;
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
          <a href="${appUrl}/optic" style="background-color: ${EMAIL_BRAND_PRIMARY}; color: white;
            padding: 12px 28px; text-decoration: none; border-radius: 8px;
            font-weight: bold; font-size: 15px; display: inline-block;">Open Optic</a>
        </div>

        <div style="text-align: center; border-top: 1px solid #edf2f7; padding-top: 32px;">
          <p style="color: #a0aec0; font-size: 12px; margin: 0;">Transaction ID: ${details.transactionId}</p>
          <p style="color: #a0aec0; font-size: 12px; margin-top: 4px;">
            Powered by Verza Optic</p>
        </div>

      </div>
    </body>
    </html>
  `;

  const msg = {
    to: toEmail,
    from: {name: "Verza Optic", email: params.SENDGRID_FROM_EMAIL.value()},
    subject,
    html,
  };

  try {
    await sgMail.send(msg);
    logger.info(`Optic subscription receipt (${details.type}) sent to ${toEmail}.`);
    await db.collection("emailLogs").add({
      to: toEmail,
      subject,
      html,
      type: "optic_subscription_receipt",
      timestamp: Timestamp.now(),
      status: "sent",
    });
  } catch (error) {
    logger.error(`Failed to send Optic subscription receipt to ${toEmail}:`, error);
  }
}

/**
 * Warns when included Optic credits are at or below 20% remaining (80% used).
 * @param {string} toEmail Recipient email.
 * @param {string} name Recipient display name.
 * @param {object} details Balance context.
 * @return {Promise<void>}
 */
export async function sendOpticLowCreditsEmail(
  toEmail: string,
  name: string,
  details: {
    balance: number;
    allowance: number;
    planName: string;
    planTier: "launch" | "pilot" | "enterprise" | "flagship";
  }
): Promise<void> {
  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set, skipping Optic low-credit email.");
    return;
  }
  sgMail.setApiKey(sendgridKey);

  const appUrl = params.APP_URL.value();
  const used = Math.max(0, details.allowance - details.balance);
  const usedPct = details.allowance > 0 ?
    Math.min(100, Math.round((used / details.allowance) * 100)) :
    0;
  const balanceLabel = details.balance.toLocaleString("en-US");
  const allowanceLabel = details.allowance.toLocaleString("en-US");
  const pilotNote = details.planTier === "pilot" ?
    " Studio will auto-purchase a 250-lead block ($500) when you run out, if a card is on file." :
    details.planTier === "launch" ?
      " Launch includes 100 leads per month and pauses when you hit the cap." :
      details.planTier === "flagship" ?
        " Flagship can continue past your included balance; overage is reviewed with your account team." :
        " Enterprise can continue past your included balance; overage is reviewed quarterly.";

  const subject = `Optic: ${usedPct}% of your included leads used this period`;
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
            vertical-align: middle; font-family: sans-serif;">Verza Optic</span>
        </div>
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #1a202c; margin: 0; font-size: 28px; font-weight: 800;
            letter-spacing: -0.025em;">Credits Running Low</h1>
          <p style="color: #718096; margin-top: 8px; font-size: 16px;">
            You've used about ${usedPct}% of your ${details.planName} included leads.
          </p>
        </div>

        <div style="background-color: #f8fafc; padding: 24px; border-radius: 12px;
          border: 1px solid #edf2f7; margin-bottom: 32px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 12px 0; color: #4a5568; font-size: 15px;">Remaining</td>
              <td style="padding: 12px 0; color: ${EMAIL_BRAND_PRIMARY}; font-size: 22px;
              font-weight: 800; text-align: right;">${balanceLabel}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; color: #4a5568; font-size: 15px;">Included this period</td>
              <td style="padding: 12px 0; color: #1a202c; font-size: 15px; 
              font-weight: 600; text-align: right;">${allowanceLabel}</td>
            </tr>
          </table>
        </div>

        <div style="padding: 20px; border-radius: 12px; background-color: #fffaf0;
          border: 1px solid #feebc8; margin-bottom: 32px;">
          <p style="margin: 0; font-size: 13px; color: #7b341e; line-height: 1.6;">
            <strong>Hi ${name} —</strong> You have ${balanceLabel} included leads left on ${details.planName}.${pilotNote}
          </p>
        </div>

        <div style="text-align: center; margin-bottom: 32px;">
          <a href="${appUrl}/optic" style="background-color: ${EMAIL_BRAND_PRIMARY}; color: white;
            padding: 12px 28px; text-decoration: none; border-radius: 8px;
            font-weight: bold; font-size: 15px; display: inline-block;">Open Optic</a>
          <p style="margin-top: 16px; font-size: 13px;">
            <a href="${appUrl}/optic/pricing" style="color: ${EMAIL_BRAND_PRIMARY};">Manage billing</a>
          </p>
        </div>

        <div style="text-align: center; border-top: 1px solid #edf2f7; padding-top: 32px;">
          <p style="color: #a0aec0; font-size: 12px; margin: 0;">Powered by Verza Optic</p>
        </div>

      </div>
    </body>
    </html>
  `;

  const msg = {
    to: toEmail,
    from: {name: "Verza Optic", email: params.SENDGRID_FROM_EMAIL.value()},
    subject,
    html,
  };

  try {
    await sgMail.send(msg);
    logger.info(`Optic low-credit warning sent to ${toEmail} (${balanceLabel}/${allowanceLabel}).`);
    await db.collection("emailLogs").add({
      to: toEmail,
      subject,
      html,
      type: "optic_low_credits",
      timestamp: Timestamp.now(),
      status: "sent",
    });
  } catch (error) {
    logger.error(`Failed to send Optic low-credit email to ${toEmail}:`, error);
  }
}

/**
 * Sends an email from the deployment onboarding sequence to the brand who posted it.
 * Step 0 is sent immediately when the deployment goes live. Steps 1–4 are drip emails.
 *
 * Steps 0–2 lead with Optic when the brand has not yet run a discovery search for this
 * campaign; once they have, those steps shift to managing applicants and submissions.
 * @param {string} toEmail The recipient's email address.
 * @param {string} name The recipient's name.
 * @param {string} gigTitle The title of the deployment.
 * @param {string} gigId The Firestore ID of the deployment (for deep links).
 * @param {number} step The step number (0–4).
 * @param {{hasOpticMission?: boolean}} [opts] Whether an Optic job already exists for this campaign.
 */
export async function sendDeploymentEmailSequence(
  toEmail: string,
  name: string,
  gigTitle: string,
  gigId: string,
  step: number,
  opts?: {hasOpticMission?: boolean}
): Promise<void> {
  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set, skipping deployment email sequence.");
    return;
  }
  sgMail.setApiKey(sendgridKey);

  const appUrl = params.APP_URL.value();
  const deploymentUrl = `${appUrl}/campaigns/${gigId}`;
  const opticUrl = `${appUrl}/optic?campaignId=${encodeURIComponent(gigId)}`;
  const vaultUrl = `${appUrl}/optic/vault`;
  const hasOpticMission = opts?.hasOpticMission === true;

  let subject = "";
  let content = "";

  const signature = `
    <p style="margin-top: 30px; font-size: 14px; color: #666;">
      Cheers,<br/>
      <strong>Serge Amouzou</strong><br/>
      Founder & CEO of Verza
    </p>
  `;

  const btnStyle = emailButtonStyle("6px");
  const secondaryLinkStyle =
    `color: ${EMAIL_BRAND_PRIMARY}; font-size: 14px; text-decoration: underline;`;

  switch (step) {
  case 0: // Immediate — campaign is live → Optic first
    subject = `Your campaign "${gigTitle}" is live — find creators with Optic`;
    content = `
      <h1 style="color: #333; font-size: 22px;">Your campaign is live, ${name}!</h1>
      <p style="color: #555; line-height: 1.6;"><strong>"${gigTitle}"</strong> is now open on Verza.
      Creators in the network can still apply — but the brands that fill campaigns fastest
      <strong>search Optic for creators who already fit the brief</strong>.</p>
      <p style="color: #555; line-height: 1.6;">Optic searches across <strong>200M+ creators</strong>
      for matches to your campaign (by platform, audience size, and niche), then saves each one
      to your vault with a <strong>creator report</strong> — match score and why they fit — so you
      can spot the best fits faster and put budget on the right creators first.</p>
      <ul style="color: #555; line-height: 2;">
        <li>Search Optic for creators that match this campaign</li>
        <li>Open creator reports in your vault, then reach out</li>
        <li>Accept creators on the campaign page when they’re ready to produce</li>
      </ul>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${opticUrl}" style="${btnStyle}">Find matching creators</a>
      </div>
      <p style="text-align: center; margin: 0;">
        <a href="${deploymentUrl}" style="${secondaryLinkStyle}">Or view your campaign</a>
      </p>
      ${signature}
    `;
    break;

  case 1: // Day 2
    if (!hasOpticMission) {
      subject = `Still waiting on applicants for "${gigTitle}"? Search Optic`;
      content = `
        <h1 style="color: #333; font-size: 22px;">Don’t wait for the right creators to find you</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;"><strong>"${gigTitle}"</strong> is live, but we haven’t
        seen an Optic search tied to it yet. Marketplace applications are helpful — Optic is how
        you search <strong>200M+ creators</strong> for people who actually fit the brief.</p>
        <ul style="color: #555; line-height: 2;">
          <li>Search Instagram, TikTok, YouTube, and more</li>
          <li>Filter by audience size (nano → macro)</li>
          <li>Compare creator reports in your vault before you spend outreach time</li>
        </ul>
        <p style="color: #555; line-height: 1.6;">A short search (5–10 creators) is enough to start
        filling spots this week — with reports that show who fits before you invite them.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${opticUrl}" style="${btnStyle}">Search creators with Optic</a>
        </div>
        <p style="text-align: center; margin: 0;">
          <a href="${deploymentUrl}" style="${secondaryLinkStyle}">Review applications on your campaign</a>
        </p>
        ${signature}
      `;
    } else {
      subject = `Creators for "${gigTitle}" — review applications & Optic reports`;
      content = `
        <h1 style="color: #333; font-size: 22px;">Your pipeline is moving</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">You’ve already searched for
        <strong>"${gigTitle}"</strong> with Optic — nice. Here’s how to keep filling spots:</p>
        <ul style="color: #555; line-height: 2;">
          <li>Open creator reports in your vault and send the drafted outreach</li>
          <li>Accept marketplace applicants you like on the campaign page</li>
          <li>Run another Optic search if you still need more fits</li>
        </ul>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${deploymentUrl}" style="${btnStyle}">Open your campaign</a>
        </div>
        <p style="text-align: center; margin: 0;">
          <a href="${vaultUrl}" style="${secondaryLinkStyle}">Review creator reports</a>
          &nbsp;·&nbsp;
          <a href="${opticUrl}" style="${secondaryLinkStyle}">Search again in Optic</a>
        </p>
        ${signature}
      `;
    }
    break;

  case 2: // Day 4
    if (!hasOpticMission) {
      subject = `Find creators for "${gigTitle}" before production stalls`;
      content = `
        <h1 style="color: #333; font-size: 22px;">Empty seats slow everything down</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">It’s been a few days since
        <strong>"${gigTitle}"</strong> went live, and there’s still no Optic search for it.
        Waiting on inbound applications alone often means under-filled campaigns and delayed
        content.</p>
        <p style="color: #555; line-height: 1.6;">Spend 10 minutes in Optic: attach this campaign,
        search <strong>200M+ creators</strong> for brief fits, and use the creator reports to invite
        the strongest matches first. That’s how most brands hit roster size on time — without
        burning budget on the wrong creators.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${opticUrl}" style="${btnStyle}">Find matching creators</a>
        </div>
        <p style="text-align: center; margin: 0;">
          <a href="${deploymentUrl}" style="${secondaryLinkStyle}">View campaign</a>
        </p>
        ${signature}
      `;
    } else {
      subject = "How submissions and the Verza Score work";
      content = `
        <h1 style="color: #333; font-size: 22px;">Your creators are submitting work</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">Once a creator has claimed a spot in <strong>"${gigTitle}"</strong>,
        they can upload their videos or links directly on the campaign page. Here's what you'll see:</p>
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
    }
    break;

  case 3: // Day 7 — approving and paying
    subject = "Approve work and pay creators in one click";
    content = `
      <h1 style="color: #333; font-size: 22px;">Ready to pay your creators?</h1>
      <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
      <p style="color: #555; line-height: 1.6;">Once you're satisfied with a creator's submission on
      <strong>"${gigTitle}"</strong>, paying them is one step. Hit <strong>Approve & Pay</strong> on the
      campaign page — funds go directly to their bank account, no manual transfers needed.</p>
      <ul style="color: #555; line-height: 2;">
        <li>Every payout is logged and tracked on the campaign page</li>
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
      From the campaign page you can see:</p>
      <ul style="color: #555; line-height: 2;">
        <li><strong>Clicks and conversions</strong> per creator — see who actually drove results</li>
        <li><strong>Earned rewards</strong> — tracked automatically against each creator's link</li>
        <li>Use this data to know exactly who to bring back for your next campaign — or search Optic for lookalikes</li>
      </ul>
      <p style="color: #555; line-height: 1.6;">The brands that win at performance marketing are the ones
      who double down on what worked. Your data is waiting.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${deploymentUrl}" style="${btnStyle}">View Campaign Results</a>
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
            <a href="${appUrl}/profile" style="font-size: 11px; color: ${EMAIL_BRAND_PRIMARY}; text-decoration: none;">Notification Settings</a>
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
      gigId,
      step,
      hasOpticMission,
      timestamp: Timestamp.now(),
      status: "sent",
    });
  } catch (error) {
    logger.error(`Failed to send deployment email sequence step ${step} to ${toEmail}:`, error);
  }
}

/**
 * Sends an email from the agency onboarding sequence to a new agency/brand owner.
 * Step 0 is sent immediately on agency creation. Steps 1–5 are drip emails.
 * @param {string} toEmail The recipient's email address.
 * @param {string} name The recipient's name.
 * @param {string} agencyName The name of the agency/brand they created.
 * @param {number} step The step number (0–5).
 * @param {{isBrandAccount?: boolean}} [opts] Brand vs agency wording.
 */
export async function sendAgencyEmailSequence(
  toEmail: string,
  name: string,
  agencyName: string,
  step: number,
  opts?: {isBrandAccount?: boolean}
): Promise<void> {
  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set, skipping agency email sequence.");
    return;
  }
  sgMail.setApiKey(sendgridKey);

  const appUrl = params.APP_URL.value();
  const isBrand = opts?.isBrandAccount === true;
  const entity = isBrand ? "brand" : "agency";
  const entityTitle = isBrand ? "Brand" : "Agency";
  const opticUrl = `${appUrl}/optic`;

  let subject = "";
  let content = "";

  const signature = `
    <p style="margin-top: 30px; font-size: 14px; color: #666;">
      Cheers,<br/>
      <strong>Serge Amouzou</strong><br/>
      Founder & CEO of Verza
    </p>
  `;

  const btnStyle = emailButtonStyle("6px");
  const secondaryLinkStyle =
    `color: ${EMAIL_BRAND_PRIMARY}; font-size: 14px; text-decoration: underline;`;

  switch (step) {
  case 0: // Immediate — brand/agency is live
    subject = `${agencyName} is officially live on Verza`;
    content = `
      <h1 style="color: #333; font-size: 22px;">Congrats, ${name} — your ${entity} is live!</h1>
      <p style="color: #555; line-height: 1.6;"><strong>${agencyName}</strong> is now set up on Verza.
      Start by searching <strong>Optic</strong> across <strong>200M+ creators</strong> for people who match
      your brief — each lead lands in your vault with a <strong>creator report</strong> so you can invite
      the best fits first and put budget on the right creators.</p>
      <ul style="color: #555; line-height: 2;">
        <li><strong>Optic</strong> — search by platform, audience size, and niche; compare fit with creator reports</li>
        <li><strong>${isBrand ? "Creator roster" : "Talent Roster"}</strong> — invite creators and manage your roster</li>
        <li><strong>Team Management</strong> — bring in admins and team members</li>
        <li><strong>Payouts</strong> — pay talent directly to their bank account</li>
        <li><strong>Campaigns</strong> — ${isBrand ? "launch campaigns and invite creators who fit" : "run brand campaigns across your entire roster"}</li>
      </ul>
      <p style="color: #555; line-height: 1.6;">Over the next two weeks I'll walk you through each part of
      the ${entity} workspace one by one.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${opticUrl}" style="${btnStyle}">Search creators with Optic</a>
      </div>
      <p style="text-align: center; margin: 0;">
        <a href="${appUrl}/agency" style="${secondaryLinkStyle}">Or go to your ${entityTitle} dashboard</a>
      </p>
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

  case 4: // Day 10 — campaigns
    subject = "Step 4: Launch a campaign for your entire roster";
    content = `
      <h1 style="color: #333; font-size: 22px;">Run campaigns across your whole roster</h1>
      <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
      <p style="color: #555; line-height: 1.6;">Campaigns let you run brand activations at scale.
      Create a campaign, set the rate per creator and how many you need, then fund it from your agency wallet.</p>
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
            <a href="${appUrl}/profile" style="font-size: 11px; color: ${EMAIL_BRAND_PRIMARY}; text-decoration: none;">Notification Settings</a>
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
      timestamp: Timestamp.now(),
      status: "sent",
    });
  } catch (error) {
    logger.error(`Failed to send agency email sequence step ${step} to ${toEmail}:`, error);
  }
}

/**
 * Unique recipient emails for agency alerts: owner + active team members on the agency doc.
 * @param {string} agencyId Firestore document ID of the agency (brand).
 * @return {!Promise<!Array<string>>} Distinct lowercased email addresses.
 */
export async function getAgencyTeamNotificationEmails(agencyId: string): Promise<string[]> {
  const agencySnap = await db.collection("agencies").doc(agencyId).get();
  if (!agencySnap.exists) return [];
  const agency = agencySnap.data() as {
    ownerId?: string;
    team?: Array<{email?: string; status?: string; userId?: string}>;
  };
  const emails = new Set<string>();
  const add = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const t = raw.trim();
    if (t.includes("@")) emails.add(t.toLowerCase());
  };
  if (agency.ownerId) {
    const ownerSnap = await db.collection("users").doc(agency.ownerId).get();
    if (ownerSnap.exists) add(ownerSnap.data()?.email);
  }
  for (const m of agency.team || []) {
    if (m?.status === "active" && m?.email) add(m.email);
  }
  return [...emails];
}

/**
 * Whether the authenticated user may trigger applicant-related emails for this agency.
 * @param {string} authUid Authenticated Firebase user id.
 * @param {string} agencyId Firestore agency id (matches gig `brandId`).
 * @param {string} applicantUid User id of the applicant listed on the gig.
 * @return {!Promise<boolean>} True if the caller is the applicant, agency owner, or active team member.
 */
async function canManageAgencyTeamEmail(
  authUid: string,
  agencyId: string,
  applicantUid: string
): Promise<boolean> {
  if (authUid === applicantUid) return true;
  const agencySnap = await db.collection("agencies").doc(agencyId).get();
  if (!agencySnap.exists) return false;
  const agency = agencySnap.data() as {
    ownerId?: string;
    team?: Array<{userId?: string; status?: string}>;
  };
  if (agency.ownerId === authUid) return true;
  return (agency.team || []).some(
    (t) => t?.userId === authUid && t?.status === "active"
  );
}

/**
 * Sends an email to agency team members when a creator is added to the active roster.
 * @param {!Array<string>} recipientEmails Distinct team inboxes to notify.
 * @param {string} agencyName Display name of the brand/agency.
 * @param {string} creatorName Display name of the creator (or assigned talent).
 * @param {string} gigTitle Campaign title.
 * @param {string} gigId Firestore gig id for deep link.
 * @param {boolean} isAgencyAcceptance True when an agency assigned talent vs solo join.
 * @param {boolean} fromApplicationApproval True when the brand just approved an application
 *   (vs instant join, e.g. cause campaigns).
 * @return {!Promise<void>}
 */
export async function sendCreatorSecuredEmail(
  recipientEmails: string[],
  agencyName: string,
  creatorName: string,
  gigTitle: string,
  gigId: string,
  isAgencyAcceptance: boolean,
  fromApplicationApproval: boolean
): Promise<void> {
  if (recipientEmails.length === 0) return;
  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set, skipping creator secured email.");
    return;
  }
  sgMail.setApiKey(sendgridKey);

  const appUrl = params.APP_URL.value();
  const campaignUrl = `${appUrl}/campaigns/${gigId}`;

  const emailLogoHeader = `
    <div style="text-align: center; margin-bottom: 30px;">
      <img src="https://app.tryverza.com/verza-icon.svg" alt="Verza" width="24" height="18"
        style="vertical-align: middle; margin-right: 8px;">
      <span style="font-weight: bold; font-size: 24px; color: #000000;
        vertical-align: middle; font-family: sans-serif;">Verza</span>
    </div>
  `;

  const btnStyle = emailButtonStyle("6px");

  let subject: string;
  let headline: string;
  let body: string;

  if (fromApplicationApproval) {
    subject = `You've approved ${creatorName} for "${gigTitle}"`;
    headline = "You approved a creator";
    body = isAgencyAcceptance ?
      `You approved <strong>${creatorName}</strong> for <strong>"${gigTitle}"</strong> (${agencyName}). ` +
        "They were submitted by an agency on the creator's behalf. " +
        "Open your campaign to review the roster and track content submissions." :
      `You approved <strong>${creatorName}</strong> for <strong>"${gigTitle}"</strong> (${agencyName}). ` +
        "Open your campaign to review the roster and track content submissions.";
  } else if (isAgencyAcceptance) {
    subject = `An agency has filled a spot on "${gigTitle}"`;
    headline = "A new creator just joined your campaign";
    body =
      `An agency has assigned <strong>${creatorName}</strong> to your campaign ` +
      `<strong>"${gigTitle}"</strong> (${agencyName}). Head to your campaign to review the roster ` +
      "and track content submissions.";
  } else {
    subject = `${creatorName} joined "${gigTitle}"`;
    headline = `${creatorName} is on your campaign`;
    body =
      `<strong>${creatorName}</strong> has joined your campaign ` +
      `<strong>"${gigTitle}"</strong> (${agencyName}). Head to your campaign to review the roster ` +
      "and track content submissions.";
  }

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
        <p style="color: #555; line-height: 1.6;">Hello,</p>
        <p style="color: #555; line-height: 1.6;">${body}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${campaignUrl}" style="${btnStyle}">View campaign</a>
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
            <a href="${appUrl}/profile" style="font-size: 11px; color: ${EMAIL_BRAND_PRIMARY}; text-decoration: none;">Notification Settings</a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  for (const toEmail of recipientEmails) {
    try {
      await sgMail.send({
        to: toEmail,
        from: {name: "Serge from Verza", email: params.SENDGRID_FROM_EMAIL.value()},
        subject,
        html,
      });
      logger.info(`Creator secured email sent to ${toEmail} for campaign ${gigId}.`);
    } catch (error) {
      logger.error(`Failed to send creator secured email to ${toEmail}:`, error);
    }
  }
}

/**
 * Sends an email to agency team when someone applies to a campaign.
 * @param {!Array<string>} recipientEmails Distinct team inboxes to notify.
 * @param {string} agencyName Display name of the brand/agency.
 * @param {string} applicantDisplayName Applicant display name for email copy.
 * @param {string} gigTitle Campaign title.
 * @param {string} gigId Firestore gig id for deep link.
 * @param {boolean} isAgencyAcceptance True when an agency applied on behalf of talent.
 * @return {!Promise<void>}
 */
export async function sendBrandCampaignApplicantEmails(
  recipientEmails: string[],
  agencyName: string,
  applicantDisplayName: string,
  gigTitle: string,
  gigId: string,
  isAgencyAcceptance: boolean
): Promise<void> {
  if (recipientEmails.length === 0) return;
  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set, skipping applicant email.");
    return;
  }
  sgMail.setApiKey(sendgridKey);
  const appUrl = params.APP_URL.value();
  const campaignUrl = `${appUrl}/campaigns/${gigId}`;
  const emailLogoHeader = `
    <div style="text-align: center; margin-bottom: 30px;">
      <img src="https://app.tryverza.com/verza-icon.svg" alt="Verza" width="24" height="18"
        style="vertical-align: middle; margin-right: 8px;">
      <span style="font-weight: bold; font-size: 24px; color: #000000;
        vertical-align: middle; font-family: sans-serif;">Verza</span>
    </div>
  `;
  const btnStyle = emailButtonStyle("6px");
  const subject = isAgencyAcceptance ?
    `New applicant (agency) on "${gigTitle}"` :
    `New applicant on "${gigTitle}"`;
  const body = isAgencyAcceptance ?
    `An agency has applied on behalf of <strong>${applicantDisplayName}</strong> for
      <strong>"${gigTitle}"</strong> (${agencyName}). Review the application in Verza.` :
    `<strong>${applicantDisplayName}</strong> applied to your campaign
      <strong>"${gigTitle}"</strong> (${agencyName}). Review the application in Verza.`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${subject}</title></head>
    <body style="background-color: #f9f9f9; padding: 20px; font-family: sans-serif; margin: 0;">
      <div style="max-width: 600px; margin: auto; padding: 30px; border: 1px solid #eee;
        border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        ${emailLogoHeader}
        <h1 style="color: #333; font-size: 22px;">New campaign applicant</h1>
        <p style="color: #555; line-height: 1.6;">Hello,</p>
        <p style="color: #555; line-height: 1.6;">${body}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${campaignUrl}" style="${btnStyle}">Review application</a>
        </div>
        <p style="margin-top: 30px; font-size: 14px; color: #666;">
          You also received an in-app notification about this application.
        </p>
        <div style="text-align: center; border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">
          <p style="font-size: 12px; color: #999; margin: 0;">
            Verza &copy; ${new Date().getFullYear()} | The operating system for the creator economy.
          </p>
          <div style="margin-top: 10px;">
            <a href="${appUrl}/profile" style="font-size: 11px; color: ${EMAIL_BRAND_PRIMARY}; text-decoration: none;">Notification Settings</a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
  for (const toEmail of recipientEmails) {
    try {
      await sgMail.send({
        to: toEmail,
        from: {name: "Verza", email: params.SENDGRID_FROM_EMAIL.value()},
        subject,
        html,
      });
      logger.info(`Applicant email sent to ${toEmail} for campaign ${gigId}.`);
    } catch (error) {
      logger.error(`Failed to send applicant email to ${toEmail}:`, error);
    }
  }
}

/**
 * Sends an email to agency team members when a creator submits a video or link for review.
 * @param {!Array<string>} recipientEmails Distinct team inboxes to notify.
 * @param {string} agencyName Display name of the brand/agency.
 * @param {string} creatorName Display name of the submitting creator.
 * @param {string} gigTitle Campaign title.
 * @param {string} gigId Firestore gig id for deep link.
 * @param {"video"|"link"} submissionKind Whether the submission is a file upload or link.
 * @return {!Promise<void>}
 */
export async function sendBrandSubmissionReceivedEmail(
  recipientEmails: string[],
  agencyName: string,
  creatorName: string,
  gigTitle: string,
  gigId: string,
  submissionKind: "video" | "link"
): Promise<void> {
  if (recipientEmails.length === 0) return;
  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set, skipping submission received email.");
    return;
  }
  sgMail.setApiKey(sendgridKey);

  const appUrl = params.APP_URL.value();
  const campaignUrl = `${appUrl}/campaigns/${gigId}`;

  const emailLogoHeader = `
    <div style="text-align: center; margin-bottom: 30px;">
      <img src="https://app.tryverza.com/verza-icon.svg" alt="Verza" width="24" height="18"
        style="vertical-align: middle; margin-right: 8px;">
      <span style="font-weight: bold; font-size: 24px; color: #000000;
        vertical-align: middle; font-family: sans-serif;">Verza</span>
    </div>
  `;

  const btnStyle = emailButtonStyle("6px");

  const assetLabel = submissionKind === "link" ? "a video link" : "a new video";
  const subject = `New submission on "${gigTitle}"`;
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
        <h1 style="color: #333; font-size: 22px;">New creator submission</h1>
        <p style="color: #555; line-height: 1.6;">Hello,</p>
        <p style="color: #555; line-height: 1.6;">
          <strong>${creatorName}</strong> submitted ${assetLabel} for your campaign
          <strong>"${gigTitle}"</strong> (${agencyName}). Review it in Verza when you&apos;re ready.
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${campaignUrl}" style="${btnStyle}">Review submission</a>
        </div>
        <p style="margin-top: 30px; font-size: 14px; color: #666;">
          You also received an in-app notification about this submission.
        </p>
        <div style="text-align: center; border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">
          <p style="font-size: 12px; color: #999; margin: 0;">
            Verza &copy; ${new Date().getFullYear()} | The operating system for the creator economy.
          </p>
          <div style="margin-top: 10px;">
            <a href="${appUrl}/profile" style="font-size: 11px; color: ${EMAIL_BRAND_PRIMARY}; text-decoration: none;">Notification Settings</a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  for (const toEmail of recipientEmails) {
    try {
      await sgMail.send({
        to: toEmail,
        from: {name: "Verza", email: params.SENDGRID_FROM_EMAIL.value()},
        subject,
        html,
      });
      logger.info(`Submission received email sent to ${toEmail} for campaigns/${gigId}.`);
    } catch (error) {
      logger.error(`Failed to send submission received email to ${toEmail}:`, error);
    }
  }
}

export const notifyBrandVideoSubmitted = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated.");
  }

  const userId = request.auth.uid;
  const {gigId, submissionKind} = request.data as {
    gigId?: string;
    submissionKind?: "video" | "link";
  };

  if (!gigId || typeof gigId !== "string") {
    throw new HttpsError("invalid-argument", "gigId is required.");
  }

  const kind: "video" | "link" = submissionKind === "link" ? "link" : "video";

  try {
    const gigSnap = await db.collection("gigs").doc(gigId).get();
    if (!gigSnap.exists) {
      throw new HttpsError("not-found", "Campaign not found.");
    }
    const gigData = gigSnap.data() as {
      title: string;
      brandId: string;
      acceptedCreatorIds?: string[];
    };

    if (!gigData.acceptedCreatorIds?.includes(userId)) {
      throw new HttpsError(
        "permission-denied",
        "Only accepted creators can notify the brand about submissions for this campaign."
      );
    }

    const recipients = await getAgencyTeamNotificationEmails(gigData.brandId);
    if (recipients.length === 0) return {success: true};

    const agencySnap = await db.collection("agencies").doc(gigData.brandId).get();
    const agencyName = agencySnap.exists ?
      ((agencySnap.data()?.name as string) || "Your agency") :
      "Your agency";

    const creatorSnap = await db.collection("users").doc(userId).get();
    const creatorName = creatorSnap.exists ?
      ((creatorSnap.data()?.displayName as string) || "A creator") :
      "A creator";

    await sendBrandSubmissionReceivedEmail(
      recipients,
      agencyName,
      creatorName,
      gigData.title,
      gigId,
      kind
    );

    return {success: true};
  } catch (error: unknown) {
    logger.error(`Error in notifyBrandVideoSubmitted for gig ${gigId}:`, error);
    if (error instanceof HttpsError) throw error;
    const msg = error instanceof Error ? error.message : "Failed to send submission email.";
    throw new HttpsError("internal", msg || "Failed to send submission email.");
  }
});

export const notifyBrandCampaignApplicant = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated.");
  }

  const authUid = request.auth.uid;
  const {gigId, applicantUserId, isAgencyAcceptance} = request.data as {
    gigId?: string;
    applicantUserId?: string;
    isAgencyAcceptance?: boolean;
  };

  if (!gigId || typeof gigId !== "string") {
    throw new HttpsError("invalid-argument", "gigId is required.");
  }
  if (!applicantUserId || typeof applicantUserId !== "string") {
    throw new HttpsError("invalid-argument", "applicantUserId is required.");
  }

  try {
    const gigSnap = await db.collection("gigs").doc(gigId).get();
    if (!gigSnap.exists) {
      throw new HttpsError("not-found", "Campaign not found.");
    }
    const gigData = gigSnap.data() as {
      title: string;
      brandId: string;
      appliedCreatorIds?: string[];
    };

    if (!gigData.appliedCreatorIds?.includes(applicantUserId)) {
      throw new HttpsError(
        "permission-denied",
        "Applicant is not on the pending list for this campaign."
      );
    }

    const allowed = await canManageAgencyTeamEmail(authUid, gigData.brandId, applicantUserId);
    if (!allowed) {
      throw new HttpsError(
        "permission-denied",
        "You cannot send this notification for this applicant."
      );
    }

    const recipients = await getAgencyTeamNotificationEmails(gigData.brandId);
    if (recipients.length === 0) return {success: true};

    const agencySnap = await db.collection("agencies").doc(gigData.brandId).get();
    const agencyName = agencySnap.exists ?
      ((agencySnap.data()?.name as string) || "Your agency") :
      "Your agency";

    const applicantSnap = await db.collection("users").doc(applicantUserId).get();
    const applicantDisplayName = applicantSnap.exists ?
      ((applicantSnap.data()?.displayName as string) || "A creator") :
      "A creator";

    await sendBrandCampaignApplicantEmails(
      recipients,
      agencyName,
      applicantDisplayName,
      gigData.title,
      gigId,
      Boolean(isAgencyAcceptance)
    );

    return {success: true};
  } catch (error: unknown) {
    logger.error(`Error in notifyBrandCampaignApplicant for gig ${gigId}:`, error);
    if (error instanceof HttpsError) throw error;
    const msg = error instanceof Error ? error.message : "Failed to send applicant email.";
    throw new HttpsError("internal", msg || "Failed to send applicant email.");
  }
});

export const notifyBrandCreatorJoined = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated.");
  }

  const {gigId, creatorName, isAgencyAcceptance, fromApplicationApproval} = request.data as {
    gigId?: string;
    creatorName?: string;
    isAgencyAcceptance?: boolean;
    fromApplicationApproval?: boolean;
  };
  if (!gigId || !creatorName) {
    throw new HttpsError("invalid-argument", "gigId and creatorName are required.");
  }

  try {
    const gigSnap = await db.collection("gigs").doc(gigId).get();
    if (!gigSnap.exists) {
      throw new HttpsError("not-found", "Campaign not found.");
    }
    const gigData = gigSnap.data() as { title: string; brandId: string };

    const recipients = await getAgencyTeamNotificationEmails(gigData.brandId);
    if (recipients.length === 0) return {success: true};

    const agencySnap = await db.collection("agencies").doc(gigData.brandId).get();
    if (!agencySnap.exists) return {success: true};
    const agencyData = agencySnap.data() as { ownerId: string; name: string };

    await sendCreatorSecuredEmail(
      recipients,
      agencyData.name,
      creatorName,
      gigData.title,
      gigId,
      isAgencyAcceptance ?? false,
      Boolean(fromApplicationApproval)
    );

    return {success: true};
  } catch (error: unknown) {
    logger.error(`Error in notifyBrandCreatorJoined for gig ${gigId}:`, error);
    if (error instanceof HttpsError) throw error;
    const msg = error instanceof Error ? error.message : "Failed to send notification email.";
    throw new HttpsError("internal", msg || "Failed to send notification email.");
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
  } catch (error: unknown) {
    logger.error("Error sending feedback email:", error);
    const msg = error instanceof Error ? error.message : "Failed to send feedback.";
    throw new HttpsError("internal", msg || "Failed to send feedback.");
  }
});
