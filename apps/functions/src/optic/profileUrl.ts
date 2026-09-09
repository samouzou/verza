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

const IG_SKIP = new Set(["p", "reel", "tv", "stories", "explore", "accounts", "reels"]);
const LI_SKIP = new Set([
  "feed",
  "jobs",
  "messaging",
  "notifications",
  "search",
  "mynetwork",
  "login",
  "signup",
  "company",
  "school",
  "in",
]);
const X_SKIP = new Set([
  "home",
  "search",
  "explore",
  "settings",
  "i",
  "intent",
  "compose",
  "messages",
  "notifications",
  "login",
  "hashtag",
  "jobs",
]);

/** Canonical Instagram profile URL from a handle or partial URL. */
export function instagramProfileUrl(handleOrUrl: string): string {
  const raw = handleOrUrl.trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const seg = u.pathname.split("/").filter(Boolean)[0];
      if (seg && !IG_SKIP.has(seg.toLowerCase())) {
        return `https://www.instagram.com/${seg}/`;
      }
    } catch {
      /* fall through */
    }
  }
  const handle = raw.replace(/^@/, "").split(/[/?#]/)[0];
  return `https://www.instagram.com/${handle}/`;
}

/** Canonical LinkedIn profile URL from a vanity slug or /in/ URL. */
export function linkedinProfileUrl(slugOrUrl: string): string {
  const raw = slugOrUrl.trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const m = u.pathname.match(/^\/in\/([^/]+)/);
      if (m?.[1]) return `https://www.linkedin.com/in/${decodeURIComponent(m[1])}`;
    } catch {
      /* fall through */
    }
  }
  const slug = raw.replace(/^@/, "").replace(/^\/?in\//, "").split(/[/?#]/)[0];
  return `https://www.linkedin.com/in/${slug}`;
}

/** Canonical X profile URL from a handle or x.com / twitter.com URL. */
export function twitterProfileUrl(handleOrUrl: string): string {
  const raw = handleOrUrl.trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const seg = u.pathname.split("/").filter(Boolean)[0];
      if (seg && !X_SKIP.has(seg.toLowerCase())) return `https://x.com/${seg}`;
    } catch {
      /* fall through */
    }
  }
  const handle = raw.replace(/^@/, "").split(/[/?#]/)[0];
  return `https://x.com/${handle}`;
}

/** Canonical profile URL for an Optic extension platform. */
export function extensionProfileUrl(platform: string, handleOrUrl: string): string {
  if (platform === "linkedin") return linkedinProfileUrl(handleOrUrl);
  if (platform === "twitter") return twitterProfileUrl(handleOrUrl);
  return instagramProfileUrl(handleOrUrl);
}

/** Handle / vanity slug from a normalized `host/path` vault key. */
export function handleFromNormalizedKey(key: string, platform?: string): string | null {
  const ig = key.match(/^instagram\.com\/([^/]+)$/);
  if (ig && (!platform || platform === "instagram") && !IG_SKIP.has(ig[1])) {
    return ig[1];
  }
  const li = key.match(/^linkedin\.com\/in\/([^/]+)$/);
  if (li && (!platform || platform === "linkedin") && !LI_SKIP.has(li[1])) {
    return decodeURIComponent(li[1]);
  }
  const x = key.match(/^(?:x|twitter)\.com\/([^/]+)$/);
  if (x && (!platform || platform === "twitter") && !X_SKIP.has(x[1])) {
    return x[1];
  }
  return null;
}
