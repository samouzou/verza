const STORAGE_KEY = 'verza_post_auth_redirect';
const MAX_AGE_MS = 60 * 60 * 1000;

/** Only same-origin app paths; rejects protocol-relative and absolute URLs. */
export function isSafeAppPath(path: string | null | undefined): path is string {
  return !!path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}

/** Remembers where to send the user after sign-in and onboarding (e.g. back to a campaign's Apply card). */
export function setPostAuthRedirect(path: string): void {
  if (typeof window === 'undefined' || !isSafeAppPath(path)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    // Storage can be unavailable (private mode); the user just lands on the dashboard.
  }
}

export function peekPostAuthRedirect(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { path, at } = JSON.parse(raw) as { path?: string; at?: number };
    if (!isSafeAppPath(path) || !at || Date.now() - at > MAX_AGE_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

export function clearPostAuthRedirect(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Campaign detail pages reached from the public listing, which unfinished creators may still visit. */
export function isCampaignApplyPath(pathname: string): boolean {
  return /^\/campaigns\/[A-Za-z0-9]+$/.test(pathname);
}
