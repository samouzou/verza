import * as logger from "firebase-functions/logger";
import sgMail from "@sendgrid/mail";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import * as params from "../config/params";
import {EMAIL_BRAND_PRIMARY, emailButtonStyle} from "../emailBrand";
import type {StoreProduct, StoreProductKind, UserProfileFirestoreData} from "../types";

/** Last scheduled step (0 is sent immediately on first publish). */
export const STORE_LAUNCH_LAST_STEP = 2;

const signature = `
  <p style="margin-top: 30px; font-size: 14px; color: #666;">
    Cheers,<br/>
    <strong>Serge Amouzou</strong><br/>
    Founder & CEO of Verza
  </p>
`;

function emailShell(args: {subject: string; content: string; appUrl: string}): string {
  const logo = `
    <div style="text-align: center; margin-bottom: 30px;">
      <img src="https://app.tryverza.com/verza-icon.svg" alt="Verza" width="24" height="18"
        style="vertical-align: middle; margin-right: 8px;">
      <span style="font-weight: bold; font-size: 24px; color: #000000;
        vertical-align: middle; font-family: sans-serif;">Verza</span>
    </div>
  `;
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${args.subject}</title>
    </head>
    <body style="background-color: #f9f9f9; padding: 20px; font-family: sans-serif; margin: 0;">
      <div style="max-width: 600px; margin: auto; padding: 30px; border: 1px solid #eee;
        border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        ${logo}
        <div style="padding: 10px 0;">${args.content}</div>
        <div style="text-align: center; border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">
          <p style="font-size: 12px; color: #999; margin: 0;">
            Verza &copy; ${new Date().getFullYear()} | The operating system for the creator economy.
          </p>
          <div style="margin-top: 10px;">
            <a href="${args.appUrl}/profile" style="font-size: 11px; color: ${EMAIL_BRAND_PRIMARY}; text-decoration: none;">Notification Settings</a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function kindLabel(kind: StoreProductKind | undefined): string {
  if (kind === "course") return "course";
  if (kind === "tip") return "tip jar";
  return "product";
}

function contentTips(kind: StoreProductKind | undefined): string {
  if (kind === "course") {
    return `Teach one free slice of the course on camera — a single tactic, not a trailer.
        Then say the rest is in the course and drop the link in the first comment.`;
  }
  if (kind === "tip") {
    return `Talk about the work you're doing this week and why support helps you keep
        making it. A tip jar sells when the audience feels close to you, not when you
        pitch "donate."`;
  }
  return `Show the file on screen. Flip through the pages, demo the preset, or use the
        template live. People buy what they can see — not a caption that says "link in bio."`;
}

type StepContent = {subject: string; content: string};

function launchSteps(args: {
  name: string;
  title: string;
  kind?: StoreProductKind;
  productUrl: string;
  storeUrl: string;
  btn: string;
  secondary: string;
}): StepContent[] {
  const {kind, productUrl, storeUrl, btn, secondary} = args;
  const name = escapeHtml(args.name);
  const title = escapeHtml(args.title);
  const noun = kindLabel(kind);

  return [
    {
      subject: `Your ${noun} is live — share this link today`,
      content: `
        <h1 style="color: #333; font-size: 22px;">${title} is ready for your audience</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">
          The product is the easy part. Sales come from putting one clear link
          where people already watch you — not from hoping they wander into your Store.
        </p>
        <p style="color: #555; line-height: 1.6;">
          Copy this checkout link and use it everywhere this week:
        </p>
        <p style="color: #333; line-height: 1.6; word-break: break-all;">
          <a href="${productUrl}" style="color: ${EMAIL_BRAND_PRIMARY};">${productUrl}</a>
        </p>
        <ol style="color: #555; line-height: 2;">
          <li><strong>Bio</strong> — replace a vague "link in bio" with this URL (or your Store page if you have more than one product).</li>
          <li><strong>First comment</strong> — on the next video or post, paste the link yourself so it doesn't get buried.</li>
          <li><strong>Stories / newsletter</strong> — one sentence of who it's for, then the link. One ask, not five.</li>
        </ol>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${productUrl}" style="${btn}">Open your product page</a>
        </div>
        <p style="text-align: center; margin: 0;">
          <a href="${storeUrl}" style="${secondary}">Copy links from Store</a>
        </p>
        ${signature}
      `,
    },
    {
      subject: "Don't announce the product. Make content that sells it.",
      content: `
        <h1 style="color: #333; font-size: 22px;">The post should do the selling</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">
          A "new product just dropped" post underperforms. Your audience buys when they
          watch you <em>use</em> what you're selling — then the link feels like a next step,
          not an ad.
        </p>
        <p style="color: #555; line-height: 1.6;">
          ${contentTips(kind)}
        </p>
        <p style="color: #555; line-height: 1.6;">
          Simple shape: <strong>hook</strong> (the problem) → <strong>proof</strong> (you solving it)
          → <strong>link</strong> in the first comment. Pin that comment.
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${productUrl}" style="${btn}">Get the link for your next post</a>
        </div>
        ${signature}
      `,
    },
    {
      subject: "Keep showing the link — once is not a launch",
      content: `
        <h1 style="color: #333; font-size: 22px;">Three posts beat one announcement</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">
          Most creators share the link once and assume nobody wanted it. Your audience
          missed it. Plan <strong>three native posts over the next 10 days</strong> that
          each earn the same link — different hook, same ${noun}.
        </p>
        <ul style="color: #555; line-height: 2;">
          <li>Reply to "how do I get this?" with the checkout URL, not a DM maze.</li>
          <li>If it's quiet, tighten the product page: first two sentences and a cover that reads on a phone.</li>
          <li>Check Store for sales so you know which post actually moved people.</li>
        </ul>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${storeUrl}" style="${btn}">Open Store</a>
        </div>
        <p style="text-align: center; margin: 0;">
          <a href="${productUrl}" style="${secondary}">Edit ${title}</a>
        </p>
        ${signature}
      `,
    },
  ];
}

export async function sendStoreLaunchEmailSequence(
  toEmail: string,
  name: string,
  step: number,
  productId: string
): Promise<"sent" | "skipped" | "inactive"> {
  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set, skipping store launch email sequence.");
    return "skipped";
  }
  sgMail.setApiKey(sendgridKey);

  const appUrl = params.APP_URL.value();
  const productSnap = await db.collection("storeProducts").doc(productId).get();
  if (!productSnap.exists) {
    logger.info("Store launch drip skipped — product missing", {productId, step});
    return "inactive";
  }
  const product = {id: productSnap.id, ...productSnap.data()} as StoreProduct;
  if (product.status !== "active") {
    logger.info("Store launch drip skipped — product not active", {
      productId,
      step,
      status: product.status,
    });
    return "inactive";
  }

  const btn = emailButtonStyle("6px");
  const secondary =
    `color: ${EMAIL_BRAND_PRIMARY}; font-size: 14px; text-decoration: underline;`;
  const productUrl = `${appUrl}/s/${productId}`;
  const steps = launchSteps({
    name,
    title: product.title || "your product",
    kind: product.kind,
    productUrl,
    storeUrl: `${appUrl}/store`,
    btn,
    secondary,
  });
  const stepContent = steps[step];
  if (!stepContent) {
    logger.info("No store launch email for step", {step});
    return "skipped";
  }

  const html = emailShell({
    subject: stepContent.subject,
    content: stepContent.content,
    appUrl,
  });

  try {
    await sgMail.send({
      to: toEmail,
      from: {
        name: "Serge from Verza",
        email: params.SENDGRID_FROM_EMAIL.value(),
      },
      subject: stepContent.subject,
      html,
    });
    logger.info("Store launch email sent", {step, toEmail, productId});
    await db.collection("emailLogs").add({
      to: toEmail,
      subject: stepContent.subject,
      html,
      type: "store_launch",
      step,
      productId,
      timestamp: Timestamp.now(),
      status: "sent",
    });
    return "sent";
  } catch (error) {
    logger.error(`Failed store launch email step=${step}`, error);
    return "skipped";
  }
}

