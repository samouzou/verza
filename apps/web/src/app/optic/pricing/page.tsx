"use client";

import { useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { Check, Loader2, Zap } from "lucide-react";

import { OpticCreditsBadge } from "@/components/optic/optic-credits-badge";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useOpticCredits } from "@/hooks/use-optic-credits";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";

type OpticPlanId =
  | "optic_pilot_monthly"
  | "optic_pilot_yearly"
  | "optic_enterprise_monthly"
  | "optic_enterprise_yearly";

const pilotFeatures = [
  "1,000 Optic leads + AI drafts per month",
  "YouTube, Instagram, TikTok, Facebook, Twitch",
  "Gmail drafts & vault outreach tracking",
  "Auto top-up: 250 leads for $500 when you exceed your plan",
];

const enterpriseFeatures = [
  "3,500 Optic leads + AI drafts per month",
  "Everything in Studio",
  "Dedicated account manager",
  "Quarterly true-up on overage (no workflow pauses)",
];

async function startCheckout(
  opticPlanId: OpticPlanId,
  setBusy: (id: OpticPlanId | null) => void,
  toast: ReturnType<typeof useToast>["toast"]
) {
  setBusy(opticPlanId);
  try {
    const fn = httpsCallable(functions, "createOpticSubscriptionCheckoutSession");
    const res = await fn({opticPlanId});
    const url = (res.data as {url?: string})?.url;
    if (!url) throw new Error("No checkout URL");
    window.location.href = url;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    toast({title: "Checkout failed", description: msg, variant: "destructive"});
    setBusy(null);
  }
}

export default function OpticPricingPage() {
  const { user, isLoading: authLoading, isAgencyTeam } = useAuth();
  const { toast } = useToast();
  const agencyId = user?.primaryAgencyId ?? null;
  const billing = useOpticCredits(agencyId);
  const [busyPlan, setBusyPlan] = useState<OpticPlanId | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const fn = httpsCallable(functions, "createOpticBillingPortalSession");
      const res = await fn({});
      const url = (res.data as {url?: string})?.url;
      if (!url) throw new Error("No portal URL");
      window.location.href = url;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({title: "Could not open billing", description: msg, variant: "destructive"});
    } finally {
      setPortalLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container max-w-5xl space-y-8 py-8">
      <PageHeader
        title="Optic pricing"
        description="Creator sourcing with AI outreach drafts — billed separately from your Verza workspace subscription."
        actions={
          <div className="flex flex-wrap gap-2">
            {agencyId && isAgencyTeam && (
              <OpticCreditsBadge balance={billing.balance} loading={billing.loading} />
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href="/optic">Back to discovery</Link>
            </Button>
          </div>
        }
      />

      {billing.hasActiveSubscription && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium capitalize">
                Current plan: {billing.plan}
                {billing.billingInterval ? ` · ${billing.billingInterval}ly` : ""}
              </p>
              <p className="text-sm text-muted-foreground">
                {billing.balance} credits remaining
                {billing.plan === "enterprise" && billing.overageLeads > 0
                  ? ` · ${billing.overageLeads} overage leads this period`
                  : ""}
                {billing.plan === "pilot" && billing.topUpBlocks > 0
                  ? ` · ${billing.topUpBlocks} top-up block${billing.topUpBlocks === 1 ? "" : "s"} this period`
                  : ""}
              </p>
            </div>
            <Button variant="outline" size="sm" disabled={portalLoading} onClick={() => void openPortal()}>
              {portalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Manage billing"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="relative">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-amber-500" />
                Studio
              </CardTitle>
              <Badge variant="secondary">Pilot</Badge>
            </div>
            <CardDescription>
              Proof-of-concept for one campaign — corporate-card friendly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-3xl font-semibold tabular-nums">$1,499</p>
              <p className="text-sm text-muted-foreground">per month</p>
              <p className="mt-2 text-sm text-muted-foreground">
                or <span className="font-medium text-foreground">~$1,243/mo</span> billed yearly
                <span className="text-emerald-600"> (17% off)</span>
              </p>
            </div>
            <ul className="space-y-2 text-sm">
              {pilotFeatures.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                  {f}
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter className="flex flex-col gap-2">
            <Button
              className="w-full"
              disabled={!isAgencyTeam || busyPlan !== null}
              onClick={() => void startCheckout("optic_pilot_monthly", setBusyPlan, toast)}
            >
              {busyPlan === "optic_pilot_monthly" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Subscribe monthly"
              )}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              disabled={!isAgencyTeam || busyPlan !== null}
              onClick={() => void startCheckout("optic_pilot_yearly", setBusyPlan, toast)}
            >
              {busyPlan === "optic_pilot_yearly" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Subscribe yearly"
              )}
            </Button>
          </CardFooter>
        </Card>

        <Card className="relative border-primary/40 shadow-md">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Enterprise
              </CardTitle>
              <Badge>Recommended</Badge>
            </div>
            <CardDescription>
              Scale sourcing with a dedicated account manager.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-3xl font-semibold tabular-nums">$4,200</p>
              <p className="text-sm text-muted-foreground">per month</p>
              <p className="mt-2 text-sm text-muted-foreground">
                or <span className="font-medium text-foreground">$3,500/mo</span> billed yearly
                <span className="text-emerald-600"> (17% off · $42k/yr)</span>
              </p>
            </div>
            <ul className="space-y-2 text-sm">
              {enterpriseFeatures.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                  {f}
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter className="flex flex-col gap-2">
            <Button
              className="w-full"
              disabled={!isAgencyTeam || busyPlan !== null}
              onClick={() => void startCheckout("optic_enterprise_monthly", setBusyPlan, toast)}
            >
              {busyPlan === "optic_enterprise_monthly" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Subscribe monthly"
              )}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              disabled={!isAgencyTeam || busyPlan !== null}
              onClick={() => void startCheckout("optic_enterprise_yearly", setBusyPlan, toast)}
            >
              {busyPlan === "optic_enterprise_yearly" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Subscribe yearly"
              )}
            </Button>
          </CardFooter>
        </Card>
      </div>

      <p className="text-center text-xs text-muted-foreground max-w-2xl mx-auto">
        1 Optic credit = 1 creator profile scraped and saved to your vault with an AI outreach draft.
        Studio overage is billed automatically at $2/lead in 250-lead blocks. Enterprise overage is reviewed
        quarterly with your account manager.
      </p>
    </div>
  );
}
