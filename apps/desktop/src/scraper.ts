
import { chromium } from 'playwright';
import * as path from 'path';
import { app } from 'electron';

/**
 * Launches a browser, navigates to the creator's profile, and captures a screenshot.
 * @param url The social profile URL to scrape.
 * @returns Base64 encoded screenshot buffer.
 */
export async function scrapeCreatorProfile(url: string): Promise<string> {
  console.log(`[Optic] Launching browser for: ${url}`);
  
  const userDataDir = path.join(app.getPath('userData'), 'optic-browser-profile');

  // Launch persistent context to reuse sessions (login states)
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: { width: 1280, height: 1080 }
  });

  const page = await context.newPage();

  try {
    // Navigate and wait for network to be idle
    await page.goto(url, { waitUntil: 'networkidle' });
    
    // Add a small delay for any client-side JS/animations
    await page.waitForTimeout(2000);

    // Capture screenshot as base64
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    const base64Image = screenshotBuffer.toString('base64');

    console.log(`[Optic] Screenshot captured successfully.`);
    return base64Image;
  } catch (error) {
    console.error(`[Optic] Scraper error:`, error);
    throw error;
  } finally {
    await context.close();
  }
}
