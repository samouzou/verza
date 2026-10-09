"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ToastAction } from "@/components/ui/toast";
import type { toast as toastFn } from "@/hooks/use-toast";
import { isPrismLimitError, PRISM_PRICING_PATH, type PrismPlan } from "@/hooks/use-prism-plan";

const TIER_LABEL: Record<PrismPlan["tier"], string> = {
  free: "Prism Free",
  lifetime: "Prism Lifetime",
  launch: "Prism Launch",
  enterprise: "Prism Enterprise",
};

/** Plan name, AI usage this month and an upgrade link (Free only). */
export function PrismPlanBadge({ plan }: { plan: PrismPlan }) {
  if (plan.loading) return null;
  const nearLimit = plan.aiLimit !== null && plan.aiUsed >= plan.aiLimit * 0.8;
  return (
    <Link
      href={PRISM_PRICING_PATH}
      className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
      title="Plans and usage"
    >
      <Badge variant={plan.paid ? "default" : "secondary"} className="font-medium">
        {TIER_LABEL[plan.tier]}
      </Badge>
      <span className={nearLimit ? "text-amber-600" : "text-muted-foreground"}>
        {plan.aiLimit === null ? "Unlimited AI" : `${plan.aiUsed}/${plan.aiLimit} AI this month`}
      </span>
      {!plan.paid && (
        <span className="inline-flex items-center gap-1 font-medium text-primary">
          <Sparkles className="h-3 w-3" />
          Upgrade
        </span>
      )}
    </Link>
  );
}

/**
 * Shows the plan-limit toast with an Upgrade button when the error is a Prism limit.
 * Returns false for any other error so the caller can show its own toast.
 */
export function toastPrismLimit(toast: typeof toastFn, e: unknown): boolean {
  if (!isPrismLimitError(e)) return false;
  toast({
    title: "Plan limit reached",
    description: e instanceof Error ? e.message : String(e),
    action: (
      <ToastAction altText="Upgrade" asChild>
        <Link href={PRISM_PRICING_PATH}>Upgrade</Link>
      </ToastAction>
    ),
  });
  return true;
}
