import {randomBytes} from "node:crypto";
import {FieldValue, type QueryDocumentSnapshot} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {HttpsError, onCall, onRequest} from "firebase-functions/v2/https";
import sgMail from "@sendgrid/mail";
import {db} from "../config/firebase";
import * as params from "../config/params";
import {EMAIL_BRAND_PRIMARY, emailButtonStyle} from "../emailBrand";
import {slugifyCampaign} from "../gigs/publicCampaigns";
import type {Gig, UserProfileFirestoreData} from "../types";
import {assertVerzaAdmin} from "./campaigns";

const CREATOR_ROLES = new Set(["individual_creator", "talent"]);
const BRAND_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);
const PAGE_SIZE = 400;
const SEND_CONCURRENCY = 12;

type Recipient = {uid: string; email: string; name: string; token: string};

/**
 * @param {number} amount Dollars.
 * @return {string} USD string.
 */
function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

/**
 * @param {Gig} gig Campaign.
 * @return {string} Pay line for the email.
 */
export function campaignPayLine(gig: Gig): string {
  const parts: string[] = [];
  const funded = Number(gig.fundedAmount) || 0;
  const rate = Number(gig.ratePerCreator) || 0;
  if (gig.budgetMode === "pool") {
    parts.push(funded > 0 ? `${formatUsd(funded)} budget` : "Flat fee");
  } else if (rate > 0) {
    parts.push(`${formatUsd(rate)} per creator`);
  } else if (funded > 0) {
    parts.push(`${formatUsd(funded)} budget`);
  }
  const aff = gig.affiliateSettings;
  if (aff?.isEnabled && Number(aff.rewardAmount) > 0) {
    const unit = aff.rewardType === "cpc" ? "click" : "sale";
    parts.push(`${formatUsd(Number(aff.rewardAmount))} per ${unit}`);
  }
  return parts.join(" + ") || "See the campaign for pay";
}

/**
 * @param {string} uid User id.
 * @param {string} token Unsubscribe token.
 * @return {string} Public unsubscribe URL.
 */
function unsubscribeUrl(uid: string, token: string): string {
  const project = process.env.GCLOUD_PROJECT?.trim() || "verza-canvas";
  const region = process.env.FUNCTION_REGION?.trim() || "us-central1";
  const q = new URLSearchParams({u: uid, t: token});
  return `https://${region}-${project}.cloudfunctions.net/campaignAlertUnsubscribe?${q.toString()}`;
}

/**
 * @param {UserProfileFirestoreData} user User doc.
 * @return {boolean} Whether they should get campaign alert mail.
 */
function isEligibleCreator(user: UserProfileFirestoreData): boolean {
  if (!CREATOR_ROLES.has(user.role)) return false;
  if (BRAND_ROLES.has(user.role)) return false;
  if (user.isBrandAccount) return false;
  if (user.hasCompletedOnboarding !== true) return false;
  const email = typeof user.email === "string" ? user.email.trim() : "";
  if (!email) return false;
  if (user.emailPreferences?.campaignAlerts === false) return false;
  return true;
}

/**
 * Individual creators and talent who haven't unsubscribed.
 * @return {Promise<Recipient[]>} Recipients.
 */
async function loadRecipients(): Promise<Recipient[]> {
  const out: Recipient[] = [];
  const seen = new Set<string>();
  for (const role of ["individual_creator", "talent"]) {
    let cursor: QueryDocumentSnapshot | null = null;
    for (;;) {
      let q = db.collection("users").where("role", "==", role).limit(PAGE_SIZE);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      if (snap.empty) break;
      for (const docSnap of snap.docs) {
        if (seen.has(docSnap.id)) continue;
        const user = docSnap.data() as UserProfileFirestoreData;
        if (!isEligibleCreator(user)) continue;
        seen.add(docSnap.id);
        const email = String(user.email).trim();
        let token = typeof user.emailPrefsToken === "string" ? user.emailPrefsToken : "";
        if (!token) {
          token = randomBytes(16).toString("hex");
          await docSnap.ref.update({emailPrefsToken: token});
        }
        out.push({
          uid: docSnap.id,
          email,
          name: String(user.displayName || "there").split(" ")[0],
          token,
        });
      }
      cursor = snap.docs[snap.docs.length - 1];
      if (snap.size < PAGE_SIZE) break;
    }
  }
  return out;
}

