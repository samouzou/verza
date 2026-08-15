const IG_SKIP_HANDLES = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "stories",
  "explore",
  "accounts",
  "direct",
  "tags",
  "about",
  "legal",
  "privacy",
  "help",
  "login",
  "popular",
  "www",
]);

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePostUrl(href: string): string | null {
  try {
    const url = href.startsWith("http") ? new URL(href) : new URL(href, "https://www.instagram.com");
    const path = url.pathname;
    if (!path.includes("/p/") && !path.includes("/reel/")) return null;
    return `https://www.instagram.com${path}`.replace(/\/$/, "") + "/";
  } catch {
    return null;
  }
}

function isProfileHandle(handle: string): boolean {
  const lower = handle.toLowerCase();
  if (IG_SKIP_HANDLES.has(lower)) return false;
  if (handle.length < 2 || handle.length > 30) return false;
  return /^[A-Za-z0-9._]+$/.test(handle);
}

/** Best-effort: username for the logged-in account (to exclude from results). */
export function detectLoggedInUsername(): string | null {
  const navProfile = document.querySelector(
    'a[href^="/"][href$="/"] img[alt*="profile picture" i], a[href^="/"][href$="/"] img[alt*="\'s profile picture" i]'
  );
  const href = navProfile?.closest("a")?.getAttribute("href") || "";
  const match = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
  if (match && isProfileHandle(match[1])) return match[1];
  return null;
}

function countHashtagPosts(): number {
  return document.querySelectorAll('main a[href*="/p/"], main a[href*="/reel/"]').length;
}

/**
 * Wait for the hashtag grid, scroll to load posts, and warm up the page.
 * Runs inside an Instagram hashtag tab.
 */
export async function prepareHashtagExplore(): Promise<{ ready: boolean; reason?: string }> {
  const path = window.location.pathname;
  if (path.includes("/accounts/login")) {
    return { ready: false, reason: "login_required" };
  }
  if (!path.includes("/explore/tags/")) {
    return { ready: false, reason: "wrong_page" };
  }

  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline && countHashtagPosts() < 3) {
    await sleep(900);
  }

  if (countHashtagPosts() === 0) {
    const bodyText = document.body.innerText.toLowerCase();
    if (bodyText.includes("log in") && bodyText.includes("sign up")) {
      return { ready: false, reason: "login_required" };
    }
    return { ready: false, reason: "no_posts" };
  }

  const scrollTarget = document.querySelector("main") ?? document.documentElement;
  for (let round = 0; round < 6; round += 1) {
    scrollTarget.scrollTop = scrollTarget.scrollHeight;
    await sleep(1400 + round * 200);
  }
  scrollTarget.scrollTop = 0;
  await sleep(600);

  return { ready: countHashtagPosts() > 0 };
}

/** Collect post/reel URLs from the hashtag grid (not nav or suggestions). */
export function collectHashtagPostUrls(maxPosts: number): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  document.querySelectorAll('main a[href*="/p/"], main a[href*="/reel/"]').forEach((node) => {
    const href = (node as HTMLAnchorElement).href || (node as HTMLAnchorElement).getAttribute("href") || "";
    const normalized = normalizePostUrl(href);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    urls.push(normalized);
  });

  return urls.slice(0, maxPosts);
}

function countKeywordAccounts(): number {
  let count = 0;
  document.querySelectorAll('main a[href^="/"]').forEach((node) => {
    const href = (node as HTMLAnchorElement).getAttribute("href") || "";
    const match = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
    if (match && isProfileHandle(match[1])) count += 1;
  });
  return count;
}

/** Wait for Instagram keyword search results and scroll to load accounts. */
export async function prepareKeywordSearch(): Promise<{ ready: boolean; reason?: string }> {
  const path = window.location.pathname;
  if (path.includes("/accounts/login")) {
    return { ready: false, reason: "login_required" };
  }
  if (!path.includes("/explore/search/")) {
    return { ready: false, reason: "wrong_page" };
  }

  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline && countKeywordAccounts() < 2) {
    await sleep(900);
  }

  if (countKeywordAccounts() === 0) {
    return { ready: false, reason: "no_accounts" };
  }

  const scrollTarget = document.querySelector("main") ?? document.documentElement;
  for (let round = 0; round < 5; round += 1) {
    scrollTarget.scrollTop = scrollTarget.scrollHeight;
    await sleep(1200 + round * 150);
  }
  await sleep(500);

  return { ready: countKeywordAccounts() > 0 };
}

