
import {HttpsError, onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {FieldValue} from "firebase-admin/firestore";
import sgMail from "@sendgrid/mail";
import {db} from "../config/firebase";
import * as params from "../config/params";
import {EMAIL_BRAND_PRIMARY, emailButtonStyle} from "../emailBrand";
import type {Agency, Gig, UserProfileFirestoreData} from "../types";
import {
  gigHasCreatorCap,
  gigPlatformFeeFraction,
  isPoolBudgetGig,
  maxCreatorPayoutCents,
  poolRemainingCents,
} from "../poolBudget";

/**
 * @param {string} agencyId Campaign brand id.
 * @param {string} requesterId Auth uid.
 * @return {!Promise<Agency>} Agency if the caller is on the brand team.
 */
async function assertGigBrandTeam(agencyId: string, requesterId: string): Promise<Agency> {
  const agency = (await db.collection("agencies").doc(agencyId).get()).data() as Agency | undefined;
  if (!agency) throw new HttpsError("not-found", "Brand not found.");
  const isTeam = agency.ownerId === requesterId ||
    agency.team?.some((m) => m.userId === requesterId && (m.role === "admin" || m.role === "member"));
  if (!isTeam) {
    throw new HttpsError("permission-denied", "Only the brand team can do this.");
  }
  return agency;
}

/**
 * @param {string} value Raw text.
 * @return {string} Escaped text.
 */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * @param {string} to Recipient.
 * @param {string} subject Subject.
 * @param {string} html Body.
 * @return {!Promise<void>}
 */
async function sendCreatorMail(to: string, subject: string, html: string): Promise<void> {
  const key = params.SENDGRID_API_KEY.value();
  if (!key) {
    logger.error("SENDGRID_API_KEY not set, skipping campaign invite email.");
    return;
  }
  sgMail.setApiKey(key);
  await sgMail.send({
    to,
    from: {name: "Verza", email: params.SENDGRID_FROM_EMAIL.value()},
    subject,
    html,
  });
}

/**
 * @param {string} title Heading.
 * @param {string} body Html paragraphs.
 * @param {string} href Button url.
 * @param {string} cta Button label.
 * @return {string} Html email.
 */
function wrapEmail(title: string, body: string, href: string, cta: string): string {
  const appUrl = params.APP_URL.value();
  const btn = emailButtonStyle("6px");
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title></head>
    <body style="background-color: #f9f9f9; padding: 20px; font-family: sans-serif; margin: 0;">
      <div style="max-width: 600px; margin: auto; padding: 30px; border: 1px solid #eee;
        border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 30px;">
          <img src="https://app.tryverza.com/verza-icon.svg" alt="Verza" width="24" height="18"
            style="vertical-align: middle; margin-right: 8px;">
          <span style="font-weight: bold; font-size: 24px; color: #000000;
            vertical-align: middle;">Verza</span>
        </div>
        <h1 style="color: #333; font-size: 22px;">${title}</h1>
        ${body}
        <div style="text-align: center; margin: 30px 0;">
          <a href="${href}" style="${btn}">${cta}</a>
        </div>
        <div style="text-align: center; border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">
          <p style="font-size: 12px; color: #999; margin: 0;">
            Verza &copy; ${new Date().getFullYear()}
          </p>
          <a href="${appUrl}/profile" style="font-size: 11px; color: ${EMAIL_BRAND_PRIMARY}; text-decoration: none;">
            Notification Settings
          </a>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * @param {UserProfileFirestoreData} user Creator.
 * @param {Gig} gig Campaign.
 * @return {!Promise<void>}
 */
async function notifyInvite(user: UserProfileFirestoreData, gig: Gig): Promise<void> {
  const appUrl = params.APP_URL.value();
  const campaignUrl = `${appUrl}/campaigns/${gig.id}`;
  const brand = escapeHtml(gig.brandName || "A brand");
  const title = escapeHtml(gig.title || "a campaign");
  await db.collection("notifications").add({
    userId: user.uid,
    title: "Campaign invite",
    message: `${gig.brandName} invited you to "${gig.title}". Open the brief to accept or pass.`,
    type: "campaign_invite",
    read: false,
    link: `/campaigns/${gig.id}`,
    createdAt: FieldValue.serverTimestamp(),
  });
  if (!user.email) return;
  const html = wrapEmail(
    "You're invited",
    `<p style="color: #555; line-height: 1.6;">Hello ${escapeHtml(user.displayName || "there")},</p>
     <p style="color: #555; line-height: 1.6;">
       ${brand} invited you to <strong>"${title}"</strong> on Verza.
     </p>
     <p style="color: #555; line-height: 1.6;">
       Review the brief and accept if you want in. Nothing is booked until you say yes.
     </p>`,
    campaignUrl,
    "Review invite"
  );
  try {
    await sendCreatorMail(user.email, `${gig.brandName} invited you to "${gig.title}"`, html);
  } catch (err) {
    logger.error("Failed to send campaign invite email", {uid: user.uid, err});
  }
}

/**
 * Brand invites a specific creator to this campaign.
 */
export const inviteCreatorToCampaign = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const gigId = String(request.data?.gigId ?? "").trim();
  const creatorId = String(request.data?.creatorId ?? "").trim();
  const offeredRaw = request.data?.offeredPayout;
  if (!gigId || !creatorId) {
    throw new HttpsError("invalid-argument", "Campaign and creator are required.");
  }

  const gigRef = db.collection("gigs").doc(gigId);
  const gigSnap = await gigRef.get();
  if (!gigSnap.exists) throw new HttpsError("not-found", "Campaign not found.");
  const gig = {id: gigId, ...gigSnap.data()} as Gig;
  await assertGigBrandTeam(gig.brandId, request.auth.uid);

  if (gig.status !== "open" && gig.status !== "in-progress") {
    throw new HttpsError(
      "failed-precondition",
      "Fund or open this campaign before inviting creators."
    );
  }
  if ((gig.acceptedCreatorIds || []).includes(creatorId)) {
    return {status: "already_accepted" as const};
  }
  if ((gig.rejectedCreatorIds || []).includes(creatorId)) {
    throw new HttpsError(
      "failed-precondition",
      "This creator was declined for this campaign."
    );
  }
  if ((gig.appliedCreatorIds || []).includes(creatorId)) {
    return {status: "already_applied" as const};
  }
  if ((gig.invitedCreatorIds || []).includes(creatorId)) {
    return {status: "already_invited" as const};
  }
  if (gigHasCreatorCap(gig) &&
    (gig.acceptedCreatorIds || []).length >= (gig.creatorsNeeded || 0)) {
    throw new HttpsError("failed-precondition", "This campaign is full.");
  }

  const userSnap = await db.collection("users").doc(creatorId).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "Creator not found.");
  const user = {uid: creatorId, ...userSnap.data()} as UserProfileFirestoreData;

  const updates: Record<string, unknown> = {
    invitedCreatorIds: FieldValue.arrayUnion(creatorId),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (isPoolBudgetGig(gig)) {
    const offered = Number(offeredRaw);
    if (!Number.isFinite(offered) || offered < 1) {
      throw new HttpsError(
        "invalid-argument",
        "Enter the amount you expect to pay this creator."
      );
    }
    const fee = gigPlatformFeeFraction(gig);
    const maxPay = maxCreatorPayoutCents(
      poolRemainingCents({fundedAmount: gig.fundedAmount, budgetSpent: gig.budgetSpent}),
      fee
    ) / 100;
    if (maxPay < 1) {
      throw new HttpsError(
        "failed-precondition",
        "There is not enough campaign budget left to invite with an offer."
      );
    }
    if (offered > maxPay + 0.009) {
      throw new HttpsError(
        "invalid-argument",
        `That offer is above what is left in this campaign budget (max $${maxPay.toFixed(0)}).`
      );
    }
    updates[`offeredPayouts.${creatorId}`] = offered;
  }

  await gigRef.update(updates);
  await notifyInvite(user, gig);
  logger.info("Invited creator to campaign", {gigId, creatorId});
  return {
    status: "invited" as const,
    creatorName: user.displayName || "Creator",
  };
});

/**
 * Invited creator declines the personal invite.
 */
export const declineCampaignInvite = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const gigId = String(request.data?.gigId ?? "").trim();
  if (!gigId) throw new HttpsError("invalid-argument", "Campaign is required.");
  const uid = request.auth.uid;
  const gigRef = db.collection("gigs").doc(gigId);
  const gigSnap = await gigRef.get();
  if (!gigSnap.exists) throw new HttpsError("not-found", "Campaign not found.");
  const gig = gigSnap.data() as Gig;
  if (!(gig.invitedCreatorIds || []).includes(uid)) {
    throw new HttpsError("failed-precondition", "You do not have a pending invite.");
  }
  await gigRef.update({
    invitedCreatorIds: FieldValue.arrayRemove(uid),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {success: true};
});
