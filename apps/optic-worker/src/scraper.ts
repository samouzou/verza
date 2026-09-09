import * as path from "path";
import * as os from "os";
import {chromium, type BrowserContext, type Page} from "playwright";

const VET_PROFILE_DIR = "optic-vet-profile";
const MAX_AVATAR_BYTES = 1_500_000;

export async function createVetBrowserContext(): Promise<BrowserContext> {
  const userDataDir = path.join(os.tmpdir(), VET_PROFILE_DIR);
  return chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: {width: 1280, height: 1080},
  });
}

export type ScrapedProfileSignals = {
  followerCount: string | null;
  postCount: string | null;
  email: string | null;
  externalUrl: string | null;
  bio: string | null;
};

export type ScrapedProfileCapture = {
  screenshotBase64: string;
  /** Best-effort avatar / og:image URL from the profile page. */
  avatarSourceUrl: string | null;
  /** JPEG/PNG bytes captured in the page session (survives CDN hotlink blocks). */
  avatarBytes: Buffer | null;
  avatarContentType: string | null;
  signals: ScrapedProfileSignals;
};

function platformFromUrl(url: string, fallback: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (host.includes("youtube") || host === "youtu.be") return "youtube";
    if (host.includes("tiktok")) return "tiktok";
    if (host.includes("twitch")) return "twitch";
    if (host.includes("instagram")) return "instagram";
    if (host.includes("facebook") || host.includes("fb.com")) return "facebook";
    if (host.includes("linkedin")) return "linkedin";
    if (host === "x.com" || host === "twitter.com") return "twitter";
  } catch {
    /* ignore */
  }
  return fallback || "unknown";
}

export function canonicalizeCreatorUrl(url: string, platform: string): string {
  try {
    const u = new URL(url);
    if (platform === "tiktok") {
      const m = u.pathname.match(/^\/@([^/]+)/);
      if (m) return `https://www.tiktok.com/@${m[1]}`;
    }
    if (platform === "twitch") {
      const seg = u.pathname.split("/").filter(Boolean)[0];
      if (seg) return `https://www.twitch.tv/${seg}`;
    }
    if (platform === "linkedin") {
      const m = u.pathname.match(/^\/in\/([^/]+)/);
      if (m) return `https://www.linkedin.com/in/${m[1]}`;
    }
    if (platform === "twitter") {
      const skip = new Set([
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
      ]);
      const seg = u.pathname.split("/").filter(Boolean)[0];
      if (seg && !skip.has(seg.toLowerCase())) return `https://x.com/${seg}`;
    }
    if (platform === "youtube") {
      u.search = "";
      u.hash = "";
      return u.toString().replace(/\/$/, "");
    }
  } catch {
    /* ignore */
  }
  return url;
}

type DomSignals = ScrapedProfileSignals & {avatarSourceUrl: string | null};

