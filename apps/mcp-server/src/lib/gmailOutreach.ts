import type {Firestore} from "firebase-admin/firestore";
import type {VerzaActor} from "../context.js";
import type {VerzaCallableClient} from "./callable.js";
import {ensureStoredEmailHtml} from "./emailHtml.js";

export function opticAppUrls(appBaseUrl: string): {
  connectUrl: string;
  vaultUrl: string;
} {
  const app = appBaseUrl.replace(/\/$/, "");
  return {
    connectUrl: `${app}/optic`,
    vaultUrl: `${app}/optic/vault`,
  };
}

export type GmailStatus = {
  connected: boolean;
  email: string | null;
  canRead: boolean;
  connectUrl: string;
  vaultUrl: string;
  note: string;
};

export async function getGmailStatus(
  db: Firestore,
  actor: VerzaActor,
  appBaseUrl: string
): Promise<GmailStatus> {
  const snap = await db.collection("users").doc(actor.uid).get();
  const user = snap.data() ?? {};
  const connected = user.opticGmailConnected === true;
  const email =
    typeof user.opticGmailEmail === "string" && user.opticGmailEmail.trim()
      ? user.opticGmailEmail.trim()
      : null;
  const canRead = user.opticGmailCanRead === true;
  const urls = opticAppUrls(appBaseUrl);
  return {
    connected,
    email,
    canRead,
    ...urls,
    note: connected
      ? "Gmail is connected for this brand user. Create HTML drafts with optic_create_gmail_draft, then they send from Gmail (or optic_send_gmail with confirm=true)."
      : "Gmail is not connected. Open connectUrl while signed into Verza and click Connect Gmail. OAuth must finish in the browser — it cannot be completed from this chat.",
  };
}

/**
 * Returns the in-app connect URL. Optionally the same Google OAuth URL the
 * web app uses (callback still lands on Verza; do not collect auth codes here).
 */
export async function beginGmailConnectFromMcp(
  db: Firestore,
  actor: VerzaActor,
  client: VerzaCallableClient,
  appBaseUrl: string
): Promise<
  GmailStatus & {
    alreadyConnected: boolean;
    oauthUrl: string | null;
  }
> {
  const status = await getGmailStatus(db, actor, appBaseUrl);
  if (status.connected) {
    return {
      ...status,
      alreadyConnected: true,
      oauthUrl: null,
    };
  }

  try {
    const result = await client.call<{url?: string}>(actor.uid, "beginGmailConnect", {});
    const oauthUrl = typeof result?.url === "string" && result.url.trim() ? result.url.trim() : null;
    return {
      ...status,
      alreadyConnected: false,
      oauthUrl,
      note:
        "Open connectUrl in a browser while signed into Verza and click Connect Gmail. " +
        (oauthUrl
          ? "oauthUrl is the same Google consent link the app uses; the callback must finish on Verza (do not paste authorization codes here)."
          : "Completing Google OAuth from this chat is not supported."),
    };
  } catch {
    return {
      ...status,
      alreadyConnected: false,
      oauthUrl: null,
      note:
        "Open connectUrl while signed into Verza and click Connect Gmail. " +
        "Completing Google OAuth from this chat is not supported.",
    };
  }
}

export async function updateLeadOutreachDraft(
  client: VerzaCallableClient,
  actor: VerzaActor,
  input: {
    leadId: string;
    draftEmail?: string | null;
    draftEmailSubject?: string | null;
  }
): Promise<{ok: true; draftEmailHtml?: string}> {
  const payload: Record<string, unknown> = {leadId: input.leadId};
  let draftEmailHtml: string | undefined;
  if (typeof input.draftEmail === "string") {
    draftEmailHtml = ensureStoredEmailHtml(input.draftEmail);
    if (!draftEmailHtml) {
      throw new Error("draftEmail cannot be empty.");
    }
    payload.draftEmail = draftEmailHtml;
  }
  if (typeof input.draftEmailSubject === "string") {
    payload.draftEmailSubject = input.draftEmailSubject;
  }
  await client.call(actor.uid, "setOpticLeadOutreachDraft", payload);
  return {ok: true as const, draftEmailHtml};
}

export type GmailDraftResult =
  | {
      ok: true;
      leadId: string;
      draftId: string | null;
      to: string | null;
    }
  | {ok: false; leadId: string; error: string};

export async function createGmailDraftsForLeads(
  client: VerzaCallableClient,
  actor: VerzaActor,
  leadIds: string[],
  appBaseUrl: string
): Promise<{
  created: number;
  failed: number;
  results: GmailDraftResult[];
  note: string;
}> {
  const ids = [...new Set(leadIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    throw new Error("Provide leadId or leadIds.");
  }
  if (ids.length > 25) {
    throw new Error("Create at most 25 Gmail drafts per call.");
  }

  const results: GmailDraftResult[] = [];
  for (const leadId of ids) {
    try {
      const result = await client.call<{draftId?: string; to?: string}>(
        actor.uid,
        "createOpticGmailDraft",
        {leadId}
      );
      results.push({
        ok: true,
        leadId,
        draftId: typeof result?.draftId === "string" ? result.draftId : null,
        to: typeof result?.to === "string" ? result.to : null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ok: false, leadId, error: message});
    }
  }

  const created = results.filter((r) => r.ok).length;
  const failed = results.length - created;
  const urls = opticAppUrls(appBaseUrl);
  return {
    created,
    failed,
    results,
    note:
      created > 0
        ? `Open Gmail → Drafts to review the HTML email, then send when ready. Vault: ${urls.vaultUrl}`
        : `No drafts created. If Gmail is disconnected, open ${urls.connectUrl} while signed into Verza.`,
  };
}

export async function sendGmailForLead(
  client: VerzaCallableClient,
  actor: VerzaActor,
  leadId: string
): Promise<{
  success: true;
  to: string | null;
  threadId: string | null;
  followUp: boolean;
  note: string;
}> {
  const result = await client.call<{
    to?: string;
    threadId?: string;
    followUp?: boolean;
  }>(actor.uid, "sendOpticGmailMessage", {leadId});
  return {
    success: true as const,
    to: typeof result?.to === "string" ? result.to : null,
    threadId: typeof result?.threadId === "string" ? result.threadId : null,
    followUp: result?.followUp === true,
    note: "Sent from the connected Gmail account. The lead is marked contacted.",
  };
}

export async function markLeadsContacted(
  client: VerzaCallableClient,
  actor: VerzaActor,
  leadIds: string[],
  contacted: boolean
): Promise<{updated: number; failed: number; results: Array<{leadId: string; ok: boolean; error?: string}>}> {
  const ids = [...new Set(leadIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    throw new Error("Provide leadId or leadIds.");
  }
  if (ids.length > 50) {
    throw new Error("Update at most 50 leads per call.");
  }

  const results: Array<{leadId: string; ok: boolean; error?: string}> = [];
  for (const leadId of ids) {
    try {
      await client.call(actor.uid, "setOpticLeadOutreachStatus", {
        leadId,
        emailed: contacted,
      });
      results.push({leadId, ok: true});
    } catch (err) {
      results.push({
        leadId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return {
    updated: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
