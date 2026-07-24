
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

  const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

  const brandBlock = brand
    ? `
    Outreach sender context (use this for draftEmail tone and sign-off; do not invent a different company name):
    - Agency / team name: "${brand.agencyName}"
    ${brand.brandSummary ? `- Brand positioning (from their Verza brand guide): "${brand.brandSummary}"` : ""}
    ${brand.paySourceCampaignTitle ? `- Outreach is scoped to this Verza campaign name (mention once if natural): "${brand.paySourceCampaignTitle}"` : ""}
    ${
      brand.campaignPaySummary
        ? isCauseOrBarterCampaignType(brand.paySourceCampaignType)
          ? `
    Campaign partnership context (this outreach is for a cause or in-kind style campaign — do not imply a cash sponsorship unless the facts below include an explicit USD per-creator amount):
    ${brand.campaignPaySummary}

    In draftEmail: Do not use the words "compensation", "fee", "rate", "paid", or "dollars" in a way that suggests cash payment unless a concrete USD per-creator figure appears in the facts above. Frame the opportunity around mission alignment${
            brand.paySourceCampaignType === "barter_campaign" ? " or a mutually agreed product/exchange" : ""
          }. You may invite them to review details on Verza; do not suggest they will receive a cash payout unless the facts state it clearly.
    `
          : `
    Pay transparency (from their live Verza campaigns — creators often ignore outreach when budget is unclear):
    ${brand.campaignPaySummary}

    In draftEmail: if the bullet list above includes concrete USD per-creator figures, include one clear upfront sentence stating a representative rate or small range using ONLY those numbers (survey data shows creators respond more when budget is stated early). If no numeric rate appears above, say honestly that pay is defined per campaign on Verza without inventing dollar amounts. Never promise a slot, acceptance, or terms not in the list. If any line describes a cause or in-kind barter with no USD figure, do not imply cash compensation for that campaign.
    `
        : ""
    }

    The draftEmail must read as a short personal note from someone at "${brand.agencyName}" partnering via Verza — mention the agency name once where it feels natural, align with Campaign Objectives, and invite the creator to learn more (do not use generic "the Verza network" as the only sender identity).
    `
    : `
    If an email is found, draftEmail is a short, 3-sentence personalized pitch inviting them to explore the Verza network, aligned with Campaign Objectives.
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

    If an email is found, also generate a draftEmail string:
    A short, 3-sentence personalized pitch as specified above.

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
