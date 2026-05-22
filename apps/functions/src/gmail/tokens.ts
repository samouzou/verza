import {FieldValue} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import {APP_URL, GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET} from "../config/params";
import {GMAIL_COMPOSE_SCOPE, GMAIL_CREDENTIAL_DOC_ID} from "./constants";

type GmailCredentialDoc = {
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: number;
  email: string;
};

/**
 * OAuth redirect URI registered in Google Cloud Console.
 * @return {string} Callback URL under APP_URL.
 */
export function gmailRedirectUri(): string {
  const base = APP_URL.value().trim().replace(/\/$/, "");
  return `${base}/optic/gmail/callback`;
}

/**
 * Loads Gmail OAuth client id and secret from Firebase params.
 * @return {{clientId: string, clientSecret: string}} OAuth client credentials.
 */
function oauthClientConfig(): {clientId: string; clientSecret: string} {
  const clientId = GMAIL_OAUTH_CLIENT_ID.value().trim();
  const clientSecret = GMAIL_OAUTH_CLIENT_SECRET.value().trim();
  if (!clientId || !clientSecret) {
    throw new HttpsError(
      "failed-precondition",
      "Gmail OAuth is not configured (GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET)."
    );
  }
  return {clientId, clientSecret};
}

/**
 * Builds the Google OAuth authorization URL for Gmail compose scope.
 * @return {string} URL to redirect the user to Google consent.
 */
export function buildGmailOAuthUrl(): string {
  const {clientId} = oauthClientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: gmailRedirectUri(),
    response_type: "code",
    scope: GMAIL_COMPOSE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchanges an authorization or refresh token with Google.
 * @param {Record<string, string>} body Token endpoint form fields.
 * @return {Promise<object>} Token response from Google.
 */
async function exchangeToken(body: Record<string, string>): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const {clientId, clientSecret} = oauthClientConfig();
  const form = new URLSearchParams({...body, client_id: clientId, client_secret: clientSecret});
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: form.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    logger.error("[Gmail] Token exchange failed", {status: res.status, text: text.slice(0, 300)});
    throw new HttpsError("internal", "Could not complete Gmail authorization.");
  }
  return JSON.parse(text) as {access_token: string; refresh_token?: string; expires_in: number};
}

/**
 * Reads the connected Gmail address from the Gmail API profile.
 * @param {string} accessToken Valid access token.
 * @return {Promise<string>} User's Gmail address.
 */
async function fetchGmailProfileEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: {Authorization: `Bearer ${accessToken}`},
  });
  const data = (await res.json()) as {emailAddress?: string};
  if (!res.ok || !data.emailAddress) {
    throw new HttpsError("internal", "Could not read Gmail profile.");
  }
  return data.emailAddress;
}

/**
 * Persists Gmail tokens and updates the user's public connection flags.
 * @param {string} uid Firebase Auth uid.
 * @param {object} tokens Refresh/access tokens and profile email.
 * @return {Promise<void>}
 */
async function saveGmailConnection(uid: string, tokens: {
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
  email: string;
}): Promise<void> {
  const expiresAt = Date.now() + tokens.expiresIn * 1000 - 60_000;
  const credRef = db
    .collection("users")
    .doc(uid)
    .collection("private_credentials")
    .doc(GMAIL_CREDENTIAL_DOC_ID);

  await credRef.set({
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: expiresAt,
    email: tokens.email,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection("users").doc(uid).update({
    opticGmailConnected: true,
    opticGmailEmail: tokens.email,
    opticGmailConnectedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Stores Gmail tokens after OAuth redirect (user must call while signed in).
 * @param {string} uid Firebase Auth uid.
 * @param {string} code Authorization code from Google.
 */
export async function completeGmailOAuthForUser(uid: string, code: string): Promise<{email: string}> {
  const token = await exchangeToken({
    code,
    redirect_uri: gmailRedirectUri(),
    grant_type: "authorization_code",
  });
  if (!token.refresh_token) {
    logger.warn("[Gmail] No refresh_token returned; user may have already consented.");
  }
  const email = await fetchGmailProfileEmail(token.access_token);
  const credSnap = await db
    .collection("users")
    .doc(uid)
    .collection("private_credentials")
    .doc(GMAIL_CREDENTIAL_DOC_ID)
    .get();
  const existing = credSnap.data() as GmailCredentialDoc | undefined;
  const refreshToken = token.refresh_token || existing?.refreshToken;
  if (!refreshToken) {
    throw new HttpsError(
      "failed-precondition",
      "Gmail did not return a refresh token. Disconnect in Google Account and try again with consent."
    );
  }
  await saveGmailConnection(uid, {
    refreshToken,
    accessToken: token.access_token,
    expiresIn: token.expires_in,
    email,
  });
  return {email};
}

/**
 * Removes Gmail tokens and clears public connection flags on the user profile.
 * @param {string} uid Firebase Auth uid.
 */
export async function disconnectGmailForUser(uid: string): Promise<void> {
  try {
    await db
      .collection("users")
      .doc(uid)
      .collection("private_credentials")
      .doc(GMAIL_CREDENTIAL_DOC_ID)
      .delete();
  } catch (err) {
    logger.debug("[Gmail] Credential doc delete skipped", {err});
  }
  await db.collection("users").doc(uid).update({
    opticGmailConnected: false,
    opticGmailEmail: null,
    opticGmailConnectedAt: null,
  });
}

/**
 * Refreshes a Gmail access token using the stored refresh token.
 * @param {string} refreshToken OAuth refresh token.
 * @return {Promise<object>} New access token and expiry duration.
 */
async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  const token = await exchangeToken({
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return {accessToken: token.access_token, expiresIn: token.expires_in};
}

/**
 * Returns a valid Gmail access token for API calls (refreshes and persists when needed).
 * @param {string} uid Firebase Auth uid.
 */
export async function getGmailAccessTokenForUser(uid: string): Promise<string> {
  const credRef = db
    .collection("users")
    .doc(uid)
    .collection("private_credentials")
    .doc(GMAIL_CREDENTIAL_DOC_ID);
  const snap = await credRef.get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "Gmail is not connected for this account.");
  }
  const cred = snap.data() as GmailCredentialDoc;
  if (!cred.refreshToken) {
    throw new HttpsError("failed-precondition", "Gmail refresh token missing. Reconnect Gmail.");
  }
  if (cred.accessToken && cred.accessTokenExpiresAt > Date.now()) {
    return cred.accessToken;
  }
  const refreshed = await refreshAccessToken(cred.refreshToken);
  const expiresAt = Date.now() + refreshed.expiresIn * 1000 - 60_000;
  await credRef.update({
    accessToken: refreshed.accessToken,
    accessTokenExpiresAt: expiresAt,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return refreshed.accessToken;
}

/**
 * Builds a base64url-encoded RFC 2822 message for the Gmail API.
 * @param {object} opts To, subject, and plain-text body.
 * @return {string} Base64url raw message.
 */
export function buildGmailRawMessage(opts: {
  to: string;
  subject: string;
  body: string;
}): string {
  const lines = [
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    opts.body,
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}
