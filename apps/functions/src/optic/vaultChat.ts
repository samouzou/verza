import {HttpsError, onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {googleAI} from "@genkit-ai/google-genai";
import {ai} from "../ai/genkit";
import {db} from "../config/firebase";
import {
  VAULT_SNAPSHOT_LIMIT,
  buildVaultSnapshot,
  snapshotForPrompt,
  type VaultCampaignScope,
  type VaultLeadDoc,
} from "./vaultSnapshot";

const MODEL = "gemini-3.6-flash";
const TEAM_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);
const QUESTION_MAX = 500;

/**
 * Brand-team check with a primary agency (same gate as vault CRM writes).
 * @param {string} uid Auth uid.
 * @return {Promise<string>} primaryAgencyId.
 */
async function requirePrimaryAgency(uid: string): Promise<string> {
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("failed-precondition", "User profile not found.");
  }
  const user = userSnap.data()!;
  const role = String(user.role ?? "");
  if (!TEAM_ROLES.has(role)) {
    throw new HttpsError("permission-denied", "Vault chat is for brand owners, admins, and members.");
  }
  const agencyId = user.primaryAgencyId as string | undefined;
  if (!agencyId) {
    throw new HttpsError("failed-precondition", "Set a primary agency before asking the vault.");
  }
  return agencyId;
}

function normalizeScope(value: unknown): VaultCampaignScope {
  if (typeof value !== "string" || !value.trim()) return "__all__";
  const scope = value.trim();
  if (scope === "__all__" || scope === "__pooled__") return scope;
  if (scope.length > 128) {
    throw new HttpsError("invalid-argument", "Invalid campaign scope.");
  }
  return scope;
}

function leadInScope(lead: VaultLeadDoc, scope: VaultCampaignScope): boolean {
  const campaignId = typeof lead.campaignId === "string" ? lead.campaignId : "";
  if (scope === "__all__") return true;
  if (scope === "__pooled__") return !campaignId;
  return campaignId === scope;
}

/**
 * Resolves a human label for the campaign filter.
 * @param {VaultCampaignScope} scope Filter id.
 * @param {string} [hint] Client-supplied title (untrusted, trimmed).
 * @return {Promise<string>} Label.
 */
async function resolveScopeLabel(scope: VaultCampaignScope, hint?: string): Promise<string> {
  const cleanHint = hint?.trim().slice(0, 80);
  if (scope === "__all__") return "All vault leads";
  if (scope === "__pooled__") return "Pooled missions (no single campaign)";
  if (cleanHint) return cleanHint;
  const gig = await db.collection("gigs").doc(scope).get();
  const title = gig.exists && typeof gig.data()?.title === "string" ? String(gig.data()!.title).trim() : "";
  return title || `Campaign ${scope.slice(0, 6)}…`;
}

/**
 * Answers a vault analytics question from a counted CRM snapshot (model does not query Firestore).
 */
export const askOpticVaultChat = onCall(
  {timeoutSeconds: 60, memory: "512MiB"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to ask the vault.");
    }
    const uid = request.auth.uid;
    const agencyId = await requirePrimaryAgency(uid);

    const question =
      typeof request.data?.question === "string" ? request.data.question.trim() : "";
    if (!question) {
      throw new HttpsError("invalid-argument", "Ask a question about this campaign.");
    }
    if (question.length > QUESTION_MAX) {
      throw new HttpsError("invalid-argument", `Keep questions under ${QUESTION_MAX} characters.`);
    }

    const scope = normalizeScope(request.data?.campaignFilter);
    const hint = typeof request.data?.campaignTitle === "string" ? request.data.campaignTitle : undefined;
    const scopeLabel = await resolveScopeLabel(scope, hint);

    const snap = await db
      .collection("optic_outreach_leads")
      .where("agencyId", "==", agencyId)
      .orderBy("createdAt", "desc")
      .limit(VAULT_SNAPSHOT_LIMIT)
      .get();

    const scoped = snap.docs
      .map((d) => d.data() as VaultLeadDoc)
      .filter((lead) => leadInScope(lead, scope));
    const truncated = snap.size >= VAULT_SNAPSHOT_LIMIT;
    const snapshot = buildVaultSnapshot(scoped, scopeLabel, truncated);
    const facts = snapshotForPrompt(snapshot);

    const prompt = `You are a campaign producer looking at the Verza Optic vault (creator CRM).
Answer ONLY from the JSON snapshot. Do not invent counts, names, rates, or open/reply rates.
If the question needs data listed under notInThisData, say that clearly and answer with what IS in the snapshot.
Use creator-economy language (reached out, in conversation, booked, passed, no upfront pay).
Keep the answer to 2–5 short sentences. Lead with the numbers. No markdown tables. No bullet walls.

SNAPSHOT:
${JSON.stringify(facts)}

QUESTION:
${question}
`;

    try {
      const {text} = await ai.generate({
        model: googleAI.model(MODEL),
        prompt,
        config: {temperature: 0.2},
      });
      const answer = (text ?? "").trim();
      if (!answer) {
        throw new HttpsError("internal", "The vault had nothing to say. Try again.");
      }
      logger.info("[optic] askOpticVaultChat ok", {
        uid,
        agencyId,
        scope,
        leadCount: snapshot.leadCount,
      });
      return {answer, snapshot};
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("[optic] askOpticVaultChat failed", {uid, error: msg});
      throw new HttpsError("internal", "Could not answer right now. Try again in a moment.");
    }
  }
);
