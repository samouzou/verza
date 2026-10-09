"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, type DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase";

/** "lifetime" = AppSumo: Starter's limits for good, no auto-publishing. */
export type PrismPlanTier = "free" | "lifetime" | "starter" | "launch" | "pro" | "enterprise";
export type PrismSelfServeTier = "starter" | "launch" | "pro";

export type PrismTierLimits = {
  /** AI actions a month; null = unlimited. */
  ai: number | null;
  /** Feed graphics a month; null = no monthly cap. */
  graphics: number | null;
  publish: boolean;
  /** X API fees included each month. Enterprise is by contract. */
  xIncludedDollars: number;
  /** Seconds of AI video included each month. */
  videoSeconds: number;
};

/** Keep in sync with functions billing.ts and videoCredits.ts. */
export const PRISM_TIERS: Record<PrismPlanTier, PrismTierLimits> = {
  free: { ai: 0, graphics: 0, publish: false, xIncludedDollars: 0, videoSeconds: 0 },
  lifetime: { ai: 300, graphics: 30, publish: false, xIncludedDollars: 0, videoSeconds: 0 },
  starter: { ai: 300, graphics: 30, publish: false, xIncludedDollars: 0, videoSeconds: 0 },
  launch: { ai: 1000, graphics: 100, publish: true, xIncludedDollars: 5, videoSeconds: 30 },
  pro: { ai: 3000, graphics: null, publish: true, xIncludedDollars: 10, videoSeconds: 120 },
  enterprise: { ai: null, graphics: null, publish: true, xIncludedDollars: 0, videoSeconds: 120 },
};

export const PRISM_TIER_LABEL: Record<PrismPlanTier, string> = {
  free: "No Prism plan",
  lifetime: "Prism Lifetime",
  starter: "Prism Starter",
  launch: "Prism Launch",
  pro: "Prism Pro",
  enterprise: "Prism Enterprise",
};

/** Free trial on a brand's first subscription (keep in sync with functions billing.ts). */
export const PRISM_TRIAL_DAYS = 7;
/** Markup on X fees above the allowance, covering card processing. */
export const PRISM_X_MARKUP = 0.05;
export const PRISM_PRICING_PATH = "/prism/pricing";

export interface PrismPlan {
  tier: PrismPlanTier;
  loading: boolean;
  /** Any paid plan, including AppSumo Lifetime. */
  paid: boolean;
  /** Auto-publishing: Launch, Pro or Enterprise with an active or trialing subscription. */
  canPublish: boolean;
  /** Starter, Launch or Pro billed through a self-serve subscription (can switch plans in place). */
  selfServe: boolean;
  /** null = no monthly cap. */
  graphicsLimit: number | null;
  /** null = no monthly cap. */
  graphicsLeft: number | null;
  subscriptionStatus: string | null;
  billingInterval: "month" | "year" | null;
  aiUsed: number;
  /** null = unlimited. */
  aiLimit: number | null;
  /** The brand hasn't had a Prism subscription or trial yet (Checkout makes the final call). */
  trialEligible: boolean;
  /** ISO time the current trial ends, while trialing. */
  trialEndsAt: string | null;
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
  const plan = d?.prismPlan;
  const subscribed = active && (plan === "starter" || plan === "launch" || plan === "pro" || plan === "enterprise");
  const tier: PrismPlanTier = subscribed ? plan : d?.prismLifetime === true ? "lifetime" : "free";
  const limits = PRISM_TIERS[tier];
  const thisPeriod = d?.prismUsagePeriodKey === periodKey();
  const aiUsed = thisPeriod ? count(d?.prismAiActionsThisPeriod) : 0;
  const graphicsUsed = thisPeriod ? count(d?.prismGraphicsThisPeriod) : 0;
  return {
    tier,
    paid: tier !== "free",
    canPublish: subscribed && limits.publish,
    selfServe: subscribed && tier !== "enterprise" && typeof d?.prismStripeSubscriptionId === "string",
    graphicsLimit: limits.graphics,
    graphicsLeft: limits.graphics === null ? null : Math.max(0, limits.graphics - graphicsUsed),
    subscriptionStatus: status,
    billingInterval: d?.prismBillingInterval === "month" || d?.prismBillingInterval === "year" ? d.prismBillingInterval : null,
    aiUsed,
    aiLimit: limits.ai,
    trialEligible: d?.prismTrialUsed !== true && !d?.prismStripeSubscriptionId,
    trialEndsAt:
      status === "trialing" && typeof d?.prismTrialEnd?.toDate === "function" ? d.prismTrialEnd.toDate().toISOString() : null,
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
