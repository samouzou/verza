import {FieldValue, type Firestore} from "firebase-admin/firestore";
import type {BudgetEstimate} from "./budget.js";
import type {RoasPrediction} from "./roas.js";

/** Snapshot stored on `gigs/{id}.opticRoasInsight` — shared by MCP + vault UI. */
export type OpticRoasInsightSnapshot = {
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
  budget: {
    creatorCompensationUsd: number;
    ratePerCreator: number;
    creatorsNeeded: number;
  };
  creatorsPreview: Array<{
    name: string | null;
    followers: number;
    matchScore: number | null;
  }>;
  caveats: string[];
  source: "mcp" | "web";
  updatedAt: ReturnType<typeof FieldValue.serverTimestamp>;
};

export function buildRoasInsightSnapshot(
  prediction: RoasPrediction,
  budget: BudgetEstimate,
  source: "mcp" | "web"
): OpticRoasInsightSnapshot {
  const usedProxies = prediction.creatorsModeled.some((c) => c.id.startsWith("proxy-"));
  const vaultLeadsUsed = prediction.creatorsModeled.filter(
    (c) => !c.id.startsWith("proxy-")
  ).length;

  return {
    predictedRoas: prediction.predictedRoas,
    spendUsd: prediction.spendUsd,
    expectedRevenueUsd: prediction.expectedRevenueUsd,
    expectedViews: prediction.expectedViews,
    expectedConversions: prediction.expectedConversions,
    hireCount: prediction.hireCount,
    confidence: prediction.confidence,
    vaultLeadsUsed,
    usedProxies,
    inputs: prediction.inputs,
    budget: {
      creatorCompensationUsd: budget.creatorCompensationUsd,
      ratePerCreator: budget.ratePerCreator,
      creatorsNeeded: budget.creatorsNeeded,
    },
    creatorsPreview: prediction.creatorsModeled.slice(0, 5).map((c) => ({
      name: c.name,
      followers: c.followers,
      matchScore: c.matchScore,
    })),
    caveats: prediction.caveats,
    source,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export async function saveRoasInsightOnGig(
  db: Firestore,
  campaignId: string,
  snapshot: OpticRoasInsightSnapshot
): Promise<void> {
  await db.collection("gigs").doc(campaignId).update({
    opticRoasInsight: snapshot,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
