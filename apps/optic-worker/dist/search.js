"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSeedLeads = generateSeedLeads;
exports.findCreators = findCreators;
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const playwright_1 = require("playwright");
const generative_ai_1 = require("@google/generative-ai");
const limits_1 = require("./limits");
const genAI = new generative_ai_1.GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const scoutProfileDir = () => path.join(os.tmpdir(), "optic-scout-profile");
function searchBudget(targetSaved) {
    const t = Math.min(limits_1.OPTIC_MAX_SAVED_PER_RUN, Math.max(5, targetSaved));
    return {
        seedAsk: Math.min(100, Math.max(16, Math.ceil(t * 2.5))),
        youtubeChannels: Math.min(48, Math.max(12, Math.ceil(t * 2))),
        igPosts: Math.min(36, Math.max(12, Math.ceil(t * 2))),
        tiktokProfiles: Math.min(64, Math.max(16, Math.ceil(t * 3))),
        facebookPages: Math.min(36, Math.max(12, Math.ceil(t * 2))),
        twitchChannels: Math.min(48, Math.max(12, Math.ceil(t * 2))),
        linkedinProfiles: Math.min(48, Math.max(12, Math.ceil(t * 2))),
        twitterProfiles: Math.min(48, Math.max(12, Math.ceil(t * 2))),
    };
}
async function generateSeedLeads(platform, objectives, agencyName, targetSaved) {
    const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });
    const { seedAsk } = searchBudget(targetSaved);
    const clientLine = agencyName
        ? `The outreach is on behalf of the brand "${agencyName}" (via Verza); prefer creators who would realistically work with that kind of partner.`
        : "";
    const prompt = `
    Based on these campaign objectives: "${objectives}",
    ${clientLine}
    provide a list of ${seedAsk} real, high-quality creators on ${platform} who would be a strong fit.
    Include their full profile URL${platform === "twitter" ? " as https://x.com/{handle} (not tweet permalinks)" : ""}.
    Return the result strictly as a JSON array of objects with "name" and "url" keys.
    Do not include any markdown formatting.
  `;
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch)
        return [];
    try {
        return JSON.parse(jsonMatch[0]);
    }
    catch {
        return [];
    }
}
async function generateSearchQuery(platform, objectives) {
    const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });
    const prompt = `Based on these campaign objectives: "${objectives}", generate a single, highly effective search query to find relevant creators on ${platform}. Return only the query string.`;
    const result = await model.generateContent(prompt);
    return result.response.text().trim().replace(/"/g, "");
}
async function findCreators(platform, objectives, targetSaved) {
    const budget = searchBudget(targetSaved);
    const query = await generateSearchQuery(platform, objectives);
    const context = await playwright_1.chromium.launchPersistentContext(scoutProfileDir(), {
        headless: true,
        viewport: { width: 1280, height: 1080 },
    });
    const page = await context.newPage();
    const urls = [];
    try {
        if (platform === "youtube") {
            await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAg%3D%3D`, { timeout: 45_000 });
            await new Promise((r) => setTimeout(r, 3000));
            const channelLinks = await page.evaluate((cap) => {
                const out = [];
                const push = (href) => {
                    if (!href)
                        return;
                    try {
                        const u = new URL(href, location.origin);
                        const path = u.pathname.replace(/\/$/, "");
                        if (path.startsWith("/@") ||
                            path.startsWith("/channel/") ||
                            path.startsWith("/c/") ||
                            path.startsWith("/user/")) {
                            const clean = `https://www.youtube.com${path}`;
                            if (!out.includes(clean))
                                out.push(clean);
                        }
                    }
                    catch {
                        /* ignore */
                    }
                };
                document.querySelectorAll("a#main-link.channel-link, a[href*='/@'], a[href*='/channel/']").forEach((a) => {
                    push(a.href);
                });
                return out.slice(0, cap);
            }, budget.youtubeChannels);
            urls.push(...channelLinks);
        }
        else if (platform === "instagram") {
            await page.goto(`https://www.instagram.com/explore/tags/${encodeURIComponent(query.replace(/\s+/g, ""))}/`, { timeout: 45_000 });
            await new Promise((r) => setTimeout(r, 4000));
            const postLinks = await page.$$eval('a[href^="/p/"]', (links, cap) => links.slice(0, cap).map((a) => a.href), budget.igPosts);
            urls.push(...postLinks);
        }
        else if (platform === "tiktok") {
            await page.goto(`https://www.tiktok.com/search?q=${encodeURIComponent(query)}`, {
                timeout: 45_000,
            });
            await new Promise((r) => setTimeout(r, 3500));
            const tiktokUrls = await page.evaluate((cap) => {
                const out = [];
                document.querySelectorAll('a[href*="tiktok.com/@"]').forEach((a) => {
                    try {
                        const u = new URL(a.href);
                        const m = u.pathname.match(/^\/@([^/]+)/);
                        if (!m)
                            return;
                        const href = `https://www.tiktok.com/@${m[1]}`;
                        if (!out.includes(href))
                            out.push(href);
                    }
                    catch {
                        /* ignore */
                    }
                });
                return out.slice(0, cap);
            }, budget.tiktokProfiles);
            urls.push(...tiktokUrls);
        }
        else if (platform === "facebook") {
            await page.goto(`https://www.facebook.com/search/pages/?q=${encodeURIComponent(query)}`, { timeout: 45_000 });
            await new Promise((r) => setTimeout(r, 4000));
            const pageUrls = await page.evaluate((cap) => {
                const out = [];
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
                        const u = new URL(a.href);
                        const seg = u.pathname.split("/").filter(Boolean)[0];
                        if (!seg || skip.has(seg.toLowerCase()))
                            return;
                        const url = `https://www.facebook.com/${seg}`;
                        if (!out.includes(url))
                            out.push(url);
                    }
                    catch {
                        /* ignore bad URLs */
                    }
                });
                return out.slice(0, cap);
            }, budget.facebookPages);
            urls.push(...pageUrls);
        }
        else if (platform === "twitch") {
            await page.goto(`https://www.twitch.tv/search?term=${encodeURIComponent(query)}`, {
                timeout: 45_000,
            });
            await new Promise((r) => setTimeout(r, 3500));
            const channelUrls = await page.evaluate((cap) => {
                const out = [];
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
                        const u = new URL(a.href);
                        const seg = u.pathname.split("/").filter(Boolean)[0];
                        if (!seg || skip.has(seg.toLowerCase()))
                            return;
                        const url = `https://www.twitch.tv/${seg}`;
                        if (!out.includes(url))
                            out.push(url);
                    }
                    catch {
                        /* ignore bad URLs */
                    }
                });
                return out.slice(0, cap);
            }, budget.twitchChannels);
            urls.push(...channelUrls);
        }
        else if (platform === "linkedin") {
            await page.goto(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`, { timeout: 45_000 });
            await new Promise((r) => setTimeout(r, 4000));
            const peopleUrls = await page.evaluate((cap) => {
                const out = [];
                document.querySelectorAll('a[href*="linkedin.com/in/"]').forEach((a) => {
                    try {
                        const u = new URL(a.href, location.origin);
                        const m = u.pathname.match(/^\/in\/([^/]+)/);
                        if (!m)
                            return;
                        const href = `https://www.linkedin.com/in/${m[1]}`;
                        if (!out.includes(href))
                            out.push(href);
                    }
                    catch {
                        /* ignore */
                    }
                });
                return out.slice(0, cap);
            }, budget.linkedinProfiles);
            urls.push(...peopleUrls);
        }
        else if (platform === "twitter") {
            await page.goto(`https://x.com/search?q=${encodeURIComponent(query)}&f=user`, { timeout: 45_000 });
            await new Promise((r) => setTimeout(r, 4000));
            const twitterUrls = await page.evaluate((cap) => {
                const out = [];
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
                    "tos",
                    "privacy",
                    "hashtag",
                    "jobs",
                ]);
                document.querySelectorAll('a[href*="x.com/"], a[href*="twitter.com/"]').forEach((a) => {
                    try {
                        const u = new URL(a.href, location.origin);
                        const seg = u.pathname.split("/").filter(Boolean)[0];
                        if (!seg || skip.has(seg.toLowerCase()) || seg.startsWith("i"))
                            return;
                        const href = `https://x.com/${seg}`;
                        if (!out.includes(href))
                            out.push(href);
                    }
                    catch {
                        /* ignore */
                    }
                });
                return out.slice(0, cap);
            }, budget.twitterProfiles);
            urls.push(...twitterUrls);
        }
        return urls;
    }
    catch (error) {
        console.error("[Optic worker] Search error:", error);
        return [];
    }
    finally {
        await context.close();
    }
}