/**
 * Starts the share-the-link drip the first time a creator publishes a Store product.
 * Safe to call on every publish — no-ops if the sequence already ran or is in flight.
 */
export async function maybeStartStoreLaunchDrip(args: {
  uid: string;
  email?: string | null;
  name: string;
  productId: string;
}): Promise<void> {
  const {uid, email, name, productId} = args;
  if (!email) {
    logger.info("[store launch] No email on user, skipping drip", {uid, productId});
    return;
  }

  const userRef = db.collection("users").doc(uid);
  const twoDaysFromNow = new Timestamp(
    Timestamp.now().seconds + 2 * 24 * 60 * 60,
    0
  );

  const started = await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const user = snap.data() as UserProfileFirestoreData | undefined;
    if (!user) return false;
    if (user.storeLaunchDripComplete) return false;
    if (user.storeEmailSequence) return false;
    tx.update(userRef, {
      storeEmailSequence: {
        step: 1,
        nextEmailAt: twoDaysFromNow,
        productId,
      },
    });
    return true;
  });

  if (!started) return;

  await sendStoreLaunchEmailSequence(email, name, 0, productId);
  logger.info("[store launch] Sequence started", {uid, productId});
}

export async function completeStoreLaunchDrip(uid: string): Promise<void> {
  await db.collection("users").doc(uid).update({
    storeEmailSequence: FieldValue.delete(),
    storeLaunchDripComplete: true,
  });
}
