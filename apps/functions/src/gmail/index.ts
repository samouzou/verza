import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {FieldValue, type DocumentData, type DocumentSnapshot} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import {GMAIL_OAUTH_CLIENT_SECRET} from "../config/params";
import {
  buildGmailOAuthUrl,
  buildGmailRawMessage,
  completeGmailOAuthForUser,
  disconnectGmailForUser,
  getGmailAccessTokenForUser,
} from "./tokens";
import {isOpticLeadStage} from "../optic/leadCrm";
import {isEmailDraftEmpty} from "./emailHtml";
import {parseGmailThread} from "./thread";

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
 * Returns the Google OAuth URL to connect Gmail (compose + send).
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
    const {email, canRead} = await completeGmailOAuthForUser(request.auth.uid, code.trim());
    logger.info(`[Gmail] Connected for uid=${request.auth.uid} (${email}) canRead=${canRead}`);
    return {success: true as const, email, canRead};
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

type LeadEmailPayload = {
  leadSnap: DocumentSnapshot;
  lead: DocumentData;
  toEmail: string;
  subject: string;
  body: string;
  threadId: string | null;
};

/**
 * Loads a vault lead the caller may email and builds the outbound message.
 * @param {string} uid Auth uid.
 * @param {string} leadId Vault lead id.
 * @return {Promise<LeadEmailPayload>} Lead + message fields.
 */
async function loadVaultLeadForGmail(
  uid: string,
  leadId: string
): Promise<{leadSnap: DocumentSnapshot; lead: DocumentData}> {
  const {primaryAgencyId} = await assertBrandTeam(uid);
  const leadSnap = await db.collection("optic_outreach_leads").doc(leadId.trim()).get();
  if (!leadSnap.exists) {
    throw new HttpsError("not-found", "Lead not found.");
  }
  const lead = leadSnap.data()!;
  if (String(lead.agencyId ?? "") !== primaryAgencyId) {
    throw new HttpsError("permission-denied", "This lead belongs to another brand.");
  }
  return {leadSnap, lead};
}

async function loadLeadEmailPayload(uid: string, leadId: string): Promise<LeadEmailPayload> {
  const {leadSnap, lead} = await loadVaultLeadForGmail(uid, leadId);
  const toEmail = typeof lead.email === "string" ? lead.email.trim() : "";
  const body = typeof lead.draftEmail === "string" ? lead.draftEmail.trim() : "";
  if (!toEmail) {
    throw new HttpsError(
      "failed-precondition",
      "This lead has no email on their profile. Copy the platform DM from the vault instead."
    );
  }
  if (!body || isEmailDraftEmpty(body)) {
    throw new HttpsError("failed-precondition", "This lead has no draft email yet.");
  }

  const storedSubject =
    typeof lead.draftEmailSubject === "string" ? lead.draftEmailSubject.trim() : "";
  const creatorName =
    typeof lead.creatorName === "string" && lead.creatorName.trim() ?
      lead.creatorName.trim() :
      "there";
  const brandName =
    typeof lead.agencyName === "string" && lead.agencyName.trim() ?
      lead.agencyName.trim() :
      "our team";
  let subject = storedSubject || `Partnership with ${brandName} — ${creatorName}`;
  const threadId = typeof lead.gmailThreadId === "string" && lead.gmailThreadId.trim()
    ? lead.gmailThreadId.trim()
    : null;
  if (threadId && !/^re:\s/i.test(subject)) {
    subject = `Re: ${subject}`;
  }

  return {leadSnap, lead, toEmail, subject, body, threadId};
}

function markLeadContacted(
  lead: DocumentData,
  uid: string,
  extra: Record<string, unknown>
): Record<string, unknown> {
  const stage = isOpticLeadStage(lead.pipelineStage)
    ? lead.pipelineStage
    : lead.outreachEmailed === true ? "contacted" : "new";
  return {
    outreachEmailed: true,
    outreachEmailedAt: FieldValue.serverTimestamp(),
    outreachEmailedBy: uid,
    lastContactedAt: FieldValue.serverTimestamp(),
    ...(stage === "new" ? {pipelineStage: "contacted"} : {}),
    updatedAt: FieldValue.serverTimestamp(),
    ...extra,
  };
}

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

    const {leadSnap, toEmail, subject, body} = await loadLeadEmailPayload(uid, leadId);
    const accessToken = await getGmailAccessTokenForUser(uid);
    const raw = buildGmailRawMessage({to: toEmail, subject, body});

    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
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

