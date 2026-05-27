import type { Gig } from "@/types";

export type CampaignType = Gig["campaignType"];

export function isCauseCampaignType(
  campaignType: CampaignType | string | undefined | null,
): boolean {
  return campaignType === "cause_campaign";
}

export function isBarterCampaignType(
  campaignType: CampaignType | string | undefined | null,
): boolean {
  return campaignType === "barter_campaign";
}

/** Types where neither fixed base nor performance rewards are required to publish. */
export function allowsNoPlatformCashCompensation(
  campaignType: CampaignType | string | undefined | null,
): boolean {
  return isCauseCampaignType(campaignType) || isBarterCampaignType(campaignType);
}
