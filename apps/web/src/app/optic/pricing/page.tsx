"use client";

import { useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { Check, Loader2, Mail, Zap } from "lucide-react";

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

const launchFeatures = [
  "Run more than one active campaign at a time",
  "100 Optic leads + AI drafts per month",
  "YouTube, Instagram, TikTok, Facebook, Twitch",
  "Gmail drafts & vault outreach tracking",
];

const enterpriseFeatures = [
  "3,500 Optic leads + AI drafts per month",
  "YouTube, Instagram, TikTok, Facebook, Twitch",
  "Gmail drafts & vault outreach tracking",
  "Dedicated account manager",
  "Quarterly true-up on overage",
];

const flagshipFeatures = [
  "8,000 Optic leads + AI drafts per month",
  "Everything in Enterprise",
  "Priority sourcing capacity for multi-channel programs",
  "Managed program support (proposal-scoped deliverables)",
  "Custom commercial terms via payment link",
];

const PROPOSAL_MAIL =
  "mailto:serge@tryverza.com?subject=Optic%20access%20request";

export default function OpticPricingPage() {
  const { user, isLoading: authLoading, isAgencyTeam } = useAuth();
  const { toast } = useToast();
  const agencyId = user?.primaryAgencyId ?? null;
  const billing = useOpticCredits(agencyId);
  const [portalLoading, setPortalLoading] = useState(false);
  const [launchLoading, setLaunchLoading] = useState(false);
  const [launchInterval, setLaunchInterval] = useState<"month" | "year">("month");

  const startLaunchCheckout = async () => {
    if (!user || !agencyId || !isAgencyTeam) {
      toast({
        title: "Sign in as a brand team member",
        description: "Launch checkout is for the workspace you’ll bill.",
        variant: "destructive",
      });
      return;
    }
    setLaunchLoading(true);
    try {
      const fn = httpsCallable(functions, "createOpticSubscriptionCheckoutSession");
      const res = await fn({
        opticPlanId: launchInterval === "year" ? "optic_launch_yearly" : "optic_launch_monthly",
      });
      const url = (res.data as {url?: string})?.url;
      if (!url) throw new Error("No checkout URL");
      window.location.href = url;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({title: "Could not start Launch checkout", description: msg, variant: "destructive"});
    } finally {
      setLaunchLoading(false);
    }
  };

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const fn = httpsCallable(functions, "createOpticBillingPortalSession");
      const res = await fn({});
      const url = (res.data as { url?: string })?.url;
      if (!url) throw new Error("No portal URL");
      window.location.href = url;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Could not open billing", description: msg, variant: "destructive" });
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
        title="Optic plans"
        description="Every brand gets one active campaign free. Launch unlocks more campaigns plus 100 Optic leads a month. Enterprise and Flagship are scoped to the program."
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

      {billing.isAppSumo && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">AppSumo Optic</p>
              <p className="text-sm text-muted-foreground">
                {billing.appsumoCodeCount} code{billing.appsumoCodeCount === 1 ? "" : "s"} ·{" "}
                {billing.allowance} leads/mo · {billing.balance} remaining this month
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/optic/redeem">Redeem another code</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {billing.hasActiveSubscription && !billing.isAppSumo && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium capitalize">
                Current plan: {billing.plan}
                {billing.billingInterval ? ` · ${billing.billingInterval}ly` : ""}
              </p>
              <p className="text-sm text-muted-foreground">
                {billing.balance} credits remaining
                {(billing.plan === "enterprise" || billing.plan === "flagship") &&
                billing.overageLeads > 0
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

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="relative border-primary/40 shadow-md">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Launch
              </CardTitle>
              <Badge>Self-serve</Badge>
            </div>
            <CardDescription>
              For shops and small startups running more than one campaign.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-3xl font-semibold tracking-tight">
                {launchInterval === "year" ? "$687" : "$69"}
              </p>
              <p className="text-sm text-muted-foreground">
                {launchInterval === "year"
                  ? "per year · 100 Optic leads / month"
                  : "per month · 100 Optic leads"}
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={launchInterval === "month" ? "default" : "outline"}
                  onClick={() => setLaunchInterval("month")}
                >
                  Monthly
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={launchInterval === "year" ? "default" : "outline"}
                  onClick={() => setLaunchInterval("year")}
                >
                  Yearly
                </Button>
              </div>
            </div>
            <ul className="space-y-2 text-sm">
              {launchFeatures.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                  {f}
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button className="w-full" disabled={launchLoading} onClick={() => void startLaunchCheckout()}>
              {launchLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Subscribe to Launch
            </Button>
          </CardFooter>
        </Card>

        <Card className="relative">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-amber-500" />
                Enterprise
              </CardTitle>
              <Badge variant="secondary">Program</Badge>
            </div>
            <CardDescription>
              Full Optic workspace for focused creator programs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-3xl font-semibold tracking-tight">Custom</p>
              <p className="text-sm text-muted-foreground">Monthly or annual — quote via payment link</p>
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
          <CardFooter>
            <Button className="w-full" asChild>
              <a href={PROPOSAL_MAIL}>
                <Mail className="mr-2 h-4 w-4" />
                Request access
              </a>
            </Button>
          </CardFooter>
        </Card>

        <Card className="relative">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Flagship
              </CardTitle>
              <Badge variant="outline">Custom</Badge>
            </div>
            <CardDescription>
              Multi-channel capacity for category programs — commercial terms per deal.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-3xl font-semibold tracking-tight">Custom</p>
              <p className="text-sm text-muted-foreground">Monthly or annual — quote via payment link</p>
            </div>
            <ul className="space-y-2 text-sm">
              {flagshipFeatures.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                  {f}
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button className="w-full" asChild>
              <a href={`${PROPOSAL_MAIL}%20%C2%B7%20Flagship`}>
                <Mail className="mr-2 h-4 w-4" />
                Request Flagship access
              </a>
            </Button>
          </CardFooter>
        </Card>
      </div>

      <p className="text-center text-xs text-muted-foreground max-w-2xl mx-auto">
        Every workspace can run one live campaign at no charge. Launch is self-serve. Enterprise and
        Flagship are quoted to the brief — we send a payment link. Media budgets for creator payouts
        stay separate.
      </p>
    </div>
  );
}