/** Collect profile URLs from keyword search results. */
export function collectKeywordAccountUrls(
  maxAccounts: number,
  excludeUsername?: string | null
): string[] {
  const exclude = excludeUsername?.toLowerCase() ?? null;
  const seen = new Set<string>();
  const urls: string[] = [];

  document.querySelectorAll('main a[href^="/"]').forEach((node) => {
    const href = (node as HTMLAnchorElement).getAttribute("href") || "";
    const match = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
    if (!match) return;
    const handle = match[1];
    if (!isProfileHandle(handle)) return;
    if (exclude && handle.toLowerCase() === exclude) return;
    const key = handle.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(`https://www.instagram.com/${handle}/`);
  });

  return urls.slice(0, maxAccounts);
}

/** On a post/reel page, return the creator username. */
export function scrapePostAuthor(excludeUsername?: string | null): string | null {
  const exclude = excludeUsername?.toLowerCase() ?? null;
  const candidates: string[] = [];

  const pushHandle = (href: string) => {
    const match = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
    if (!match) return;
    const handle = match[1];
    if (!isProfileHandle(handle)) return;
    if (exclude && handle.toLowerCase() === exclude) return;
    candidates.push(handle);
  };

  document.querySelectorAll("header a[href^='/']").forEach((node) => {
    pushHandle((node as HTMLAnchorElement).getAttribute("href") || "");
  });

  document.querySelectorAll('article a[href^="/"]').forEach((node) => {
    const href = (node as HTMLAnchorElement).getAttribute("href") || "";
    if (href.includes("/p/") || href.includes("/reel/")) return;
    pushHandle(href);
  });

  return candidates[0] ?? null;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const OBFUSCATED_EMAIL_RE =
  /([a-zA-Z0-9._%+-]+)\s*(?:\[?\s*at\s*\]?|\(@\)|\(at\))\s*([a-zA-Z0-9.-]+)\s*(?:\[?\s*dot\s*\]?|\(\.\))\s*([a-zA-Z]{2,})/gi;

/** Normalize and validate a candidate email string. */
function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase().replace(/^mailto:/i, "");
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(trimmed)) return null;
  // Skip common Instagram / placeholder addresses
  if (trimmed.endsWith("@instagram.com") || trimmed.endsWith("@fb.com")) return null;
  return trimmed;
}

/** Pull emails from mailto: links and free text (bio, header, contact buttons). */
function extractEmailsFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(EMAIL_RE)) {
    const email = normalizeEmail(match[0]);
    if (email) found.add(email);
  }
  for (const match of text.matchAll(OBFUSCATED_EMAIL_RE)) {
    const email = normalizeEmail(`${match[1]}@${match[2]}.${match[3]}`);
    if (email) found.add(email);
  }
  return Array.from(found);
}

function collectMailtoEmails(root: ParentNode = document): string[] {
  const found = new Set<string>();
  root.querySelectorAll('a[href^="mailto:"]').forEach((node) => {
    const href = (node as HTMLAnchorElement).getAttribute("href") || "";
    const email = normalizeEmail(href.split("?")[0]);
    if (email) found.add(email);
  });
  return Array.from(found);
}

/**
 * Best-effort bio: prefer the longest plausible text block in the profile header,
 * skipping follower/post count lines and the display name.
 */
function scrapeBio(header: Element | null, displayName: string | null): string | null {
  if (!header) return null;
  const skip = new Set(
    [displayName, "Follow", "Following", "Message", "Email", "Contact", "Options"]
      .filter(Boolean)
      .map((s) => String(s).trim().toLowerCase())
  );

  let best: string | null = null;
  header.querySelectorAll("span, div").forEach((node) => {
    // Prefer leaf-ish nodes to avoid concatenating the whole header.
    if (node.querySelector("span, div")) return;
    const text = node.textContent?.trim();
    if (!text || text.length < 3 || text.length > 600) return;
    if (/^\d/.test(text)) return;
    if (/\b(followers|following|posts)\b/i.test(text) && text.length < 40) return;
    if (skip.has(text.toLowerCase())) return;
    if (!best || text.length > best.length) best = text;
  });
  return best;
}

