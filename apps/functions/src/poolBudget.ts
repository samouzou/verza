/** Runtime pool-budget math. Do not import these from @verza/types — that package is TS-only.
 * Keep in sync with packages/types.
 */

export const GIG_PLATFORM_FEE_FRACTION = 0.04;

/**
 * Fee fraction stored on a campaign, or the platform default. Caps at 50%.
 * @param {object=} gig Campaign fields.
 * @return {number} Fee as a fraction of creator pay.
 */
export function gigPlatformFeeFraction(gig?: {platformFeeFraction?: number | null}): number {
  const n = Number(gig?.platformFeeFraction);
  if (Number.isFinite(n) && n >= 0 && n <= 0.5) return n;
  return GIG_PLATFORM_FEE_FRACTION;
}

/**
 * Display string such as `4%` or `15%`.
 * @param {object=} gig Campaign fields.
 * @return {string} Percent label.
 */
export function formatGigPlatformFeeLabel(gig?: {platformFeeFraction?: number | null}): string {
  const pct = Math.round(gigPlatformFeeFraction(gig) * 1000) / 10;
  return `${pct}%`;
}

export type GigBudgetMode = "flat_fee" | "pool";

export function isPoolBudgetGig(gig: {budgetMode?: GigBudgetMode | string | null}): boolean {
  return gig.budgetMode === "pool";
}

/**
 * Campaigns with no fixed creator pay and nothing funded (performance-only, barter) can add a campaign budget
 * without relaunching. Cause campaigns never pay cash.
 * @param {object} gig Campaign fields.
 * @return {boolean} Whether a first budget can be added.
 */
export function canStartCampaignBudget(gig: {
  budgetMode?: GigBudgetMode | string | null;
  campaignType?: string | null;
  ratePerCreator?: number | null;
  fundedAmount?: number | null;
}): boolean {
  if (isPoolBudgetGig(gig) || gig.campaignType === "cause_campaign") return false;
  return !(Number(gig.ratePerCreator) > 0) && !(Number(gig.fundedAmount) > 0);
}

/** Fields that turn a performance-only campaign into a campaign-budget campaign; there is no creator cap. */
export const START_CAMPAIGN_BUDGET_FIELDS = {budgetMode: "pool", ratePerCreator: 0, creatorsNeeded: 0} as const;

export function gigHasCreatorCap(gig: {
  budgetMode?: GigBudgetMode | string | null;
  campaignType?: string | null;
  creatorsNeeded?: number | null;
}): boolean {
  if (gig.campaignType === "cause_campaign") return false;
  if (isPoolBudgetGig(gig)) return false;
  return Math.floor(Number(gig.creatorsNeeded) || 0) > 0;
}

export function dollarsToCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

export type PoolDraw = {
  creatorAmountCents: number;
  platformFeeCents: number;
  totalDrawCents: number;
};

export function poolDrawForCreatorAmount(
  creatorAmountUsd: number,
  feeFraction: number = GIG_PLATFORM_FEE_FRACTION
): PoolDraw {
  const fraction = Number.isFinite(feeFraction) && feeFraction >= 0 && feeFraction <= 0.5 ?
    feeFraction :
    GIG_PLATFORM_FEE_FRACTION;
  const creatorAmountCents = dollarsToCents(creatorAmountUsd);
  const platformFeeCents = Math.round(creatorAmountCents * fraction);
  return {
    creatorAmountCents,
    platformFeeCents,
    totalDrawCents: creatorAmountCents + platformFeeCents,
  };
}

export function poolRemainingCents(gig: {fundedAmount?: number | null; budgetSpent?: number | null}): number {
  const locked = dollarsToCents(Number(gig.fundedAmount) || 0);
  const spent = dollarsToCents(Number(gig.budgetSpent) || 0);
  return Math.max(0, locked - spent);
}

export function maxCreatorPayoutCents(
  remainingCents: number,
  feeFraction: number = GIG_PLATFORM_FEE_FRACTION
): number {
  if (remainingCents <= 0) return 0;
  const fraction = Number.isFinite(feeFraction) && feeFraction >= 0 && feeFraction <= 0.5 ?
    feeFraction :
    GIG_PLATFORM_FEE_FRACTION;
  let guess = Math.floor(remainingCents / (1 + fraction));
  while (guess > 0 && guess + Math.round(guess * fraction) > remainingCents) {
    guess -= 1;
  }
  while (guess + 1 + Math.round((guess + 1) * fraction) <= remainingCents) {
    guess += 1;
  }
  return guess;
}
