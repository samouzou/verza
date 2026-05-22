import * as path from "path";
import * as os from "os";
import {chromium} from "playwright";
import {GoogleGenerativeAI} from "@google/generative-ai";

import {OPTIC_MAX_SAVED_PER_RUN} from "./limits";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const scoutProfileDir = () => path.join(os.tmpdir(), "optic-scout-profile");

function searchBudget(targetSaved: number) {
  const t = Math.min(OPTIC_MAX_SAVED_PER_RUN, Math.max(5, targetSaved));
  return {
    seedAsk: Math.min(100, Math.max(16, Math.ceil(t * 2.5))),
    youtubeChannels: Math.min(48, Math.max(12, Math.ceil(t * 2))),
    igPosts: Math.min(36, Math.max(12, Math.ceil(t * 2))),
    tiktokProfiles: Math.min(64, Math.max(16, Math.ceil(t * 3))),
    facebookPages: Math.min(36, Math.max(12, Math.ceil(t * 2))),
    twitchChannels: Math.min(48, Math.max(12, Math.ceil(t * 2))),
  };
}

export async function generateSeedLeads(
  platform: string,
  objectives: string,
  agencyName: string | null | undefined,
  targetSaved: number
): Promise<{name: string; url: string}[]> {
  const model = genAI.getGenerativeModel({model: "gemini-3-flash-preview"});
  const {seedAsk} = searchBudget(targetSaved);

  const clientLine = agencyName
    ? `The outreach is on behalf of the brand "${agencyName}" (via Verza); prefer creators who would realistically work with that kind of partner.`
    : "";

  const prompt = `
    Based on these campaign objectives: "${objectives}",
    ${clientLine}
    provide a list of ${seedAsk} real, high-quality creators on ${platform} who would be a strong fit.
    Include their full profile URL.
    Return the result strictly as a JSON array of objects with "name" and "url" keys.
    Do not include any markdown formatting.
  `;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }
}

async function generateSearchQuery(platform: string, objectives: string): Promise<string> {
  const model = genAI.getGenerativeModel({model: "gemini-3-flash-preview"});
  const prompt = `Based on these campaign objectives: "${objectives}", generate a single, highly effective search query to find relevant creators on ${platform}. Return only the query string.`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim().replace(/"/g, "");
}

export async function findCreators(
  platform: string,
  objectives: string,
  targetSaved: number
): Promise<string[]> {
  const budget = searchBudget(targetSaved);
  const query = await generateSearchQuery(platform, objectives);

  const context = await chromium.launchPersistentContext(scoutProfileDir(), {
    headless: true,
    viewport: {width: 1280, height: 1080},
  });

  const page = await context.newPage();
  const urls: string[] = [];

  try {
    if (platform === "youtube") {
      await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
        timeout: 45_000,
      });
      await new Promise((r) => setTimeout(r, 3000));

      const channelLinks = await page.$$eval("a#main-link.channel-link", (links, cap: number) =>
        links.slice(0, cap).map((a) => (a as HTMLAnchorElement).href),
        budget.youtubeChannels
      );
      urls.push(...channelLinks);
    } else if (platform === "instagram") {
      await page.goto(
        `https://www.instagram.com/explore/tags/${encodeURIComponent(query.replace(/\s+/g, ""))}/`,
        {timeout: 45_000}
      );
      await new Promise((r) => setTimeout(r, 4000));

      const postLinks = await page.$$eval('a[href^="/p/"]', (links, cap: number) =>
        links.slice(0, cap).map((a) => (a as HTMLAnchorElement).href),
        budget.igPosts
      );
      urls.push(...postLinks);
    } else if (platform === "tiktok") {
      await page.goto(`https://www.tiktok.com/search?q=${encodeURIComponent(query)}`, {
        timeout: 45_000,
      });
      await new Promise((r) => setTimeout(r, 3500));
      const tiktokUrls = await page.evaluate((cap: number) => {
        const out: string[] = [];
        document.querySelectorAll('a[href*="tiktok.com/@"]').forEach((a) => {
          const href = (a as HTMLAnchorElement).href?.split("?")[0];
          if (href && !out.includes(href)) out.push(href);
        });
        return out.slice(0, cap);
      }, budget.tiktokProfiles);
      urls.push(...tiktokUrls);
    } else if (platform === "facebook") {
      await page.goto(
        `https://www.facebook.com/search/pages/?q=${encodeURIComponent(query)}`,
        {timeout: 45_000}
      );
      await new Promise((r) => setTimeout(r, 4000));

      const pageUrls = await page.evaluate((cap: number) => {
        const out: string[] = [];
        const skip = new Set([
          "pages",
          "watch",
          "groups",
          "events",
          "marketplace",
          "gaming",
          "search",
          "login",
        ]);
        document.querySelectorAll('a[href*="facebook.com"]').forEach((a) => {
          try {
            const u = new URL((a as HTMLAnchorElement).href);
            const seg = u.pathname.split("/").filter(Boolean)[0];
            if (!seg || skip.has(seg.toLowerCase())) return;
            const url = `https://www.facebook.com/${seg}`;
            if (!out.includes(url)) out.push(url);
          } catch {
            /* ignore bad URLs */
          }
        });
        return out.slice(0, cap);
      }, budget.facebookPages);
      urls.push(...pageUrls);
    } else if (platform === "twitch") {
      await page.goto(`https://www.twitch.tv/search?term=${encodeURIComponent(query)}`, {
        timeout: 45_000,
      });
      await new Promise((r) => setTimeout(r, 3500));

      const channelUrls = await page.evaluate((cap: number) => {
        const out: string[] = [];
        const skip = new Set([
          "search",
          "directory",
          "downloads",
          "settings",
          "login",
          "signup",
          "p",
          "videos",
          "clips",
        ]);
        document.querySelectorAll('a[href*="twitch.tv"]').forEach((a) => {
          try {
            const u = new URL((a as HTMLAnchorElement).href);
            const seg = u.pathname.split("/").filter(Boolean)[0];
            if (!seg || skip.has(seg.toLowerCase())) return;
            const url = `https://www.twitch.tv/${seg}`;
            if (!out.includes(url)) out.push(url);
          } catch {
            /* ignore bad URLs */
          }
        });
        return out.slice(0, cap);
      }, budget.twitchChannels);
      urls.push(...channelUrls);
    }

    return urls;
  } catch (error) {
    console.error("[Optic worker] Search error:", error);
    return [];
  } finally {
    await context.close();
  }
}
