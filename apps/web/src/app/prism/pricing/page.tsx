"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { Check, Loader2, Mail, Sparkles, Zap } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { PrismPlanBadge } from "@/components/prism/prism-plan";
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
import {
  PRISM_AI_LIMITS,
  PRISM_FREE_SLIDE_RENDERS,
  PRISM_LIFETIME_GRAPHICS,
  PRISM_FREE_STUDIO_RUNS,
  PRISM_X_INCLUDED_DOLLARS,
  PRISM_X_MARKUP,
  usePrismPlan,
} from "@/hooks/use-prism-plan";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";

const freeFeatures = [
  "Content calendar, composer and approvals",
  "All channels: LinkedIn, X, Instagram, TikTok, YouTube, newsletter",
  "Brand strategy and voice profile",
  `${PRISM_AI_LIMITS.free} AI actions a month`,
  `Try Studio once and render ${PRISM_FREE_SLIDE_RENDERS} carousels`,
  "One free 10-second AI video",
];

const launchFeatures = [
  "Everything in Free",
  "Studio: batch a week of drafts any time",
  "Unlimited carousel slides and feed graphics",
  "AI month plans, channel adaptation, scripts and newsletters",
  `${PRISM_AI_LIMITS.launch.toLocaleString()} AI actions a month`,
  "60 seconds of AI Reels and TikToks a month (1080p); top up from $18",
  "Auto-publishing to LinkedIn, X, Instagram and TikTok",
  `$${PRISM_X_INCLUDED_DOLLARS} of X API fees included monthly; beyond that, X's rates + ${PRISM_X_MARKUP * 100}% processing`,
];

const enterpriseFeatures = [
  "Everything in Launch",
  "Unlimited AI actions",
  "Multiple brands and custom workflows",
  "Dedicated onboarding and support",
  "Custom terms, monthly or annual",
];

const ENTERPRISE_MAIL = "mailto:serge@tryverza.com?subject=Prism%20Enterprise";

function money(cents: number | null | undefined, currency: string): string | null {
  if (typeof cents !== "number") return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {items.map((f) => (
        <li key={f} className="flex gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          {f}
        </li>
      ))}
    </ul>
  );
}

