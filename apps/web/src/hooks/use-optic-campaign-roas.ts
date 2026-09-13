"use client";

import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot, type Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db, functions } from "@/lib/firebase";
import type { OpticRoasInsight } from "@/lib/optic/types";

function parseInsight(raw: unknown): OpticRoasInsight | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  return {
    predictedRoas:
      typeof d.predictedRoas === "number"
        ? d.predictedRoas
        : d.predictedRoas === null
          ? null
          : null,
    spendUsd: typeof d.spendUsd === "number" ? d.spendUsd : 0,
    expectedRevenueUsd: typeof d.expectedRevenueUsd === "number" ? d.expectedRevenueUsd : 0,
    expectedViews: typeof d.expectedViews === "number" ? d.expectedViews : 0,
    expectedConversions:
      typeof d.expectedConversions === "number" ? d.expectedConversions : 0,
    hireCount: typeof d.hireCount === "number" ? d.hireCount : 0,
    confidence: d.confidence === "medium" ? "medium" : "low",
    vaultLeadsUsed: typeof d.vaultLeadsUsed === "number" ? d.vaultLeadsUsed : 0,
    usedProxies: Boolean(d.usedProxies),
    inputs:
      d.inputs && typeof d.inputs === "object"
        ? {
            averageOrderValueUsd:
              typeof (d.inputs as Record<string, unknown>).averageOrderValueUsd ===
              "number"
                ? ((d.inputs as Record<string, unknown>).averageOrderValueUsd as number)
                : 50,
            conversionRate:
              typeof (d.inputs as Record<string, unknown>).conversionRate === "number"
                ? ((d.inputs as Record<string, unknown>).conversionRate as number)
                : 0.005,
            viewRate:
              typeof (d.inputs as Record<string, unknown>).viewRate === "number"
                ? ((d.inputs as Record<string, unknown>).viewRate as number)
                : 0.08,
            engagementRate:
              typeof (d.inputs as Record<string, unknown>).engagementRate === "number"
                ? ((d.inputs as Record<string, unknown>).engagementRate as number)
                : null,
          }
        : {
            averageOrderValueUsd: 50,
            conversionRate: 0.005,
            viewRate: 0.08,
            engagementRate: null,
          },
    budget:
      d.budget && typeof d.budget === "object"
        ? {
            creatorCompensationUsd:
              typeof (d.budget as Record<string, unknown>).creatorCompensationUsd ===
              "number"
                ? ((d.budget as Record<string, unknown>).creatorCompensationUsd as number)
                : 0,
            ratePerCreator:
              typeof (d.budget as Record<string, unknown>).ratePerCreator === "number"
                ? ((d.budget as Record<string, unknown>).ratePerCreator as number)
                : 0,
            creatorsNeeded:
              typeof (d.budget as Record<string, unknown>).creatorsNeeded === "number"
                ? ((d.budget as Record<string, unknown>).creatorsNeeded as number)
                : 0,
          }
        : {
            creatorCompensationUsd: 0,
            ratePerCreator: 0,
            creatorsNeeded: 0,
          },
    creatorsPreview: Array.isArray(d.creatorsPreview)
      ? (d.creatorsPreview as OpticRoasInsight["creatorsPreview"])
      : [],
    caveats: Array.isArray(d.caveats) ? (d.caveats as string[]) : [],
    source: d.source === "mcp" ? "mcp" : "web",
    updatedAt: (d.updatedAt as Timestamp | null | undefined) ?? null,
  };
}

export function useOpticCampaignRoasInsight(campaignId: string | null | undefined) {
  const [insight, setInsight] = useState<OpticRoasInsight | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!campaignId || campaignId === "__all__" || campaignId === "__pooled__") {
      setInsight(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const unsub = onSnapshot(
      doc(db, "gigs", campaignId),
      (snap) => {
        if (!snap.exists()) {
          setInsight(null);
          setLoading(false);
          return;
        }
        setInsight(parseInsight(snap.data()?.opticRoasInsight));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [campaignId]);

  const refresh = useCallback(
    async (opts?: {
      averageOrderValueUsd?: number;
      conversionRate?: number;
      viewRate?: number;
    }) => {
      if (!campaignId || campaignId === "__all__" || campaignId === "__pooled__") {
        return false;
      }
      setRefreshing(true);
      setError(null);
      try {
        const callable = httpsCallable(functions, "refreshOpticCampaignRoasInsight");
        await callable({
          campaignId,
          averageOrderValueUsd: opts?.averageOrderValueUsd,
          conversionRate: opts?.conversionRate,
          viewRate: opts?.viewRate,
        });
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not refresh ROAS");
        return false;
      } finally {
        setRefreshing(false);
      }
    },
    [campaignId]
  );

  return { insight, loading, refreshing, error, refresh };
}
