import {googleAI} from "@genkit-ai/google-genai";
import {ai} from "../ai/genkit";
import type {OpticJobBrandContext} from "./jobs";

const MODEL = "gemini-3-flash-preview";

export type ExtensionProfileInput = {
  username: string;
  displayName?: string | null;
  bio?: string | null;
  followerCount?: string | null;
  postCount?: string | null;
  externalUrl?: string | null;
};

export type ExtensionLeadEnrichment = {
  creatorName: string;
  niche: string;
  email: string | null;
  followerCount: string;
  draftEmail: string | null;
  draftEmailSubject: string | null;
  draftDm: string | null;
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

function extractEmailFromBio(bio: string | null | undefined): string | null {
  if (!bio) return null;
  const match = bio.match(EMAIL_RE);
  return match ? match[0].toLowerCase() : null;
}

function dmStyleHint(platform: string): string {
  if (platform === "instagram") {
    return "Instagram DM: warm and concise (2–3 short sentences). No subject line. Light emoji at most one if natural.";
  }
  return "Platform DM: short, friendly, no subject line (2–3 sentences).";
}

function isCauseOrBarter(ct: string | null | undefined): boolean {
  return ct === "cause_campaign" || ct === "barter_campaign";
}

async function generateGeminiText(prompt: string, temperature = 0.5): Promise<string> {
  const {text} = await ai.generate({
    model: googleAI.model(MODEL),
    prompt,
    config: {temperature},
  });
  return text?.trim() ?? "";
}

const GENERIC_HASHTAGS = new Set([
  "creator",
  "creators",
  "influencer",
  "influencers",
  "instagram",
  "marketing",
  "business",
  "entrepreneur",
  "lifestyle",
  "fitness",
  "beauty",
  "fashion",
  "explore",
  "reels",
  "viral",
  "content",
  "socialmedia",
]);

/** Prompt block listing creators already in the vault, so later batches surface new names. */
function formatExcludeBlock(excludeUsernames: string[] | undefined): string {
  if (!excludeUsernames?.length) return "";
  const handles = excludeUsernames.map((u) => `@${u}`).join(", ");
  return `

Already saved from earlier batches of this mission — do NOT suggest these again, and prefer creators in the same niche who are not on this list:
${handles}`;
}

function formatExtensionBriefContext(
  objectives: string,
  agencyName: string,
  brand: OpticJobBrandContext | null | undefined
): string {
  const parts = [`Campaign objectives:\n${objectives.trim()}`];
  if (brand?.paySourceCampaignTitle?.trim()) {
    parts.push(`Linked Verza campaign: "${brand.paySourceCampaignTitle.trim()}"`);
  }
  if (brand?.brandSummary?.trim()) {
    parts.push(`Brand summary: ${brand.brandSummary.trim()}`);
  }
  if (brand?.campaignPaySummary?.trim()) {
    parts.push(`Compensation / offer: ${brand.campaignPaySummary.trim()}`);
  }
  if (brand?.paySourceCampaignType) {
    parts.push(`Campaign type: ${brand.paySourceCampaignType}`);
  }
  if (agencyName?.trim()) {
    parts.push(`Brand / agency: ${agencyName.trim()}`);
  }
  return parts.join("\n\n");
}

function cleanHashtag(raw: string): string | null {
  const cleaned = raw
    .replace(/#/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toLowerCase()
    .slice(0, 80);
  if (!cleaned || cleaned.length < 3) return null;
  if (GENERIC_HASHTAGS.has(cleaned)) return null;
  return cleaned;
}

function cleanSearchQuery(raw: string): string | null {
  const cleaned = raw.replace(/^["']|["']$/g, "").trim().slice(0, 120);
  return cleaned.length >= 3 ? cleaned : null;
}

export type InstagramExtensionSearchPlan = {
  summary: string;
  hashtags: string[];
  searchQueries: string[];
  seedProfiles: ExtensionSeedProfile[];
};

export type ExtensionSeedProfile = {
  username: string;
  profileUrl: string;
};

/** Plans niche Instagram discovery from the full campaign brief (not objectives alone). */
export async function planInstagramExtensionSearch(
  objectives: string,
  agencyName: string,
  brand: OpticJobBrandContext | null | undefined,
  maxProfiles: number,
  excludeUsernames?: string[],
  audienceLabel?: string | null
): Promise<InstagramExtensionSearchPlan> {
  const brief = formatExtensionBriefContext(objectives, agencyName, brand);
  const seedAsk = Math.min(48, Math.max(12, maxProfiles * 2));
  const excluded = new Set((excludeUsernames ?? []).map((u) => u.toLowerCase()));
  // Steering the seeds at plan time is far cheaper than scraping profiles the
  // audience filter will reject afterwards.
  const audienceRule = audienceLabel ?
    `\n- Only suggest creators whose follower count fits: ${audienceLabel}` :
    "";

  const prompt = `You are an expert Instagram creator scout for brand partnerships.

${brief}${formatExcludeBlock(excludeUsernames)}

Plan a discovery mission on Instagram. Be SPECIFIC to this brief — do not use generic discovery tags unless the brief is truly that broad.

Return STRICT JSON only (no markdown):
{
  "summary": "One sentence describing the ideal creator niche for this brief",
  "hashtags": ["nicheTag1", "nicheTag2", "nicheTag3"],
  "searchQueries": ["specific account search phrase", "another niche phrase"],
  "seedUsernames": [{ "username": "handle", "reason": "why they fit the brief" }]
}

Rules:
- hashtags: 2-4 tags WITHOUT # symbol, lowercase, no spaces — niche to this brief (e.g. "sourdoughbaker" not "food")
- searchQueries: 2-3 distinct 3-6 word phrases for Instagram account keyword search, tailored to the brief
- seedUsernames: up to ${seedAsk} REAL public Instagram creators who fit THIS brief (username without @)
- Prefer creators in the niche described — micro/mid creators, not mega-celebrities unless the brief asks for fame
- Avoid generic tags: creators, influencer, marketing, lifestyle, fitness, beauty unless explicitly in the brief${audienceRule}`;

  const text = await generateGeminiText(prompt, 0.35);
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  let parsed: {
    summary?: string;
    hashtags?: string[];
    searchQueries?: string[];
    seedUsernames?: Array<{username?: string; reason?: string}>;
  } = {};

  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      parsed = {};
    }
  }

  const hashtags: string[] = [];
  const hashtagSeen = new Set<string>();
  for (const raw of parsed.hashtags ?? []) {
    const tag = cleanHashtag(String(raw));
    if (!tag || hashtagSeen.has(tag)) continue;
    hashtagSeen.add(tag);
    hashtags.push(tag);
  }

  const searchQueries: string[] = [];
  const querySeen = new Set<string>();
  for (const raw of parsed.searchQueries ?? []) {
    const q = cleanSearchQuery(String(raw));
    if (!q) continue;
    const key = q.toLowerCase();
    if (querySeen.has(key)) continue;
    querySeen.add(key);
    searchQueries.push(q);
  }

  const seedProfiles: ExtensionSeedProfile[] = [];
  // Pre-seeding with already-saved handles makes the loop below skip them.
  const seedSeen = new Set<string>(excluded);
  for (const row of parsed.seedUsernames ?? []) {
    const username = String(row.username ?? "").replace(/^@/, "").trim();
    if (!username || seedSeen.has(username.toLowerCase())) continue;
    seedSeen.add(username.toLowerCase());
    seedProfiles.push({
      username,
      profileUrl: `https://www.instagram.com/${username}/`,
    });
  }

  if (hashtags.length === 0) {
    const fallback = await generateInstagramHashtagQuery(objectives, agencyName, brand);
    if (fallback) hashtags.push(fallback);
  }
  if (searchQueries.length === 0) {
    const fallback = await generateInstagramSearchQuery(objectives, agencyName, brand);
    if (fallback) searchQueries.push(fallback);
  }
  if (seedProfiles.length === 0) {
    const fallbackSeeds = await generateExtensionSeedProfiles(
      objectives,
      agencyName,
      brand,
      maxProfiles,
      excludeUsernames
    );
    seedProfiles.push(...fallbackSeeds.filter((s) => !excluded.has(s.username.toLowerCase())));
  }

  return {
    summary: parsed.summary?.trim() || "Searching Instagram for creators matching your campaign brief.",
    hashtags: hashtags.slice(0, 4),
    searchQueries: searchQueries.slice(0, 3),
    seedProfiles: seedProfiles.slice(0, seedAsk),
  };
}

export async function generateInstagramHashtagQuery(
  objectives: string,
  agencyName?: string,
  brand?: OpticJobBrandContext | null
): Promise<string> {
  const brief = formatExtensionBriefContext(objectives, agencyName ?? "", brand);
  const prompt = `You are an Instagram creator scout.

${brief}

Generate ONE niche Instagram hashtag (no # symbol, no spaces, lowercase) that would surface creators who match THIS specific brief.
Avoid generic tags like creators, influencer, marketing, lifestyle unless the brief is truly that broad.
Return only the hashtag text.`;

  const text = await generateGeminiText(prompt, 0.3);
  return cleanHashtag(text) ?? "creators";
}

export async function generateInstagramSearchQuery(
  objectives: string,
  agencyName?: string,
  brand?: OpticJobBrandContext | null
): Promise<string> {
  const brief = formatExtensionBriefContext(objectives, agencyName ?? "", brand);
  const prompt = `You are an Instagram creator scout.

${brief}

Generate a short Instagram account search phrase (3-6 words) to find creators who match THIS specific brief.
Return only the search phrase, no quotes.`;

  const text = await generateGeminiText(prompt, 0.35);
  return cleanSearchQuery(text) ?? objectives.trim().slice(0, 80);
}

export async function generateExtensionSeedProfiles(
  objectives: string,
  agencyName: string | null | undefined,
  brand: OpticJobBrandContext | null | undefined,
  maxProfiles: number,
  excludeUsernames?: string[]
): Promise<ExtensionSeedProfile[]> {
  const ask = Math.min(48, Math.max(12, maxProfiles * 2));
  const brief = formatExtensionBriefContext(objectives, agencyName ?? "", brand);

  const prompt = `You are an Instagram creator scout.

${brief}${formatExcludeBlock(excludeUsernames)}

Suggest ${ask} real Instagram creators who would be a strong fit for THIS specific brief.
Return STRICT JSON only (no markdown): an array of objects with "username" (handle without @) and "profileUrl" (full https://instagram.com/... URL).
Prefer niche creators who match the campaign — not generic influencers.`;

  const text = await generateGeminiText(prompt, 0.45);
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{username?: string; profileUrl?: string; url?: string}>;
    const out: ExtensionSeedProfile[] = [];
    const seen = new Set<string>();

    for (const row of parsed) {
      const rawUrl = (row.profileUrl || row.url || "").trim();
      const rawUser = (row.username || "").replace(/^@/, "").trim();
      let username = rawUser;
      if (!username && rawUrl) {
        const m = rawUrl.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
        username = m?.[1] ?? "";
      }
      if (!username || seen.has(username.toLowerCase())) continue;
      seen.add(username.toLowerCase());
      const profileUrl = rawUrl && rawUrl.includes("instagram.com")
        ? rawUrl.split("?")[0].replace(/\/?$/, "/")
        : `https://www.instagram.com/${username}/`;
      out.push({username, profileUrl});
    }
    return out.slice(0, ask);
  } catch {
    return [];
  }
}

// Legacy single-call helpers kept for compatibility — prefer planInstagramExtensionSearch.
export async function enrichExtensionInstagramLead(
  profile: ExtensionProfileInput,
  objectives: string,
  brand: OpticJobBrandContext | null | undefined
): Promise<ExtensionLeadEnrichment> {
  const emailFromBio = extractEmailFromBio(profile.bio);
  const creatorName = profile.displayName?.trim() || profile.username;
  const followerCount = profile.followerCount?.trim() || "Unknown";

  // Mirror optic-worker vision.ts brand + draft instructions so IG extension
  // drafts match web-worker quality (text profile instead of screenshot).
  const brandBlock = brand
    ? `
    Outreach sender context (use for draft tone and sign-off; do not invent a different company name):
    - Agency / team name: "${brand.agencyName}"
    ${brand.brandSummary ? `- Brand positioning (from their Verza brand guide): "${brand.brandSummary}"` : ""}
    ${brand.paySourceCampaignTitle ? `- Outreach is scoped to this Verza campaign name (mention once if natural): "${brand.paySourceCampaignTitle}"` : ""}
    ${
      brand.campaignPaySummary
        ? isCauseOrBarter(brand.paySourceCampaignType)
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
    Write personalized Instagram outreach for this creator based on Campaign Objectives:
    "${objectives}"
    ${brandBlock}

    Creator profile (scraped from a logged-in Instagram session — treat these fields as ground truth; do not invent contact info):
    - Username: @${profile.username}
    - Display name: ${creatorName}
    - Followers: ${followerCount}
    - Bio: ${profile.bio || "(empty)"}
    - External link: ${profile.externalUrl || "(none)"}
    - Email visible in bio: ${emailFromBio || "(none)"}
    - Posts: ${profile.postCount || "(unknown)"}

    Return strictly a JSON object with these keys:
    1. niche (string, e.g. tech, beauty, gaming)
    2. draftEmail (string or null): ONLY if email is not null — a 3-sentence email body. Use blank lines between paragraphs (\\n\\n). No markdown.
    3. draftEmailSubject (string or null): ONLY if email is not null — a short specific subject line.
    4. draftDm (string or null): REQUIRED when email is null — a ${dmStyleHint("instagram")} Personalized pitch the brand can paste into Instagram DMs. Use \\n\\n between paragraphs if more than one thought. No markdown.

    If email IS found, set draftDm to null. If email is NOT found, set draftEmail and draftEmailSubject to null and always provide draftDm.

    Personalize using the bio and display name where natural. Do not invent emails, follower counts, or facts not listed above.
    Do not include markdown outside the JSON. Use null for unknown fields.
  `;

  const text = await generateGeminiText(prompt);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let parsed: {
    niche?: string;
    draftEmail?: string | null;
    draftEmailSubject?: string | null;
    draftDm?: string | null;
  } = {};
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      parsed = {};
    }
  }

  const hasEmail = !!emailFromBio;
  return {
    creatorName,
    niche: parsed.niche?.trim() || "Creator",
    email: emailFromBio,
    followerCount,
    draftEmail: hasEmail ? parsed.draftEmail?.trim() || null : null,
    draftEmailSubject: hasEmail ? parsed.draftEmailSubject?.trim() || null : null,
    draftDm: hasEmail ? null : parsed.draftDm?.trim() || null,
  };
}
