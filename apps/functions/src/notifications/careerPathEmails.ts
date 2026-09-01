import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import sgMail from "@sendgrid/mail";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import * as params from "../config/params";
import {EMAIL_BRAND_PRIMARY, emailButtonStyle} from "../emailBrand";

export type CareerPathEmailPath = "community" | "monetized" | "emerging";

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

type StepContent = {subject: string; content: string};

function communitySteps(name: string, appUrl: string, btn: string, secondary: string): StepContent[] {  return [
    {
      subject: "You chose Community — let's open your Store",
      content: `
        <h1 style="color: #333; font-size: 22px;">Your audience is ready to support you, ${name}</h1>
        <p style="color: #555; line-height: 1.6;">You picked the <strong>Community</strong> path — so we're
        walking you through Verza Store: tip jars, downloads, and courses your fans can buy directly.</p>
        <ul style="color: #555; line-height: 2;">
          <li><strong>Tip jar</strong> — let fans support you with preset amounts</li>
          <li><strong>Download</strong> — sell a PDF, pack, or single digital file</li>
          <li><strong>Course</strong> — multi-lesson content fans unlock after purchase</li>
        </ul>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/store" style="${btn}">Open your Store</a>
        </div>
        ${signature}
      `,
    },
    {
      subject: "Step 1: Turn on a tip jar in under 2 minutes",
      content: `
        <h1 style="color: #333; font-size: 22px;">Let your community tip you directly</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">A <strong>tip jar</strong> is the fastest Store product to launch.
        Set a few amounts, write a short thank-you, publish, and share the link.</p>
        <ol style="color: #555; line-height: 2;">
          <li>Go to Store → <strong>New tip jar</strong></li>
          <li>Name it, set tip presets, add a short description</li>
          <li>Publish when payouts are connected (you can draft now)</li>
        </ol>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/store" style="${btn}">Create a tip jar</a>
        </div>
        <p style="text-align: center; margin: 0;">
          <a href="${appUrl}/settings" style="${secondary}">Connect payouts in Settings</a>
        </p>
        ${signature}
      `,
    },
    {
      subject: "Step 2: Sell a download your fans will buy today",
      content: `
        <h1 style="color: #333; font-size: 22px;">One file. One price. Instant delivery.</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">A <strong>download</strong> is perfect for templates, presets,
        PDFs, or packs. Fans pay once and get the file.</p>
        <ol style="color: #555; line-height: 2;">
          <li>Store → <strong>New download</strong></li>
          <li>Add title, price, and the file or delivery URL</li>
          <li>Publish and copy your product link</li>
        </ol>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/store/new?kind=link" style="${btn}">Create a download</a>
        </div>
        ${signature}
      `,
    },
    {
      subject: "Step 3: Launch a course your community can binge",
      content: `
        <h1 style="color: #333; font-size: 22px;">Turn your knowledge into a multi-lesson course</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">Courses package lessons, videos, and chapter copy into one
        paid unlock. Start with 3–5 chapters — expand later.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/store/new?kind=course" style="${btn}">Create a course</a>
        </div>
        ${signature}
      `,
    },
    {
      subject: "Step 4: Connect payouts so you can publish and get paid",
      content: `
        <h1 style="color: #333; font-size: 22px;">Drafts are fine — publishing needs payouts</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">Fans can't check out until your payout account is active.
        Connect it once in Settings, then publish.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/settings" style="${btn}">Connect payouts</a>
        </div>
        <p style="text-align: center; margin: 0;">
          <a href="${appUrl}/store" style="${secondary}">Publish from Store</a>
        </p>
        ${signature}
      `,
    },
    {
      subject: "Step 5: Share your Store — make it easy to buy",
      content: `
        <h1 style="color: #333; font-size: 22px;">Put your products where your audience already is</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">Pin your tip jar or best product in your bio, stories, and
        newsletter. One clear link beats five soft CTAs.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/store" style="${btn}">Open Store &amp; copy links</a>
        </div>
        ${signature}
      `,
    },
  ];
}

