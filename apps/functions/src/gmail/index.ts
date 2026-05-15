import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {FieldValue} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import {GMAIL_OAUTH_CLIENT_SECRET} from "../config/params";
import {
  buildGmailOAuthUrl,
  buildGmailRawMessage,
  completeGmailOAuthForUser,
  disconnectGmailForUser,
  getGmailAccessTokenForUser,
} from "./tokens";

const TEAM_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);

/**
 * Ensures the caller is a brand team member with a primary workspace.
 * @param {string} uid Firebase Auth uid.
 */
async function assertBrandTeam(uid: string): Promise<{primaryAgencyId: string}> {
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("failed-precondition", "User profile not found.");
  }
  const user = userSnap.data()!;
  const role = String(user.role ?? "");
  if (!TEAM_ROLES.has(role)) {
    throw new HttpsError("permission-denied", "Gmail outreach is for brand team accounts.");
  }
  const primaryAgencyId = user.primaryAgencyId as string | undefined;
  if (!primaryAgencyId) {
    throw new HttpsError("failed-precondition", "Set a primary brand workspace before connecting Gmail.");
  }
  return {primaryAgencyId};
}

/**
 * Returns the Google OAuth URL to connect Gmail (compose drafts scope).
 */
export const beginGmailConnect = onCall(
  {secrets: [GMAIL_OAUTH_CLIENT_SECRET]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to connect Gmail.");
    }
    await assertBrandTeam(request.auth.uid);
    return {url: buildGmailOAuthUrl()};
  }
);

/**
 * Exchanges the OAuth authorization code and stores refresh tokens server-side.
 */
export const completeGmailConnect = onCall(
  {secrets: [GMAIL_OAUTH_CLIENT_SECRET]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to connect Gmail.");
    }
    const {code} = request.data as {code?: unknown};
    if (typeof code !== "string" || !code.trim()) {
      throw new HttpsError("invalid-argument", "Authorization code is required.");
    }
    await assertBrandTeam(request.auth.uid);
    const {email} = await completeGmailOAuthForUser(request.auth.uid, code.trim());
    logger.info(`[Gmail] Connected for uid=${request.auth.uid} (${email})`);
    return {success: true as const, email};
  }
);

/**
 * Disconnects Gmail and deletes stored credentials.
 */
export const disconnectGmail = onCall(
  {secrets: [GMAIL_OAUTH_CLIENT_SECRET]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to disconnect Gmail.");
    }
    await assertBrandTeam(request.auth.uid);
    await disconnectGmailForUser(request.auth.uid);
    return {success: true as const};
  }
);

/**
 * Creates a Gmail draft from an Optic vault lead's draft email.
 */
export const createOpticGmailDraft = onCall(
  {secrets: [GMAIL_OAUTH_CLIENT_SECRET]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to create a Gmail draft.");
    }
    const uid = request.auth.uid;
    const {leadId} = request.data as {leadId?: unknown};
    if (typeof leadId !== "string" || !leadId.trim()) {
      throw new HttpsError("invalid-argument", "leadId is required.");
    }

    const {primaryAgencyId} = await assertBrandTeam(uid);
    const leadSnap = await db.collection("optic_outreach_leads").doc(leadId.trim()).get();
    if (!leadSnap.exists) {
      throw new HttpsError("not-found", "Lead not found.");
    }
    const lead = leadSnap.data()!;
    if (String(lead.agencyId ?? "") !== primaryAgencyId) {
      throw new HttpsError("permission-denied", "This lead belongs to another brand.");
    }
    const toEmail = typeof lead.email === "string" ? lead.email.trim() : "";
    const draftBody = typeof lead.draftEmail === "string" ? lead.draftEmail.trim() : "";
    if (!toEmail) {
      throw new HttpsError("failed-precondition", "This lead has no email on their profile. Copy the draft manually.");
    }
    if (!draftBody) {
      throw new HttpsError("failed-precondition", "This lead has no draft email yet.");
    }

    const creatorName =
      typeof lead.creatorName === "string" && lead.creatorName.trim()
        ? lead.creatorName.trim()
        : "there";
    const brandName =
      typeof lead.agencyName === "string" && lead.agencyName.trim()
        ? lead.agencyName.trim()
        : "our team";
    const subject = `Partnership with ${brandName} — ${creatorName}`;

    const accessToken = await getGmailAccessTokenForUser(uid);
    const raw = buildGmailRawMessage({to: toEmail, subject, body: draftBody});

    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({message: {raw}}),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      logger.error("[Gmail] Draft create failed", {status: res.status, payload});
      throw new HttpsError("internal", "Gmail could not create the draft.");
    }

    const draftId = typeof payload.id === "string" ? payload.id : null;
    await leadSnap.ref.update({
      gmailDraftId: draftId,
      gmailDraftCreatedAt: FieldValue.serverTimestamp(),
    });

    return {success: true as const, draftId, to: toEmail};
  }
);