async function extractDomSignals(page: Page, platform: string): Promise<DomSignals> {
  return page.evaluate((plat: string) => {
    const abs = (href: string | null | undefined): string | null => {
      if (!href) return null;
      try {
        const u = new URL(href, location.href);
        if (u.protocol !== "https:" && u.protocol !== "http:") return null;
        return u.toString();
      } catch {
        return null;
      }
    };

    const textOf = (sel: string): string | null => {
      const el = document.querySelector(sel);
      const t = el?.textContent?.replace(/\s+/g, " ").trim() || "";
      return t || null;
    };

    const ogImage = abs(
      document.querySelector('meta[property="og:image"]')?.getAttribute("content")
    );
    const ogDesc =
      document.querySelector('meta[property="og:description"]')?.getAttribute("content")?.trim() ||
      null;

    const pickAvatarImg = (): string | null => {
      if (ogImage) return ogImage;
      const imgs = Array.from(
        document.querySelectorAll(
          'header img, img[alt*="profile" i], img[alt*="avatar" i], img[alt*="photo" i], #avatar img, .tw-avatar img'
        )
      ) as HTMLImageElement[];
      for (const img of imgs) {
        const src = img.currentSrc || img.src || "";
        if (!src || src.startsWith("data:")) continue;
        const resolved = abs(src);
        if (!resolved) continue;
        const alt = (img.getAttribute("alt") || "").toLowerCase();
        if (
          alt.includes("profile") ||
          alt.includes("avatar") ||
          alt.includes("photo") ||
          img.width >= 48 ||
          img.naturalWidth >= 48
        ) {
          return resolved;
        }
      }
      return null;
    };

    const mailto = Array.from(document.querySelectorAll('a[href^="mailto:"]'))
      .map((a) => (a as HTMLAnchorElement).href.replace(/^mailto:/i, "").split("?")[0].trim())
      .find((e) => e.includes("@")) || null;

    const firstExternal = (): string | null => {
      const skipHosts = new Set([
        "youtube.com",
        "youtu.be",
        "tiktok.com",
        "twitch.tv",
        "instagram.com",
        "facebook.com",
        "fb.com",
        "linkedin.com",
        "x.com",
        "twitter.com",
        "google.com",
      ]);
      for (const a of Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[]) {
        const href = abs(a.href);
        if (!href) continue;
        try {
          const host = new URL(href).hostname.replace(/^www\./, "").toLowerCase();
          if ([...skipHosts].some((h) => host === h || host.endsWith(`.${h}`))) continue;
          if (host) return href;
        } catch {
          /* ignore */
        }
      }
      return null;
    };

    let followerCount: string | null = null;
    let postCount: string | null = null;
    let bio: string | null = ogDesc;
    let externalUrl: string | null = abs(
      document.querySelector('link[rel="me"], a[rel="me"]')?.getAttribute("href")
    );

    if (plat === "youtube") {
      followerCount =
        textOf("#subscriber-count") ||
        textOf("#owner-sub-count") ||
        textOf("yt-formatted-string#subscriber-count") ||
        null;
      postCount =
        textOf("#videos-count") ||
        textOf(".grid-subheader yt-formatted-string") ||
        null;
      bio = textOf("#description-container") || textOf("#description") || bio;
      const links = Array.from(
        document.querySelectorAll("#links-holder a, #channel-header-container a[href]")
      ) as HTMLAnchorElement[];
      for (const a of links) {
        const href = abs(a.href);
        if (href && !/youtube\.com|youtu\.be/i.test(href)) {
          externalUrl = href;
          break;
        }
      }
    } else if (plat === "tiktok") {
      followerCount =
        textOf('[data-e2e="followers-count"]') ||
        textOf('strong[title*="Followers" i]') ||
        null;
      postCount = textOf('[data-e2e="likes-count"]') || null;
      bio = textOf('[data-e2e="user-bio"]') || bio;
      const bioLink = document.querySelector('[data-e2e="user-bio"] a, a[data-e2e="user-link"]');
      externalUrl = abs((bioLink as HTMLAnchorElement | null)?.href) || firstExternal();
    } else if (plat === "twitch") {
      followerCount =
        textOf('[data-a-target="followers-count"]') ||
        textOf('p[class*="followers"]') ||
        null;
      bio = textOf('[data-a-target="channel-about-panel"]') || textOf(".about-section") || bio;
      externalUrl = firstExternal();
    } else if (plat === "linkedin") {
      followerCount =
        textOf(".pv-recent-activity-section__follower-count") ||
        textOf(".org-top-card-summary-info-list") ||
        null;
      bio =
        textOf(".pv-text-details__left-panel") ||
        textOf(".top-card-layout__headline") ||
        bio;
      externalUrl = firstExternal();
    } else if (plat === "twitter") {
      followerCount =
        textOf('a[href$="/verified_followers"]') ||
        textOf('a[href$="/followers"]') ||
        null;
      bio =
        textOf('[data-testid="UserDescription"]') ||
        textOf('[data-testid="UserProfileHeader_Items"]') ||
        bio;
      externalUrl =
        abs(
          document
            .querySelector('[data-testid="UserUrl"] a, [data-testid="UserProfileHeader_Items"] a[href]')
            ?.getAttribute("href")
        ) || firstExternal();
    } else if (plat === "facebook") {
      followerCount = textOf('[href*="/followers"]') || followerCount;
      bio = textOf('[data-pagelet="ProfileTilesFeed"]') || bio;
      externalUrl = firstExternal();
    } else {
      externalUrl = externalUrl || firstExternal();
    }

    if (!followerCount) {
      const body = document.body?.innerText?.slice(0, 4000) || "";
      const m = body.match(
        /([\d.,]+\s*[KMB]?)\s*(subscribers?|followers?|connections?)/i
      );
      if (m) followerCount = m[1];
    }
    if (!postCount) {
      const body = document.body?.innerText?.slice(0, 4000) || "";
      const m = body.match(/([\d.,]+\s*[KMB]?)\s*(videos?|posts?|tweets?)/i);
      if (m) postCount = m[1];
    }

    return {
      followerCount,
      postCount,
      email: mailto,
      externalUrl,
      bio,
      avatarSourceUrl: pickAvatarImg(),
    };
  }, platform);
}