function monetizedSteps(name: string, appUrl: string, btn: string, secondary: string): StepContent[] {  return [
    {
      subject: "You chose Deal Hunter — let's get you paid for brand work",
      content: `
        <h1 style="color: #333; font-size: 22px;">Brand deals without the Net-60 chase, ${name}</h1>
        <p style="color: #555; line-height: 1.6;">You picked the <strong>monetized / Deal Hunter</strong> path.
        Over the next two weeks we'll walk campaign discovery, verified reach, submissions, and payouts —
        so you look bookable and get paid fast.</p>
        <ul style="color: #555; line-height: 2;">
          <li>Polish your creator profile so brands trust you</li>
          <li>Verify social metrics brands can see live</li>
          <li>Claim campaigns, hit the Verza Score, get paid</li>
        </ul>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/campaigns" style="${btn}">Browse active campaigns</a>
        </div>
        ${signature}
      `,
    },
    {
      subject: "Step 1: Make your profile bookable",
      content: `
        <h1 style="color: #333; font-size: 22px;">Brands hire what they can understand in 10 seconds</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">Complete your display name, photo, niche, and bio. If you
        want inbound interest, turn on marketplace visibility when you're ready.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/profile" style="${btn}">Complete your profile</a>
        </div>
        ${signature}
      `,
    },
    {
      subject: "Step 2: Verify your reach — brands trust live metrics",
      content: `
        <h1 style="color: #333; font-size: 22px;">Screenshots don't book deals. Verified metrics do.</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">Connect Instagram, TikTok, or YouTube in Insights so brands
        see engagement they can trust — not a stale media kit PDF.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/insights" style="${btn}">Verify your reach</a>
        </div>
        ${signature}
      `,
    },
    {
      subject: "Step 3: Claim a campaign that fits your niche",
      content: `
        <h1 style="color: #333; font-size: 22px;">Find work that's already funded</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">Open the campaign network, filter for your platform and niche,
        and claim a spot. Briefs and rates are on the campaign page — no endless DMs to start.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/campaigns" style="${btn}">Browse campaigns</a>
        </div>
        ${signature}
      `,
    },
    {
      subject: "Step 4: Hit the Verza Score before you submit",
      content: `
        <h1 style="color: #333; font-size: 22px;">Brands pay for content that clears the Gauntlet</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">Every submission runs through the <strong>Verza Score</strong> —
        an AI preview of how the piece performs. Aim for the campaign threshold (often ~65%). Use
        <strong>AI Studio</strong> to prototype hooks before you film the final.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/ai-studio" style="${btn}">Open AI Studio</a>
        </div>
        <p style="text-align: center; margin: 0;">
          <a href="${appUrl}/campaigns" style="${secondary}">Back to campaigns</a>
        </p>
        ${signature}
      `,
    },
    {
      subject: "Step 5: Connect payouts — approval should mean money in the bank",
      content: `
        <h1 style="color: #333; font-size: 22px;">When work is approved, funds should move</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">Connect your bank in Settings so approved campaign work
        can pay out. No more chasing invoices for Verza-funded campaigns.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/settings" style="${btn}">Connect payouts</a>
        </div>
        <p style="text-align: center; margin: 0;">
          <a href="${appUrl}/campaigns" style="${secondary}">Find another campaign</a>
        </p>
        ${signature}
      `,
    },
  ];
}

function emergingSteps(name: string, appUrl: string, btn: string, secondary: string): StepContent[] {  return [
    {
      subject: "You chose growth — let's make posting feel intentional",
      content: `
        <h1 style="color: #333; font-size: 22px;">Build momentum before you monetize, ${name}</h1>
        <p style="color: #555; line-height: 1.6;">You picked the <strong>emerging / growth</strong> path.
        We'll walk AI Studio for hooks and scripts, practice with the Verza Score, then show you how to
        layer in deals or Store when you're ready.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/ai-studio" style="${btn}">Open AI Studio</a>
        </div>
        ${signature}
      `,
    },
    {
      subject: "Step 1: Script a hook that actually converts",
      content: `
        <h1 style="color: #333; font-size: 22px;">Stop guessing what to say in the first 3 seconds</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">In <strong>AI Studio</strong>, generate hooks and scripts
        for your niche and platform. Save a few winners and batch your next week of posts.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/ai-studio" style="${btn}">Generate a script</a>
        </div>
        ${signature}
      `,
    },
    {
      subject: "Step 2: Prototype the visual before you shoot",
      content: `
        <h1 style="color: #333; font-size: 22px;">Test the concept. Then film the real thing.</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">Use AI Studio scenes / media tools to rough out the look
        of a post or short. Kill weak ideas early — protect your production time for what works.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/ai-studio" style="${btn}">Prototype in AI Studio</a>
        </div>
        ${signature}
      `,
    },
    {
      subject: "Step 3: Practice the Gauntlet — know what will perform",
      content: `
        <h1 style="color: #333; font-size: 22px;">Get AI feedback before the algorithm does</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">The <strong>Verza Score</strong> simulates how content
        lands with a real audience. Practice on your own drafts so brand submissions (later) aren't your
        first time seeing feedback.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/ai-studio" style="${btn}">Practice in AI Studio</a>
        </div>
        ${signature}
      `,
    },
    {
      subject: "Step 4: Connect Insights so growth is measurable",
      content: `
        <h1 style="color: #333; font-size: 22px;">Growth without numbers is just vibes</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">Link your socials in Insights. When you're ready for brand
        deals, verified metrics are already there — and you can see which formats actually move.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/insights" style="${btn}">Connect Insights</a>
        </div>
        ${signature}
      `,
    },
    {
      subject: "Step 5: When you're ready — deals or Store next",
      content: `
        <h1 style="color: #333; font-size: 22px;">You've got the content engine. Add a money lane.</h1>
        <p style="color: #555; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #555; line-height: 1.6;">Two clean next steps when growth feels steady:</p>
        <ul style="color: #555; line-height: 2;">
          <li><strong>Campaigns</strong> — claim funded brand work and get paid on Verza</li>
          <li><strong>Store</strong> — tip jar, downloads, or a course for fans who already believe</li>
        </ul>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/campaigns" style="${btn}">Browse campaigns</a>
        </div>
        <p style="text-align: center; margin: 0;">
          <a href="${appUrl}/store" style="${secondary}">Or open Store</a>
        </p>
        ${signature}
      `,
    },
  ];
}

