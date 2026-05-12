
import { chromium } from 'playwright';
import * as path from 'path';
import { app } from 'electron';
import { logger } from './logger';

/**
 * Launches a browser, navigates to the creator's profile, and captures a screenshot.
 * @param url The social profile URL to scrape.
 * @returns Base64 encoded screenshot buffer.
 */
export async function scrapeCreatorProfile(url: string): Promise<string> {
  logger.log(`[Optic] Launching browser for: ${url}`);
  
  const userDataDir = path.join(app.getPath('userData'), 'optic-browser-profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: { width: 1280, height: 1080 }
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    logger.log(`[Optic] Screenshot captured for: ${url}`);
    return screenshotBuffer.toString('base64');
  } catch (error) {
    logger.error(`[Optic] Scraper error:`, error);
    throw error;
  } finally {
    await context.close();
  }
}
