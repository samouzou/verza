import { isPoolBudgetGig, type Gig } from "@/types";
import { isBarterCampaignType, isCauseCampaignType } from "@/lib/campaign-type";

type GigStatusFields = Pick<
  Gig,
  | "status"
  | "campaignType"
  | "budgetMode"
  | "ratePerCreator"
  | "fundedAmount"
  | "campaignBudget"
  | "affiliateSettings"
>;

/** Locked cash on this campaign: a pool budget, a funded amount, or a flat creator rate. */
export function gigHasCashBudget(gig: Pick<GigStatusFields, "budgetMode" | "ratePerCreator" | "fundedAmount" | "campaignBudget">): boolean {
  if (Number(gig.fundedAmount) > 0) return true;
  if (Number(gig.ratePerCreator) > 0) return true;
  return isPoolBudgetGig(gig) && Number(gig.campaignBudget) > 0;
}

/**
 * Status badge copy. Open campaigns with a locked budget are "Budget funded"
 * (replacing "Capital Available"). Unfunded performance campaigns stay "Performance Only".
 */
export function gigStatusBadgeLabel(
  gig: GigStatusFields | null | undefined,
  status?: string,
  completeNoun: "Campaign" | "Deployment" = "Campaign"
): string {
  const s = status ?? gig?.status ?? "";
  if (s === "budget_exhausted") return "Budget used";
  if (s === "pending_payment") return "Funding Pending";
  if (s === "in-progress") return "In Progress";
  if (s === "completed") return `${completeNoun} Complete`;
  if (s !== "open") return s.replace(/_/g, " ") || "unknown";

  if (isCauseCampaignType(gig?.campaignType)) return "Open for Creators";

  const hasPerf =
    gig?.affiliateSettings?.isEnabled && (gig?.affiliateSettings?.rewardAmount || 0) > 0;
  if (
    isBarterCampaignType(gig?.campaignType) &&
    (gig?.ratePerCreator || 0) <= 0 &&
    !hasPerf &&
    !gigHasCashBudget(gig || {})
  ) {
    return "Barter · In-Kind";
  }

  return gigHasCashBudget(gig || {}) ? "Budget funded" : "Performance Only";
}