function stepsForPath(
  path: CareerPathEmailPath,
  name: string,
  appUrl: string,
  btn: string,
  secondary: string
): StepContent[] {
  if (path === "community") return communitySteps(name, appUrl, btn, secondary);
  if (path === "monetized") return monetizedSteps(name, appUrl, btn, secondary);
  return emergingSteps(name, appUrl, btn, secondary);
}

/**
 * Sends one step of a career-path drip (community / monetized / emerging).
 * Steps are 0–5; step 0 is usually sent immediately on path selection.
 */
export async function sendCareerPathEmailSequence(
  toEmail: string,
  name: string,
  path: CareerPathEmailPath,
  step: number
): Promise<void> {
  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.error("SENDGRID_API_KEY not set, skipping career path email sequence.");
    return;
  }
  sgMail.setApiKey(sendgridKey);

  const appUrl = params.APP_URL.value().replace(/\/$/, "");
  const btn = emailButtonStyle("6px");
  const secondary =
    `color: ${EMAIL_BRAND_PRIMARY}; font-size: 14px; text-decoration: underline;`;
  const steps = stepsForPath(path, name, appUrl, btn, secondary);
  const stepContent = steps[step];
  if (!stepContent) {
    logger.info(`No career path email for path=${path} step=${step}.`);
    return;
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
    logger.info(`Career path email sent`, {path, step, toEmail});
    await db.collection("emailLogs").add({
      to: toEmail,
      subject: stepContent.subject,
      html,
      type: "career_path_onboarding",
      path,
      step,
      timestamp: Timestamp.now(),
      status: "sent",
    });
  } catch (error) {
    logger.error(`Failed career path email path=${path} step=${step}`, error);
  }
}

/** @deprecated Prefer sendCareerPathEmailSequence(path: "community"). */
export async function sendStoreEmailSequence(
  toEmail: string,
  name: string,
  step: number
): Promise<void> {
  return sendCareerPathEmailSequence(toEmail, name, "community", step);
}

/**
 * Starts the drip for the creator's current careerPathResult.
 * Sends step 0 immediately and schedules steps 1–5.
 */
export const startCareerPathEmailSequence = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to start path guide emails.");
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
    careerPathResult?: string | null;
    careerPathEmailSequence?: {
      path: CareerPathEmailPath;
      step: number;
      nextEmailAt: Timestamp;
    } | null;
    storeEmailSequence?: {step: number; nextEmailAt: Timestamp} | null;
  };

  if (user.role !== "individual_creator" && user.role !== "talent") {
    throw new HttpsError("permission-denied", "Path guide emails are for creators.");
  }

  const path = user.careerPathResult;
  if (path !== "community" && path !== "monetized" && path !== "emerging") {
    throw new HttpsError(
      "failed-precondition",
      "Pick a career path before starting guide emails."
    );
  }
  if (!user.email) {
    throw new HttpsError("failed-precondition", "Add an email to your account first.");
  }

  // Already on this path's drip — don't restart mid-sequence.
  if (user.careerPathEmailSequence?.path === path) {
    return {ok: true as const, alreadyActive: true, path};
  }

  const twoDaysFromNow = new Timestamp(
    Timestamp.now().seconds + 2 * 24 * 60 * 60,
    0
  );

  await userRef.update({
    careerPathEmailSequence: {path, step: 1, nextEmailAt: twoDaysFromNow},
    // Clear legacy community-only field if present.
    storeEmailSequence: FieldValue.delete(),
  });

  await sendCareerPathEmailSequence(user.email, user.displayName || "there", path, 0);

  logger.info("[Career path emails] Sequence started", {uid, path});
  return {ok: true as const, started: true, path};
});

/** Back-compat alias used by older clients. */
export const startStoreEmailSequence = startCareerPathEmailSequence;
