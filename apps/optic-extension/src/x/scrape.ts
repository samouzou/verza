import type {ScrapedInstagramProfile} from "../shared/types";
import {fetchAvatarAsJpegDataUrl} from "../shared/avatar";
import {twitterHandleFromUrl, twitterProfileUrl} from "../shared/handles";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLoginWall(): boolean {
  const href = window.location.href.toLowerCase();
  if (href.includes("/i/flow/login") || href.includes("login.x.com") || href.includes("/login")) {
    return true;
  }
  const body = document.body?.innerText?.slice(0, 1500).toLowerCase() || "";
  if (document.querySelector('[data-testid="UserCell"], [data-testid="UserName"]')) return false;
  return body.includes("sign in to x") || (body.includes("log in") && body.includes("sign up"));
}

export function detectLoggedInXHandle(): string | null {
  const me = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]') as HTMLAnchorElement | null;
  return me?.href ? twitterHandleFromUrl(me.href) : null;
}

function collectUserUrls(cap: number, excludeHandle: string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const skipSelf = excludeHandle?.toLowerCase() ?? "";
  document.querySelectorAll('a[href]').forEach((a) => {
    const href = (a as HTMLAnchorElement).href;
    const handle = twitterHandleFromUrl(href);
    if (!handle) return;
    const key = handle.toLowerCase();
    if (key === skipSelf || seen.has(key)) return;
    seen.add(key);
    out.push(twitterProfileUrl(handle));
  });
  return out.slice(0, cap);
}

export async function prepareXUserSearch(): Promise<{ready: boolean; reason?: string}> {
  if (isLoginWall()) return {ready: false, reason: "login_required"};
  if (!/\/search/i.test(window.location.pathname)) {
    return {ready: false, reason: "wrong_page"};
  }

  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline && collectUserUrls(3, null).length < 1) {
    window.scrollBy(0, 900);
    await sleep(900);
  }

  if (collectUserUrls(1, null).length === 0) {
    return {ready: false, reason: isLoginWall() ? "login_required" : "no_results"};
  }
  return {ready: true};
}

export async function collectXUserUrls(
  cap: number,
  excludeHandle?: string | null
): Promise<string[]> {
  const exclude = excludeHandle ?? detectLoggedInXHandle();
  for (let i = 0; i < 8; i += 1) {
    window.scrollBy(0, 1400);
    await sleep(700);
    if (collectUserUrls(cap, exclude).length >= cap) break;
  }
  return collectUserUrls(cap, exclude);
}

function scrapeXProfileOnce(): ScrapedInstagramProfile | null {
  if (isLoginWall()) return null;
  const handle = twitterHandleFromUrl(window.location.href);
  if (!handle) return null;

  const nameBlock = document.querySelector('[data-testid="UserName"]');
  const displayName =
    nameBlock?.querySelector("span")?.textContent?.trim() ||
    document.querySelector('meta[property="og:title"]')?.getAttribute("content")?.split("(")[0]?.trim() ||
    null;

  const bio =
    document.querySelector('[data-testid="UserDescription"]')?.textContent?.replace(/\s+/g, " ").trim() ||
    document.querySelector('meta[property="og:description"]')?.getAttribute("content")?.trim() ||
    null;

  const followerLink =
    document.querySelector('a[href$="/verified_followers"]') ||
    document.querySelector('a[href$="/followers"]');
  const followerCount =
    followerLink?.textContent?.match(/([\d.,]+[KMB]?\+?)/i)?.[1] ||
    document.body.innerText.match(/([\d.,]+[KMB]?\+?)\s+Followers/i)?.[1] ||
    null;

  const postCount =
    document.body.innerText.match(/([\d.,]+[KMB]?\+?)\s+Posts?/i)?.[1] || null;

  const urlNode = document.querySelector(
    '[data-testid="UserUrl"] a, [data-testid="UserProfileHeader_Items"] a[href^="http"]'
  ) as HTMLAnchorElement | null;
  const externalUrl =
    urlNode && !/x\.com|twitter\.com/i.test(urlNode.href) ? urlNode.href : null;

  const mailto = Array.from(document.querySelectorAll('a[href^="mailto:"]'))
    .map((a) => (a as HTMLAnchorElement).href.replace(/^mailto:/i, "").split("?")[0].trim())
    .find((e) => e.includes("@")) || null;

  let avatarUrl: string | null = null;
  const avatar = document.querySelector(
    `[data-testid="UserAvatar-Container-${handle}"] img, a[href$="/photo"] img`
  ) as HTMLImageElement | null;
  const src = avatar?.currentSrc || avatar?.src || "";
  if (src && /^https?:\/\//i.test(src)) avatarUrl = src;
  if (!avatarUrl) {
    const og = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    if (og && /^https:\/\//i.test(og)) avatarUrl = og;
  }

  return {
    username: handle,
    displayName,
    bio,
    followerCount,
    postCount,
    externalUrl,
    email: mailto,
    avatarUrl,
    avatarDataUrl: null,
    profileUrl: twitterProfileUrl(handle),
  };
}

export async function scrapeXProfile(): Promise<ScrapedInstagramProfile | null> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const profile = scrapeXProfileOnce();
    if (profile && (profile.followerCount || profile.bio || profile.displayName)) {
      if (profile.avatarUrl && !profile.avatarDataUrl) {
        profile.avatarDataUrl = await fetchAvatarAsJpegDataUrl(profile.avatarUrl);
      }
      return profile;
    }
    await sleep(1000);
  }
  const fallback = scrapeXProfileOnce();
  if (fallback?.avatarUrl && !fallback.avatarDataUrl) {
    fallback.avatarDataUrl = await fetchAvatarAsJpegDataUrl(fallback.avatarUrl);
  }
  return fallback;
}
