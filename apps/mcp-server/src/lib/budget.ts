import {numOrZero} from "../context.js";

/** Gig payout fee retained by Verza (from payoutCreatorForGig). */
export const GIG_PLATFORM_FEE_FRACTION = 0.15;

export type GigBudgetInput = {
  id: string;
  title: string;
  status: string;
  campaignType: string;
  ratePerCreator: number;
  creatorsNeeded: number;
  videosPerCreator: number;
  fundedAmount?: number;
  acceptedCreatorIds?: string[];
  paidCreatorIds?: string[];
  platforms?: string[];
  affiliateSettings?: {
    isEnabled?: boolean;
    rewardType?: "cpc" | "cpa" | string;
    rewardAmount?: number;
  } | null;
};

export type BudgetEstimate = {
  campaignId: string;
  title: string;
  status: string;
  campaignType: string;
  ratePerCreator: number;
  creatorsNeeded: number;
  videosPerCreator: number;
  /** Brand cash outlay to fund creator base pay (rate × creators). */
  creatorCompensationUsd: number;
  /** Illustrative 15% platform fee on creator payouts (taken at payout). */
  estimatedPlatformFeeUsd: number;
  /** Net to creators after platform fee. */
  estimatedCreatorNetUsd: number;
  fundedAmountUsd: number;
  remainingSlots: number;
  remainingBudgetUsd: number;
  affiliate: {
    enabled: boolean;
    rewardType: string | null;
    rewardAmountUsd: number | null;
    note: string;
  };
  assumptions: string[];
};

export function estimateCampaignBudget(gig: GigBudgetInput): BudgetEstimate {
  const rate = numOrZero(gig.ratePerCreator);
  const needed = Math.max(0, Math.floor(numOrZero(gig.creatorsNeeded)));
  const videos = Math.max(0, Math.floor(numOrZero(gig.videosPerCreator)));
  const creatorCompensationUsd = rate * needed;
  const estimatedPlatformFeeUsd = Math.round(creatorCompensationUsd * GIG_PLATFORM_FEE_FRACTION * 100) / 100;
  const estimatedCreatorNetUsd =
    Math.round((creatorCompensationUsd - estimatedPlatformFeeUsd) * 100) / 100;
  const fundedAmountUsd = numOrZero(gig.fundedAmount);
  const accepted = Array.isArray(gig.acceptedCreatorIds) ? gig.acceptedCreatorIds.length : 0;
  const remainingSlots = Math.max(0, needed - accepted);
  const remainingBudgetUsd = Math.round(rate * remainingSlots * 100) / 100;

  const aff = gig.affiliateSettings;
  const affiliateEnabled = Boolean(aff?.isEnabled);
  const rewardType = affiliateEnabled && aff?.rewardType ? String(aff.rewardType) : null;
  const rewardAmount =
    affiliateEnabled && aff?.rewardAmount != null ? numOrZero(aff.rewardAmount) : null;

  return {
    campaignId: gig.id,
    title: gig.title,
    status: gig.status,
    campaignType: gig.campaignType,
    ratePerCreator: rate,
    creatorsNeeded: needed,
    videosPerCreator: videos,
    creatorCompensationUsd,
    estimatedPlatformFeeUsd,
    estimatedCreatorNetUsd,
    fundedAmountUsd,
    remainingSlots,
    remainingBudgetUsd,
    affiliate: {
      enabled: affiliateEnabled,
      rewardType,
      rewardAmountUsd: rewardAmount,
      note: affiliateEnabled
        ? "Performance rewards are additive to base pay and depend on tracked clicks/conversions."
        : "No affiliate CPC/CPA layer enabled on this campaign.",
    },
    assumptions: [
      "Creator compensation = ratePerCreator × creatorsNeeded (same as Verza gig funding checkout).",
      `Platform fee modeled at ${GIG_PLATFORM_FEE_FRACTION * 100}% of creator payout (taken at payout, not an extra brand charge at funding).`,
      "Cause/barter campaigns may show $0 cash rate — treat ROAS separately.",
    ],
  };
}
