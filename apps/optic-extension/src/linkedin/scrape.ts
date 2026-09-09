import type {ScrapedInstagramProfile} from "../shared/types";
import {fetchAvatarAsJpegDataUrl} from "../shared/avatar";
import {linkedinProfileUrl, linkedinSlugFromUrl} from "../shared/handles";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLoginWall(): boolean {
  const path = window.location.pathname.toLowerCase();
  if (
    path.includes("/login") ||
    path.includes("/authwall") ||
    path.includes("/checkpoint") ||
    path.includes("/uas/login")
  ) {
    return true;
  }
  const host = window.location.hostname.toLowerCase();
  if (host.startsWith("login.")) return true;
  const body = document.body?.innerText?.slice(0, 2000).toLowerCase() || "";
  if (document.querySelectorAll('a[href*="/in/"]').length > 0) return false;
  return body.includes("sign in") && body.includes("join now");
}

export function detectLoggedInLinkedInSlug(): string | null {
  const candidates = [
    document.querySelector(".global-nav__me a[href*='/in/']"),
    document.querySelector("a[href*='/in/'] img.global-nav__me-photo")?.closest("a"),
    document.querySelector('a[data-control-name="identity_welcome_message"]'),
  ];
  for (const el of candidates) {
    const href = (el as HTMLAnchorElement | null)?.href;
    const slug = href ? linkedinSlugFromUrl(href) : null;
    if (slug) return slug;
  }
  return null;
}

function collectPeopleUrls(cap: number, excludeSlug: string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const skipSelf = excludeSlug?.toLowerCase() ?? "";
  document.querySelectorAll('a[href*="/in/"]').forEach((a) => {
    const slug = linkedinSlugFromUrl((a as HTMLAnchorElement).href);
    if (!slug) return;
    const key = slug.toLowerCase();
    if (key === skipSelf || seen.has(key)) return;
    seen.add(key);
    out.push(linkedinProfileUrl(slug));
  });
  return out.slice(0, cap);
}

/** Wait for LinkedIn people-search results, then scroll to load more. */
export async function prepareLinkedInPeopleSearch(): Promise<{
  ready: boolean;
  reason?: string;
}> {
  if (isLoginWall()) return {ready: false, reason: "login_required"};
  if (!/\/search\/results\/people/i.test(window.location.pathname)) {
    return {ready: false, reason: "wrong_page"};
  }

  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline && collectPeopleUrls(3, null).length < 1) {
    window.scrollBy(0, 800);
    await sleep(900);
  }

  if (collectPeopleUrls(1, null).length === 0) {
    return {ready: false, reason: isLoginWall() ? "login_required" : "no_results"};
  }
  return {ready: true};
}

export async function collectLinkedInPeopleUrls(
  cap: number,
  excludeSlug?: string | null
): Promise<string[]> {
  const exclude = excludeSlug ?? detectLoggedInLinkedInSlug();
  for (let i = 0; i < 8; i += 1) {
    window.scrollBy(0, 1400);
    const more = document.querySelector(
      'button[aria-label*="more" i], button.infinite-scroller__show-more-button'
    ) as HTMLButtonElement | null;
    more?.click();
    await sleep(800);
    if (collectPeopleUrls(cap, exclude).length >= cap) break;
  }
  return collectPeopleUrls(cap, exclude);
}

function scrapeLinkedInProfileOnce(): ScrapedInstagramProfile | null {
  if (isLoginWall()) return null;
  const slug = linkedinSlugFromUrl(window.location.href);
  if (!slug) return null;

  const displayName =
    document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ||
    document.querySelector('meta[property="og:title"]')?.getAttribute("content")?.split("|")[0]?.trim() ||
    null;

  const headline =
    document.querySelector(".text-body-medium.break-words")?.textContent?.replace(/\s+/g, " ").trim() ||
    document.querySelector(".pv-text-details__left-panel .text-body-medium")?.textContent?.replace(/\s+/g, " ").trim() ||
    document.querySelector('meta[property="og:description"]')?.getAttribute("content")?.trim() ||
    null;

  const about =
    document.querySelector("#about ~ .display-flex .inline-show-more-text")?.textContent?.replace(/\s+/g, " ").trim() ||
    null;

  const bio = [headline, about].filter(Boolean).join(" — ") || headline || about;

  const body = document.body?.innerText?.slice(0, 5000) || "";
  const followerMatch = body.match(/([\d.,]+[KMB]?\+?)\s+(followers?|connections?)/i);
  const followerCount = followerMatch ? followerMatch[1] : null;

  let externalUrl: string | null = null;
  const links = Array.from(
    document.querySelectorAll(
      ".pv-text-details__left-panel a[href], .pv-top-card a[href], section.pv-contact-info a[href]"
    )
  ) as HTMLAnchorElement[];
  for (const a of links) {
    const href = a.href;
    if (!href || /linkedin\.com|javascript:/i.test(href)) continue;
    if (href.startsWith("mailto:")) continue;
    if (/^https?:\/\//i.test(href)) {
      externalUrl = href;
      break;
    }
  }

  const mailto = Array.from(document.querySelectorAll('a[href^="mailto:"]'))
    .map((a) => (a as HTMLAnchorElement).href.replace(/^mailto:/i, "").split("?")[0].trim())
    .find((e) => e.includes("@")) || null;

  let avatarUrl: string | null = null;
  const imgs = document.querySelectorAll(
    ".pv-top-card-profile-picture img, .pv-top-card img, button.pv-top-card-profile-picture img, img.profile-photo-edit__preview"
  );
  for (const node of Array.from(imgs)) {
    const img = node as HTMLImageElement;
    const src = img.currentSrc || img.src || "";
    if (src && !src.startsWith("data:") && /^https?:\/\//i.test(src)) {
      avatarUrl = src;
      break;
    }
  }
  if (!avatarUrl) {
    const og = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    if (og && /^https:\/\//i.test(og)) avatarUrl = og;
  }

  return {
    username: slug,
    displayName,
    bio,
    followerCount,
    postCount: null,
    externalUrl,
    email: mailto,
    avatarUrl,
    avatarDataUrl: null,
    profileUrl: linkedinProfileUrl(slug),
  };
}

export async function scrapeLinkedInProfile(): Promise<ScrapedInstagramProfile | null> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const profile = scrapeLinkedInProfileOnce();
    if (profile && (profile.followerCount || profile.bio || profile.displayName)) {
      if (profile.avatarUrl && !profile.avatarDataUrl) {
        profile.avatarDataUrl = await fetchAvatarAsJpegDataUrl(profile.avatarUrl);
      }
      return profile;
    }
    await sleep(1000);
  }
  const fallback = scrapeLinkedInProfileOnce();
  if (fallback?.avatarUrl && !fallback.avatarDataUrl) {
    fallback.avatarDataUrl = await fetchAvatarAsJpegDataUrl(fallback.avatarUrl);
  }
  return fallback;
}
