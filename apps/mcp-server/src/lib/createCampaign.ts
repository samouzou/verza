import type {VerzaActor} from "../context.js";
import type {VerzaCallableClient} from "./callable.js";
import type {CampaignDraft, CampaignType} from "./draft.js";
import {estimateCampaignBudget} from "./budget.js";

export type CreateCampaignInput = {
  title: string;
  description: string;
  platforms: string[];
  campaignType: CampaignType;
  ratePerCreator: number;
  creatorsNeeded: number;
  videosPerCreator: number;
  usageRights?: CampaignDraft["usageRights"];
  allowWhitelisting?: boolean;
  requireVerzaScore?: boolean;
  verzaScoreThreshold?: number;
  deliverablesDueDate?: string | null;
  affiliateSettings?: {
    isEnabled: boolean;
    rewardType?: "cpc" | "cpa";
    rewardAmount?: number;
    destinationUrl?: string;
    trackingMethod?: "link_only" | "promo_code_only" | "both";
    promoCodeDiscountValue?: string;
    promoCodeSuffix?: string;
  } | null;
  /** When set, enable a simple affiliate CPC layer pointing at this URL. */
  enableAffiliateFromUrl?: string | null;
};

/**
 * Creates a Verza campaign via existing callables.
 * Paid campaigns return a Stripe checkout URL; $0 / cause / barter go live immediately.
 */
export async function createCampaignViaCallables(
  client: VerzaCallableClient,
  actor: VerzaActor,
  input: CreateCampaignInput,
  appBaseUrl: string
): Promise<{
  mode: "funded_checkout" | "live";
  gigId: string | null;
  checkoutUrl: string | null;
  fundingUrl: string | null;
  campaignUrl: string | null;
  budgetPreview: ReturnType<typeof estimateCampaignBudget> | null;
  message: string;
}> {
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title || !description) {
    throw new Error("title and description are required");
  }
  if (!Array.isArray(input.platforms) || input.platforms.length === 0) {
    throw new Error("At least one platform is required");
  }

  const creatorsNeeded =
    input.campaignType === "cause_campaign"
      ? 0
      : Math.max(1, Math.floor(input.creatorsNeeded));
  const videosPerCreator = Math.max(1, Math.floor(input.videosPerCreator || 1));
  const ratePerCreator = Math.max(0, input.ratePerCreator);
  const totalAmount = ratePerCreator * (input.campaignType === "cause_campaign" ? 0 : creatorsNeeded);

  let affiliateSettings = input.affiliateSettings ?? {isEnabled: false as const};
  if (input.enableAffiliateFromUrl?.trim()) {
    affiliateSettings = {
      isEnabled: true,
      rewardType: "cpc",
      rewardAmount: 1,
      destinationUrl: input.enableAffiliateFromUrl.trim(),
      trackingMethod: "link_only",
    };
  }

  const basePayload = {
    title,
    description,
    platforms: input.platforms,
    creatorsNeeded,
    videosPerCreator,
    campaignType: input.campaignType,
    usageRights: input.usageRights ?? "30_days",
    allowWhitelisting: Boolean(input.allowWhitelisting),
    requireVerzaScore: input.requireVerzaScore !== false,
    verzaScoreThreshold: input.verzaScoreThreshold ?? 65,
    ...(input.deliverablesDueDate ? {deliverablesDueDate: input.deliverablesDueDate} : {}),
    affiliateSettings,
  };

  const app = appBaseUrl.replace(/\/$/, "");

  // Same gate as the web composer: $0 total → launchFreeCampaign (live immediately).
  if (totalAmount === 0) {
    const result = await client.call<{gigId?: string}>(actor.uid, "launchFreeCampaign", basePayload);
    const gigId = result?.gigId ?? null;
    if (!gigId) throw new Error("Campaign was created, but we couldn’t get its link back. Try refreshing campaigns.");
    return {
      mode: "live" as const,
      gigId,
      checkoutUrl: null,
      fundingUrl: null,
      campaignUrl: `${app}/campaigns/${gigId}`,
      budgetPreview: null,
      message:
        "Your campaign is live. Next, review the launch report (budget and predicted return), then start finding creators.",
    };
  }

  const result = await client.call<{url?: string; gigId?: string}>(
    actor.uid,
    "createGigFundingCheckoutSession",
    {
      ...basePayload,
      ratePerCreator,
    }
  );
  const checkoutUrl = result?.url ?? null;
  const gigId = result?.gigId ?? null;
  if (!checkoutUrl) {
    throw new Error("Checkout session did not return a URL.");
  }
  if (!gigId) {
    throw new Error("Campaign was created, but we couldn’t get its link back. Try refreshing campaigns.");
  }

  // Prefer Verza-hosted funding link: Stripe URLs include a # fragment that chat
  // clients often strip ("This link is incomplete").
  const fundingUrl = `${app}/campaigns/${gigId}/fund`;

  const budgetPreview = estimateCampaignBudget({
    id: gigId,
    title,
    status: "pending_payment",
    campaignType: input.campaignType,
    ratePerCreator,
    creatorsNeeded,
    videosPerCreator,
    fundedAmount: 0,
    platforms: input.platforms,
    affiliateSettings,
  });

  return {
    mode: "funded_checkout" as const,
    gigId,
    /** @deprecated Prefer fundingUrl — raw Stripe links break when chat truncates the # fragment. */
    checkoutUrl,
    fundingUrl,
    campaignUrl: `${app}/campaigns/${gigId}`,
    budgetPreview,
    message:
      "Open fundingUrl (Verza) to pay — you’ll be signed in and sent to Stripe. Don’t share or shorten the raw Stripe checkout link.",
  };
}
