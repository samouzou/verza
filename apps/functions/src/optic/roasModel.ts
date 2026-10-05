import {isOpticLeadStage} from "./leadCrm";

export type PipelineBucket = "booked" | "negotiating" | "replied" | "contacted" | "new" | "excluded";
/** How a creator's cost is known. Creators with no known cost are left out of every scenario. */
export type SpendBasis = "quoted" | "flat_fee" | "performance";

/** Typical odds a creator at each stage ends up booked. */
export const CLOSE_PROBABILITY: Record<PipelineBucket, number> = {
  booked: 1,
  negotiating: 0.6,
  replied: 0.35,
  contacted: 0.1,
  new: 0,
  excluded: 0,
};
const BUCKET_ORDER: PipelineBucket[] = ["booked", "negotiating", "replied", "contacted", "new"];

export type RoasLeadInput = {
  id: string;
  name: string | null;
  followers: number;
  matchScore: number | null;
  pipelineStage?: unknown;
  outreachEmailed?: unknown;
  outreachResponse?: unknown;
  quotedRateUsd?: unknown;
};

export type RoasModelInputs = {
  averageOrderValueUsd: number;
  conversionRate: number;
  viewRate: number;
  /** Campaign flat fee per creator; 0 when the campaign has none. */
  ratePerCreator: number;
  /** Campaign reward per conversion (cost per acquisition); 0 when the campaign has none. Paid on top of fixed fees. */
  costPerConversionUsd: number;
  /** Share added to fixed fees that the brand pays on top (budget campaigns pay Verza's fee from the budget). */
  fixedFeeFraction: number;
  /** Most creators the full-target scenario includes; null for no count cap. */
  targetCount: number | null;
  /** All-in budget the full target's fixed costs must fit in; null for no budget cap. */
  budgetUsd: number | null;
};

export type ModeledCreator = {
  id: string;
  name: string | null;
  followers: number;
  matchScore: number | null;
  bucket: PipelineBucket;
  /** Quoted rate or flat fee plus any fee the brand pays on it, before performance pay. */
  fixedUsd: number;
  /** Fixed fee plus expected performance pay at the modeled conversion rate. */
  spendUsd: number;
  spendBasis: SpendBasis;
};

export type RoasScenario = {
  roas: number | null;
  spendUsd: number;
  revenueUsd: number;
  views: number;
  conversions: number;
  /** Probability-weighted creator count (whole numbers for committed and target). */
  creators: number;
  /**
   * Conversion rate where revenue equals spend. 0 when only performance pay applies (profitable at any rate);
   * null without reach, or when the per-conversion reward is at or above order value (never breaks even).
   */
  breakEvenConversionRate: number | null;
};

export type RoasModelResult = {
  committed: RoasScenario;
  likely: RoasScenario;
  target: RoasScenario;
  targetCreators: ModeledCreator[];
  pipeline: Record<PipelineBucket, number>;
  spendBasis: Record<SpendBasis, number>;
  /** Active creators left out because nothing tells us what they cost. */
  unpriced: number;
  /** Target slots no priced creator fills yet (creator-count campaigns only). */
  targetShortfall: number;
  /** Priced creators left out of the full target because their fixed cost no longer fits the budget. */
  overBudget: number;
  /** Fixed costs (incl. fees) the full target draws from the budget. */
  budgetFixedSpendUsd: number;
  quotesUsed: number;
  medianQuoteUsd: number | null;
};

/**
 * Pipeline bucket for ROAS. Passed, declined, and ghosted creators are excluded.
 * @param {RoasLeadInput} lead Vault lead.
 * @return {PipelineBucket} Bucket.
 */
export function pipelineBucket(lead: RoasLeadInput): PipelineBucket {
  const stage = isOpticLeadStage(lead.pipelineStage) ?
    lead.pipelineStage :
    lead.outreachEmailed === true ? "contacted" : "new";
  const response = typeof lead.outreachResponse === "string" ? lead.outreachResponse : "";
  if (stage === "passed" || response === "declined" || response === "ghosted") return "excluded";
  if (stage === "booked") return "booked";
  if (stage === "negotiating" || response === "rate_card" || response === "countered") return "negotiating";
  if (stage === "replied" || response === "interested" || response === "needs_brief" || response === "needs_usage") {
    return "replied";
  }
  return stage === "contacted" ? "contacted" : "new";
}

/**
 * Middle value of a list.
 * @param {number[]} values Numbers.
 * @return {number | null} Median, or null for an empty list.
 */
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Rounds to cents.
 * @param {number} n Value.
 * @return {number} Rounded value.
 */
function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Stage-aware ROAS: committed (booked), likely (pipeline weighted by close odds), and full target.
 * @param {RoasLeadInput[]} leads Campaign leads.
 * @param {RoasModelInputs} inputs Assumptions.
 * @return {RoasModelResult} Scenarios and breakdowns.
 */
