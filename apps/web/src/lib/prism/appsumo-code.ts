const KEY = "verza_appsumo_prism_code";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeAppSumoPrismCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function rememberAppSumoPrismCode(raw: string): void {
  if (typeof window === "undefined") return;
  const code = normalizeAppSumoPrismCode(raw);
  if (code.length < 6 || code.length > 64) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    // Private mode; they can still paste the code.
  }
}

export function readAppSumoPrismCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const { code, at } = JSON.parse(raw) as { code?: string; at?: number };
    if (!code || !at || Date.now() - at > MAX_AGE_MS || code.length < 6) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

export function clearAppSumoPrismCode(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
