import {createHash, randomBytes} from "crypto";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {db} from "../config/firebase";

const TEAM_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);
const KEY_PREFIX = "vzmcp_";

function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey.trim()).digest("hex");
}

function generateRawApiKey(): {rawKey: string; keyPrefix: string; keyHash: string} {
  const secret = randomBytes(24).toString("base64url");
  const rawKey = `${KEY_PREFIX}${secret}`;
  const keyPrefix = rawKey.slice(0, KEY_PREFIX.length + 6);
  return {rawKey, keyPrefix, keyHash: hashApiKey(rawKey)};
}

async function assertAgencyTeam(uid: string): Promise<{agencyId: string; role: string}> {
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("failed-precondition", "User profile not found.");
  }
  const user = userSnap.data()!;
  const role = String(user.role ?? "");
  if (!TEAM_ROLES.has(role)) {
    throw new HttpsError(
      "permission-denied",
      "Only brand team members can manage MCP API keys."
    );
  }
  const agencyId = user.primaryAgencyId as string | undefined;
  if (!agencyId) {
    throw new HttpsError("failed-precondition", "Set a primary agency first.");
  }
  return {agencyId, role};
}

/**
 * Creates a personal MCP API key for the signed-in agency user.
 * The raw key is returned once; only a hash is stored.
 */
export const createMcpApiKey = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to create an MCP API key.");
  }
  const uid = request.auth.uid;
  const {agencyId} = await assertAgencyTeam(uid);

  const labelRaw = request.data?.label;
  const label =
    typeof labelRaw === "string" && labelRaw.trim()
      ? labelRaw.trim().slice(0, 80)
      : "Claude / ChatGPT / Cursor";

  const existing = await db
    .collection("mcp_api_keys")
    .where("uid", "==", uid)
    .where("revokedAt", "==", null)
    .get();
  if (existing.size >= 10) {
    throw new HttpsError(
      "resource-exhausted",
      "You already have 10 active MCP keys. Revoke one before creating another."
    );
  }

  const {rawKey, keyPrefix, keyHash} = generateRawApiKey();
  const ref = db.collection("mcp_api_keys").doc();
  await ref.set({
    keyHash,
    keyPrefix,
    uid,
    agencyId,
    label,
    createdAt: FieldValue.serverTimestamp(),
    lastUsedAt: null,
    revokedAt: null,
  });

  return {
    id: ref.id,
    label,
    keyPrefix,
    apiKey: rawKey,
    agencyId,
    note: "Copy this key now. Verza will not show the full secret again.",
  };
});

/** Lists non-secret metadata for the caller's MCP keys. */
export const listMcpApiKeys = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to list MCP API keys.");
  }
  const uid = request.auth.uid;
  await assertAgencyTeam(uid);

  const snap = await db
    .collection("mcp_api_keys")
    .where("uid", "==", uid)
    .limit(40)
    .get();

  const keys = snap.docs
    .map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        label: d.label ?? "MCP key",
        keyPrefix: d.keyPrefix ?? "",
        agencyId: d.agencyId ?? null,
        createdAt: d.createdAt ?? null,
        lastUsedAt: d.lastUsedAt ?? null,
        revoked: Boolean(d.revokedAt),
      };
    })
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? 0;
      const tb = b.createdAt?.toMillis?.() ?? 0;
      return tb - ta;
    })
    .slice(0, 25);

  return {keys};
});

/** Revokes an MCP API key owned by the caller. */
export const revokeMcpApiKey = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to revoke an MCP API key.");
  }
  const uid = request.auth.uid;
  await assertAgencyTeam(uid);

  const keyId = typeof request.data?.keyId === "string" ? request.data.keyId.trim() : "";
  if (!keyId) {
    throw new HttpsError("invalid-argument", "keyId is required.");
  }

  const ref = db.collection("mcp_api_keys").doc(keyId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "API key not found.");
  }
  if (String(snap.data()?.uid ?? "") !== uid) {
    throw new HttpsError("permission-denied", "You can only revoke your own MCP keys.");
  }

  await ref.update({
    revokedAt: FieldValue.serverTimestamp(),
  });
  return {ok: true as const, keyId};
});

/**
 * Resolves uid + agencyId from a raw MCP API key (server-side only).
 * @param {string} rawKey Full key including vzmcp_ prefix.
 * @return {Promise<{uid: string; agencyId: string; keyId: string} | null>}
 */
export async function resolveMcpApiKey(
  rawKey: string
): Promise<{uid: string; agencyId: string; keyId: string} | null> {
  const key = rawKey.trim();
  if (!key.startsWith(KEY_PREFIX) || key.length < KEY_PREFIX.length + 16) {
    return null;
  }
  const keyHash = hashApiKey(key);
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

  // Best-effort last-used stamp (ignore failures).
  void doc.ref.update({lastUsedAt: Timestamp.now()}).catch(() => undefined);

  return {uid, agencyId, keyId: doc.id};
}
