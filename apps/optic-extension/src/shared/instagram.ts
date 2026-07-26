/** Extract Instagram username from a profile URL or handle. */
export function instagramUsernameFromUrl(urlOrHandle: string): string | null {
  const raw = urlOrHandle.trim();
  if (!raw) return null;
  if (raw.startsWith("@")) {
    const handle = raw.slice(1).split(/[/?#]/)[0];
    return handle || null;
  }
  try {
    const u = new URL(raw.includes("://") ? raw : `https://www.instagram.com/${raw}`);
    const seg = u.pathname.split("/").filter(Boolean)[0];
    if (!seg || ["p", "reel", "tv", "explore", "accounts"].includes(seg.toLowerCase())) {
      return null;
    }
    return seg;
  } catch {
    const handle = raw.replace(/^@/, "").split(/[/?#]/)[0];
    return handle || null;
  }
}

export function instagramProfileUrl(username: string): string {
  const clean = username.replace(/^@/, "").trim();
  return `https://www.instagram.com/${clean}/`;
}

const COUNT_SUFFIXES: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };

/**
 * Parses Instagram's rendered counts ("1,234", "12.3K", "1.2M") into a number.
 * Returns null when the value is missing or unrecognized, which callers must treat
 * as "unknown" rather than zero — a failed scrape should never filter a creator out.
 * Mirrored in `apps/functions/src/optic/counts.ts`.
 */
export function parseCompactCount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim().toLowerCase().replace(/,/g, "");
  const match = text.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const multiplier = match[2] ? COUNT_SUFFIXES[match[2]] : 1;
  return Math.round(value * multiplier);
}
