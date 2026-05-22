import { chromium, type BrowserContext } from "playwright";
import * as path from "path";
import { app } from "electron";
import { logger } from "./logger";

const VET_PROFILE_DIR = "optic-vet-profile";

/**
 * Headless Playwright profile used only for vetting screenshots.
 * Kept separate from `optic-browser-profile` (interactive platform login).
 */
export async function createVetBrowserContext(): Promise<BrowserContext> {
  const userDataDir = path.join(app.getPath("userData"), VET_PROFILE_DIR);
  return chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: { width: 1280, height: 1080 },
  });
}

/**
 * Captures a profile screenshot using an existing browser context (one context per mission).
 */
export async function scrapeCreatorProfileInContext(
  context: BrowserContext,
  url: string
): Promise<string> {
  logger.log(`[Optic] Capturing profile: ${url}`);
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    await new Promise((r) => setTimeout(r, 2000));
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    logger.log(`[Optic] Screenshot captured for: ${url}`);
    return screenshotBuffer.toString("base64");
  } catch (error) {
    logger.error(`[Optic] Scraper error:`, error);
    throw error;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Standalone scrape (CLI / one-off): opens and closes its own vet context.
 */
export async function scrapeCreatorProfile(url: string): Promise<string> {
  const context = await createVetBrowserContext();
  try {
    return await scrapeCreatorProfileInContext(context, url);
  } finally {
    await context.close().catch(() => {});
  }
}
