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
