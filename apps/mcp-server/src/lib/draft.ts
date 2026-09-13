import {GoogleGenerativeAI} from "@google/generative-ai";
import type {VerzaActor} from "../context.js";
import {scrapeProductPage} from "./scrape.js";

export const CAMPAIGN_TYPES = [
  "standard_sponsorship",
  "production_grant",
  "cause_campaign",
  "barter_campaign",
] as const;

export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export const CAMPAIGN_PLATFORMS = [
  "TikTok",
  "Instagram",
  "YouTube",
  "Facebook",
  "Twitch",
  "LinkedIn",
] as const;

export type CampaignDraft = {
  sourceUrl: string;
  pageTitle: string | null;
  pageDescription: string | null;
  campaignType: CampaignType;
  title: string;
  descriptionHtml: string;
  /** Plain-text brief for agents / Optic objectives. */
  descriptionText: string;
  platforms: string[];
  ratePerCreator: number;
  creatorsNeeded: number;
  videosPerCreator: number;
  usageRights: "none" | "30_days" | "1_year" | "perpetuity";
  allowWhitelisting: boolean;
  requireVerzaScore: boolean;
  verzaScoreThreshold: number;
  affiliateSuggested: boolean;
  rationale: string;
  assumptions: string[];
  nextStep: string;
};

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeBriefHtml(html: string): string {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<\/?(iframe|object|embed|form|input|button|meta|link)\b[^>]*>/gi, "");
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  return s.trim().slice(0, 80000);
}

export type DraftFromUrlInput = {
  productUrl: string;
  geminiApiKey: string;
  actor: VerzaActor;
  userNotes?: string | null;
  campaignType?: CampaignType | null;
  platforms?: string[] | null;
  ratePerCreator?: number | null;
  creatorsNeeded?: number | null;
  videosPerCreator?: number | null;
};

/**
 * Scrape a product/brand URL and draft a Verza campaign brief + economics.
 */
