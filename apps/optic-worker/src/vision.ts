import {GoogleGenerativeAI} from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export type DraftBrandContext = {
  agencyName: string;
  brandSummary: string | null;
  userDisplayName: string | null;
  campaignPaySummary: string | null;
  paySourceCampaignTitle: string | null;
  /** From selected gig when mission is scoped to one campaign (e.g. cause_campaign). */
  paySourceCampaignType?: string | null;
};

export interface GeminiAnalysisResult {
  creatorName: string;
  niche: string;
  email?: string | null;
  followerCount: string;
  draftEmail?: string | null;
  draftEmailSubject?: string | null;
  draftDm?: string | null;
}

function isCauseOrBarterCampaignType(ct: string | null | undefined): boolean {
  return ct === "cause_campaign" || ct === "barter_campaign";
}

function dmStyleHint(platform: string): string {
  const hints: Record<string, string> = {
    instagram:
      "Instagram DM: warm and concise (2–3 short sentences). No subject line. Light emoji at most one if natural.",
    tiktok:
      "TikTok DM: very short and casual (1–2 sentences). No subject line. Gen-Z friendly but professional.",
    youtube:
      "YouTube DM: friendly and clear (2–3 sentences). No subject line. Slightly more polished than IG.",
    facebook:
      "Facebook Page message: approachable (2–3 sentences). No subject line.",
    twitch:
      "Twitch DM: casual streamer-to-brand tone (2–3 sentences). No subject line.",
  };
  return hints[platform] ?? "Platform DM: short, friendly, no subject line (2–3 sentences).";
}

export async function analyzeProfileWithGemini(
  imageBase64: string,
  objectives: string = "general outreach",
  brand?: DraftBrandContext | null,
  platform: string = "youtube"
): Promise<GeminiAnalysisResult> {
  const model = genAI.getGenerativeModel({model: "gemini-3.6-flash"});
  const platLabel = platform.charAt(0).toUpperCase() + platform.slice(1);

  const brandBlock = brand
    ? `
    Outreach sender context (use for draft tone and sign-off; do not invent a different company name):
    - Agency / team name: "${brand.agencyName}"
    ${brand.brandSummary ? `- Brand positioning (from their Verza brand guide): "${brand.brandSummary}"` : ""}
    ${brand.paySourceCampaignTitle ? `- Outreach is scoped to this Verza campaign name (mention once if natural): "${brand.paySourceCampaignTitle}"` : ""}
    ${
      brand.campaignPaySummary
        ? isCauseOrBarterCampaignType(brand.paySourceCampaignType)
          ? `
    Campaign partnership context (this outreach is for a cause or in-kind style campaign — do not imply a cash sponsorship unless the facts below include an explicit USD per-creator amount):
    ${brand.campaignPaySummary}

    In drafts: Do not use the words "compensation", "fee", "rate", "paid", or "dollars" in a way that suggests cash payment unless a concrete USD per-creator figure appears in the facts above. Frame the opportunity around mission alignment${
            brand.paySourceCampaignType === "barter_campaign" ? " or a mutually agreed product/exchange" : ""
          }. You may invite them to review details on Verza; do not suggest they will receive a cash payout unless the facts state it clearly.
    `
          : `
    Pay transparency (from their live Verza campaigns — creators often ignore outreach when budget is unclear):
    ${brand.campaignPaySummary}

    In drafts: if the bullet list above includes concrete USD per-creator figures, include one clear upfront sentence stating a representative rate or small range using ONLY those numbers. If no numeric rate appears above, say honestly that pay is defined per campaign on Verza without inventing dollar amounts. Never promise a slot, acceptance, or terms not in the list. If any line describes a cause or in-kind barter with no USD figure, do not imply cash compensation for that campaign.
    `
        : ""
    }

    Drafts must read as a short personal note from someone at "${brand.agencyName}" partnering via Verza — mention the agency name once where natural, align with Campaign Objectives, and invite the creator to learn more.
    `
    : `
    Drafts invite the creator to explore the Verza network, aligned with Campaign Objectives.
    `;

  const prompt = `
    You are an elite marketing agent powering Verza Optic.
    Analyze this screenshot of a creator's ${platLabel} profile based on Campaign Objectives:
    "${objectives}"
    ${brandBlock}

    Return strictly a JSON object with these keys:
    1. creatorName (string)
    2. niche (string, e.g. tech, beauty, gaming)
    3. email (string if visible in bio, else null)
    4. followerCount (string estimate from visible numbers)

    5. draftEmail (string or null): ONLY if email is not null — a 3-sentence email body. Use blank lines between paragraphs (\\n\\n). No markdown.
    6. draftEmailSubject (string or null): ONLY if email is not null — a short specific subject line.
    7. draftDm (string or null): REQUIRED when email is null — a ${dmStyleHint(platform)} Personalized pitch the brand can paste into ${platLabel} DMs. Use \\n\\n between paragraphs if more than one thought. No markdown.

    If email IS found, set draftDm to null. If email is NOT found, set draftEmail and draftEmailSubject to null and always provide draftDm.

    Do not include markdown outside the JSON. Use null for unknown fields.
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

  const parsed = JSON.parse(jsonMatch[0]) as GeminiAnalysisResult;
  const hasEmail = typeof parsed.email === "string" && parsed.email.trim().length > 0;

  if (hasEmail) {
    parsed.draftDm = null;
  } else {
    parsed.email = null;
    parsed.draftEmail = null;
    parsed.draftEmailSubject = null;
  }

  return parsed;
}
