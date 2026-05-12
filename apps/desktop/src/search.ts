
import { chromium } from 'playwright';
import * as path from 'path';
import { app } from 'electron';
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

/**
 * Uses Gemini to transform objectives into a search query for a specific platform.
 */
async function generateSearchQuery(platform: string, objectives: string): Promise<string> {
  const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
  const prompt = `Based on these campaign objectives: "${objectives}", generate a single, highly effective search query to find relevant creators on ${platform}. Return only the query string.`;
  
  const result = await model.generateContent(prompt);
  return result.response.text().trim().replace(/\"/g, '');
}

/**
 * Performs an autonomous search on a platform and returns found URLs.
 */
export async function findCreators(platform: string, objectives: string): Promise<string[]> {
  console.log(`[Optic] Starting autonomous search on ${platform}...`);
  
  const query = await generateSearchQuery(platform, objectives);
  console.log(`[Optic] Generated Search Query: ${query}`);

  const userDataDir = path.join(app.getPath('userData'), 'optic-browser-profile');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: { width: 1280, height: 1080 }
  });

  const page = await context.newPage();
  const urls: string[] = [];

  try {
    if (platform === 'youtube') {
      await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
      await page.waitForTimeout(3000);
      
      // Extract top 3 channel URLs
      const channelLinks = await page.$$eval('a#main-link.channel-link', links => 
        links.slice(0, 3).map(a => (a as HTMLAnchorElement).href)
      );
      urls.push(...channelLinks);
    } else if (platform === 'instagram') {
      // Instagram search is trickier, we'll try to use the explore/search tags
      await page.goto(`https://www.instagram.com/explore/tags/${encodeURIComponent(query.replace(/\s+/g, ''))}/`);
      await page.waitForTimeout(4000);
      
      // Extract URLs from recent posts
      const postLinks = await page.$$eval('a[href^="/p/"]', links => 
        links.slice(0, 3).map(a => (a as HTMLAnchorElement).href)
      );
      urls.push(...postLinks);
    }

    console.log(`[Optic] Found ${urls.length} potential leads.`);
    return urls;
  } catch (error) {
    console.error(`[Optic] Search error:`, error);
    return [];
  } finally {
    await context.close();
  }
}
