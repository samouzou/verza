import {createHash, randomBytes} from "node:crypto";
import type {Firestore, Timestamp} from "firebase-admin/firestore";
import {FieldValue, Timestamp as FsTimestamp} from "firebase-admin/firestore";

export const OAUTH_TOKEN_PREFIX = "vzato_";
export const ACCESS_TOKEN_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
export const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
export const AUTH_REQUEST_TTL_MS = 15 * 60 * 1000;

export type McpOauthClientMeta = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
};

export type McpOauthAuthRequest = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  state: string | null;
  resource: string | null;
  scope: string | null;
  createdAt: Timestamp;
  expiresAt: Timestamp;
};

export type McpOauthCode = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  uid: string;
  agencyId: string;
  resource: string | null;
  scope: string | null;
  createdAt: Timestamp;
  expiresAt: Timestamp;
};

export type McpOauthAccessToken = {
  tokenHash: string;
  tokenPrefix: string;
  uid: string;
  agencyId: string;
  clientId: string;
  resource: string | null;
  scope: string | null;
  createdAt: Timestamp;
  expiresAt: Timestamp;
};

export function hashSecret(value: string): string {
  return createHash("sha256").update(value.trim()).digest("hex");
}

export function newOpaqueToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

export function newRequestId(): string {
  return randomBytes(16).toString("hex");
}

export function looksLikeOauthAccessToken(value: string): boolean {
  const v = value.trim();
  return v.startsWith(OAUTH_TOKEN_PREFIX) && v.length >= OAUTH_TOKEN_PREFIX.length + 16;
}

export function looksLikeOauthRefreshToken(value: string): boolean {
  const v = value.trim();
  return v.startsWith("vzrt_") && v.length >= 20;
}

function expiresIn(ms: number): FsTimestamp {
  return FsTimestamp.fromMillis(Date.now() + ms);
}

export async function saveAuthRequest(
  db: Firestore,
  requestId: string,
  data: Omit<McpOauthAuthRequest, "createdAt" | "expiresAt">
): Promise<void> {
  await db.collection("mcp_oauth_auth_requests").doc(requestId).set({
    ...data,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: expiresIn(AUTH_REQUEST_TTL_MS),
  });
}

export async function loadAuthRequest(
  db: Firestore,
  requestId: string
): Promise<(McpOauthAuthRequest & {id: string}) | null> {
  const snap = await db.collection("mcp_oauth_auth_requests").doc(requestId).get();
  if (!snap.exists) return null;
  const d = snap.data() as McpOauthAuthRequest;
  if (d.expiresAt?.toMillis?.() && d.expiresAt.toMillis() < Date.now()) {
    await snap.ref.delete().catch(() => undefined);
    return null;
  }
  return {id: snap.id, ...d};
}

export async function deleteAuthRequest(db: Firestore, requestId: string): Promise<void> {
  await db.collection("mcp_oauth_auth_requests").doc(requestId).delete().catch(() => undefined);
}

export async function saveAuthCode(
  db: Firestore,
  code: string,
  data: Omit<McpOauthCode, "createdAt" | "expiresAt">
): Promise<void> {
  await db.collection("mcp_oauth_codes").doc(hashSecret(code)).set({
    ...data,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: expiresIn(AUTH_CODE_TTL_MS),
  });
}

export async function consumeAuthCode(
  db: Firestore,
  code: string
): Promise<McpOauthCode | null> {
  const ref = db.collection("mcp_oauth_codes").doc(hashSecret(code));
  const snap = await ref.get();
  if (!snap.exists) return null;
  const d = snap.data() as McpOauthCode;
  await ref.delete().catch(() => undefined);
  if (d.expiresAt?.toMillis?.() && d.expiresAt.toMillis() < Date.now()) {
    return null;
  }
  return d;
}

export async function saveAccessToken(
  db: Firestore,
  rawToken: string,
  data: Omit<McpOauthAccessToken, "tokenHash" | "tokenPrefix" | "createdAt" | "expiresAt"> & {
    expiresAtMs?: number;
  }
): Promise<void> {
  const ttlMs = data.expiresAtMs ?? ACCESS_TOKEN_TTL_SEC * 1000;
  const {expiresAtMs: _drop, ...rest} = data;
  await db.collection("mcp_oauth_tokens").doc(hashSecret(rawToken)).set({
    ...rest,
    tokenHash: hashSecret(rawToken),
    tokenPrefix: rawToken.slice(0, 12),
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: expiresIn(ttlMs),
  });
}

export async function resolveOauthTokenRecord(
  db: Firestore,
  rawToken: string
): Promise<{
  uid: string;
  agencyId: string;
  clientId: string;
  resource: string | null;
  scope: string | null;
} | null> {
  const snap = await db.collection("mcp_oauth_tokens").doc(hashSecret(rawToken)).get();
  if (!snap.exists) return null;
  const d = snap.data() as McpOauthAccessToken;
  if (d.expiresAt?.toMillis?.() && d.expiresAt.toMillis() < Date.now()) {
    await snap.ref.delete().catch(() => undefined);
    return null;
  }
  const uid = typeof d.uid === "string" ? d.uid : "";
  const agencyId = typeof d.agencyId === "string" ? d.agencyId : "";
  if (!uid || !agencyId) return null;
  return {
    uid,
    agencyId,
    clientId: typeof d.clientId === "string" ? d.clientId : "",
    resource: typeof d.resource === "string" ? d.resource : null,
    scope: typeof d.scope === "string" ? d.scope : null,
  };
}

export async function resolveUidFromOauthAccessToken(
  db: Firestore,
  rawToken: string
): Promise<{uid: string; agencyId: string} | null> {
  if (!looksLikeOauthAccessToken(rawToken)) return null;
  const hit = await resolveOauthTokenRecord(db, rawToken);
  if (!hit) return null;
  return {uid: hit.uid, agencyId: hit.agencyId};
}

export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  const digest = createHash("sha256").update(codeVerifier).digest("base64url");
  return digest === codeChallenge;
}
