import type {Firestore} from "firebase-admin/firestore";
import type {VerzaActor} from "../context.js";
import {AGENT_PREFERRED_PLATFORMS, getCampaign, listLeads} from "../services/verza.js";
import {estimateCampaignBudget, type BudgetEstimate} from "./budget.js";
import {buildRoasInsightSnapshot, saveRoasInsightOnGig} from "./insights.js";
import {predictCampaignRoas, type RoasPrediction} from "./roas.js";

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
  engagementRate?: number;
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
  roas: RoasPrediction;
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

/**
 * Brand-facing launch pack: budget + predicted ROAS + what to do next.
 */
export async function buildCampaignLaunchBrief(
  db: Firestore,
  actor: VerzaActor,
  input: LaunchBriefInput
): Promise<CampaignLaunchBrief> {
  const campaign = await getCampaign(db, actor, input.campaignId);
  if (!campaign) throw new Error(`Campaign ${input.campaignId} not found`);

  const aov = input.averageOrderValueUsd ?? LAUNCH_BRIEF_DEFAULTS.averageOrderValueUsd;
  const conversionRate = input.conversionRate ?? LAUNCH_BRIEF_DEFAULTS.conversionRate;
  const viewRate = input.viewRate ?? LAUNCH_BRIEF_DEFAULTS.viewRate;

  const budget = estimateCampaignBudget(campaign);
  const leads = await listLeads(db, actor, {
    campaignId: input.campaignId,
    limit: 50,
    minMatchScore: input.minMatchScore ?? null,
  });
  const roas = predictCampaignRoas({
    budget,
    leads,
    hireCount: input.hireCount,
    averageOrderValueUsd: aov,
    conversionRate,
    viewRate,
    engagementRate: input.engagementRate,
  });

  let savedToVault = false;
  if (input.persist !== false) {
    const snapshot = buildRoasInsightSnapshot(roas, budget, "mcp");
    await saveRoasInsightOnGig(db, input.campaignId, snapshot);
    savedToVault = true;
  }

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

  const roasLabel =
    roas.predictedRoas == null ? "—" : `${roas.predictedRoas.toFixed(2)}x`;

  const confidenceLabel =
    roas.confidence === "medium" ? "Solid estimate" : "Early estimate — improves with more creators";

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
    ...roas.caveats,
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
      {
        label: "Predicted return",
        value: roasLabel,
        hint: confidenceLabel,
      },
      {
        label: "Creator hire spend",
        value: money(roas.spendUsd),
        hint: `${roas.hireCount} creators at ${money(budget.ratePerCreator)} each`,
      },
      {
        label: "Expected revenue",
        value: money(roas.expectedRevenueUsd),
        hint: `About ${Math.round(roas.expectedViews).toLocaleString()} views → ~${roas.expectedConversions} orders`,
      },
      {
        label: "Total creator budget",
        value: money(budget.creatorCompensationUsd),
        hint: `${budget.remainingSlots} open slots`,
      },
      {
        label: "Assumptions",
        value: `Order value ${money(aov)} · ${pct(conversionRate)} convert · ${pct(viewRate)} see the post`,
      },
    ],
    budget,
    roas,
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
