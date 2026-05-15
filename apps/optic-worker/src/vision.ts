import {GoogleGenerativeAI} from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export type DraftBrandContext = {
  agencyName: string;
  brandSummary: string | null;
  userDisplayName: string | null;
  campaignPaySummary: string | null;
  paySourceCampaignTitle: string | null;
};

export interface GeminiAnalysisResult {
  creatorName: string;
  niche: string;
  email?: string;
  followerCount: string;
  draftEmail?: string;
}

export async function analyzeProfileWithGemini(
  imageBase64: string,
  objectives: string = "general outreach",
  brand?: DraftBrandContext | null
): Promise<GeminiAnalysisResult> {
  const model = genAI.getGenerativeModel({model: "gemini-3-flash-preview"});

  const brandBlock = brand
    ? `
    Outreach sender context (use this for draftEmail tone and sign-off; do not invent a different company name):
    - Agency / team name: "${brand.agencyName}"
    ${brand.brandSummary ? `- Brand positioning (from their Verza brand guide): "${brand.brandSummary}"` : ""}
    ${brand.paySourceCampaignTitle ? `- Outreach is scoped to this Verza campaign name (mention once if natural): "${brand.paySourceCampaignTitle}"` : ""}
    ${
      brand.campaignPaySummary
        ? `
    Pay transparency (from their live Verza campaigns — creators often ignore outreach when budget is unclear):
    ${brand.campaignPaySummary}

    In draftEmail: if the bullet list above includes concrete USD per-creator figures, include one clear upfront sentence stating a representative rate or small range using ONLY those numbers (survey data shows creators respond more when budget is stated early). If no numeric rate appears above, say honestly that pay is defined per campaign on Verza without inventing dollar amounts. Never promise a slot, acceptance, or terms not in the list.
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

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        data: imageBase64,
        mimeType: "image/png",
      },
    },
  ]);

  const text = result.response.text().trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to extract valid JSON from Gemini response");
  }

  return JSON.parse(jsonMatch[0]) as GeminiAnalysisResult;
}
