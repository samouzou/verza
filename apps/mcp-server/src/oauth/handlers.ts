import type {IncomingMessage, ServerResponse} from "node:http";
import type {Firestore} from "firebase-admin/firestore";
import {getAuth} from "firebase-admin/auth";
import {resolveActor} from "../context.js";
import {assertRedirectAllowed, fetchCimdMetadata, isCimdClientId} from "./cimd.js";
import {
  friendlyClientNameFromRedirect,
  isAllowedMcpClientRedirectUri,
} from "./clients.js";
import {
  authorizationServerMetadata,
  mcpPublicOrigin,
  protectedResourceMetadata,
} from "./metadata.js";
import {
  ACCESS_TOKEN_TTL_SEC,
  consumeAuthCode,
  deleteAuthRequest,
  loadAuthRequest,
  newOpaqueToken,
  newRequestId,
  OAUTH_TOKEN_PREFIX,
  saveAccessToken,
  saveAuthCode,
  saveAuthRequest,
  verifyPkceS256,
} from "./store.js";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {"content-type": "application/json", "cache-control": "no-store"});
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {"content-type": "text/html; charset=utf-8", "cache-control": "no-store"});
  res.end(html);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readFormOrJson(req: IncomingMessage): Promise<Record<string, string>> {
  const raw = await readBody(req);
  const ctype = (req.headers["content-type"] ?? "").toLowerCase();
  if (ctype.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") out[k] = v;
        else if (v != null) out[k] = String(v);
      }
      return out;
    } catch {
      return {};
    }
  }
  const params = new URLSearchParams(raw);
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

function extractBearerToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, "").trim() || null;
  }
  return null;
}

