import type {McpOauthClientMeta} from "./store.js";
import {isAllowedMcpClientRedirectUri} from "./clients.js";

const CIMD_MAX_BYTES = 16_384;
const CIMD_TIMEOUT_MS = 5_000;

function isPrivateOrLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h === "127.0.0.1" || h === "::1") {
    return true;
  }
  if (/^(10\.|192\.168\.|169\.254\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  return false;
}

/**
 * Fetches and validates an OAuth Client ID Metadata Document (CIMD).
 * client_id must be an https URL with a path; document.client_id must match exactly.
 */
export async function fetchCimdMetadata(clientId: string): Promise<McpOauthClientMeta> {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    throw new Error("client_id must be a valid HTTPS URL (CIMD).");
  }
  if (url.protocol !== "https:") {
    throw new Error("client_id CIMD URL must use https.");
  }
  if (!url.pathname || url.pathname === "/") {
    throw new Error("client_id CIMD URL must include a path.");
  }
  if (isPrivateOrLocalHost(url.hostname)) {
    throw new Error("client_id CIMD URL host is not allowed.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CIMD_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {Accept: "application/json"},
    });
  } catch (e) {
    throw new Error(
      `Could not fetch client metadata: ${e instanceof Error ? e.message : String(e)}`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`CIMD fetch failed (${res.status}).`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > CIMD_MAX_BYTES) {
    throw new Error("CIMD document is too large.");
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("CIMD document is not valid JSON.");
  }

  if (typeof json.client_id !== "string" || json.client_id !== clientId) {
    throw new Error("CIMD client_id does not match the request URL.");
  }

  const redirectUris = Array.isArray(json.redirect_uris)
    ? json.redirect_uris.filter((u): u is string => typeof u === "string" && u.trim().length > 0)
    : [];
  if (redirectUris.length === 0) {
    throw new Error("CIMD document is missing redirect_uris.");
  }

  const clientName =
    typeof json.client_name === "string" && json.client_name.trim()
      ? json.client_name.trim()
      : "MCP client";

  return {
    clientId,
    clientName,
    redirectUris,
  };
}

export function assertRedirectAllowed(
  meta: McpOauthClientMeta,
  redirectUri: string
): void {
  if (meta.redirectUris.includes(redirectUri)) return;

  // ChatGPT sometimes presents a per-app CIMD redirect while still using the
  // shared legacy redirect (or vice versa). Allow any https ChatGPT/OpenAI
  // connector callback when the CIMD identity is itself ChatGPT/OpenAI.
  try {
    const clientHost = new URL(meta.clientId).hostname.toLowerCase();
    const isChatGptClient =
      clientHost === "chatgpt.com" ||
      clientHost.endsWith(".chatgpt.com") ||
      clientHost === "openai.com" ||
      clientHost.endsWith(".openai.com");
    if (isChatGptClient && isAllowedMcpClientRedirectUri(redirectUri)) {
      const path = new URL(redirectUri).pathname;
      if (
        path === "/connector_platform_oauth_redirect" ||
        path.startsWith("/connector/oauth/")
      ) {
        return;
      }
    }
  } catch {
    /* fall through */
  }

  throw new Error("redirect_uri is not registered for this client.");
}

/** True when client_id looks like a CIMD URL rather than a random string. */
export function isCimdClientId(clientId: string): boolean {
  return /^https:\/\//i.test(clientId.trim());
}
