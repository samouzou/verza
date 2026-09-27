export function mcpPublicOrigin(reqHost: string | undefined, fallbackAppBase: string): string {
  const host = (reqHost ?? "").split(",")[0]?.trim();
  if (host) {
    const bare = host.replace(/:\d+$/, "");
    if (bare.includes("tryverza.com") || bare.includes("run.app") || bare === "localhost") {
      const proto = bare === "localhost" || bare.startsWith("127.") ? "http" : "https";
      return `${proto}://${host}`;
    }
  }
  // Prefer api. from app. when host header missing (local scripts).
  try {
    const u = new URL(fallbackAppBase);
    if (u.hostname.startsWith("app.")) {
      u.hostname = u.hostname.replace(/^app\./, "api.");
    } else if (u.hostname.startsWith("dev-app.")) {
      u.hostname = u.hostname.replace(/^dev-app\./, "dev-api.");
    }
    return u.origin;
  } catch {
    return "https://api.tryverza.com";
  }
}

export function protectedResourceMetadata(issuer: string) {
  return {
    resource: issuer,
    authorization_servers: [issuer],
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"],
    resource_documentation: "https://app.tryverza.com/optic",
  };
}

export function authorizationServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
    client_id_metadata_document_supported: true,
    // Soft DCR shim for clients that still probe registration_endpoint.
    registration_endpoint: `${issuer}/oauth/register`,
  };
}

export function wwwAuthenticateHeader(issuer: string): string {
  const resourceMeta = `${issuer}/.well-known/oauth-protected-resource`;
  return `Bearer realm="verza-mcp", resource_metadata="${resourceMeta}"`;
}
