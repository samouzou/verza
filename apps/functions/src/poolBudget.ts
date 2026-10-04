/** Runtime pool-budget math. Do not import these from @verza/types — that package is TS-only. Keep in sync with packages/types. */

export const GIG_PLATFORM_FEE_FRACTION = 0.15;

export type GigBudgetMode = "flat_fee" | "pool";

export function isPoolBudgetGig(gig: {budgetMode?: GigBudgetMode | string | null}): boolean {
  return gig.budgetMode === "pool";
}

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

export function poolDrawForCreatorAmount(creatorAmountUsd: number): PoolDraw {
  const creatorAmountCents = dollarsToCents(creatorAmountUsd);
  const platformFeeCents = Math.round(creatorAmountCents * GIG_PLATFORM_FEE_FRACTION);
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

export function maxCreatorPayoutCents(remainingCents: number): number {
  if (remainingCents <= 0) return 0;
  let guess = Math.floor(remainingCents / (1 + GIG_PLATFORM_FEE_FRACTION));
  while (guess > 0 && guess + Math.round(guess * GIG_PLATFORM_FEE_FRACTION) > remainingCents) {
    guess -= 1;
  }
  while (guess + 1 + Math.round((guess + 1) * GIG_PLATFORM_FEE_FRACTION) <= remainingCents) {
    guess += 1;
  }
  return guess;
}