export function modelCampaignRoas(leads: RoasLeadInput[], inputs: RoasModelInputs): RoasModelResult {
  const quoteOf = (l: RoasLeadInput) =>
    typeof l.quotedRateUsd === "number" && Number.isFinite(l.quotedRateUsd) && l.quotedRateUsd > 0 ?
      l.quotedRateUsd :
      null;

  const quotes = leads.map(quoteOf).filter((q): q is number => q != null);
  const medianQuoteUsd = median(quotes);
  const flat = inputs.ratePerCreator > 0 ? inputs.ratePerCreator : null;
  const cpa = inputs.costPerConversionUsd > 0 ? inputs.costPerConversionUsd : 0;
  const conversionsPerFollower = inputs.viewRate * inputs.conversionRate;

  const pipeline: Record<PipelineBucket, number> = {booked: 0, negotiating: 0, replied: 0, contacted: 0, new: 0, excluded: 0};
  const active: ModeledCreator[] = [];
  let unpriced = 0;
  for (const l of leads) {
    const bucket = pipelineBucket(l);
    pipeline[bucket] += 1;
    if (bucket === "excluded") continue;
    const quote = quoteOf(l);
    const fixedUsd = cents((quote ?? flat ?? 0) * (1 + Math.max(0, inputs.fixedFeeFraction)));
    const spendBasis: SpendBasis | null =
      quote != null ? "quoted" : flat != null ? "flat_fee" : cpa > 0 ? "performance" : null;
    if (!spendBasis) {
      unpriced += 1;
      continue;
    }
    active.push({
      id: l.id,
      name: l.name,
      followers: l.followers,
      matchScore: l.matchScore,
      bucket,
      fixedUsd,
      spendUsd: cents(fixedUsd + l.followers * conversionsPerFollower * cpa),
      spendBasis,
    });
  }

  const scenario = (creators: ModeledCreator[], weight: (c: ModeledCreator) => number): RoasScenario => {
    let fixedUsd = 0;
    let views = 0;
    let count = 0;
    for (const c of creators) {
      const w = weight(c);
      fixedUsd += c.fixedUsd * w;
      views += c.followers * inputs.viewRate * w;
      count += w;
    }
    const conversions = views * inputs.conversionRate;
    const revenueUsd = conversions * inputs.averageOrderValueUsd;
    const spendUsd = fixedUsd + conversions * cpa;
    const marginPerConversion = inputs.averageOrderValueUsd - cpa;
    let breakEvenConversionRate: number | null = null;
    if (views > 0 && marginPerConversion > 0) {
      breakEvenConversionRate = fixedUsd / (views * marginPerConversion);
    }
    return {
      roas: spendUsd > 0 ? Math.round((revenueUsd / spendUsd) * 100) / 100 : null,
      spendUsd: cents(spendUsd),
      revenueUsd: cents(revenueUsd),
      views: Math.round(views),
      conversions: Math.round(conversions * 1000) / 1000,
      creators: Math.round(count * 10) / 10,
      breakEvenConversionRate,
    };
  };

  const booked = active.filter((c) => c.bucket === "booked");
  const targetCount = inputs.targetCount == null ? null : Math.max(inputs.targetCount, booked.length);
  const budget = inputs.budgetUsd != null && inputs.budgetUsd > 0 ? inputs.budgetUsd : null;
  const ranked = [...active].sort((a, b) =>
    BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket) ||
    (b.matchScore ?? -1) - (a.matchScore ?? -1)
  );
  // Booked creators always count; the rest join in pipeline order while their fixed cost still fits.
  const targetCreators: ModeledCreator[] = [];
  let budgetFixedSpendUsd = 0;
  let overBudget = 0;
  for (const c of ranked) {
    if (targetCount != null && targetCreators.length >= targetCount) break;
    if (budget != null && c.bucket !== "booked" && budgetFixedSpendUsd + c.fixedUsd > budget) {
      overBudget += 1;
      continue;
    }
    targetCreators.push(c);
    budgetFixedSpendUsd += c.fixedUsd;
  }

  const spendBasis: Record<SpendBasis, number> = {quoted: 0, flat_fee: 0, performance: 0};
  for (const c of targetCreators) spendBasis[c.spendBasis] += 1;

  return {
    committed: scenario(booked, () => 1),
    likely: scenario(active, (c) => CLOSE_PROBABILITY[c.bucket]),
    target: scenario(targetCreators, () => 1),
    targetCreators,
    pipeline,
    spendBasis,
    unpriced,
    targetShortfall: targetCount == null ? 0 : Math.max(0, targetCount - targetCreators.length),
    overBudget,
    budgetFixedSpendUsd: cents(budgetFixedSpendUsd),
    quotesUsed: quotes.length,
    medianQuoteUsd: medianQuoteUsd == null ? null : cents(medianQuoteUsd),
  };
}
