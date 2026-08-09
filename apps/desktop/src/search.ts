
import { chromium } from 'playwright';
import * as path from 'path';
import { app } from 'electron';
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from 'dotenv';
import { logger } from './logger';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

/**
 * Uses Gemini's internal knowledge to generate a seed list of creators.
 */
export async function generateSeedLeads(
  platform: string,
  objectives: string,
  agencyName?: string | null
): Promise<{ name: string; url: string }[]> {
  logger.log(`[Optic] Generating seed leads from AI knowledge...`);
  const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

  const clientLine = agencyName
    ? `The outreach is on behalf of the brand/agency "${agencyName}" (via Verza); prefer creators who would realistically work with that kind of partner.`
    : "";

  const prompt = `
    Based on these campaign objectives: "${objectives}",
    ${clientLine}
    provide a list of 5 real, high-quality creators on ${platform} who would be a perfect fit.
    Include their full profile URL.
    Return the result strictly as a JSON array of objects with "name" and "url" keys.
    Do not include any markdown formatting.
  `;
  
  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  
  if (!jsonMatch) return [];
  return JSON.parse(jsonMatch[0]);
}

/**
 * Uses Gemini to transform objectives into a search query for a specific platform.
 */
async function generateSearchQuery(platform: string, objectives: string): Promise<string> {
  const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });
  const prompt = `Based on these campaign objectives: "${objectives}", generate a single, highly effective search query to find relevant creators on ${platform}. Return only the query string.`;
  
  const result = await model.generateContent(prompt);
  return result.response.text().trim().replace(/\"/g, '');
}

/**
 * Performs an autonomous search on a platform and returns found URLs.
 */
export async function findCreators(platform: string, objectives: string): Promise<string[]> {
  logger.log(`[Optic] Starting autonomous search on ${platform}...`);
  
  const query = await generateSearchQuery(platform, objectives);
  logger.log(`[Optic] Search query: "${query}"`);

  const userDataDir = path.join(app.getPath("userData"), "optic-scout-profile");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: { width: 1280, height: 1080 }
  });

  const page = await context.newPage();
  const urls: string[] = [];

  try {
    if (platform === "youtube") {
      await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
        timeout: 45_000,
      });
      await new Promise((r) => setTimeout(r, 3000));
      
      // Extract top 3 channel URLs
      const channelLinks = await page.$$eval('a#main-link.channel-link', links => 
        links.slice(0, 3).map(a => (a as HTMLAnchorElement).href)
      );
      urls.push(...channelLinks);
    } else if (platform === "instagram") {
      // Instagram hashtag explore — URLs are post pages, not full profiles; good for seed discovery only.
      await page.goto(
        `https://www.instagram.com/explore/tags/${encodeURIComponent(query.replace(/\s+/g, ""))}/`,
        { timeout: 45_000 }
      );
      await new Promise((r) => setTimeout(r, 4000));
      
      // Extract URLs from recent posts
      const postLinks = await page.$$eval('a[href^="/p/"]', links => 
        links.slice(0, 3).map(a => (a as HTMLAnchorElement).href)
      );
      urls.push(...postLinks);
    } else if (platform === "tiktok") {
      await page.goto(`https://www.tiktok.com/search?q=${encodeURIComponent(query)}`, {
        timeout: 45_000,
      });
      await new Promise((r) => setTimeout(r, 3500));
      const tiktokUrls = await page.evaluate(() => {
        const out: string[] = [];
        document.querySelectorAll('a[href*="tiktok.com/@"]').forEach((a) => {
          const href = (a as HTMLAnchorElement).href?.split("?")[0];
          if (href && !out.includes(href)) out.push(href);
        });
        return out.slice(0, 8);
      });
      urls.push(...tiktokUrls);
    }

    logger.log(`[Optic] Found ${urls.length} potential leads.`);
    return urls;
  } catch (error) {
    logger.error(`[Optic] Search error:`, error);
    return [];
  } finally {
    await context.close();
  }
}
