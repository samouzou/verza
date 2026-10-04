import {isOpticLeadStage} from "./leadCrm";

export type PipelineBucket = "booked" | "negotiating" | "replied" | "contacted" | "new" | "excluded";
export type SpendBasis = "quoted" | "flat_fee" | "estimated" | "unknown";

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
const PROXY_FOLLOWERS = 50_000;

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
  /** Creators the full-target scenario fills. */
  targetCount: number;
};

export type ModeledCreator = {
  id: string;
  name: string | null;
  followers: number;
  matchScore: number | null;
  bucket: PipelineBucket;
  spendUsd: number;
  spendBasis: SpendBasis;
  proxy: boolean;
};

export type RoasScenario = {
  roas: number | null;
  spendUsd: number;
  revenueUsd: number;
  views: number;
  conversions: number;
  /** Probability-weighted creator count (whole numbers for committed and target). */
  creators: number;
  /** Conversion rate where revenue equals spend; null without spend or reach. */
  breakEvenConversionRate: number | null;
};

export type RoasModelResult = {
  committed: RoasScenario;
  likely: RoasScenario;
  target: RoasScenario;
  targetCreators: ModeledCreator[];
  pipeline: Record<PipelineBucket, number>;
  spendBasis: Record<SpendBasis, number>;
  quotesUsed: number;
  medianQuoteUsd: number | null;
  usedProxies: boolean;
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

  // Every quote informs market pricing, even from creators who later passed.
  const quotes = leads.map(quoteOf).filter((q): q is number => q != null);
  const perThousand = leads
    .filter((l) => quoteOf(l) != null && l.followers > 0)
    .map((l) => (quoteOf(l) as number) / (l.followers / 1000));
  const medianQuoteUsd = median(quotes);
  const medianPerThousand = median(perThousand);
  const flat = inputs.ratePerCreator > 0 ? inputs.ratePerCreator : null;

  const spendFor = (quote: number | null, followers: number): {spendUsd: number; spendBasis: SpendBasis} => {
    if (quote != null) return {spendUsd: quote, spendBasis: "quoted"};
    if (flat != null) return {spendUsd: flat, spendBasis: "flat_fee"};
    if (medianPerThousand != null && followers > 0) {
      return {spendUsd: cents(medianPerThousand * followers / 1000), spendBasis: "estimated"};
    }
    if (medianQuoteUsd != null) return {spendUsd: medianQuoteUsd, spendBasis: "estimated"};
    return {spendUsd: 0, spendBasis: "unknown"};
  };

  const pipeline: Record<PipelineBucket, number> = {booked: 0, negotiating: 0, replied: 0, contacted: 0, new: 0, excluded: 0};
  const active: ModeledCreator[] = [];
  for (const l of leads) {
    const bucket = pipelineBucket(l);
    pipeline[bucket] += 1;
    if (bucket === "excluded") continue;
    active.push({
      id: l.id,
      name: l.name,
      followers: l.followers,
      matchScore: l.matchScore,
      bucket,
      ...spendFor(quoteOf(l), l.followers),
      proxy: false,
    });
  }

  const scenario = (creators: ModeledCreator[], weight: (c: ModeledCreator) => number): RoasScenario => {
    let spendUsd = 0;
    let views = 0;
    let count = 0;
    for (const c of creators) {
      const w = weight(c);
      spendUsd += c.spendUsd * w;
      views += c.followers * inputs.viewRate * w;
      count += w;
    }
    const conversions = views * inputs.conversionRate;
    const revenueUsd = conversions * inputs.averageOrderValueUsd;
    return {
      roas: spendUsd > 0 ? Math.round((revenueUsd / spendUsd) * 100) / 100 : null,
      spendUsd: cents(spendUsd),
      revenueUsd: cents(revenueUsd),
      views: Math.round(views),
      conversions: Math.round(conversions * 1000) / 1000,
      creators: Math.round(count * 10) / 10,
      breakEvenConversionRate: spendUsd > 0 && views > 0 && inputs.averageOrderValueUsd > 0 ?
        spendUsd / (views * inputs.averageOrderValueUsd) :
        null,
    };
  };

  const booked = active.filter((c) => c.bucket === "booked");
  const targetCount = Math.max(inputs.targetCount, booked.length);
  const ranked = [...active].sort((a, b) =>
    BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket) ||
    (b.matchScore ?? -1) - (a.matchScore ?? -1)
  );
  const targetCreators = ranked.slice(0, targetCount);
  const avgFollowers = active.length ?
    Math.round(active.reduce((s, c) => s + c.followers, 0) / active.length) :
    PROXY_FOLLOWERS;
  while (targetCreators.length < targetCount) {
    const i = targetCreators.length + 1;
    targetCreators.push({
      id: `proxy-${i}`,
      name: active.length ? "Placeholder (average vault reach)" : `Placeholder mid-micro #${i}`,
      followers: avgFollowers,
      matchScore: null,
      bucket: "new",
      ...spendFor(null, avgFollowers),
      proxy: true,
    });
  }

  const spendBasis: Record<SpendBasis, number> = {quoted: 0, flat_fee: 0, estimated: 0, unknown: 0};
  for (const c of targetCreators) spendBasis[c.spendBasis] += 1;

  return {
    committed: scenario(booked, () => 1),
    likely: scenario(active, (c) => CLOSE_PROBABILITY[c.bucket]),
    target: scenario(targetCreators, () => 1),
    targetCreators,
    pipeline,
    spendBasis,
    quotesUsed: quotes.length,
    medianQuoteUsd: medianQuoteUsd == null ? null : cents(medianQuoteUsd),
    usedProxies: targetCreators.some((c) => c.proxy),
  };
}
