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
import {parseGmailThread, type GmailThreadMessage} from "./thread";

const TEAM_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);
const THREAD_SNAPSHOT_MAX = 20;
const THREAD_BODY_MAX = 8000;

/**
 * Sanitizes parsed Gmail messages for Firestore team read-only sharing.
 * @param {GmailThreadMessage[]} messages Parsed thread messages.
 * @return {GmailThreadMessage[]} Capped, size-bounded copy.
 */
function sanitizeThreadSnapshot(messages: GmailThreadMessage[]): GmailThreadMessage[] {
  return messages.slice(-THREAD_SNAPSHOT_MAX).map((m) => ({
    id: String(m.id ?? "").slice(0, 128),
    from: String(m.from ?? "").slice(0, 200),
    fromEmail: String(m.fromEmail ?? "").slice(0, 200),
    date: typeof m.date === "string" ? m.date.slice(0, 40) : null,
    snippet: String(m.snippet ?? "").slice(0, 500),
    body: String(m.body ?? "").slice(0, THREAD_BODY_MAX),
    direction: m.direction === "outbound" ? "outbound" : "inbound",
  }));
}

/**
 * Builds lead fields that store a team-visible, read-only thread copy.
 * @param {GmailThreadMessage[]} messages Parsed messages.
 * @param {string} uid Synced-by uid.
 * @param {string} email Synced-by mailbox.
 * @return {Record<string, unknown>} Firestore patch fields.
 */
function threadSnapshotPatch(
  messages: GmailThreadMessage[],
  uid: string,
  email: string
): Record<string, unknown> {
  return {
    gmailThreadSnapshot: sanitizeThreadSnapshot(messages),
    gmailThreadSyncedAt: FieldValue.serverTimestamp(),
    gmailThreadSyncedByUid: uid,
    gmailThreadSyncedByEmail: email.trim() || null,
  };
}

