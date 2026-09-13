import {numOrZero} from "../context.js";
import type {BudgetEstimate} from "./budget.js";

export type LeadReachInput = {
  id: string;
  creatorName?: string | null;
  followerCount?: string | number | null;
  followerCountNumeric?: number | null;
  matchScore?: number | null;
  profileUrl?: string | null;
  discoveryPlatform?: string | null;
};

export type RoasPredictInput = {
  budget: BudgetEstimate;
  /** Leads to use for reach modeling (typically top matchScore). */
  leads: LeadReachInput[];
  hireCount?: number;
  averageOrderValueUsd: number;
  /** Fraction of estimated views that convert (e.g. 0.005 = 0.5%). */
  conversionRate: number;
  /** Fraction of followers who see the content (views / followers). */
  viewRate: number;
  /** Optional engagement rate used only in narrative (not revenue math). */
  engagementRate?: number;
};

export type RoasPrediction = {
  campaignId: string;
  title: string;
  predictedRoas: number | null;
  spendUsd: number;
  expectedRevenueUsd: number;
  expectedViews: number;
  expectedConversions: number;
  hireCount: number;
  creatorsModeled: Array<{
    id: string;
    name: string | null;
    followers: number;
    matchScore: number | null;
    expectedViews: number;
  }>;
  inputs: {
    averageOrderValueUsd: number;
    conversionRate: number;
    viewRate: number;
    engagementRate: number | null;
  };
  confidence: "low" | "medium";
  caveats: string[];
};

function parseFollowers(lead: LeadReachInput): number {
  if (typeof lead.followerCountNumeric === "number" && Number.isFinite(lead.followerCountNumeric)) {
    return Math.max(0, lead.followerCountNumeric);
  }
  if (typeof lead.followerCount === "number" && Number.isFinite(lead.followerCount)) {
    return Math.max(0, lead.followerCount);
  }
  if (typeof lead.followerCount === "string") {
    const raw = lead.followerCount.trim().toUpperCase().replace(/,/g, "");
    const m = raw.match(/^([\d.]+)\s*([KMB])?$/);
    if (!m) {
      const n = Number.parseFloat(raw);
      return Number.isFinite(n) ? Math.max(0, n) : 0;
    }
    const base = Number.parseFloat(m[1]);
    if (!Number.isFinite(base)) return 0;
    const mult = m[2] === "K" ? 1_000 : m[2] === "M" ? 1_000_000 : m[2] === "B" ? 1_000_000_000 : 1;
    return Math.max(0, base * mult);
  }
  return 0;
}

/**
 * Heuristic predicted ROAS from campaign spend + vault lead reach.
 * Explicitly modeled — not measured historical ROAS.
 */
export function predictCampaignRoas(input: RoasPredictInput): RoasPrediction {
  const hireDefault = Math.max(1, input.budget.creatorsNeeded || 1);
  const hireCount = Math.max(
    1,
    Math.floor(input.hireCount && input.hireCount > 0 ? input.hireCount : hireDefault)
  );
  const spendUsd = Math.round(input.budget.ratePerCreator * hireCount * 100) / 100;

  const sorted = [...input.leads].sort((a, b) => {
    const sa = typeof a.matchScore === "number" ? a.matchScore : -1;
    const sb = typeof b.matchScore === "number" ? b.matchScore : -1;
    return sb - sa;
  });

  const selected = sorted.slice(0, hireCount);
  const viewRate = Math.min(1, Math.max(0, input.viewRate));
  const conversionRate = Math.min(1, Math.max(0, input.conversionRate));
  const aov = Math.max(0, numOrZero(input.averageOrderValueUsd));

  const creatorsModeled = selected.map((lead) => {
    const followers = parseFollowers(lead);
    const expectedViews = Math.round(followers * viewRate);
    return {
      id: lead.id,
      name: lead.creatorName ?? null,
      followers,
      matchScore: typeof lead.matchScore === "number" ? lead.matchScore : null,
      expectedViews,
    };
  });

  // If vault is empty, fall back to a mid-micro creator proxy per hire slot.
  if (creatorsModeled.length === 0) {
    for (let i = 0; i < hireCount; i++) {
      const followers = 50_000;
      creatorsModeled.push({
        id: `proxy-${i + 1}`,
        name: `Proxy mid-micro creator #${i + 1}`,
        followers,
        matchScore: null,
        expectedViews: Math.round(followers * viewRate),
      });
    }
  } else if (creatorsModeled.length < hireCount) {
    const avgFollowers =
      creatorsModeled.reduce((s, c) => s + c.followers, 0) / creatorsModeled.length;
    while (creatorsModeled.length < hireCount) {
      const i = creatorsModeled.length;
      creatorsModeled.push({
        id: `proxy-${i + 1}`,
        name: `Proxy (avg vault reach)`,
        followers: Math.round(avgFollowers),
        matchScore: null,
        expectedViews: Math.round(avgFollowers * viewRate),
      });
    }
  }

  const expectedViews = creatorsModeled.reduce((s, c) => s + c.expectedViews, 0);
  const expectedConversions = expectedViews * conversionRate;
  const expectedRevenueUsd = Math.round(expectedConversions * aov * 100) / 100;
  const predictedRoas =
    spendUsd > 0 ? Math.round((expectedRevenueUsd / spendUsd) * 100) / 100 : null;

  const usedProxies = creatorsModeled.some((c) => c.id.startsWith("proxy-"));
  const caveats = [
    "This is a predictive model, not measured campaign ROAS.",
    "Follower counts on Optic leads are often vision estimates from profile screenshots.",
    "Tune averageOrderValueUsd, conversionRate, and viewRate for your brand funnel.",
  ];
  if (usedProxies) {
    caveats.push(
      "One or more hire slots used proxy reach because the vault did not have enough scored leads — run Optic discovery first for better estimates."
    );
  }
  if (input.budget.campaignType === "cause_campaign" || input.budget.campaignType === "barter_campaign") {
    caveats.push("Cause/barter campaigns may have $0 cash spend; ROAS vs cash outlay may be undefined or infinite.");
  }

  return {
    campaignId: input.budget.campaignId,
    title: input.budget.title,
    predictedRoas,
    spendUsd,
    expectedRevenueUsd,
    expectedViews,
    expectedConversions: Math.round(expectedConversions * 1000) / 1000,
    hireCount,
    creatorsModeled,
    inputs: {
      averageOrderValueUsd: aov,
      conversionRate,
      viewRate,
      engagementRate:
        input.engagementRate != null && Number.isFinite(input.engagementRate)
          ? input.engagementRate
          : null,
    },
    confidence: usedProxies || selected.length === 0 ? "low" : "medium",
    caveats,
  };
}