/**
 * @param {object} args Email fields.
 * @return {string} HTML.
 */
function alertHtml(args: {
  name: string;
  brandName: string;
  title: string;
  payLine: string;
  applyUrl: string;
  unsubscribeUrl: string;
  appUrl: string;
}): string {
  const btn = emailButtonStyle("6px");
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Open campaign on Verza</title></head>
<body style="background-color: #f9f9f9; padding: 20px; font-family: sans-serif; margin: 0;">
<div style="max-width: 600px; margin: auto; padding: 30px; border: 1px solid #eee; border-radius: 12px;
  background-color: #ffffff;">
<div style="text-align: center; margin-bottom: 30px;">
<img src="https://app.tryverza.com/verza-icon.svg" alt="Verza" width="24" height="18"
  style="vertical-align: middle; margin-right: 8px;">
<span style="font-weight: bold; font-size: 24px; color: #000000; vertical-align: middle;">Verza</span>
</div>
<h1 style="color: #333; font-size: 22px;">There's an open campaign that might fit, ${args.name}</h1>
<p style="color: #555; line-height: 1.6;"><strong>${args.brandName}</strong> is looking for creators for
<strong>${args.title}</strong>.</p>
<p style="color: #555; line-height: 1.6;">Pay: <strong>${args.payLine}</strong></p>
<div style="text-align: center; margin: 30px 0;">
<a href="${args.applyUrl}" style="${btn}">View the campaign</a>
</div>
<p style="color: #555; line-height: 1.6;">It's free to apply. If it's not for you, you can skip it —
we only send these when a campaign is actually open.</p>
<p style="margin-top: 30px; font-size: 14px; color: #666;">Cheers,<br/><strong>Serge Amouzou</strong><br/>
Founder &amp; CEO of Verza</p>
<div style="text-align: center; border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">
<p style="font-size: 12px; color: #999; margin: 0;">Verza &copy; ${new Date().getFullYear()}</p>
<p style="margin-top: 10px;">
<a href="${args.unsubscribeUrl}" style="font-size: 11px; color: ${EMAIL_BRAND_PRIMARY};">Unsubscribe from campaign emails</a>
<span style="color: #ccc;"> · </span>
<a href="${args.appUrl}/profile" style="font-size: 11px; color: ${EMAIL_BRAND_PRIMARY};">Email settings</a>
</p>
</div></div></body></html>`;
}

/**
 * @param {Gig} gig Campaign.
 * @param {string} gigId Gig id.
 * @param {Recipient} r Recipient.
 * @return {Promise<boolean>} Sent.
 */
async function sendOne(gig: Gig, gigId: string, r: Recipient): Promise<boolean> {
  const appUrl = params.APP_URL.value().replace(/\/+$/, "");
  const slug = slugifyCampaign(gig.title || "campaign", gigId);
  const unsub = unsubscribeUrl(r.uid, r.token);
  const subject = `${gig.brandName || "A brand"} has an open campaign on Verza`;
  try {
    await sgMail.send({
      to: r.email,
      from: {name: "Serge from Verza", email: params.SENDGRID_FROM_EMAIL.value()},
      subject,
      html: alertHtml({
        name: r.name,
        brandName: gig.brandName || "A brand",
        title: gig.title || "Creator campaign",
        payLine: campaignPayLine(gig),
        applyUrl: `${appUrl}/c/${slug}`,
        unsubscribeUrl: unsub,
        appUrl,
      }),
      headers: {
        "List-Unsubscribe": `<${unsub}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    return true;
  } catch (e) {
    logger.error("campaign creator alert send failed", {
      to: r.email,
      gigId,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

/**
 * @param {Recipient[]} recipients Queue.
 * @param {function(Recipient): Promise<boolean>} fn Send one.
 * @return {Promise<number>} Success count.
 */
async function sendAll(
  recipients: Recipient[],
  fn: (r: Recipient) => Promise<boolean>
): Promise<number> {
  let sent = 0;
  for (let i = 0; i < recipients.length; i += SEND_CONCURRENCY) {
    const chunk = recipients.slice(i, i + SEND_CONCURRENCY);
    const results = await Promise.all(chunk.map((r) => fn(r)));
    sent += results.filter(Boolean).length;
  }
  return sent;
}

/** Count eligible creators, or send the campaign email to all of them. */
export const adminSendCampaignCreatorAlert = onCall(
  {secrets: [params.SENDGRID_API_KEY], timeoutSeconds: 540, memory: "512MiB"},
  async (request) => {
    const adminUid = assertVerzaAdmin(request);
    const gigId = String(request.data?.gigId ?? "").trim();
    const dryRun = request.data?.dryRun === true;
    if (!gigId) throw new HttpsError("invalid-argument", "Campaign ID is required.");

    const gigSnap = await db.collection("gigs").doc(gigId).get();
    if (!gigSnap.exists) throw new HttpsError("not-found", "Campaign not found.");
    const gig = gigSnap.data() as Gig;
    if (gig.status !== "open") {
      throw new HttpsError("failed-precondition", "Only open campaigns can be emailed to creators.");
    }

    const recipients = await loadRecipients();
    if (dryRun) {
      return {
        dryRun: true,
        recipientCount: recipients.length,
        title: gig.title || "Untitled campaign",
        payLine: campaignPayLine(gig),
      };
    }

    const key = params.SENDGRID_API_KEY.value();
    if (!key) throw new HttpsError("failed-precondition", "Email is not configured.");
    sgMail.setApiKey(key);

    const sent = await sendAll(recipients, (r) => sendOne(gig, gigId, r));
    await gigSnap.ref.update({
      lastCreatorAlertAt: FieldValue.serverTimestamp(),
      lastCreatorAlertBy: adminUid,
      lastCreatorAlertSent: sent,
    });
    logger.info("campaign creator alert sent", {gigId, sent, attempted: recipients.length, by: adminUid});
    return {
      dryRun: false,
      sent,
      attempted: recipients.length,
      title: gig.title || "Untitled campaign",
    };
  }
);

/**
 * @param {string} title Heading.
 * @param {string} body Trusted HTML.
 * @return {string} HTML page.
 */
function unsubscribePage(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title></head>
<body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: #f4f4f7; padding: 60px 20px;">
<div style="max-width: 480px; margin: auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px;
  padding: 40px; text-align: center;">
<h1 style="font-size: 22px; color: #1a202c; margin: 0 0 12px 0;">${title}</h1>
<p style="color: #4a5568; font-size: 15px; line-height: 1.6; margin: 0;">${body}</p></div></body></html>`;
}

/** One-click unsubscribe from campaign alert emails. */
export const campaignAlertUnsubscribe = onRequest(async (req, res) => {
  const uid = String(req.query.u ?? "");
  const token = String(req.query.t ?? "");
  const resubscribe = req.query.resubscribe === "1";
  if (!uid || !token || uid.length > 128 || token.length > 64) {
    res.status(400).send(unsubscribePage("Invalid link", "This unsubscribe link is incomplete."));
    return;
  }
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.emailPrefsToken !== token) {
    res.status(404).send(unsubscribePage("Link expired", "We couldn't match this link to an account."));
    return;
  }
  await ref.update({"emailPreferences.campaignAlerts": resubscribe});
  if (req.method === "POST") {
    res.status(200).send("ok");
    return;
  }
  const q = new URLSearchParams({u: uid, t: token, resubscribe: "1"});
  res.status(200).send(resubscribe ?
    unsubscribePage("You're subscribed", "You'll get an email when Verza shares an open campaign.") :
    unsubscribePage(
      "You're unsubscribed",
      "You won't get campaign emails anymore. Changed your mind? " +
      `<a href="?${q.toString()}" style="color: #0E7C5A;">Resubscribe</a>.`
    ));
});
