import type {Firestore} from "firebase-admin/firestore";
import type {VerzaActor} from "../context.js";
import {AGENT_PREFERRED_PLATFORMS, getCampaign} from "../services/verza.js";
import {estimateCampaignBudget, type BudgetEstimate} from "./budget.js";
import type {VerzaCallableClient} from "./callable.js";
import {predictCampaignRoas, summarizeRoasPrediction, type RoasPrediction} from "./roas.js";

export const LAUNCH_BRIEF_DEFAULTS = {
  averageOrderValueUsd: 50,
  conversionRate: 0.005,
  viewRate: 0.08,
} as const;

export type LaunchBriefInput = {
  campaignId: string;
  averageOrderValueUsd?: number;
  conversionRate?: number;
  viewRate?: number;
  hireCount?: number;
  minMatchScore?: number | null;
  campaignUrl?: string | null;
  checkoutUrl?: string | null;
  fundingUrl?: string | null;
  createMode?: "funded_checkout" | "live" | null;
  appBaseUrl: string;
  persist?: boolean;
};

export type CampaignLaunchBrief = {
  reportKind: "campaign_launch_brief";
  headline: string;
  summary: string;
  campaign: {
    id: string;
    title: string;
    status: string;
    campaignType: string;
    platforms: string[];
    campaignUrl: string | null;
    checkoutUrl: string | null;
    fundingUrl: string | null;
    mode: "funded_checkout" | "live" | null;
  };
  metrics: Array<{label: string; value: string; hint?: string}>;
  budget: BudgetEstimate;
  /** Null when the forecast couldn’t be computed; the rest of the brief still applies. */
  roas: RoasPrediction | null;
  roasSummary: string | null;
  scoutPlan: {
    preferredTool: "optic_prepare_agent_mission" | "optic_start_discovery";
    platforms: string[];
    tip: string;
  };
  nextActions: string[];
  vaultUrl: string;
  footnotes: string[];
  savedToVault: boolean;
};