function snapshotFromLead(lead: DocumentData): GmailThreadMessage[] {
  const raw = lead.gmailThreadSnapshot;
  if (!Array.isArray(raw)) return [];
  return sanitizeThreadSnapshot(
    raw.filter((m): m is GmailThreadMessage => !!m && typeof m === "object")
  );
}

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

    const senderSnap = await db.collection("users").doc(uid).get();
    const senderEmail =
      typeof senderSnap.data()?.opticGmailEmail === "string"
        ? String(senderSnap.data()!.opticGmailEmail).trim()
        : "";
    const canRead = senderSnap.data()?.opticGmailCanRead === true;

    let snapshotMessages: GmailThreadMessage[] | null = null;
    if (nextThreadId && canRead) {
      try {
        const {messages} = await fetchThreadAndUpdateLead(
          leadSnap,
          lead,
          nextThreadId,
          accessToken,
          senderEmail,
          uid,
          markLeadContacted(lead, uid, {
            gmailMessageId: messageId,
            gmailThreadId: nextThreadId,
            gmailSentAt: FieldValue.serverTimestamp(),
            gmailSentBy: uid,
            gmailLastSendKind: followUp ? "follow_up" : "initial",
          })
        );
        snapshotMessages = messages;
      } catch (e) {
        logger.warn("[Gmail] Post-send thread sync failed", {
          uid,
          leadId: leadSnap.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (!snapshotMessages) {
      const prior = snapshotFromLead(lead);
      const outbound: GmailThreadMessage = {
        id: messageId || `sent_${Date.now()}`,
        from: senderEmail || "You",
        fromEmail: senderEmail.toLowerCase(),
        date: new Date().toISOString(),
        snippet: subject.slice(0, 140),
        body: body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, THREAD_BODY_MAX) ||
          subject,
        direction: "outbound",
      };
      const seeded = sanitizeThreadSnapshot([...prior, outbound]);
      await leadSnap.ref.update(
        markLeadContacted(lead, uid, {
          gmailMessageId: messageId,
          gmailThreadId: nextThreadId,
          gmailSentAt: FieldValue.serverTimestamp(),
          gmailSentBy: uid,
          gmailLastSendKind: followUp ? "follow_up" : "initial",
          ...threadSnapshotPatch(seeded, uid, senderEmail),
        })
      );
    }

    logger.info("[Gmail] Sent outreach", {uid, leadId: leadSnap.id, followUp});
    return {
      success: true as const,
      to: toEmail,
      threadId: nextThreadId,
      followUp,
    };
  }
);

type LinkedThreadSource = "existing" | "message_id" | "search";

/**
 * Builds Gmail search queries from most specific to broadest.
 * @param {string} toEmail Creator email.
 * @param {string} [subject] Optional draft / known subject.
 * @return {string[]} Query strings for users.threads.list.
 */
function buildGmailThreadSearchQueries(toEmail: string, subject?: string): string[] {
  const email = toEmail.trim();
  const queries: string[] = [];
  const cleanedSubject = (subject ?? "").replace(/["'\\(){}]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (cleanedSubject) {
    queries.push(`to:${email} subject:(${cleanedSubject})`);
    queries.push(`from:${email} subject:(${cleanedSubject})`);
  }
  queries.push(`in:sent to:${email}`);
  queries.push(`to:${email} OR from:${email}`);
  return queries;
}

/**
 * Lists thread ids for a Gmail search query.
 * @param {string} accessToken OAuth access token.
 * @param {string} q Gmail search query.
 * @return {Promise<string[]>} Thread ids (most recent first).
 */
async function listGmailThreadIds(accessToken: string, q: string): Promise<string[]> {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/threads");
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", "5");
  const res = await fetch(url.toString(), {
    headers: {Authorization: `Bearer ${accessToken}`},
  });
  const payload = await res.json().catch(() => ({})) as {
    threads?: Array<{id?: string}>;
    error?: {message?: string};
  };
  if (res.status === 403 || res.status === 401) {
    logger.warn("[Gmail] Thread search denied", {status: res.status, payload});
    throw new HttpsError(
      "failed-precondition",
      "Reconnect Gmail and allow inbox read to find past threads."
    );
  }
  if (!res.ok) {
    logger.error("[Gmail] Thread search failed", {status: res.status, payload, q});
    throw new HttpsError("internal", "Could not search Gmail for this lead.");
  }
  return (payload.threads ?? [])
    .map((t) => (typeof t.id === "string" ? t.id.trim() : ""))
    .filter(Boolean);
}

/**
 * Resolves a Gmail thread id for a vault lead (existing, message id, or search).
 * @param {DocumentData} lead Lead document.
 * @param {string} accessToken OAuth access token.
 * @return {Promise<{threadId: string, messageId: string | null, source: LinkedThreadSource}>}
 */
async function resolveGmailThreadForLead(
  lead: DocumentData,
  accessToken: string
): Promise<{threadId: string; messageId: string | null; source: LinkedThreadSource}> {
  const existing =
    typeof lead.gmailThreadId === "string" ? lead.gmailThreadId.trim() : "";
  if (existing) {
    return {
      threadId: existing,
      messageId: typeof lead.gmailMessageId === "string" ? lead.gmailMessageId.trim() : null,
      source: "existing",
    };
  }

  const storedMessageId =
    typeof lead.gmailMessageId === "string" ? lead.gmailMessageId.trim() : "";
  if (storedMessageId) {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(storedMessageId)}?format=minimal`,
      {headers: {Authorization: `Bearer ${accessToken}`}}
    );
    const payload = await res.json().catch(() => ({})) as {
      id?: string;
      threadId?: string;
    };
    if (res.status === 403 || res.status === 401) {
      throw new HttpsError(
        "failed-precondition",
        "Reconnect Gmail and allow inbox read to find past threads."
      );
    }
    if (res.ok && typeof payload.threadId === "string" && payload.threadId.trim()) {
      return {
        threadId: payload.threadId.trim(),
        messageId: typeof payload.id === "string" ? payload.id : storedMessageId,
        source: "message_id",
      };
    }
  }

  const toEmail = typeof lead.email === "string" ? lead.email.trim() : "";
  if (!toEmail) {
    throw new HttpsError(
      "failed-precondition",
      "This lead has no email — add one before searching Gmail."
    );
  }
  const subject =
    typeof lead.draftEmailSubject === "string" ? lead.draftEmailSubject.trim() : "";
  for (const q of buildGmailThreadSearchQueries(toEmail, subject)) {
    const ids = await listGmailThreadIds(accessToken, q);
    if (ids.length > 0) {
      return {threadId: ids[0], messageId: storedMessageId || null, source: "search"};
    }
  }

  throw new HttpsError(
    "not-found",
    "No Gmail thread found for this creator in the connected inbox. They may have been emailed from another account."
  );
}

/**
 * Fetches a thread, updates CRM fields on the lead, and returns parsed messages.
 * Also writes a team-readable snapshot so other brand members can view replies
 * without sharing Gmail OAuth credentials.
 * @param {DocumentSnapshot} leadSnap Lead snapshot.
 * @param {DocumentData} lead Lead data.
 * @param {string} threadId Gmail thread id.
 * @param {string} accessToken OAuth access token.
 * @param {string} connectedEmail Connected Gmail address.
 * @param {string} syncedByUid User who performed the live sync.
 * @param {Record<string, unknown>} [extraPatch] Extra fields to merge (e.g. link metadata).
 */
async function fetchThreadAndUpdateLead(
  leadSnap: DocumentSnapshot,
  lead: DocumentData,
  threadId: string,
  accessToken: string,
  connectedEmail: string,
  syncedByUid: string,
  extraPatch: Record<string, unknown> = {}
): Promise<{messages: ReturnType<typeof parseGmailThread>; replyCount: number}> {
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
    ...threadSnapshotPatch(messages, syncedByUid, connectedEmail),
    ...extraPatch,
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
  return {messages, replyCount: inbound.length};
}

/**
 * Loads the Gmail thread for a vault lead.
 * Prefer a live inbox sync when the caller has Gmail read connected; otherwise
 * serve the team snapshot written on the lead (read-only).
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
      throw new HttpsError(
        "failed-precondition",
        "No Gmail thread linked yet. Use Find in Gmail, or send from Verza first."
      );
    }

    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data() ?? {};
    const connectedEmail =
      typeof userData.opticGmailEmail === "string"
        ? String(userData.opticGmailEmail).trim()
        : "";
    const canLiveSync =
      userData.opticGmailConnected === true && userData.opticGmailCanRead === true;

    if (canLiveSync) {
      try {
        const accessToken = await getGmailAccessTokenForUser(uid);
        const {messages, replyCount} = await fetchThreadAndUpdateLead(
          leadSnap,
          lead,
          threadId,
          accessToken,
          connectedEmail,
          uid
        );
        return {
          success: true as const,
          threadId,
          messages,
          replyCount,
          readOnly: false as const,
          source: "live" as const,
          syncedByEmail: connectedEmail || null,
        };
      } catch (e) {
        logger.warn("[Gmail] Live thread sync failed; trying team snapshot", {
          uid,
          leadId: leadSnap.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const snapshot = snapshotFromLead(lead);
    if (snapshot.length > 0) {
      const replyCount =
        typeof lead.gmailReplyCount === "number" && Number.isFinite(lead.gmailReplyCount)
          ? lead.gmailReplyCount
          : snapshot.filter((m) => m.direction === "inbound").length;
      const syncedByEmail =
        typeof lead.gmailThreadSyncedByEmail === "string"
          ? lead.gmailThreadSyncedByEmail
          : null;
      return {
        success: true as const,
        threadId,
        messages: snapshot,
        replyCount,
        readOnly: true as const,
        source: "snapshot" as const,
        syncedByEmail,
      };
    }

    if (!canLiveSync) {
      throw new HttpsError(
        "failed-precondition",
        "This conversation isn’t shared yet. A teammate with Gmail connected needs to open or refresh the thread once — then the whole team can read it."
      );
    }
    throw new HttpsError(
      "failed-precondition",
      "Could not load this thread from Gmail, and no shared copy is available yet."
    );
  }
);

/**
 * Finds an existing Gmail conversation for a vault lead and links gmailThreadId
 * (for emails sent before reply sync, or from Gmail drafts).
 */
export const linkOpticGmailThread = onCall(
  {secrets: [GMAIL_OAUTH_CLIENT_SECRET]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to link a Gmail thread.");
    }
    const uid = request.auth.uid;
    const {leadId} = request.data as {leadId?: unknown};
    if (typeof leadId !== "string" || !leadId.trim()) {
      throw new HttpsError("invalid-argument", "leadId is required.");
    }

    const {leadSnap, lead} = await loadVaultLeadForGmail(uid, leadId);
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data() ?? {};
    if (userData.opticGmailCanRead !== true) {
      throw new HttpsError(
        "failed-precondition",
        "Reconnect Gmail and allow inbox read to find past threads."
      );
    }
    const connectedEmail =
      typeof userData.opticGmailEmail === "string"
        ? String(userData.opticGmailEmail).trim()
        : "";

    const accessToken = await getGmailAccessTokenForUser(uid);
    const resolved = await resolveGmailThreadForLead(lead, accessToken);
    const extraPatch: Record<string, unknown> = {
      gmailThreadId: resolved.threadId,
      gmailThreadLinkedAt: FieldValue.serverTimestamp(),
      gmailThreadLinkSource: resolved.source,
    };
    if (resolved.messageId) {
      extraPatch.gmailMessageId = resolved.messageId;
    }

    const {messages, replyCount} = await fetchThreadAndUpdateLead(
      leadSnap,
      lead,
      resolved.threadId,
      accessToken,
      connectedEmail,
      uid,
      extraPatch
    );

    logger.info("[Gmail] Linked thread", {
      uid,
      leadId: leadSnap.id,
      source: resolved.source,
      replyCount,
    });

    return {
      success: true as const,
      threadId: resolved.threadId,
      source: resolved.source,
      messages,
      replyCount,
    };
  }
);
