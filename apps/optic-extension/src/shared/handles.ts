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
  "tos",
  "privacy",
  "hashtag",
  "jobs",
  "about",
  "download",
]);

export function linkedinSlugFromUrl(urlOrSlug: string): string | null {
  const raw = urlOrSlug.trim();
  if (!raw) return null;
  try {
    const u = raw.startsWith("/")
      ? new URL(raw, "https://www.linkedin.com")
      : new URL(raw.includes("://") ? raw : `https://www.linkedin.com/in/${raw}`);
    const m = u.pathname.match(/^\/in\/([^/]+)/);
    if (!m?.[1]) return null;
    const slug = decodeURIComponent(m[1]).replace(/\/+$/, "");
    return slug || null;
  } catch {
    const slug = raw.replace(/^\/?in\//, "").split(/[/?#]/)[0];
    return slug || null;
  }
}

export function linkedinProfileUrl(slug: string): string {
  const clean = linkedinSlugFromUrl(slug) ?? slug.replace(/^@/, "").trim();
  return `https://www.linkedin.com/in/${clean}`;
}

export function twitterHandleFromUrl(urlOrHandle: string): string | null {
  const raw = urlOrHandle.trim();
  if (!raw) return null;
  if (raw.startsWith("@")) {
    const handle = raw.slice(1).split(/[/?#]/)[0];
    return handle || null;
  }
  try {
    const u = raw.startsWith("/")
      ? new URL(raw, "https://x.com")
      : new URL(raw.includes("://") ? raw : `https://x.com/${raw}`);
    const seg = u.pathname.split("/").filter(Boolean)[0];
    if (!seg || X_SKIP.has(seg.toLowerCase()) || seg.startsWith("i")) return null;
    return seg;
  } catch {
    const handle = raw.replace(/^@/, "").split(/[/?#]/)[0];
    return handle || null;
  }
}

export function twitterProfileUrl(handle: string): string {
  const clean = twitterHandleFromUrl(handle) ?? handle.replace(/^@/, "").trim();
  return `https://x.com/${clean}`;
}

export function creatorKeyFromUrl(url: string, platform: string): string | null {
  if (platform === "linkedin") {
    const slug = linkedinSlugFromUrl(url);
    return slug ? slug.toLowerCase() : null;
  }
  if (platform === "twitter") {
    const handle = twitterHandleFromUrl(url);
    return handle ? handle.toLowerCase() : null;
  }
  return null;
}

export function canonicalProfileUrl(url: string, platform: string): string | null {
  if (platform === "linkedin") {
    const slug = linkedinSlugFromUrl(url);
    return slug ? linkedinProfileUrl(slug) : null;
  }
  if (platform === "twitter") {
    const handle = twitterHandleFromUrl(url);
    return handle ? twitterProfileUrl(handle) : null;
  }
  return null;
}
