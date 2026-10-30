
import {HttpsError, onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import sgMail from "@sendgrid/mail";
import {db} from "../config/firebase";
import * as params from "../config/params";
import {EMAIL_BRAND_PRIMARY, emailButtonStyle} from "../emailBrand";
import type {
  Agency,
  CampaignKickoff,
  CampaignRejectReasonId,
  Gig,
  UserProfileFirestoreData,
} from "../types";
import {CAMPAIGN_REJECT_REASONS} from "../types";

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
 * @param {unknown} raw Url.
 * @return {string} https url.
 */
function requireHttpsUrl(raw: unknown): string {
  const value = String(raw ?? "").trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpsError("invalid-argument", "Enter a valid meeting link (https://…).");
  }
  if (parsed.protocol !== "https:") {
    throw new HttpsError("invalid-argument", "The meeting link must start with https://");
  }
  return parsed.toString();
}

/**
 * @param {?{toDate: Function}} value Firestore time.
 * @param {string} timezone IANA zone.
 * @return {string} Display time.
 */
function formatKickoffWhen(
  value: {toDate: () => Date} | undefined,
  timezone: string
): string {
  if (!value?.toDate) return "";
  const date = value.toDate();
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone || "UTC",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return date.toUTCString();
  }
}

/**
 * @param {?{toDate: Function}} value Firestore time.
 * @return {number} Epoch millis.
 */
