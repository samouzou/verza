import {HttpsError, onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {googleAI} from "@genkit-ai/google-genai";
import {ai} from "../ai/genkit";
import {db} from "../config/firebase";

const MODEL = "gemini-3.6-flash";
const TEAM_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);

const ALLOWED_TYPES = new Set([
  "standard_sponsorship",
  "production_grant",
  "cause_campaign",
  "barter_campaign",
]);

/**
 * Strips obvious script injection; brief is trusted to brand team only.
 * @param {string} html Raw HTML from the model.
 * @return {string} Safer HTML fragment.
 */
function sanitizeBriefHtml(html: string): string {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<\/?(iframe|object|embed|form|input|button|meta|link)\b[^>]*>/gi, "");
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  return s.trim().slice(0, 80000);
}

/**
 * Loads agency display name and short brand hint for prompts.
 * @param {string} agencyId Agency id.
 * @return {Promise<{name: string; brandHint: string | null}>} Context.
 */
async function loadAgencySnippet(agencyId: string): Promise<{name: string; brandHint: string | null}> {
  const snap = await db.collection("agencies").doc(agencyId).get();
  if (!snap.exists) {
    return {name: "Your brand", brandHint: null};
  }
  const ag = snap.data()!;
  const name = typeof ag.name === "string" && ag.name.trim() ? ag.name.trim() : "Your brand";
  const brandGuide = ag.brandGuide as {missionStatement?: string} | undefined;
  const mission =
    typeof brandGuide?.missionStatement === "string" ? brandGuide.missionStatement.trim() : "";
  const brandHint = mission ? mission.slice(0, 400) : null;
  return {name, brandHint};
}

/**
 * Callable: AI-generated campaign title + HTML brief for the campaign composer.
 */
