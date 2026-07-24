/** Normalizes profile URLs for duplicate detection (host + path, no trailing slash). */
export function normalizeProfileUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    let path = u.pathname.replace(/\/$/, "") || "";
    path = path.toLowerCase();
    return `${host}${path}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Canonical Instagram profile URL from a handle or partial URL. */
export function instagramProfileUrl(handleOrUrl: string): string {
  const raw = handleOrUrl.trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const seg = u.pathname.split("/").filter(Boolean)[0];
      if (seg && !["p", "reel", "tv", "stories", "explore"].includes(seg.toLowerCase())) {
        return `https://www.instagram.com/${seg}/`;
      }
    } catch {
      /* fall through */
    }
  }
  const handle = raw.replace(/^@/, "").split(/[/?#]/)[0];
  return `https://www.instagram.com/${handle}/`;
}
