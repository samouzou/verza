const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CODE = /^[A-Za-z0-9_-]{3,40}$/;
/** URL param → storage key. `code` is a Stripe promo code, `ref` a Prism referral code. */
const PARAMS = { code: "verza_prism_promo", ref: "verza_prism_ref" } as const;

type Param = keyof typeof PARAMS;

function save(param: Param, value: string): void {
  try {
    window.localStorage.setItem(PARAMS[param], JSON.stringify({ code: value.toUpperCase(), at: Date.now() }));
  } catch {
    // Storage can be unavailable (private mode); a promo code can still be typed at checkout.
  }
}

function read(param: Param): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PARAMS[param]);
    if (!raw) return null;
    const { code, at } = JSON.parse(raw) as { code?: string; at?: number };
    if (!code || !CODE.test(code) || !at || Date.now() - at > MAX_AGE_MS) {
      window.localStorage.removeItem(PARAMS[param]);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

/** Saves `?code=` and `?ref=` from the current URL so they survive sign-up and onboarding until checkout. */
export function rememberPrismPromo(): void {
  if (typeof window === "undefined") return;
  const search = new URLSearchParams(window.location.search);
  for (const param of Object.keys(PARAMS) as Param[]) {
    const value = search.get(param)?.trim();
    if (value && CODE.test(value)) save(param, value);
  }
}

export function readPrismPromo(): string | null {
  return read("code");
}

export function readPrismReferral(): string | null {
  return read("ref");
}