export const generateCampaignCopy = onCall(
  {timeoutSeconds: 90, memory: "512MiB"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to generate campaign copy.");
    }
    const uid = request.auth.uid;

    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) {
      throw new HttpsError("failed-precondition", "User profile not found.");
    }
    const user = userSnap.data()!;
    const role = String(user.role ?? "");
    if (!TEAM_ROLES.has(role)) {
      throw new HttpsError(
        "permission-denied",
        "Only brand team members can generate campaign copy."
      );
    }
    const agencyId = user.primaryAgencyId as string | undefined;
    if (!agencyId) {
      throw new HttpsError("failed-precondition", "Set a primary agency before creating campaigns.");
    }

    const data = request.data as {
      campaignType?: unknown;
      userPrompt?: unknown;
      platforms?: unknown;
      ratePerCreator?: unknown;
      creatorsNeeded?: unknown;
      videosPerCreator?: unknown;
      affiliateEnabled?: unknown;
    };

    const campaignType = typeof data.campaignType === "string" ? data.campaignType.trim() : "";
    if (!ALLOWED_TYPES.has(campaignType)) {
      throw new HttpsError("invalid-argument", "Invalid campaign type.");
    }

    const userPrompt =
      typeof data.userPrompt === "string" ? data.userPrompt.trim().slice(0, 4000) : "";
    if (!userPrompt) {
      throw new HttpsError("invalid-argument", "Describe what you want the campaign to cover.");
    }

    const platforms = Array.isArray(data.platforms)
      ? (data.platforms as unknown[])
          .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
          .map((p) => p.trim().slice(0, 40))
          .slice(0, 12)
      : [];

    const rate =
      typeof data.ratePerCreator === "number" && Number.isFinite(data.ratePerCreator) ?
        data.ratePerCreator :
        null;
    const creators =
      typeof data.creatorsNeeded === "number" && Number.isFinite(data.creatorsNeeded) ?
        Math.floor(data.creatorsNeeded) :
        null;
    const videos =
      typeof data.videosPerCreator === "number" && Number.isFinite(data.videosPerCreator) ?
        Math.floor(data.videosPerCreator) :
        null;
    const affiliateOn = data.affiliateEnabled === true;

    const {name: agencyName, brandHint} = await loadAgencySnippet(agencyId);

    const typeGuide: Record<string, string> = {
      standard_sponsorship: `Standard paid sponsorship / UGC on Verza.
- Tone: clear, professional, creator-friendly.
- Include: deliverable summary, key talking points, disclosure expectations (#ad), and what success looks like.
- If a base rate is provided in context, you may reference it once as guidance for creators (do not invent a different dollar amount).
- Do not promise guaranteed results, virality, or exclusivity you cannot verify.`,
      production_grant: `Production grant / editorial funding (no traditional ad-read requirement).
- Tone: respectful of creator editorial independence.
- Include: what the grant supports, expected credit/attribution, creative boundaries, and timeline hints.
- Do not frame this as a hard-sell ad script unless the user explicitly asked for that.`,
      cause_campaign: `Cause / mission campaign on Verza (nonprofit & impact).
- Tone: inspiring, authentic, inclusive — anyone can join; slots are effectively unlimited.
- Emphasize the mission, who benefits, and simple ways creators can participate.
- CRITICAL: Do not imply per-creator cash payment, fees, or "compensation" unless the user prompt explicitly states a dollar amount for creators. Do not invent sponsorship dollars.
- Avoid language that sounds like a paid brand deal unless the user clearly described payment.`,
      barter_campaign: `Barter / in-kind campaign on Verza.
- Tone: transparent about what creators receive (product, access, trade) and what you need in return.
- Include: what is offered in-kind, shipping/logistics notes if relevant, deliverable expectations.
- CRITICAL: If no cash base rate is provided in context, do not invent USD amounts. Performance bonuses may be mentioned only if the user prompt or context clearly describes them.`,
    };

    const contextLines = [
      `Brand name: ${agencyName}`,
      brandHint ? `Brand positioning (from Verza): ${brandHint}` : null,
      platforms.length ? `Target platforms: ${platforms.join(", ")}` : null,
      rate !== null && rate > 0 ? `Listed base rate (USD per creator, from form): $${rate.toLocaleString("en-US")}` : null,
      creators !== null && creators > 0 ? `Creators needed (from form): ${creators}` : null,
      campaignType === "cause_campaign" ? "Cause campaigns: creators needed is unlimited on Verza — do not invent a cap." : null,
      videos !== null && videos > 0 ? `Videos per creator (from form): ${videos}` : null,
      affiliateOn ? "Performance / affiliate layer is enabled — mention tracking only if the user prompt includes enough detail." : null,
    ]
      .filter(Boolean)
      .join("\n");

    const system = `You are a senior campaign strategist for Verza (tryverza.com), the operating system for the creator economy.
You write concise campaign titles and rich-text HTML briefs for brands recruiting creators.

RULES:
- Output must be valid JSON only (no markdown fences), with exactly two keys: "title" and "descriptionHtml".
- "title": max 120 characters, specific and scannable (no ALL CAPS).
- "descriptionHtml": HTML fragment only, suitable for ReactQuill. Use only these tags: p, br, strong, em, ul, ol, li. No images, no links unless essential (use plain text for URLs if needed).
- 3–6 short paragraphs or bullet lists; keep total under 2500 characters of HTML.
- Never invent legal terms, guaranteed reach, or payment terms not implied by the user or context.
- Stay within the campaign type voice below.

CAMPAIGN TYPE: ${campaignType}
${typeGuide[campaignType] ?? typeGuide.standard_sponsorship}

CONTEXT FROM BRAND (may be incomplete):
${contextLines}

USER BRIEF (primary source of truth):
---
${userPrompt}
---
`;

    const directive = `Generate the JSON now.`;

    try {
      const {text} = await ai.generate({
        model: googleAI.model(MODEL),
        prompt: `${system}\n\n${directive}`,
        config: {temperature: 0.65},
      });

      const raw = text?.trim() ?? "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new HttpsError("internal", "Model returned no JSON.");
      }
      const parsed = JSON.parse(jsonMatch[0]) as {title?: unknown; descriptionHtml?: unknown};
      const title =
        typeof parsed.title === "string" ? parsed.title.trim().slice(0, 200) : "";
      const descriptionHtml =
        typeof parsed.descriptionHtml === "string" ? sanitizeBriefHtml(parsed.descriptionHtml) : "";
      if (!title || !descriptionHtml) {
        throw new HttpsError("internal", "Model returned an empty title or brief.");
      }

      logger.info("[gigs] generateCampaignCopy ok", {uid, agencyId, campaignType});
      return {title, descriptionHtml};
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("[gigs] generateCampaignCopy failed", {uid, error: msg});
      throw new HttpsError("internal", "Could not generate campaign copy. Try again in a moment.");
    }
  }
);