export default function PrismPricingPage() {
  const { user, isLoading: authLoading, isAgencyTeam } = useAuth();
  const { toast } = useToast();
  const agencyId = user?.primaryAgencyId ?? null;
  const plan = usePrismPlan(agencyId);
  const [billingInterval, setBillingInterval] = useState<"month" | "year">("month");
  const [prices, setPrices] = useState<{ monthlyCents: number | null; yearlyCents: number | null; currency: string }>({
    monthlyCents: 19900,
    yearlyCents: null,
    currency: "usd",
  });
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    httpsCallable(functions, "getPrismPricing")({})
      .then((res) => setPrices(res.data as typeof prices))
      .catch(() => undefined);
  }, [user]);

  const monthly = money(prices.monthlyCents, prices.currency);
  const yearly = money(prices.yearlyCents, prices.currency);
  const yearlyPerMonth = money(prices.yearlyCents ? Math.round(prices.yearlyCents / 12) : null, prices.currency);
  const savings =
    prices.monthlyCents && prices.yearlyCents
      ? Math.round((1 - prices.yearlyCents / (prices.monthlyCents * 12)) * 100)
      : null;

  const startCheckout = async () => {
    if (!user || !agencyId || !isAgencyTeam) {
      toast({ title: "Sign in as a brand team member", description: "Checkout is for the workspace you'll bill.", variant: "destructive" });
      return;
    }
    setCheckoutLoading(true);
    try {
      const res = await httpsCallable(functions, "createPrismSubscriptionCheckoutSession")({ interval: billingInterval });
      const url = (res.data as { url?: string })?.url;
      if (!url) throw new Error("No checkout URL");
      window.location.href = url;
    } catch (e: unknown) {
      toast({ title: "Could not start checkout", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setCheckoutLoading(false);
    }
  };

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const res = await httpsCallable(functions, "createPrismBillingPortalSession")({});
      const url = (res.data as { url?: string })?.url;
      if (!url) throw new Error("No portal URL");
      window.location.href = url;
    } catch (e: unknown) {
      toast({ title: "Could not open billing", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
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
        title="Prism plans"
        description="Plan, write and approve content for free. Launch adds Studio, unlimited slides and room for daily AI work."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {agencyId && isAgencyTeam && <PrismPlanBadge plan={plan} />}
            <Button variant="outline" size="sm" asChild>
              <Link href="/prism">Back to calendar</Link>
            </Button>
          </div>
        }
      />

      {plan.tier === "lifetime" && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="space-y-1 py-4">
            <p className="font-medium">Current plan: Prism Lifetime (AppSumo)</p>
            <p className="text-sm text-muted-foreground">
              {plan.aiUsed.toLocaleString()} of {(plan.aiLimit ?? 0).toLocaleString()} AI actions and{" "}
              {PRISM_LIFETIME_GRAPHICS - (plan.graphicsLeft ?? 0)} of {PRISM_LIFETIME_GRAPHICS} feed graphics used this month ·
              unlimited carousels · video credits sold separately. Upgrade to Launch to publish automatically.
            </p>
          </CardContent>
        </Card>
      )}

      {plan.canPublish && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium capitalize">
                Current plan: Prism {plan.tier}
                {plan.billingInterval ? ` · ${plan.billingInterval}ly` : ""}
              </p>
              <p className="text-sm text-muted-foreground">
                {plan.aiLimit === null
                  ? "Unlimited AI actions"
                  : `${plan.aiUsed.toLocaleString()} of ${plan.aiLimit.toLocaleString()} AI actions used this month`}
              </p>
            </div>
            <Button variant="outline" size="sm" disabled={portalLoading} onClick={() => void openPortal()}>
              {portalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Manage billing"}
            </Button>
          </CardContent>
        </Card>
      )}

      {plan.subscriptionStatus === "past_due" && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">Your last Prism payment failed. Update your card to keep Launch.</p>
            <Button variant="outline" size="sm" disabled={portalLoading} onClick={() => void openPortal()}>
              Update payment
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="relative">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-muted-foreground" />
                Free
              </CardTitle>
              {plan.tier === "free" && !plan.loading && <Badge variant="secondary">Current</Badge>}
            </div>
            <CardDescription>Everything you need to run a content calendar as a team.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-3xl font-semibold tracking-tight">$0</p>
              <p className="text-sm text-muted-foreground">forever</p>
            </div>
            <FeatureList items={freeFeatures} />
            {plan.tier === "free" && !plan.loading && (
              <p className="text-xs text-muted-foreground">
                {Math.max(0, (plan.aiLimit ?? 0) - plan.aiUsed)} AI actions left this month · {plan.studioRunsLeft} of {PRISM_FREE_STUDIO_RUNS} Studio
                run left · {plan.slideRendersLeft} of {PRISM_FREE_SLIDE_RENDERS} slide or graphic renders left
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="relative border-primary/40 shadow-md">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Launch
              </CardTitle>
              <Badge>{plan.tier === "launch" ? "Current" : "Self-serve"}</Badge>
            </div>
            <CardDescription>For brands publishing every week across several channels.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-3xl font-semibold tracking-tight">
                {billingInterval === "year" ? yearly ?? "—" : monthly ?? "—"}
              </p>
              <p className="text-sm text-muted-foreground">
                {billingInterval === "year"
                  ? `per year${yearlyPerMonth ? ` · ${yearlyPerMonth}/month` : ""}${savings ? ` · save ${savings}%` : ""}`
                  : "per month"}
              </p>
              <div className="mt-3 flex gap-2">
                <Button type="button" size="sm" variant={billingInterval === "month" ? "default" : "outline"} onClick={() => setBillingInterval("month")}>
                  Monthly
                </Button>
                <Button type="button" size="sm" variant={billingInterval === "year" ? "default" : "outline"} onClick={() => setBillingInterval("year")}>
                  Yearly
                </Button>
              </div>
            </div>
            <FeatureList items={launchFeatures} />
          </CardContent>
          <CardFooter>
            {plan.canPublish ? (
              <Button className="w-full" variant="outline" disabled={portalLoading} onClick={() => void openPortal()}>
                Manage billing
              </Button>
            ) : (
              <Button className="w-full" disabled={checkoutLoading || plan.loading} onClick={() => void startCheckout()}>
                {checkoutLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Upgrade to Launch
              </Button>
            )}
          </CardFooter>
        </Card>

        <Card className="relative">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-amber-500" />
                Enterprise
              </CardTitle>
              <Badge variant={plan.tier === "enterprise" ? "default" : "outline"}>
                {plan.tier === "enterprise" ? "Current" : "Custom"}
              </Badge>
            </div>
            <CardDescription>For teams and agencies running content at scale.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-3xl font-semibold tracking-tight">Custom</p>
              <p className="text-sm text-muted-foreground">Monthly or annual, quoted via payment link</p>
            </div>
            <FeatureList items={enterpriseFeatures} />
          </CardContent>
          <CardFooter>
            <Button className="w-full" variant="outline" asChild>
              <a href={ENTERPRISE_MAIL}>
                <Mail className="mr-2 h-4 w-4" />
                Talk to us
              </a>
            </Button>
          </CardFooter>
        </Card>
      </div>

      <p className="mx-auto max-w-2xl text-center text-xs text-muted-foreground">
        An AI action is one piece of generated copy: adapting a post to one channel, one Studio draft, a script or a
        newsletter. A weekly plan counts as 2 and a month plan as 5. Usage resets on the 1st of each month (UTC).
      </p>
    </div>
  );
}
