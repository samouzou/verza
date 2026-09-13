import "dotenv/config";

export type McpTransport = "stdio" | "http";

function required(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(`Missing required env ${name}. See apps/mcp-server/.env.example`);
  }
  return value.trim();
}

export function loadConfig() {
  const projectId =
    process.env.VERZA_FIREBASE_PROJECT_ID?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    "verza-canvas-dev";

  const uid = process.env.VERZA_UID?.trim() || null;
  const userEmail = process.env.VERZA_USER_EMAIL?.trim().toLowerCase() || null;
  const mcpApiKey = process.env.VERZA_MCP_API_KEY?.trim() || null;

  // Cloud Run sets PORT — default to HTTP there so Dockerfile CMD stays simple.
  const transportEnv = process.env.VERZA_MCP_TRANSPORT?.trim();
  const transport = (
    transportEnv ||
    (process.env.PORT ? "http" : "stdio")
  ) as McpTransport;
  if (transport !== "stdio" && transport !== "http") {
    throw new Error('VERZA_MCP_TRANSPORT must be "stdio" or "http"');
  }

  // HTTP can auth per-request via Bearer API key / Firebase ID token.
  // stdio needs a default identity unless only using request auth (N/A).
  if (transport === "stdio" && !mcpApiKey && !uid && !userEmail) {
    throw new Error(
      "Set VERZA_MCP_API_KEY (recommended) or VERZA_UID / VERZA_USER_EMAIL. " +
        "Create a key while signed into Verza (Optic → Integrations)."
    );
  }

  const webApiKey =
    process.env.VERZA_FIREBASE_WEB_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ||
    null;

  const geminiApiKey =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    null;

  const appBaseUrl =
    process.env.VERZA_APP_URL?.trim() ||
    (projectId.includes("dev")
      ? "https://dev-app.tryverza.com"
      : "https://app.tryverza.com");

  return {
    projectId,
    uid,
    userEmail,
    mcpApiKey,
    transport,
    httpHost: process.env.VERZA_MCP_HTTP_HOST?.trim() || "127.0.0.1",
    httpPort: Number.parseInt(process.env.VERZA_MCP_HTTP_PORT || "8787", 10),
    /** Optional gate in front of HTTP; user identity still comes from MCP API key / ID token. */
    httpToken: process.env.VERZA_MCP_HTTP_TOKEN?.trim() || null,
    webApiKey,
    geminiApiKey,
    appBaseUrl,
    functionsRegion: process.env.VERZA_FUNCTIONS_REGION?.trim() || "us-central1",
  };
}

export type VerzaMcpConfig = ReturnType<typeof loadConfig>;

export function requireWebApiKey(config: VerzaMcpConfig): string {
  return required("VERZA_FIREBASE_WEB_API_KEY", config.webApiKey ?? undefined);
}

export function requireGeminiApiKey(config: VerzaMcpConfig): string {
  return required("GEMINI_API_KEY", config.geminiApiKey ?? undefined);
}

/** Soft-require credentials path for clearer errors (ADC also works). */
export function assertFirebaseCredentialsHint(): void {
  const creds = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!creds && !process.env.FIRESTORE_EMULATOR_HOST) {
    console.error(
      "[verza-mcp] Tip: set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON if Auth fails."
    );
  }
}