function timeMillis(value: {toDate?: () => Date} | undefined): number {
  if (!value?.toDate) return 0;
  return value.toDate().getTime();
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
    logger.error("SENDGRID_API_KEY not set, skipping creator campaign email.");
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
 * @param {string} reasonLabel Decline reason.
 * @param {string | null} note Optional note.
 * @return {!Promise<void>}
 */
async function notifyRejected(
  user: UserProfileFirestoreData,
  gig: Gig,
  reasonLabel: string,
  note: string | null
): Promise<void> {
  const appUrl = params.APP_URL.value();
  const campaignUrl = `${appUrl}/campaigns/${gig.id}`;
  await db.collection("notifications").add({
    userId: user.uid,
    title: "Application update",
    message: `${gig.brandName} declined your application for "${gig.title}". ${reasonLabel}.`,
    type: "application_rejected",
    read: false,
    link: `/campaigns/${gig.id}`,
    createdAt: FieldValue.serverTimestamp(),
  });
  if (!user.email) return;
  const extra = note ?
    `<p style="color: #555; line-height: 1.6;">Note from the brand: ${
      note.replace(/</g, "&lt;")
    }</p>` : "";
  const html = wrapEmail(
    "Application update",
    `<p style="color: #555; line-height: 1.6;">Hello ${user.displayName || "there"},</p>
     <p style="color: #555; line-height: 1.6;">
       ${gig.brandName} is not moving forward with your application for
       <strong>"${gig.title}"</strong>.
     </p>
     <p style="color: #555; line-height: 1.6;"><strong>Reason:</strong> ${reasonLabel}.</p>
     ${extra}
     <p style="color: #555; line-height: 1.6;">
       You can keep working from other open campaigns — the brief just was not a match this time.
     </p>`,
    campaignUrl,
    "See campaign"
  );
  try {
    await sendCreatorMail(user.email, `Update on "${gig.title}"`, html);
  } catch (err) {
    logger.error("Failed to send reject email", err);
  }
}

/**
 * @param {UserProfileFirestoreData} user Creator.
 * @param {Gig} gig Campaign.
 * @param {CampaignKickoff} kickoff Event.
 * @return {!Promise<void>}
 */
async function notifyKickoff(
  user: UserProfileFirestoreData,
  gig: Gig,
  kickoff: CampaignKickoff
): Promise<void> {
  const when = formatKickoffWhen(kickoff.startsAt, kickoff.timezone);
  const appUrl = params.APP_URL.value();
  const campaignUrl = `${appUrl}/campaigns/${gig.id}`;
  const note = kickoff.note ?
    `<p style="color: #555; line-height: 1.6;">${kickoff.note.replace(/</g, "&lt;")}</p>` : "";
  await db.collection("notifications").add({
    userId: user.uid,
    title: "Optional group kickoff",
    message: `${gig.brandName} scheduled a group kickoff for "${gig.title}" on ${when}. ` +
      "Join if you can — you can still work from the brief.",
    type: "campaign_kickoff",
    read: false,
    link: `/campaigns/${gig.id}`,
    createdAt: FieldValue.serverTimestamp(),
  });
  if (!user.email) return;
  const html = wrapEmail(
    "Optional group kickoff",
    `<p style="color: #555; line-height: 1.6;">Hello ${user.displayName || "there"},</p>
     <p style="color: #555; line-height: 1.6;">
       ${gig.brandName} scheduled a group kickoff for <strong>"${gig.title}"</strong>.
     </p>
     <p style="color: #555; line-height: 1.6;"><strong>When:</strong> ${when}</p>
     ${note}
     <p style="color: #555; line-height: 1.6;">
       Add it on the brand&apos;s calendar if you want to be there. You can still start from
       the brief if you cannot make it.
     </p>`,
    campaignUrl,
    "View campaign"
  );
  try {
    await sendCreatorMail(user.email, `Kickoff for "${gig.title}" — ${when}`, html);
  } catch (err) {
    logger.error("Failed to send kickoff email", {uid: user.uid, err});
  }
}

/**
 * Brand declines an applicant with a short reason.
 */
export const rejectCampaignApplicant = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const gigId = String(request.data?.gigId ?? "").trim();
  const creatorId = String(request.data?.creatorId ?? "").trim();
  const reasonId = String(request.data?.reasonId ?? "").trim() as CampaignRejectReasonId;
  const noteRaw = String(request.data?.note ?? "").trim();
  if (!gigId || !creatorId) {
    throw new HttpsError("invalid-argument", "Campaign and creator are required.");
  }
  const reason = CAMPAIGN_REJECT_REASONS.find((r) => r.id === reasonId);
  if (!reason) throw new HttpsError("invalid-argument", "Pick a reason for the decline.");
  const note = reasonId === "other" && noteRaw ? noteRaw.slice(0, 280) : null;

  const gigRef = db.collection("gigs").doc(gigId);
  const gigSnap = await gigRef.get();
  if (!gigSnap.exists) throw new HttpsError("not-found", "Campaign not found.");
  const gig = {id: gigId, ...gigSnap.data()} as Gig;
  await assertGigBrandTeam(gig.brandId, request.auth.uid);

  if (gig.acceptedCreatorIds?.includes(creatorId)) {
    throw new HttpsError("failed-precondition", "This creator is already on the roster.");
  }
  if (!(gig.appliedCreatorIds || []).includes(creatorId)) {
    throw new HttpsError("failed-precondition", "This creator has not applied.");
  }

  const userSnap = await db.collection("users").doc(creatorId).get();
  const user = userSnap.exists ?
    {uid: creatorId, ...userSnap.data()} as UserProfileFirestoreData :
    null;

  await gigRef.update({
    appliedCreatorIds: FieldValue.arrayRemove(creatorId),
    invitedCreatorIds: FieldValue.arrayRemove(creatorId),
    rejectedCreatorIds: FieldValue.arrayUnion(creatorId),
    [`applicationRejections.${creatorId}`]: {
      reasonId: reason.id,
      reasonLabel: reason.label,
      note,
      at: FieldValue.serverTimestamp(),
      by: request.auth.uid,
    },
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (user) await notifyRejected(user, gig, reason.label, note);
  logger.info("Rejected campaign applicant", {gigId, creatorId, reasonId: reason.id});
  return {success: true};
});

/**
 * @param {Gig} gig Campaign.
 * @param {string[]} creatorIds Who to invite.
 * @return {!Promise<string[]>} Ids emailed.
 */
async function inviteCreators(gig: Gig, creatorIds: string[]): Promise<string[]> {
  const kickoff = gig.kickoff;
  if (!kickoff?.startsAt || !creatorIds.length) return [];
  if (timeMillis(kickoff.startsAt) <= Date.now()) return [];
  const invited: string[] = [];
  for (const uid of creatorIds) {
    if ((kickoff.invitedCreatorIds || []).includes(uid)) continue;
    if (!(gig.acceptedCreatorIds || []).includes(uid)) continue;
    const snap = await db.collection("users").doc(uid).get();
    if (!snap.exists) continue;
    const user = {uid, ...snap.data()} as UserProfileFirestoreData;
    await notifyKickoff(user, gig, kickoff);
    invited.push(uid);
  }
  if (invited.length) {
    await db.collection("gigs").doc(gig.id).update({
      "kickoff.invitedCreatorIds": FieldValue.arrayUnion(...invited),
    });
  }
  return invited;
}

/**
 * Brand schedules or updates the optional group kickoff.
 */
export const setCampaignKickoff = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const gigId = String(request.data?.gigId ?? "").trim();
  const joinUrl = requireHttpsUrl(request.data?.joinUrl);
  const timezone = String(request.data?.timezone ?? "").trim() || "UTC";
  const note = String(request.data?.note ?? "").trim().slice(0, 280) || null;
  const startsAtRaw = request.data?.startsAt;
  if (!gigId || !startsAtRaw) {
    throw new HttpsError("invalid-argument", "Campaign, time, and meeting link are required.");
  }
  const startsDate = new Date(String(startsAtRaw));
  if (Number.isNaN(startsDate.getTime())) {
    throw new HttpsError("invalid-argument", "Enter a valid kickoff time.");
  }
  if (startsDate.getTime() <= Date.now() - 60 * 1000) {
    throw new HttpsError("invalid-argument", "Pick a kickoff time in the future.");
  }

  const gigRef = db.collection("gigs").doc(gigId);
  const gigSnap = await gigRef.get();
  if (!gigSnap.exists) throw new HttpsError("not-found", "Campaign not found.");
  const gig = {id: gigId, ...gigSnap.data()} as Gig;
  await assertGigBrandTeam(gig.brandId, request.auth.uid);

  const startsAt = Timestamp.fromDate(startsDate);
  const prev = gig.kickoff;
  const timeChanged = !prev?.startsAt || timeMillis(prev.startsAt) !== startsAt.toMillis();
  const urlChanged = prev?.joinUrl !== joinUrl;
  const resetRsvps = timeChanged || urlChanged;

  const kickoff: CampaignKickoff = {
    startsAt,
    timezone,
    joinUrl,
    note,
    updatedAt: Timestamp.now(),
    updatedBy: request.auth.uid,
    rsvps: resetRsvps ? {} : (prev?.rsvps || {}),
    invitedCreatorIds: resetRsvps ? [] : (prev?.invitedCreatorIds || []),
  };

  await gigRef.update({
    kickoff,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const invited = await inviteCreators(
    {...gig, kickoff},
    gig.acceptedCreatorIds || []
  );
  return {success: true, invitedCount: invited.length};
});

/**
 * Email a newly accepted creator if a future kickoff already exists.
 */
export const inviteToCampaignKickoff = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const gigId = String(request.data?.gigId ?? "").trim();
  const creatorId = String(request.data?.creatorId ?? "").trim();
  if (!gigId || !creatorId) {
    throw new HttpsError("invalid-argument", "Campaign and creator are required.");
  }
  const gigSnap = await db.collection("gigs").doc(gigId).get();
  if (!gigSnap.exists) throw new HttpsError("not-found", "Campaign not found.");
  const gig = {id: gigId, ...gigSnap.data()} as Gig;
  await assertGigBrandTeam(gig.brandId, request.auth.uid);
  const invited = await inviteCreators(gig, [creatorId]);
  return {success: true, invited: invited.length > 0};
});

/**
 * Accepted creator RSVPs to the group kickoff.
 */
export const rsvpCampaignKickoff = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const gigId = String(request.data?.gigId ?? "").trim();
  const response = String(request.data?.response ?? "").trim();
  if (!gigId || (response !== "yes" && response !== "no")) {
    throw new HttpsError("invalid-argument", "Choose yes or no.");
  }
  const uid = request.auth.uid;
  const gigRef = db.collection("gigs").doc(gigId);
  const gigSnap = await gigRef.get();
  if (!gigSnap.exists) throw new HttpsError("not-found", "Campaign not found.");
  const gig = gigSnap.data() as Gig;
  if (!(gig.acceptedCreatorIds || []).includes(uid)) {
    throw new HttpsError("permission-denied", "Only accepted creators can RSVP.");
  }
  if (!gig.kickoff?.startsAt) {
    throw new HttpsError("failed-precondition", "No kickoff is scheduled.");
  }
  await gigRef.update({
    [`kickoff.rsvps.${uid}`]: response,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {success: true, response};
});
