/** Known MCP host redirect allowlist for non-CIMD / soft-DCR clients. */

const ALLOWED_REDIRECT_HOST_SUFFIXES = [
  "claude.ai",
  "claude.com",
  "anthropic.com",
  "chatgpt.com",
  "openai.com",
  "chat.openai.com",
] as const;

/**
 * True when redirect_uri is an https URL on a known host (Claude or ChatGPT/OpenAI).
 * CIMD clients should validate against their metadata document instead.
 */
export function isAllowedMcpClientRedirectUri(redirectUri: string): boolean {
  let ru: URL;
  try {
    ru = new URL(redirectUri);
  } catch {
    return false;
  }
  if (ru.protocol !== "https:" && !(ru.protocol === "http:" && ru.hostname === "localhost")) {
    return false;
  }
  const host = ru.hostname.toLowerCase();
  return ALLOWED_REDIRECT_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`)
  );
}

export function friendlyClientNameFromRedirect(redirectUri: string, fallback = "MCP client"): string {
  try {
    const host = new URL(redirectUri).hostname.toLowerCase();
    if (host.includes("claude") || host.includes("anthropic")) return "Claude";
    if (host.includes("chatgpt") || host.includes("openai")) return "ChatGPT";
  } catch {
    /* ignore */
  }
  return fallback;
}