export async function draftCampaignFromUrl(input: DraftFromUrlInput): Promise<CampaignDraft> {
  const scraped = await scrapeProductPage(input.productUrl);
  const preferredType = input.campaignType ?? null;
  const preferredPlatforms = (input.platforms ?? []).filter((p) =>
    (CAMPAIGN_PLATFORMS as readonly string[]).includes(p)
  );

  const genAI = new GoogleGenerativeAI(input.geminiApiKey);
  const model = genAI.getGenerativeModel({model: "gemini-3.6-flash"});

  const system = `You are a senior campaign strategist for Verza (tryverza.com), the OS for the creator economy.
Draft a creator campaign from a product/brand page for the brand "${input.actor.agencyName}".

Return STRICT JSON only (no markdown fences) with keys:
- campaignType: one of standard_sponsorship | production_grant | cause_campaign | barter_campaign
- title: max 120 chars, specific, no ALL CAPS
- descriptionHtml: HTML fragment using only p, br, strong, em, ul, ol, li (3–6 short blocks, under 2500 chars)
- platforms: array from TikTok, Instagram, YouTube, Facebook, Twitch, LinkedIn (1–3 best fits)
- ratePerCreator: number USD (0 for cause/barter unless cash is clear)
- creatorsNeeded: integer (0 for cause_campaign meaning unlimited; else 3–25 sensible default)
- videosPerCreator: integer 1–3
- usageRights: none | 30_days | 1_year | perpetuity
- allowWhitelisting: boolean
- requireVerzaScore: boolean (default true for paid UGC)
- verzaScoreThreshold: integer 50–85 (default 65)
- affiliateSuggested: boolean (true if product CTA / ecom conversion fit)
- rationale: 1–2 sentences why this plan fits the page
- assumptions: string array of explicit assumptions

Rules:
- Prefer standard_sponsorship for commercial products with clear cash UGC.
- Prefer barter_campaign when product seeding / in-kind is more natural than cash.
- Prefer cause_campaign only for nonprofit / impact pages.
- Do not invent legal exclusivity or guaranteed reach.
- If user forced a campaignType, honor it.
- If user provided rate/creators/platforms, prefer those numbers/platforms.`;

  const userBlock = [
    `Product URL: ${scraped.url}`,
    scraped.title ? `Page title: ${scraped.title}` : null,
    scraped.description ? `Meta description: ${scraped.description}` : null,
    preferredType ? `Forced campaignType: ${preferredType}` : null,
    preferredPlatforms.length ? `Forced platforms: ${preferredPlatforms.join(", ")}` : null,
    input.ratePerCreator != null ? `Forced ratePerCreator USD: ${input.ratePerCreator}` : null,
    input.creatorsNeeded != null ? `Forced creatorsNeeded: ${input.creatorsNeeded}` : null,
    input.videosPerCreator != null ? `Forced videosPerCreator: ${input.videosPerCreator}` : null,
    input.userNotes?.trim() ? `Brand notes: ${input.userNotes.trim().slice(0, 2000)}` : null,
    `Page text (truncated):\n${scraped.websiteText.slice(0, 12000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await model.generateContent(`${system}\n\n${userBlock}`);
  const raw = result.response.text().trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Model returned no campaign JSON. Try again with a clearer product URL.");
  }

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  let campaignType = (
    typeof parsed.campaignType === "string" ? parsed.campaignType : "standard_sponsorship"
  ) as CampaignType;
  if (preferredType) campaignType = preferredType;
  if (!(CAMPAIGN_TYPES as readonly string[]).includes(campaignType)) {
    campaignType = "standard_sponsorship";
  }

  const title =
    typeof parsed.title === "string" && parsed.title.trim()
      ? parsed.title.trim().slice(0, 200)
      : scraped.title?.slice(0, 120) || "Untitled campaign";

  const descriptionHtml =
    typeof parsed.descriptionHtml === "string"
      ? sanitizeBriefHtml(parsed.descriptionHtml)
      : `<p>Promote ${title} with authentic creator content.</p>`;
  if (!descriptionHtml) {
    throw new Error("Model returned an empty campaign brief.");
  }

  let platforms =
    preferredPlatforms.length > 0
      ? preferredPlatforms
      : Array.isArray(parsed.platforms)
        ? (parsed.platforms as unknown[])
            .filter((p): p is string => typeof p === "string")
            .filter((p) => (CAMPAIGN_PLATFORMS as readonly string[]).includes(p))
            .slice(0, 4)
        : ["TikTok", "Instagram"];
  if (platforms.length === 0) platforms = ["TikTok", "Instagram"];

  const ratePerCreator =
    input.ratePerCreator != null && Number.isFinite(input.ratePerCreator)
      ? Math.max(0, input.ratePerCreator)
      : typeof parsed.ratePerCreator === "number" && Number.isFinite(parsed.ratePerCreator)
        ? Math.max(0, parsed.ratePerCreator)
        : campaignType === "cause_campaign" || campaignType === "barter_campaign"
          ? 0
          : 750;

  let creatorsNeeded =
    input.creatorsNeeded != null && Number.isFinite(input.creatorsNeeded)
      ? Math.max(0, Math.floor(input.creatorsNeeded))
      : typeof parsed.creatorsNeeded === "number" && Number.isFinite(parsed.creatorsNeeded)
        ? Math.max(0, Math.floor(parsed.creatorsNeeded))
        : 10;
  if (campaignType === "cause_campaign") creatorsNeeded = 0;

  const videosPerCreator =
    input.videosPerCreator != null && Number.isFinite(input.videosPerCreator)
      ? Math.max(1, Math.floor(input.videosPerCreator))
      : typeof parsed.videosPerCreator === "number" && Number.isFinite(parsed.videosPerCreator)
        ? Math.max(1, Math.min(5, Math.floor(parsed.videosPerCreator)))
        : 1;

  const usageRightsRaw = typeof parsed.usageRights === "string" ? parsed.usageRights : "30_days";
  const usageRights = (
    ["none", "30_days", "1_year", "perpetuity"].includes(usageRightsRaw)
      ? usageRightsRaw
      : "30_days"
  ) as CampaignDraft["usageRights"];

  const draft: CampaignDraft = {
    sourceUrl: scraped.url,
    pageTitle: scraped.title,
    pageDescription: scraped.description,
    campaignType,
    title,
    descriptionHtml,
    descriptionText: htmlToText(descriptionHtml),
    platforms,
    ratePerCreator,
    creatorsNeeded,
    videosPerCreator,
    usageRights,
    allowWhitelisting: parsed.allowWhitelisting === true,
    requireVerzaScore: parsed.requireVerzaScore !== false,
    verzaScoreThreshold:
      typeof parsed.verzaScoreThreshold === "number" && Number.isFinite(parsed.verzaScoreThreshold)
        ? Math.max(50, Math.min(100, Math.round(parsed.verzaScoreThreshold)))
        : 65,
    affiliateSuggested: parsed.affiliateSuggested === true,
    rationale:
      typeof parsed.rationale === "string" && parsed.rationale.trim()
        ? parsed.rationale.trim().slice(0, 500)
        : "Drafted from the product page and brand context.",
    assumptions: Array.isArray(parsed.assumptions)
      ? (parsed.assumptions as unknown[])
          .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
          .map((a) => a.trim().slice(0, 240))
          .slice(0, 8)
      : [],
    nextStep:
      campaignType === "cause_campaign" ||
      campaignType === "barter_campaign" ||
      ratePerCreator <= 0
        ? "Review this draft with the brand. When they’re happy, launch the campaign — it can go live without funding."
        : "Review this draft with the brand. When they’re happy, launch the campaign and complete checkout to fund creator pay.",
  };

  return draft;
}
