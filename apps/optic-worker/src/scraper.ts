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

export async function scrapeCreatorProfileInContext(
  context: BrowserContext,
  url: string
): Promise<string> {
  const page = await context.newPage();
  try {
    await page.goto(url, {waitUntil: "networkidle", timeout: 45_000});
    await new Promise((r) => setTimeout(r, 2000));
    const screenshotBuffer = await page.screenshot({fullPage: true});
    return screenshotBuffer.toString("base64");
  } finally {
    await page.close().catch(() => {});
  }
}
