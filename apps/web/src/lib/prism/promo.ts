const STORAGE_KEY = "verza_prism_promo";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CODE = /^[A-Za-z0-9_-]{3,40}$/;

/** Saves `?code=` from the current URL so it survives sign-up and onboarding until checkout. */
export function rememberPrismPromo(): void {
  if (typeof window === "undefined") return;
  const code = new URLSearchParams(window.location.search).get("code")?.trim();
  if (!code || !CODE.test(code)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ code: code.toUpperCase(), at: Date.now() }));
  } catch {
    // Storage can be unavailable (private mode); the code can still be typed at checkout.
  }
}

export function readPrismPromo(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { code, at } = JSON.parse(raw) as { code?: string; at?: number };
    if (!code || !CODE.test(code) || !at || Date.now() - at > MAX_AGE_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

export function clearPrismPromo(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
