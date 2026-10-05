import type {VerzaActor} from "../context.js";
import type {VerzaCallableClient} from "./callable.js";

export type RoasPipelineBucket = "booked" | "negotiating" | "replied" | "contacted" | "new" | "excluded";
/** `estimated`: typical quote for similar-size creators (budget campaigns only). */
export type RoasSpendBasis = "quoted" | "flat_fee" | "estimated" | "performance";

export type RoasScenario = {
  roas: number | null;
  spendUsd: number;
  revenueUsd: number;
  views: number;
  conversions: number;
  creators: number;
  breakEvenConversionRate: number | null;
};

/** Result of the `refreshOpticCampaignRoasInsight` callable (same model as the vault card). */
export type RoasPrediction = {
  campaignId: string;
  savedToVault: boolean;
  /** Full-target scenario, kept at the top level for older readers. */
  predictedRoas: number | null;
  spendUsd: number;
  expectedRevenueUsd: number;
  expectedViews: number;
  expectedConversions: number;
  hireCount: number;
  confidence: "low" | "medium";
  vaultLeadsUsed: number;
  inputs: {
    averageOrderValueUsd: number;
    conversionRate: number;
    viewRate: number;
    engagementRate: number | null;
  };
  scenarios: {committed: RoasScenario; likely: RoasScenario; target: RoasScenario};
  pipeline: Record<RoasPipelineBucket, number>;
  spendBasis: Record<RoasSpendBasis, number>;
  /** Creators left out because nothing tells us what they cost. */
  unpriced: number;
  /** Target slots without a priced creator. */
  targetShortfall: number;
  /** Untouched creators left out for no public email or a match score under 70. */
  notQualified: number;
  /** Typical quote per follower band; null median when a band has fewer than 3 quotes. */
  typicalQuotes: Array<{band: string; label: string; medianUsd: number | null; quotes: number}>;
  /** Campaign reward per conversion included in spend (0 if none). */
  costPerConversionUsd: number;
  /** Budget campaigns: priced creators who don't fit in the budget. */
  overBudget: number;
  /** Budget campaigns: all-in campaign budget; null for per-creator campaigns. */
  campaignBudgetUsd: number | null;
  /** Fixed creator costs (incl. Verza's fee on budget campaigns) the full target uses. */
  budgetFixedSpendUsd: number;
  quotesUsed: number;
  medianQuoteUsd: number | null;
  creatorsPreview: Array<{
    name: string | null;
    followers: number;
    matchScore: number | null;
    stage: RoasPipelineBucket | null;
    spendUsd: number;
    spendBasis: RoasSpendBasis;
  }>;
  caveats: string[];
};

export type RoasPredictInput = {
  campaignId: string;
  averageOrderValueUsd: number;
  conversionRate: number;
  viewRate: number;
  hireCount?: number;
  minMatchScore?: number | null;
  /** Save on the campaign for the vault card (default true). */
  persist?: boolean;
};

/**
 * Runs the stage-aware ROAS model in Cloud Functions as the signed-in brand user.
 * @param {VerzaCallableClient} client Callable client.
 * @param {VerzaActor} actor Brand user.
 * @param {RoasPredictInput} input Assumptions.
 * @return {Promise<RoasPrediction>} Scenarios and breakdowns.
 */
export async function predictCampaignRoas(
  client: VerzaCallableClient,
  actor: VerzaActor,
  input: RoasPredictInput
): Promise<RoasPrediction> {
  const res = await client.call<{campaignId: string; savedToVault?: boolean; insight: Omit<RoasPrediction, "campaignId" | "savedToVault">}>(
    actor.uid,
    "refreshOpticCampaignRoasInsight",
    {
      campaignId: input.campaignId,
      averageOrderValueUsd: input.averageOrderValueUsd,
      conversionRate: input.conversionRate,
      viewRate: input.viewRate,
      hireCount: input.hireCount,
      minMatchScore: input.minMatchScore ?? undefined,
      persist: input.persist !== false,
      source: "mcp",
    }
  );
  const {updatedAt: _updatedAt, budget: _budget, source: _source, usedProxies: _usedProxies, ...insight} =
    res.insight as RoasPrediction & {updatedAt?: unknown; budget?: unknown; source?: unknown; usedProxies?: unknown};
  return {...insight, campaignId: res.campaignId, savedToVault: res.savedToVault !== false};
}

function roasText(roas: number | null): string {
  return roas == null ? "—" : `${roas.toFixed(2)}x`;
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", {maximumFractionDigits: 0})}`;
}

/**
 * One-paragraph explanation an agent can relay as-is.
 * @param {RoasPrediction} p Prediction.
 * @return {string} Summary.
 */
export function summarizeRoasPrediction(p: RoasPrediction): string {
  const {committed, likely, target} = p.scenarios;
  const parts = [
    `Committed (booked creators only): ${roasText(committed.roas)} on ${money(committed.spendUsd)}.`,
    `Likely (pipeline weighted by odds of booking, ~${likely.creators} creators): ${roasText(likely.roas)} on ${money(likely.spendUsd)}.`,
    p.campaignBudgetUsd ?
      `Full target (${target.creators} creators that fit the ${money(p.campaignBudgetUsd)} budget): ` +
        `${roasText(target.roas)} on ${money(target.spendUsd)}.` :
      `Full target (${target.creators} creators): ${roasText(target.roas)} on ${money(target.spendUsd)}.`,
  ];
  if (p.overBudget > 0) parts.push(`${p.overBudget} more priced creators don't fit the budget.`);
  const breakEven = (likely.spendUsd > 0 ? likely : target).breakEvenConversionRate;
  if (p.costPerConversionUsd > 0 && p.costPerConversionUsd >= p.inputs.averageOrderValueUsd) {
    parts.push(`Can't break even: the $${p.costPerConversionUsd} per-conversion reward is at or above order value.`);
  } else if (breakEven === 0) {
    parts.push("Profitable at any conversion rate, since these creators are paid only per conversion.");
  } else if (breakEven != null) {
    parts.push(
      `Break-even at ${(breakEven * 100).toFixed(2)}% conversion (modeling ${(p.inputs.conversionRate * 100).toFixed(2)}%).`
    );
  }
  if (p.costPerConversionUsd > 0) {
    parts.push(`Spend includes the $${p.costPerConversionUsd} per-conversion reward on top of any fixed fees.`);
  }
  if (p.spendBasis.estimated > 0) {
    const bands = p.typicalQuotes.filter((t) => t.medianUsd != null).map((t) => `${money(t.medianUsd as number)} ${t.label}`);
    parts.push(
      `${p.spendBasis.estimated} creator costs are estimated from ${p.quotesUsed} quotes` +
        (bands.length ? ` (typical: ${bands.join(", ")}).` : ".")
    );
  }
  if (p.notQualified > 0) {
    parts.push(`${p.notQualified} untouched creators without a public email or under a 70 match score are left out.`);
  }
  if (p.unpriced > 0) {
    parts.push(`${p.unpriced} creators with no known rate are left out.`);
  }
  if (p.pipeline.excluded > 0) {
    parts.push(`${p.pipeline.excluded} creators who passed, declined, or went quiet are left out.`);
  }
  return parts.join(" ");
}
