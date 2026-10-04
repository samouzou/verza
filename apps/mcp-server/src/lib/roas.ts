import type {VerzaActor} from "../context.js";
import type {VerzaCallableClient} from "./callable.js";

export type RoasPipelineBucket = "booked" | "negotiating" | "replied" | "contacted" | "new" | "excluded";
export type RoasSpendBasis = "quoted" | "flat_fee" | "estimated" | "unknown";

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
  usedProxies: boolean;
  inputs: {
    averageOrderValueUsd: number;
    conversionRate: number;
    viewRate: number;
    engagementRate: number | null;
  };
  scenarios: {committed: RoasScenario; likely: RoasScenario; target: RoasScenario};
  pipeline: Record<RoasPipelineBucket, number>;
  spendBasis: Record<RoasSpendBasis, number>;
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
  const {updatedAt: _updatedAt, budget: _budget, source: _source, ...insight} =
    res.insight as RoasPrediction & {updatedAt?: unknown; budget?: unknown; source?: unknown};
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
    `Full target (${target.creators} creators): ${roasText(target.roas)} on ${money(target.spendUsd)}.`,
  ];
  const breakEven = (likely.spendUsd > 0 ? likely : target).breakEvenConversionRate;
  if (breakEven != null) {
    parts.push(
      `Break-even at ${(breakEven * 100).toFixed(2)}% conversion (modeling ${(p.inputs.conversionRate * 100).toFixed(2)}%).`
    );
  }
  if (p.pipeline.excluded > 0) {
    parts.push(`${p.pipeline.excluded} creators who passed, declined, or went quiet are left out.`);
  }
  return parts.join(" ");
}