function money(n: number): string {
  return `$${n.toLocaleString("en-US", {maximumFractionDigits: 0})}`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(n * 100 >= 1 ? 1 : 2)}%`;
}

function roasText(roas: number | null): string {
  return roas == null ? "—" : `${roas.toFixed(2)}x`;
}

function roasMetrics(roas: RoasPrediction): CampaignLaunchBrief["metrics"] {
  const {committed, likely, target} = roas.scenarios;
  const basis = roas.spendBasis;
  const basisParts = [
    basis.quoted ? `${basis.quoted} quoted` : null,
    basis.flat_fee ? `${basis.flat_fee} at the flat fee` : null,
    basis.estimated ? `${basis.estimated} estimated from typical quotes` : null,
    basis.performance ? `${basis.performance} on performance pay only` : null,
    roas.costPerConversionUsd > 0 ? `plus ${money(roas.costPerConversionUsd)} per conversion` : null,
  ].filter(Boolean);
  const breakEven = target.breakEvenConversionRate;
  const targetCreators = roas.campaignBudgetUsd ?
    `${target.creators} creators within the ${money(roas.campaignBudgetUsd)} budget` :
    roas.targetShortfall > 0 ?
      `${target.creators} of ${target.creators + roas.targetShortfall} creators priced` :
      `${target.creators} creators`;
  return [
    {
      label: "Predicted return (full target)",
      value: roasText(target.roas),
      hint: roas.confidence === "medium" ? "Solid estimate" : "Early estimate — improves as creators reply and quote rates",
    },
    {
      label: "Likely return",
      value: roasText(likely.roas),
      hint: likely.creators > 0 ?
        `~${likely.creators} creators from your pipeline, weighted by odds of booking` :
        "No creators in conversation yet",
    },
    {
      label: "Committed return",
      value: roasText(committed.roas),
      hint: committed.creators > 0 ? `${committed.creators} booked creators` : "No creators booked yet",
    },
    {
      label: "Creator spend (full target)",
      value: money(target.spendUsd),
      hint: basisParts.length ? `${targetCreators}: ${basisParts.join(", ")}` : targetCreators,
    },
    {
      label: "Expected revenue (full target)",
      value: money(target.revenueUsd),
      hint: `About ${Math.round(target.views).toLocaleString()} views → ~${Math.round(target.conversions)} orders`,
    },
    ...(breakEven != null && breakEven > 0 ?
      [{
        label: "Break-even conversion",
        value: pct(breakEven),
        hint: `You break even if ${pct(breakEven)} of viewers buy`,
      }] :
      breakEven === 0 ?
        [{label: "Break-even conversion", value: "Any", hint: "Creators are paid only per conversion"}] :
        []),
  ];
}

/**
 * Brand-facing launch pack: budget + predicted ROAS + what to do next.
 */
export async function buildCampaignLaunchBrief(
  db: Firestore,
  callable: VerzaCallableClient,
  actor: VerzaActor,
  input: LaunchBriefInput
): Promise<CampaignLaunchBrief> {
  const campaign = await getCampaign(db, actor, input.campaignId);
  if (!campaign) throw new Error(`Campaign ${input.campaignId} not found`);

  const aov = input.averageOrderValueUsd ?? LAUNCH_BRIEF_DEFAULTS.averageOrderValueUsd;
  const conversionRate = input.conversionRate ?? LAUNCH_BRIEF_DEFAULTS.conversionRate;
  const viewRate = input.viewRate ?? LAUNCH_BRIEF_DEFAULTS.viewRate;

  const budget = estimateCampaignBudget(campaign);
  let roas: RoasPrediction | null = null;
  try {
    roas = await predictCampaignRoas(callable, actor, {
      campaignId: input.campaignId,
      averageOrderValueUsd: aov,
      conversionRate,
      viewRate,
      hireCount: input.hireCount,
      minMatchScore: input.minMatchScore ?? null,
      persist: input.persist !== false,
    });
  } catch (e) {
    console.error("[launchBrief] ROAS prediction failed", input.campaignId, e);
  }
  const savedToVault = roas?.savedToVault ?? false;

  const platforms = Array.isArray(campaign.platforms)
    ? campaign.platforms.map((p) => String(p).toLowerCase())
    : [];
  const prefersAgent = platforms.some((p) => AGENT_PREFERRED_PLATFORMS.has(p));
  const app = input.appBaseUrl.replace(/\/$/, "");
  const vaultUrl = `${app}/optic/vault?campaignId=${encodeURIComponent(input.campaignId)}`;
  const campaignUrl =
    input.campaignUrl ?? `${app}/campaigns/${input.campaignId}`;
  const fundingUrl =
    input.fundingUrl ??
    (input.createMode === "funded_checkout"
      ? `${app}/campaigns/${input.campaignId}/fund`
      : null);

  const nextActions: string[] = [];
  if (input.createMode === "funded_checkout" || input.fundingUrl || input.checkoutUrl) {
    nextActions.push(
      "Open the Verza funding link (fundingUrl) while signed in — you’ll be taken to Stripe to complete payment. Don’t paste or shorten raw Stripe checkout links from chat."
    );
  }
  if (prefersAgent) {
    nextActions.push(
      "Find matching creators on Instagram, LinkedIn, or X and save the best fits to your Optic vault."
    );
  } else {
    nextActions.push("Start creator discovery for this campaign and save strong matches to your vault.");
  }
  nextActions.push(
    "After more creators are in the vault, refresh this report for a sharper predicted return."
  );
  nextActions.push(`Review the campaign report anytime in Optic vault: ${vaultUrl}`);

  const footnotes = [
    ...(roas?.caveats ?? [
      "Predicted return isn’t available right now — run campaign_predict_roas in a minute to add it.",
    ]),
    `Starter assumptions when not provided: average order ${money(LAUNCH_BRIEF_DEFAULTS.averageOrderValueUsd)}, conversion ${pct(LAUNCH_BRIEF_DEFAULTS.conversionRate)}, view rate ${pct(LAUNCH_BRIEF_DEFAULTS.viewRate)}.`,
  ];
  if (input.averageOrderValueUsd == null || input.conversionRate == null) {
    footnotes.push(
      "Share your typical order value and conversion rate to make this estimate more accurate."
    );
  }

  return {
    reportKind: "campaign_launch_brief",
    headline: `Campaign report · ${campaign.title}`,
    summary:
      "Here’s a plain-English snapshot of budget, predicted return, and recommended next steps. Show this as a simple report card — not raw data.",
    campaign: {
      id: campaign.id,
      title: campaign.title,
      status: campaign.status,
      campaignType: campaign.campaignType,
      platforms,
      campaignUrl,
      checkoutUrl: null,
      fundingUrl,
      mode: input.createMode ?? null,
    },
    metrics: [
      ...(roas ? roasMetrics(roas) : []),
      {
        label: "Total creator budget",
        value: money(budget.creatorCompensationUsd),
        hint: budget.remainingSlots < 0 ? "Pay is set per creator from this budget" : `${budget.remainingSlots} open slots`,
      },
      {
        label: "Assumptions",
        value: `Order value ${money(aov)} · ${pct(conversionRate)} convert · ${pct(viewRate)} see the post`,
      },
    ],
    budget,
    roas,
    roasSummary: roas ? summarizeRoasPrediction(roas) : null,
    scoutPlan: {
      preferredTool: prefersAgent
        ? "optic_prepare_agent_mission"
        : "optic_start_discovery",
      platforms: platforms.length ? platforms : ["instagram"],
      tip: prefersAgent
        ? "We’ll find creators on these platforms for you and add the best matches to your vault."
        : "We can run discovery for you, or search alongside you — whichever is faster for this campaign.",
    },
    nextActions,
    vaultUrl,
    footnotes,
    savedToVault,
  };
}