/**
 * Sends the vault draft from the connected Gmail account (compose scope already allows send).
 */
export const sendOpticGmailMessage = onCall(
  {secrets: [GMAIL_OAUTH_CLIENT_SECRET]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to send outreach.");
    }
    const uid = request.auth.uid;
    const {leadId} = request.data as {leadId?: unknown};
    if (typeof leadId !== "string" || !leadId.trim()) {
      throw new HttpsError("invalid-argument", "leadId is required.");
    }

    const {leadSnap, lead, toEmail, subject, body, threadId} =
      await loadLeadEmailPayload(uid, leadId);
    const accessToken = await getGmailAccessTokenForUser(uid);
    const raw = buildGmailRawMessage({
      to: toEmail,
      subject,
      body,
      inReplyTo: typeof lead.gmailRfcMessageId === "string" ? lead.gmailRfcMessageId : undefined,
    });

    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(threadId ? {raw, threadId} : {raw}),
    });
    const payload = await res.json().catch(() => ({})) as {
      id?: string;
      threadId?: string;
    };
    if (!res.ok) {
      logger.error("[Gmail] Send failed", {status: res.status, payload});
      throw new HttpsError("internal", "Gmail could not send the message.");
    }

    const messageId = typeof payload.id === "string" ? payload.id : null;
    const nextThreadId = typeof payload.threadId === "string" ? payload.threadId : threadId;
    const followUp = Boolean(threadId);
    await leadSnap.ref.update(markLeadContacted(lead, uid, {
      gmailMessageId: messageId,
      gmailThreadId: nextThreadId,
      gmailSentAt: FieldValue.serverTimestamp(),
      gmailSentBy: uid,
      gmailLastSendKind: followUp ? "follow_up" : "initial",
    }));

    logger.info("[Gmail] Sent outreach", {uid, leadId: leadSnap.id, followUp});
    return {
      success: true as const,
      to: toEmail,
      threadId: nextThreadId,
      followUp,
    };
  }
);

/**
 * Loads the Gmail thread for a vault lead so the team can read replies.
 */
export const getOpticGmailThread = onCall(
  {secrets: [GMAIL_OAUTH_CLIENT_SECRET]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to read the thread.");
    }
    const uid = request.auth.uid;
    const {leadId} = request.data as {leadId?: unknown};
    if (typeof leadId !== "string" || !leadId.trim()) {
      throw new HttpsError("invalid-argument", "leadId is required.");
    }

    const {leadSnap, lead} = await loadVaultLeadForGmail(uid, leadId);
    const threadId =
      typeof lead.gmailThreadId === "string" ? lead.gmailThreadId.trim() : "";
    if (!threadId) {
      throw new HttpsError("failed-precondition", "No Gmail thread yet. Send from Verza first.");
    }

    const userSnap = await db.collection("users").doc(uid).get();
    const connectedEmail =
      typeof userSnap.data()?.opticGmailEmail === "string"
        ? String(userSnap.data()!.opticGmailEmail).trim()
        : "";

    const accessToken = await getGmailAccessTokenForUser(uid);
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`,
      {headers: {Authorization: `Bearer ${accessToken}`}}
    );
    const payload = await res.json().catch(() => ({}));
    if (res.status === 403 || res.status === 401) {
      logger.warn("[Gmail] Thread read denied", {status: res.status, payload});
      throw new HttpsError(
        "failed-precondition",
        "Reconnect Gmail and allow inbox read to see replies."
      );
    }
    if (!res.ok) {
      logger.error("[Gmail] Thread fetch failed", {status: res.status, payload});
      throw new HttpsError("internal", "Could not load the Gmail thread.");
    }

    const messages = parseGmailThread(payload, connectedEmail);
    const inbound = messages.filter((m) => m.direction === "inbound");
    const lastInbound = inbound.at(-1);
    const stage = isOpticLeadStage(lead.pipelineStage)
      ? lead.pipelineStage
      : lead.outreachEmailed === true ? "contacted" : "new";
    const crmPatch: Record<string, unknown> = {
      gmailReplyCount: inbound.length,
      gmailThreadFetchedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (lastInbound) {
      crmPatch.gmailLastInboundAt = lastInbound.date
        ? new Date(lastInbound.date)
        : FieldValue.serverTimestamp();
      if (stage === "new" || stage === "contacted") {
        crmPatch.pipelineStage = "replied";
      }
    }
    await leadSnap.ref.update(crmPatch);

    return {success: true as const, threadId, messages, replyCount: inbound.length};
  }
);