async function captureAvatarBytes(
  page: Page,
  avatarSourceUrl: string | null
): Promise<{buffer: Buffer; contentType: string} | null> {
  if (avatarSourceUrl && /^https?:\/\//i.test(avatarSourceUrl)) {
    try {
      const res = await page.request.get(avatarSourceUrl, {timeout: 12_000});
      if (res.ok()) {
        const contentType = (res.headers()["content-type"] || "image/jpeg").split(";")[0].trim();
        const buffer = Buffer.from(await res.body());
        if (
          buffer.length &&
          buffer.length <= MAX_AVATAR_BYTES &&
          (contentType.startsWith("image/") || contentType === "application/octet-stream")
        ) {
          return {
            buffer,
            contentType: contentType.startsWith("image/") ? contentType : "image/jpeg",
          };
        }
      }
    } catch {
      /* fall through to element screenshot */
    }
  }

  const selectors = [
    'meta[property="og:image"]',
    "header img",
    'img[alt*="profile" i]',
    'img[alt*="avatar" i]',
    'img[alt*="photo" i]',
    "#avatar img",
    ".tw-avatar img",
    "yt-img-shadow img",
    '[data-e2e="user-avatar"] img',
  ];
  for (const sel of selectors) {
    if (sel.startsWith("meta")) continue;
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) === 0) continue;
      const buffer = await loc.screenshot({type: "jpeg", quality: 82, timeout: 4000});
      if (buffer.length && buffer.length <= MAX_AVATAR_BYTES) {
        return {buffer, contentType: "image/jpeg"};
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function scrapeCreatorProfileInContext(
  context: BrowserContext,
  url: string,
  platform = "youtube"
): Promise<ScrapedProfileCapture> {
  const page = await context.newPage();
  const plat = platformFromUrl(url, platform);
  const target = canonicalizeCreatorUrl(url, plat);
  try {
    await page.goto(target, {waitUntil: "domcontentloaded", timeout: 45_000});
    await new Promise((r) => setTimeout(r, 2500));

    const signalsRaw = await extractDomSignals(page, plat).catch(
      (): DomSignals => ({
        followerCount: null,
        postCount: null,
        email: null,
        externalUrl: null,
        bio: null,
        avatarSourceUrl: null,
      })
    );

    const avatar = await captureAvatarBytes(page, signalsRaw.avatarSourceUrl);
    const screenshotBuffer = await page.screenshot({fullPage: true});
    return {
      screenshotBase64: screenshotBuffer.toString("base64"),
      avatarSourceUrl: signalsRaw.avatarSourceUrl,
      avatarBytes: avatar?.buffer ?? null,
      avatarContentType: avatar?.contentType ?? null,
      signals: {
        followerCount: signalsRaw.followerCount,
        postCount: signalsRaw.postCount,
        email: signalsRaw.email,
        externalUrl: signalsRaw.externalUrl,
        bio: signalsRaw.bio,
      },
    };
  } finally {
    await page.close().catch(() => {});
  }
}
