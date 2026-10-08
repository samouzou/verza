"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, type DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type PrismPlanTier = "free" | "launch" | "enterprise";

export const PRISM_AI_LIMITS: Record<Exclude<PrismPlanTier, "enterprise">, number> = { free: 15, launch: 1000 };
export const PRISM_FREE_STUDIO_RUNS = 1;
export const PRISM_FREE_SLIDE_RENDERS = 3;
/** X API fees included each month on Launch (keep in sync with functions billing.ts). */
export const PRISM_X_INCLUDED_DOLLARS = 5;
/** Markup on X fees above the allowance, covering card processing. */
export const PRISM_X_MARKUP = 0.05;
export const PRISM_PRICING_PATH = "/prism/pricing";

export interface PrismPlan {
  tier: PrismPlanTier;
  loading: boolean;
  /** Paid plan with an active or trialing subscription. */
  paid: boolean;
  subscriptionStatus: string | null;
  billingInterval: "month" | "year" | null;
  aiUsed: number;
  /** null = unlimited. */
  aiLimit: number | null;
  /** null = unlimited. */
  studioRunsLeft: number | null;
  /** null = unlimited. */
  slideRendersLeft: number | null;
}

function count(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

function periodKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function planFrom(d: DocumentData | undefined): Omit<PrismPlan, "loading"> {
  const status = typeof d?.prismSubscriptionStatus === "string" ? d.prismSubscriptionStatus : null;
  const active = status === "active" || status === "trialing";
  const tier: PrismPlanTier =
    active && (d?.prismPlan === "launch" || d?.prismPlan === "enterprise") ? d.prismPlan : "free";
  const aiUsed = d?.prismUsagePeriodKey === periodKey() ? count(d?.prismAiActionsThisPeriod) : 0;
  return {
    tier,
    paid: tier !== "free",
    subscriptionStatus: status,
    billingInterval: d?.prismBillingInterval === "month" || d?.prismBillingInterval === "year" ? d.prismBillingInterval : null,
    aiUsed,
    aiLimit: tier === "enterprise" ? null : PRISM_AI_LIMITS[tier],
    studioRunsLeft: tier === "free" ? Math.max(0, PRISM_FREE_STUDIO_RUNS - count(d?.prismStudioRunsUsed)) : null,
    slideRendersLeft: tier === "free" ? Math.max(0, PRISM_FREE_SLIDE_RENDERS - count(d?.prismSlideRendersUsed)) : null,
  };
}

/** Live Prism plan and usage for a brand workspace. */
export function usePrismPlan(agencyId: string | null | undefined): PrismPlan {
  const [plan, setPlan] = useState<PrismPlan>({ ...planFrom(undefined), loading: Boolean(agencyId) });

  useEffect(() => {
    if (!agencyId) {
      setPlan({ ...planFrom(undefined), loading: false });
      return;
    }
    return onSnapshot(
      doc(db, "agencies", agencyId),
      (snap) => setPlan({ ...planFrom(snap.data()), loading: false }),
      () => setPlan({ ...planFrom(undefined), loading: false })
    );
  }, [agencyId]);

  return plan;
}

/** True when a callable error means the brand hit a Prism plan limit. */
export function isPrismLimitError(e: unknown): boolean {
  const err = e as { code?: string; details?: { upgrade?: boolean } } | null;
  return err?.code === "functions/resource-exhausted" && err.details?.upgrade === true;
}
