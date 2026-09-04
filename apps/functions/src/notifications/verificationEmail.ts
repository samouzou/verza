import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import {Timestamp} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import * as params from "../config/params";
import {EMAIL_BRAND_PRIMARY, emailButtonStyle} from "../emailBrand";

const COOLDOWN_MS = 60 * 1000;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function verificationHtml(args: {
  name: string;
  verifyUrl: string;
}): string {
  const name = escapeHtml(args.name);
  const btn = emailButtonStyle("6px");
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verify your Verza email</title>
    </head>
    <body style="background-color: #f9f9f9; padding: 20px; font-family: sans-serif; margin: 0;">
      <div style="max-width: 600px; margin: auto; padding: 30px; border: 1px solid #eee;
        border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        <div style="text-align: center; margin-bottom: 30px;">
          <img src="https://app.tryverza.com/verza-icon.svg" alt="Verza" width="24" height="18"
            style="vertical-align: middle; margin-right: 8px;">
          <span style="font-weight: bold; font-size: 24px; color: #000000;
            vertical-align: middle; font-family: sans-serif;">Verza</span>
        </div>
        <h1 style="color: #333; font-size: 22px;">Confirm this inbox is yours</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">
          Someone just created a Verza account with this email. Click the button to verify it.
          Takes a few seconds. No extra steps.
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${args.verifyUrl}" style="${btn}">Verify my email</a>
        </div>
        <p style="color: #555; line-height: 1.6; font-size: 14px;">
          If the button doesn't work, paste this link into your browser:
        </p>
        <p style="color: #333; line-height: 1.6; word-break: break-all; font-size: 13px;">
          <a href="${args.verifyUrl}" style="color: ${EMAIL_BRAND_PRIMARY};">${escapeHtml(args.verifyUrl)}</a>
        </p>
        <p style="color: #555; line-height: 1.6; font-size: 14px;">
          If you didn't create a Verza account, ignore this. If the link expires, sign in and tap resend.
        </p>
        <p style="margin-top: 30px; font-size: 14px; color: #666;">
          Cheers,<br/>
          <strong>Serge Amouzou</strong><br/>
          Founder &amp; CEO of Verza
        </p>
        <div style="text-align: center; border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">
          <p style="font-size: 12px; color: #999; margin: 0;">
            Verza &copy; ${new Date().getFullYear()} | The operating system for the creator economy.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Sends a branded verification email with a Firebase action link.
 * Replaces the client SDK `sendEmailVerification` Firebase template.
 */
export const sendVerificationEmail = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to verify your email.");
  }

  const uid = request.auth.uid;
  const authUser = await admin.auth().getUser(uid);

  if (authUser.emailVerified) {
    return {ok: true as const, alreadyVerified: true};
  }

  const email = authUser.email;
  if (!email) {
    throw new HttpsError("failed-precondition", "Add an email to your account first.");
  }

  const userRef = db.collection("users").doc(uid);
  const snap = await userRef.get();
  const lastSent = snap.data()?.lastVerificationEmailAt as Timestamp | undefined;
  if (lastSent && Date.now() - lastSent.toMillis() < COOLDOWN_MS) {
    throw new HttpsError(
      "resource-exhausted",
      "Wait a minute before requesting another verification email."
    );
  }

  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set, cannot send verification email.");
    throw new HttpsError("failed-precondition", "Email service is not configured.");
  }
  sgMail.setApiKey(sendgridKey);

  const appUrl = params.APP_URL.value().replace(/\/$/, "");
  let verifyUrl: string;
  try {
    verifyUrl = await admin.auth().generateEmailVerificationLink(email, {
      url: appUrl,
      handleCodeInApp: false,
    });
  } catch (error) {
    logger.error("Failed to generate email verification link", {uid, email, error});
    throw new HttpsError("internal", "Could not create a verification link. Try again.");
  }

  const name = authUser.displayName || email.split("@")[0] || "there";
  const subject = "Verify your Verza email";
  const html = verificationHtml({name, verifyUrl});
  const text =
    `Hi ${name},\n\n` +
    `Confirm this inbox is yours for Verza:\n${verifyUrl}\n\n` +
    `If you didn't create a Verza account, ignore this.\n`;

  try {
    await sgMail.send({
      to: email,
      from: {
        name: "Serge from Verza",
        email: params.SENDGRID_FROM_EMAIL.value(),
      },
      subject,
      text,
      html,
    });
  } catch (error) {
    logger.error("Failed to send verification email", {uid, email, error});
    throw new HttpsError("internal", "Could not send the verification email. Try again.");
  }

  await userRef.set({lastVerificationEmailAt: Timestamp.now()}, {merge: true});
  await db.collection("emailLogs").add({
    userId: uid,
    to: email,
    subject,
    type: "email_verification",
    timestamp: Timestamp.now(),
    status: "sent",
  });

  logger.info("Verification email sent", {uid, email});
  return {ok: true as const, alreadyVerified: false};
});
