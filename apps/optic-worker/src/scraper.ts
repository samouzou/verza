import * as path from "path";
import * as os from "os";
import {chromium, type BrowserContext} from "playwright";

const VET_PROFILE_DIR = "optic-vet-profile";

export async function createVetBrowserContext(): Promise<BrowserContext> {
  const userDataDir = path.join(os.tmpdir(), VET_PROFILE_DIR);
  return chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: {width: 1280, height: 1080},
  });
}

export type ScrapedProfileCapture = {
  screenshotBase64: string;
  /** Best-effort avatar / og:image URL from the profile page. */
  avatarSourceUrl: string | null;
};

export async function scrapeCreatorProfileInContext(
  context: BrowserContext,
  url: string
): Promise<ScrapedProfileCapture> {
  const page = await context.newPage();
  try {
    await page.goto(url, {waitUntil: "networkidle", timeout: 45_000});
    await new Promise((r) => setTimeout(r, 2000));

    const avatarSourceUrl = await page
      .evaluate(() => {
        const og = document
          .querySelector('meta[property="og:image"]')
          ?.getAttribute("content");
        if (og && /^https:\/\//i.test(og)) return og;

        const imgs = Array.from(
          document.querySelectorAll(
            'header img, img[alt*="profile" i], img[alt*="avatar" i]'
          )
        ) as HTMLImageElement[];
        for (const img of imgs) {
          const src = img.currentSrc || img.src || "";
          if (!src || !/^https:\/\//i.test(src) || src.startsWith("data:")) continue;
          const alt = (img.getAttribute("alt") || "").toLowerCase();
          if (
            alt.includes("profile") ||
            alt.includes("avatar") ||
            img.width >= 64 ||
            img.naturalWidth >= 64
          ) {
            return src;
          }
        }
        return null;
      })
      .catch(() => null);

    const screenshotBuffer = await page.screenshot({fullPage: true});
    return {
      screenshotBase64: screenshotBuffer.toString("base64"),
      avatarSourceUrl,
    };
  } finally {
    await page.close().catch(() => {});
  }
}