function queryOf(req: IncomingMessage): URLSearchParams {
  try {
    return new URL(req.url ?? "/", "http://localhost").searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function pathnameOf(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

/**
 * Handles OAuth discovery + authorize/token/approve/register.
 * Returns true when the request was handled.
 */
export async function handleOauthHttp(opts: {
  req: IncomingMessage;
  res: ServerResponse;
  db: Firestore;
  appBaseUrl: string;
}): Promise<boolean> {
  const {req, res, db, appBaseUrl} = opts;
  const path = pathnameOf(req);
  const method = (req.method ?? "GET").toUpperCase();
  const issuer = mcpPublicOrigin(req.headers.host, appBaseUrl);

  // Discovery (RFC 9728 + RFC 8414)
  if (method === "GET" && path === "/.well-known/oauth-protected-resource") {
    sendJson(res, 200, protectedResourceMetadata(issuer));
    return true;
  }
  if (
    method === "GET" &&
    (path === "/.well-known/oauth-authorization-server" ||
      path === "/.well-known/openid-configuration")
  ) {
    sendJson(res, 200, authorizationServerMetadata(issuer));
    return true;
  }

  // Soft DCR: Claude may still probe this even with CIMD selected.
  if (method === "POST" && path === "/oauth/register") {
    const raw = await readBody(req);
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    const redirectUris = Array.isArray(parsed.redirect_uris)
      ? parsed.redirect_uris.filter((u): u is string => typeof u === "string")
      : [];
    const safeRedirects = redirectUris.filter(isAllowedMcpClientRedirectUri);
    const clientName =
      typeof parsed.client_name === "string" && parsed.client_name.trim()
        ? parsed.client_name.trim()
        : friendlyClientNameFromRedirect(safeRedirects[0] ?? "", "MCP client");
    sendJson(res, 201, {
      client_id: `verza-dcr-${newRequestId()}`,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: safeRedirects.length
        ? safeRedirects
        : [
            "https://claude.ai/api/mcp/auth_callback",
            "https://chatgpt.com/connector_platform_oauth_redirect",
          ],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: clientName,
    });
    return true;
  }

  // Authorization endpoint → consent page on the Verza app
  if (method === "GET" && path === "/oauth/authorize") {
    const q = queryOf(req);
    const responseType = q.get("response_type") ?? "";
    const clientId = q.get("client_id") ?? "";
    const redirectUri = q.get("redirect_uri") ?? "";
    const codeChallenge = q.get("code_challenge") ?? "";
    const codeChallengeMethod = q.get("code_challenge_method") ?? "S256";
    const state = q.get("state");
    const resource = q.get("resource");
    const scope = q.get("scope");

    try {
      if (responseType !== "code") {
        throw new Error("response_type must be code.");
      }
      if (!clientId || !redirectUri || !codeChallenge) {
        throw new Error("client_id, redirect_uri, and code_challenge are required.");
      }
      if (codeChallengeMethod !== "S256") {
        throw new Error("Only S256 PKCE is supported.");
      }

      let clientName = "MCP client";
      if (isCimdClientId(clientId)) {
        const meta = await fetchCimdMetadata(clientId);
        assertRedirectAllowed(meta, redirectUri);
        clientName = meta.clientName;
      } else {
        // Soft-DCR / opaque client_id: only Claude + ChatGPT/OpenAI callback hosts.
        if (!isAllowedMcpClientRedirectUri(redirectUri)) {
          throw new Error("redirect_uri host is not allowed for this client.");
        }
        clientName = friendlyClientNameFromRedirect(redirectUri, "MCP client");
      }

      const requestId = newRequestId();
      await saveAuthRequest(db, requestId, {
        clientId,
        clientName,
        redirectUri,
        codeChallenge,
        codeChallengeMethod: "S256",
        state,
        resource,
        scope,
      });

      const consent = new URL("/optic/mcp/oauth/consent", appBaseUrl);
      consent.searchParams.set("request_id", requestId);
      res.writeHead(302, {Location: consent.toString(), "cache-control": "no-store"});
      res.end();
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : "invalid_request";
      if (redirectUri.startsWith("https://") || redirectUri.startsWith("http://localhost")) {
        try {
          const dest = new URL(redirectUri);
          dest.searchParams.set("error", "invalid_request");
          dest.searchParams.set("error_description", message);
          if (state) dest.searchParams.set("state", state);
          res.writeHead(302, {Location: dest.toString()});
          res.end();
          return true;
        } catch {
          /* fall through */
        }
      }
      sendHtml(
        res,
        400,
        `<!doctype html><html><body><h1>Verza MCP OAuth</h1><p>${escapeHtml(message)}</p></body></html>`
      );
      return true;
    }
  }

  // Consent approval from Verza web app (Firebase ID token)
  if (method === "POST" && path === "/oauth/approve") {
    try {
      const body = await readFormOrJson(req);
      const requestId = body.request_id?.trim();
      if (!requestId) {
        sendJson(res, 400, {error: "invalid_request", error_description: "request_id required"});
        return true;
      }
      const idToken = extractBearerToken(req) || body.id_token?.trim() || null;
      if (!idToken) {
        sendJson(res, 401, {error: "unauthorized", error_description: "Sign in to Verza first."});
        return true;
      }
      let uid: string;
      try {
        const decoded = await getAuth().verifyIdToken(idToken);
        uid = decoded.uid;
      } catch {
        sendJson(res, 401, {error: "unauthorized", error_description: "Invalid Verza session."});
        return true;
      }

      const actor = await resolveActor(db, {uid});
      const pending = await loadAuthRequest(db, requestId);
      if (!pending) {
        sendJson(res, 400, {
          error: "invalid_request",
          error_description: "This sign-in link expired. Start again from your AI connector.",
        });
        return true;
      }

      const code = newOpaqueToken("vzcode_");
      await saveAuthCode(db, code, {
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
        codeChallengeMethod: "S256",
        uid: actor.uid,
        agencyId: actor.agencyId,
        resource: pending.resource,
        scope: pending.scope,
      });
      await deleteAuthRequest(db, requestId);

      const dest = new URL(pending.redirectUri);
      dest.searchParams.set("code", code);
      if (pending.state) dest.searchParams.set("state", pending.state);

      sendJson(res, 200, {
        ok: true,
        redirect_uri: dest.toString(),
        agencyName: actor.agencyName,
        clientName: pending.clientName,
      });
      return true;
    } catch (e) {
      sendJson(res, 400, {
        error: "access_denied",
        error_description: e instanceof Error ? e.message : "Could not approve access.",
      });
      return true;
    }
  }

  // Deny from consent page
  if (method === "POST" && path === "/oauth/deny") {
    const body = await readFormOrJson(req);
    const requestId = body.request_id?.trim();
    if (requestId) {
      const pending = await loadAuthRequest(db, requestId);
      await deleteAuthRequest(db, requestId);
      if (pending) {
        const dest = new URL(pending.redirectUri);
        dest.searchParams.set("error", "access_denied");
        if (pending.state) dest.searchParams.set("state", pending.state);
        sendJson(res, 200, {ok: true, redirect_uri: dest.toString()});
        return true;
      }
    }
    sendJson(res, 200, {ok: true});
    return true;
  }

  // Token endpoint
  if (method === "POST" && path === "/oauth/token") {
    try {
      const body = await readFormOrJson(req);
      const grantType = body.grant_type ?? "";

      if (grantType === "authorization_code") {
        const code = body.code?.trim() ?? "";
        const redirectUri = body.redirect_uri?.trim() ?? "";
        const codeVerifier = body.code_verifier?.trim() ?? "";
        const clientId = body.client_id?.trim() ?? "";
        if (!code || !redirectUri || !codeVerifier) {
          sendJson(res, 400, {
            error: "invalid_request",
            error_description: "code, redirect_uri, and code_verifier are required.",
          });
          return true;
        }
        const stored = await consumeAuthCode(db, code);
        if (!stored) {
          sendJson(res, 400, {error: "invalid_grant", error_description: "Invalid or expired code."});
          return true;
        }
        if (stored.redirectUri !== redirectUri) {
          sendJson(res, 400, {error: "invalid_grant", error_description: "redirect_uri mismatch."});
          return true;
        }
        if (clientId && stored.clientId !== clientId) {
          sendJson(res, 400, {error: "invalid_grant", error_description: "client_id mismatch."});
          return true;
        }
        if (!verifyPkceS256(codeVerifier, stored.codeChallenge)) {
          sendJson(res, 400, {error: "invalid_grant", error_description: "PKCE verification failed."});
          return true;
        }

        const accessToken = newOpaqueToken(OAUTH_TOKEN_PREFIX);
        const refreshToken = newOpaqueToken("vzrt_");
        await saveAccessToken(db, accessToken, {
          uid: stored.uid,
          agencyId: stored.agencyId,
          clientId: stored.clientId,
          resource: stored.resource,
          scope: stored.scope,
        });
        // Store refresh as another access-token row tagged via clientId/scope for simplicity.
        await saveAccessToken(db, refreshToken, {
          uid: stored.uid,
          agencyId: stored.agencyId,
          clientId: stored.clientId,
          resource: stored.resource,
          scope: "refresh",
          expiresAtMs: ACCESS_TOKEN_TTL_SEC * 1000 * 2,
        });

        sendJson(res, 200, {
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: ACCESS_TOKEN_TTL_SEC,
          refresh_token: refreshToken,
          scope: stored.scope ?? "mcp",
        });
        return true;
      }

      if (grantType === "refresh_token") {
        const refresh = body.refresh_token?.trim() ?? "";
        if (!refresh) {
          sendJson(res, 400, {error: "invalid_request", error_description: "refresh_token required."});
          return true;
        }
        const {looksLikeOauthRefreshToken, resolveOauthTokenRecord} = await import("./store.js");
        if (!looksLikeOauthRefreshToken(refresh)) {
          sendJson(res, 400, {error: "invalid_grant", error_description: "Invalid refresh_token."});
          return true;
        }
        const refreshHit = await resolveOauthTokenRecord(db, refresh);
        if (!refreshHit?.uid) {
          sendJson(res, 400, {error: "invalid_grant", error_description: "Invalid refresh_token."});
          return true;
        }
        const accessToken = newOpaqueToken(OAUTH_TOKEN_PREFIX);
        await saveAccessToken(db, accessToken, {
          uid: refreshHit.uid,
          agencyId: refreshHit.agencyId,
          clientId: refreshHit.clientId,
          resource: refreshHit.resource,
          scope: "mcp",
        });
        sendJson(res, 200, {
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: ACCESS_TOKEN_TTL_SEC,
          scope: "mcp",
        });
        return true;
      }

      sendJson(res, 400, {error: "unsupported_grant_type"});
      return true;
    } catch (e) {
      sendJson(res, 400, {
        error: "invalid_request",
        error_description: e instanceof Error ? e.message : "token_error",
      });
      return true;
    }
  }

  // Consent page may GET request preview
  if (method === "GET" && path === "/oauth/request") {
    const requestId = queryOf(req).get("request_id")?.trim();
    if (!requestId) {
      sendJson(res, 400, {error: "invalid_request"});
      return true;
    }
    const pending = await loadAuthRequest(db, requestId);
    if (!pending) {
      sendJson(res, 404, {error: "not_found", error_description: "Expired or unknown request."});
      return true;
    }
    sendJson(res, 200, {
      request_id: pending.id,
      client_name: pending.clientName,
      client_id: pending.clientId,
      redirect_uri: pending.redirectUri,
      scope: pending.scope ?? "mcp",
    });
    return true;
  }

  return false;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
