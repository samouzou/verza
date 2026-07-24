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

/** Runs inside an Instagram profile tab (with short wait for hydration). */
export async function scrapeInstagramProfile(): Promise<import("../shared/types").ScrapedInstagramProfile | null> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const profile = scrapeInstagramProfileOnce();
    if (profile && (profile.followerCount || profile.bio || profile.displayName)) {
      return profile;
    }
    await sleep(1000);
  }
  return scrapeInstagramProfileOnce();
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

  let bio: string | null = null;
  const header = document.querySelector("header");
  if (header) {
    const spans = header.querySelectorAll("section span, section div span");
    for (const span of spans) {
      const text = span.textContent?.trim();
      if (text && text.length > 2 && text.length < 500 && !/^\d/.test(text)) {
        bio = text;
        break;
      }
    }
  }

  let followerCount: string | null = null;
  const followerMatch = document.body.innerText.match(/([\d,.]+[KMB]?)\s+followers/i);
  if (followerMatch) followerCount = followerMatch[1];

  let externalUrl: string | null = null;
  const extLink = document.querySelector('header a[rel~="me"], header a[href^="http"]');
  if (extLink) externalUrl = (extLink as HTMLAnchorElement).href;

  return { username, displayName, bio, followerCount, externalUrl };
}
