
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";
import type { AgencyBrandContext } from "./agencyContext";
import { logger } from "./logger";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

function isCauseOrBarterCampaignType(ct: string | null | undefined): boolean {
  return ct === "cause_campaign" || ct === "barter_campaign";
}

export type DraftBrandContext = Pick<
  AgencyBrandContext,
  | "agencyName"
  | "brandSummary"
  | "userDisplayName"
  | "campaignPaySummary"
  | "paySourceCampaignTitle"
  | "paySourceCampaignType"
>;

export interface GeminiAnalysisResult {
  creatorName: string;
  niche: string;
  email?: string;
  followerCount: string;
  draftEmail?: string;
}

/**
 * Passes a base64 image to Gemini for multimodal analysis.
 * @param imageBase64 The profile screenshot.
 * @param objectives The user's campaign objectives for personalization.
 * @param brand When set (signed-in Verza agency), draftEmail is written on behalf of that agency.
 */
export async function analyzeProfileWithGemini(
  imageBase64: string,
  objectives: string = "general outreach",
  brand?: DraftBrandContext | null
): Promise<GeminiAnalysisResult> {
  logger.log(`[Optic] Analyzing with Gemini (Objectives: ${objectives.slice(0, 50)}...)...`);

  const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

  const brandBlock = brand
    ? `
    Outreach sender context (draft as the brand itself — not an agency representing them):
    - Brand / team name: "${brand.agencyName}"
    - Sender display name (intro + sign-off): "${brand.userDisplayName?.trim() || "(use brand name in sign-off; do not invent a person)"}"
    ${brand.brandSummary ? `- Brand positioning: "${brand.brandSummary}"` : ""}
    ${brand.paySourceCampaignTitle ? `- Campaign name (mention once if natural): "${brand.paySourceCampaignTitle}"` : ""}
    ${
      brand.campaignPaySummary
        ? isCauseOrBarterCampaignType(brand.paySourceCampaignType)
          ? `
    Campaign partnership context (cause or in-kind — do not imply cash unless an explicit USD figure appears below):
    ${brand.campaignPaySummary}

    In draftEmail: do not imply cash payment unless a concrete USD figure appears above. Do not invent payouts.
    `
          : `
    Pay transparency (from live campaign facts):
    ${brand.campaignPaySummary}

    In draftEmail: use ONLY numeric rates that appear above; otherwise omit pay. Never invent dollar amounts.
    `
        : ""
    }

    Email drafts must sound like "${brand.agencyName}" writing directly to the creator. Never invent titles, street addresses, or legal footers.
    `
    : `
    If an email is found, draft as a brand team reaching out aligned with Campaign Objectives.
    `;

  const prompt = `
    You are an elite marketing agent powering Verza Optic.
    Analyze this screenshot of a creator's profile based on the following Campaign Objectives:
    "${objectives}"
    ${brandBlock}

    Extract the following information and return it strictly as a JSON object:
    1. creatorName
    2. niche (e.g., tech, beauty, gaming)
    3. email (if visible in the bio or description)
    4. followerCount (estimate based on visible numbers)

    If an email is found, also generate a draftEmail string as REQUIRED HTML (not plain text).
    Use only <p>, <br>, <ul>, <li>, <strong>, <em>, and <a href="https://...">.
    Structure: greeting; intro as someone WITH the brand; what the brand does; why this creator; <ul> campaign basics; soft CTA for a brief chat; Best, + first name; optional brand-name-only footer (no street address or invented titles).
    Never write as if representing the brand via Verza unless the brand name is Verza. Bold the brand once with <strong>. No markdown.

    Do not include any markdown formatting outside of the JSON.
    If you cannot find a piece of information, return null for that field.
  `;

  try {
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: imageBase64,
          mimeType: "image/png"
        }
      }
    ]);

    const response = await result.response;
    const text = response.text().trim();
    
    // Simple regex to extract JSON if Gemini wraps it in code blocks
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to extract valid JSON from Gemini response");
    }

    const parsedData: GeminiAnalysisResult = JSON.parse(jsonMatch[0]);
    logger.log(`[Optic] Analysis complete for: ${parsedData.creatorName}`);
    
    return parsedData;
  } catch (error) {
    logger.error(`[Optic] Vision error:`, error);
    throw error;
  }
}
