import {createHash} from "node:crypto";
import {AsyncLocalStorage} from "node:async_hooks";
import type {Firestore} from "firebase-admin/firestore";
import {getAuth} from "firebase-admin/auth";
import {resolveActor, type VerzaActor} from "./context.js";

const KEY_PREFIX = "vzmcp_";

export type AuthIdentity = {
  kind: "api_key" | "id_token" | "env_user";
  uid: string;
  agencyIdHint?: string | null;
};

const authStore = new AsyncLocalStorage<AuthIdentity | null>();

export function runWithAuthIdentity<T>(identity: AuthIdentity | null, fn: () => T): T {
  return authStore.run(identity, fn);
}

export function getRequestAuthIdentity(): AuthIdentity | null {
  return authStore.getStore() ?? null;
}

function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey.trim()).digest("hex");
}

export function looksLikeMcpApiKey(value: string): boolean {
  const v = value.trim();
  return v.startsWith(KEY_PREFIX) && v.length >= KEY_PREFIX.length + 16;
}

/**
 * Looks up a personal MCP API key → uid (agency comes from that user's primaryAgencyId).
 */
export async function resolveUidFromMcpApiKey(
  db: Firestore,
  rawKey: string
): Promise<{uid: string; agencyId: string; keyId: string} | null> {
  if (!looksLikeMcpApiKey(rawKey)) return null;
  const keyHash = hashApiKey(rawKey);
  const snap = await db
    .collection("mcp_api_keys")
    .where("keyHash", "==", keyHash)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data();
  if (data.revokedAt) return null;
  const uid = typeof data.uid === "string" ? data.uid : "";
  const agencyId = typeof data.agencyId === "string" ? data.agencyId : "";
  if (!uid || !agencyId) return null;
  void doc.ref.update({lastUsedAt: new Date()}).catch(() => undefined);
  return {uid, agencyId, keyId: doc.id};
}

export async function resolveUidFromFirebaseIdToken(
  idToken: string
): Promise<string | null> {
  try {
    const decoded = await getAuth().verifyIdToken(idToken.trim());
    return decoded.uid || null;
  } catch {
    return null;
  }
}

/**
 * Parse Authorization / x-verza-mcp-key into an AuthIdentity.
 * Supports: vzmcp_… API keys and Firebase ID tokens.
 */
export async function identityFromBearer(
  db: Firestore,
  bearer: string | null | undefined
): Promise<AuthIdentity | null> {
  const token = bearer?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  if (looksLikeMcpApiKey(token)) {
    const hit = await resolveUidFromMcpApiKey(db, token);
    if (!hit) {
      throw new Error("Invalid or revoked Verza MCP API key.");
    }
    return {kind: "api_key", uid: hit.uid, agencyIdHint: hit.agencyId};
  }

  const uid = await resolveUidFromFirebaseIdToken(token);
  if (uid) {
    return {kind: "id_token", uid};
  }

  return null;
}

export type ActorResolverOptions = {
  db: Firestore;
  /** Fallback when no per-request identity (stdio / local). */
  envUid?: string | null;
  envEmail?: string | null;
  envApiKey?: string | null;
};

/**
 * Resolves the acting Verza user. Preference:
 * 1) Request-scoped bearer (HTTP)
 * 2) Env VERZA_MCP_API_KEY
 * 3) Env VERZA_UID / VERZA_USER_EMAIL
 *
 * Agency is always that user's primaryAgencyId (login user → brand workspace).
 */
export async function resolveActingActor(
  opts: ActorResolverOptions
): Promise<VerzaActor> {
  const requestId = getRequestAuthIdentity();
  if (requestId?.uid) {
    return resolveActor(opts.db, {uid: requestId.uid});
  }

  if (opts.envApiKey?.trim()) {
    const hit = await resolveUidFromMcpApiKey(opts.db, opts.envApiKey);
    if (!hit) {
      throw new Error("VERZA_MCP_API_KEY is invalid or revoked.");
    }
    return resolveActor(opts.db, {uid: hit.uid});
  }

  if (opts.envUid || opts.envEmail) {
    return resolveActor(opts.db, {uid: opts.envUid, email: opts.envEmail});
  }

  throw new Error(
    "No Verza identity. Create an MCP API key in Optic → Integrations (recommended), " +
      "set VERZA_MCP_API_KEY, or set VERZA_UID / VERZA_USER_EMAIL for local use."
  );
}
