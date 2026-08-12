"use client";

import Link from "next/link";
import { Zap } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type OpticNoCreditsCardProps = {
  batchSize?: number;
  balance?: number;
  hasActiveSubscription?: boolean;
  plan?: "none" | "pilot" | "enterprise" | "appsumo";
};

export function OpticNoCreditsCard({
  batchSize,
  balance = 0,
  hasActiveSubscription,
  plan,
}: OpticNoCreditsCardProps) {
  const needsMore =
    typeof batchSize === "number" && batchSize > 0 && balance > 0 && balance < batchSize;

  if (hasActiveSubscription && plan === "appsumo" && (balance === 0 || needsMore)) {
    return (
      <Alert className="border-amber-500/40 bg-amber-500/5">
        <Zap className="h-4 w-4" />
        <AlertTitle>
          {balance === 0
            ? "Monthly AppSumo leads used"
            : "Not enough AppSumo leads for this batch"}
        </AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            {balance === 0
              ? "Your allowance resets next month, or redeem another AppSumo code to add 50 leads/mo (and get those leads now)."
              : `This batch needs ${batchSize} leads but you only have ${balance}. Lower creators per batch or redeem another code.`}
          </p>
          <Button size="sm" asChild>
            <Link href="/optic/redeem">Redeem another code</Link>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (hasActiveSubscription && plan === "pilot" && balance === 0) {
    return (
      <Alert className="border-amber-500/40 bg-amber-500/5">
        <Zap className="h-4 w-4" />
        <AlertTitle>Monthly credits used — top-up on next save</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            Your Studio plan includes auto top-up blocks (250 leads for $500) so missions keep
            running during peak sourcing. The next saved creator will trigger a block if your card
            is on file.
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/optic/pricing">View plan</Link>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive" className="border-amber-500/40 bg-amber-500/5">
      <Zap className="h-4 w-4" />
      <AlertTitle>
        {balance === 0 ? "Subscribe to Optic to start sourcing" : "Not enough credits for this batch"}
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          {balance === 0
            ? "Optic is billed separately from your Verza workspace. Choose Studio or Enterprise, or redeem an AppSumo code."
            : `This batch needs ${batchSize} credits but you only have ${balance}. Lower creators per batch or upgrade your plan.`}
        </p>
        {needsMore && (
          <p className="text-sm text-muted-foreground">
            Each creator added to your vault costs 1 credit, which covers their profile
            details and a ready-to-send outreach message.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" asChild>
            <Link href="/optic/pricing">View Optic plans</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/optic/redeem">Redeem AppSumo code</Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