/** Best-effort profile photo URL from the header / Open Graph tags. */
function scrapeAvatarSourceUrl(header: Element | null, username: string): string | null {
  const imgs = header
    ? header.querySelectorAll("img")
    : document.querySelectorAll('header img, main img[alt*="profile picture" i]');
  for (const node of Array.from(imgs)) {
    const img = node as HTMLImageElement;
    const alt = (img.getAttribute("alt") || "").toLowerCase();
    const src = img.currentSrc || img.src || img.getAttribute("src") || "";
    if (!src || src.startsWith("data:")) continue;
    if (
      alt.includes("profile picture") ||
      alt.includes(`@${username.toLowerCase()}`) ||
      alt.includes(`${username.toLowerCase()}'s`)
    ) {
      return src;
    }
  }
  const og = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
  if (og && /^https:\/\//i.test(og)) return og;
  return null;
}

/**
 * Fetch + downscale a profile image in-page so Cloud Functions can upload without
 * hitting Instagram CDN blocks from the server.
 */
async function fetchAvatarAsJpegDataUrl(
  src: string,
  maxSide = 256
): Promise<string | null> {
  try {
    const res = await fetch(src, {credentials: "omit", mode: "cors", cache: "force-cache"});
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/") || blob.size < 32) return null;
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    // Cap payload (~1.2MB base64) so callable requests stay light.
    if (dataUrl.length > 1_600_000) return null;
    return dataUrl;
  } catch {
    return null;
  }
}

/** Runs inside an Instagram profile tab (with short wait for hydration). */
export async function scrapeInstagramProfile(): Promise<import("../shared/types").ScrapedInstagramProfile | null> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const profile = scrapeInstagramProfileOnce();
    if (profile && (profile.followerCount || profile.bio || profile.displayName || profile.email)) {
      if (profile.avatarUrl && !profile.avatarDataUrl) {
        profile.avatarDataUrl = await fetchAvatarAsJpegDataUrl(profile.avatarUrl);
      }
      return profile;
    }
    await sleep(1000);
  }
  const fallback = scrapeInstagramProfileOnce();
  if (fallback?.avatarUrl && !fallback.avatarDataUrl) {
    fallback.avatarDataUrl = await fetchAvatarAsJpegDataUrl(fallback.avatarUrl);
  }
  return fallback;
}

function scrapeInstagramProfileOnce(): import("../shared/types").ScrapedInstagramProfile | null {
  const pathMatch = window.location.pathname.match(/^\/([A-Za-z0-9._]+)\/?$/);
  if (!pathMatch) return null;
  const username = pathMatch[1];
  if (!isProfileHandle(username)) return null;

  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content");
  const displayName =
    document.querySelector("header h2, header h1")?.textContent?.trim() ||
    ogTitle?.split("(")[0]?.trim() ||
    null;

  const header = document.querySelector("header");
  const bio = scrapeBio(header, displayName);

  let followerCount: string | null = null;
  const followerMatch = document.body.innerText.match(/([\d,.]+[KMB]?)\s+followers/i);
  if (followerMatch) followerCount = followerMatch[1];

  // Post count separates working nano creators from dead or placeholder accounts,
  // which follower count alone cannot do.
  let postCount: string | null = null;
  const postMatch = document.body.innerText.match(/([\d,.]+[KMB]?)\s+posts?\b/i);
  if (postMatch) postCount = postMatch[1];

  let externalUrl: string | null = null;
  const extLink = document.querySelector(
    'header a[rel~="me"], header a[href^="http"]:not([href*="instagram.com"]):not([href^="mailto:"])'
  );
  if (extLink) externalUrl = (extLink as HTMLAnchorElement).href;

  // Contact email: mailto buttons (business/creator accounts), then bio / header text.
  const mailtoEmails = collectMailtoEmails(header ?? document);
  const textEmails = [
    ...extractEmailsFromText(bio),
    ...extractEmailsFromText(header?.innerText ?? null),
    ...extractEmailsFromText(externalUrl),
  ];
  // Also catch "Email" contact rows that expose the address as plain text near the button.
  document.querySelectorAll('a, button, div[role="button"]').forEach((node) => {
    const label = node.textContent?.trim() ?? "";
    if (!/^e-?mail$/i.test(label) && !/contact/i.test(label)) return;
    const nearby = (node.parentElement?.innerText || node.textContent || "").trim();
    textEmails.push(...extractEmailsFromText(nearby));
  });

  const email = mailtoEmails[0] ?? textEmails[0] ?? null;
  const avatarUrl = scrapeAvatarSourceUrl(header, username);

  return {
    username,
    displayName,
    bio,
    followerCount,
    postCount,
    externalUrl,
    email,
    avatarUrl,
    avatarDataUrl: null,
  };
}
