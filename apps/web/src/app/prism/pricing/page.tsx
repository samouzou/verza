"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { CalendarDays, Check, Crown, Loader2, Mail, Rocket, Sparkles } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { PrismPlanBadge } from "@/components/prism/prism-plan";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  PRISM_TIER_LABEL,
  PRISM_TIERS,
  PRISM_TRIAL_DAYS,
  PRISM_X_MARKUP,
  usePrismPlan,
  type PrismPlanTier,
  type PrismSelfServeTier,
} from "@/hooks/use-prism-plan";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";
import { readPrismPromo } from "@/lib/prism/promo";
import { cn } from "@/lib/utils";

type Interval = "month" | "year";
type PlanPrices = Record<PrismSelfServeTier, { monthlyCents: number | null; yearlyCents: number | null }>;
type ChangePreview = {
  fromTier: PrismPlanTier;
  fromCents: number;
  fromInterval: Interval;
  toTier: PrismSelfServeTier;
  toCents: number;
  toInterval: Interval;
  currency: string;
  same: boolean;
  dueNowCents?: number;
  creditCents?: number;
  trialEndsAt?: string | null;
  nextChargeAt?: string | null;
  nextChargeCents?: number;
};

/** Shown until Stripe answers (and if it can't); Checkout always charges the Stripe price. */
const LIST_PRICES: PlanPrices = {
  starter: { monthlyCents: 2900, yearlyCents: 29000 },
  launch: { monthlyCents: 7900, yearlyCents: 79000 },
  pro: { monthlyCents: 14900, yearlyCents: 149000 },
};

const RANK: Record<PrismPlanTier, number> = { free: 0, lifetime: 1, starter: 1, launch: 2, pro: 3, enterprise: 4 };

const ENTERPRISE_MAIL = "mailto:serge@tryverza.com?subject=Prism%20Enterprise";

const n = (v: number) => v.toLocaleString("en-US");
const seconds = (s: number) => (s >= 60 && s % 60 === 0 ? `${s / 60} minute${s === 60 ? "" : "s"}` : `${s} seconds`);

const PLANS: {
  tier: PrismSelfServeTier;
  name: string;
  icon: typeof Sparkles;
  blurb: string;
  features: string[];
}[] = [
  {
    tier: "starter",
    name: "Starter",
    icon: Sparkles,
    blurb: "For founders and small teams who post themselves.",
    features: [
      "Calendar, composer and team approvals",
      `${n(PRISM_TIERS.starter.ai!)} AI actions a month`,
      "Studio: batch a week of drafts any time",
      "Unlimited branded carousels (PDF and PNG)",
      `${PRISM_TIERS.starter.graphics} Instagram feed graphics a month`,
      "AI Reels and TikToks with video credit packs",
      "Copy, approve and mark posted by hand",
    ],
  },
  {
    tier: "launch",
    name: "Launch",
    icon: Rocket,
    blurb: "For brands that want Prism to publish for them.",
    features: [
      "Everything in Starter",
      `${n(PRISM_TIERS.launch.ai!)} AI actions a month`,
      "Auto-publishing to LinkedIn, X, Instagram and TikTok",
      `${PRISM_TIERS.launch.graphics} feed graphics a month`,
      `${seconds(PRISM_TIERS.launch.videoSeconds)} of 1080p AI video a month`,
      `$${PRISM_TIERS.launch.xIncludedDollars} of X API fees included monthly`,
    ],
  },
  {
    tier: "pro",
    name: "Pro",
    icon: Crown,
    blurb: "For brands posting daily across every channel.",
    features: [
      "Everything in Launch",
      `${n(PRISM_TIERS.pro.ai!)} AI actions a month`,
      "Unlimited feed graphics",
      `${seconds(PRISM_TIERS.pro.videoSeconds)} of 1080p AI video a month`,
      `$${PRISM_TIERS.pro.xIncludedDollars} of X API fees included monthly`,
      "Priority support",
    ],
  },
];

const enterpriseFeatures = [
  "Unlimited AI actions",
  "Multiple brands under one contract",
  "Custom workflows and X fees covered",
  "Dedicated onboarding and support",
];

const COMPARE: { label: string; value: (t: PrismPlanTier) => string }[] = [
  { label: "AI actions a month", value: (t) => (PRISM_TIERS[t].ai === null ? "Unlimited" : n(PRISM_TIERS[t].ai!)) },
  {
    label: "Feed graphics a month",
    value: (t) => (PRISM_TIERS[t].graphics === null ? "Unlimited" : String(PRISM_TIERS[t].graphics)),
  },
  {
    label: "AI video included",
    value: (t) => (PRISM_TIERS[t].videoSeconds ? `${PRISM_TIERS[t].videoSeconds}s / month` : "Packs"),
  },
  { label: "Auto-publishing", value: (t) => (PRISM_TIERS[t].publish ? "Yes" : "—") },
  { label: "X API fees included", value: (t) => (PRISM_TIERS[t].xIncludedDollars ? `$${PRISM_TIERS[t].xIncludedDollars} / month` : "—") },
];

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
  const [billingInterval, setBillingInterval] = useState<Interval>("month");
  const [prices, setPrices] = useState<PlanPrices>(LIST_PRICES);
  const [currency, setCurrency] = useState("usd");
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [promo, setPromo] = useState<string | null>(null);

  useEffect(() => {
    setPromo(readPrismPromo());
  }, []);

  useEffect(() => {
    if (plan.billingInterval) setBillingInterval(plan.billingInterval);
  }, [plan.billingInterval]);

  useEffect(() => {
    if (!user) return;
    httpsCallable(functions, "getPrismPricing")({})
      .then((res) => {
        const data = res.data as { currency?: string; plans?: Partial<PlanPrices> };
        if (!data.plans) return;
        setPrices((prev) => {
          const next = { ...prev };
          for (const tier of Object.keys(prev) as PrismSelfServeTier[]) {
            const p = data.plans?.[tier];
            if (p?.monthlyCents || p?.yearlyCents) {
              next[tier] = { monthlyCents: p.monthlyCents ?? prev[tier].monthlyCents, yearlyCents: p.yearlyCents ?? prev[tier].yearlyCents };
            }
          }
          return next;
        });
        if (data.currency) setCurrency(data.currency);
      })
      .catch(() => undefined);
  }, [user]);

  const requireTeam = () => {
    if (user && agencyId && isAgencyTeam) return true;
    toast({ title: "Sign in as a brand team member", description: "Billing is for the workspace you'll use Prism in.", variant: "destructive" });
    return false;
  };

  const startCheckout = async (tier: PrismSelfServeTier) => {
    if (!requireTeam()) return;
    setBusy(tier);
    try {
      const res = await httpsCallable(functions, "createPrismSubscriptionCheckoutSession")({
        plan: tier,
        interval: billingInterval,
        promoCode: promo,
      });
      const url = (res.data as { url?: string })?.url;
      if (!url) throw new Error("No checkout URL");
      window.location.href = url;
    } catch (e: unknown) {
      toast({ title: "Could not start checkout", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      setBusy(null);
    }
  };

  const previewSwitch = async (tier: PrismSelfServeTier) => {
    if (!requireTeam()) return;
    setBusy(tier);
    try {
      const res = await httpsCallable(functions, "previewPrismPlanChange")({ plan: tier, interval: billingInterval });
      setPreview(res.data as ChangePreview);
    } catch (e: unknown) {
      toast({ title: "Could not price that change", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const confirmSwitch = async () => {
    if (!preview) return;
    const { toTier, toInterval } = preview;
    setBusy("confirm");
    try {
      await httpsCallable(functions, "changePrismPlan")({ plan: toTier, interval: toInterval });
      setPreview(null);
      toast({ title: `You're on ${PRISM_TIER_LABEL[toTier]}`, description: "Your new limits apply right away." });
    } catch (e: unknown) {
      toast({ title: "Could not change plan", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const openPortal = async () => {
    setBusy("portal");
    try {
      const res = await httpsCallable(functions, "createPrismBillingPortalSession")({});
      const url = (res.data as { url?: string })?.url;
      if (!url) throw new Error("No portal URL");
      window.location.href = url;
    } catch (e: unknown) {
      toast({ title: "Could not open billing", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      setBusy(null);
    }
  };

  const savings = (tier: PrismSelfServeTier) => {
    const { monthlyCents, yearlyCents } = prices[tier];
    return monthlyCents && yearlyCents ? Math.round((1 - yearlyCents / (monthlyCents * 12)) * 100) : null;
  };
  const yearlySavings = savings("launch");
  const showPromo = !!promo && !plan.loading && !plan.selfServe && plan.tier !== "enterprise";

  const action = (tier: PrismSelfServeTier): { label: string; disabled?: boolean; onClick?: () => void; variant?: "default" | "outline" } => {
    const name = tier[0].toUpperCase() + tier.slice(1);
    if (plan.loading) return { label: "Loading…", disabled: true };
    if (plan.tier === "enterprise") return { label: "Included in Enterprise", disabled: true, variant: "outline" };
    if (plan.tier === "lifetime" && tier === "starter") return { label: "Included in your Lifetime deal", disabled: true, variant: "outline" };
    if (plan.selfServe) {
      if (plan.tier === tier && plan.billingInterval === billingInterval) {
        return { label: "Manage billing", onClick: () => void openPortal(), variant: "outline" };
      }
      if (plan.tier === tier) return { label: `Switch to ${billingInterval}ly`, onClick: () => void previewSwitch(tier), variant: "outline" };
      return {
        label: RANK[tier] > RANK[plan.tier] ? `Upgrade to ${name}` : `Switch to ${name}`,
        onClick: () => void previewSwitch(tier),
        variant: RANK[tier] > RANK[plan.tier] ? "default" : "outline",
      };
    }
    return {
      label: plan.trialEligible && !showPromo ? `Start ${PRISM_TRIAL_DAYS}-day free trial` : plan.tier === "lifetime" ? `Upgrade to ${name}` : `Get ${name}`,
      onClick: () => void startCheckout(tier),
      variant: tier === "launch" ? "default" : "outline",
    };
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container max-w-6xl space-y-8 py-8">
      <PageHeader
        title="Prism plans"
        description={`Every plan starts with a ${PRISM_TRIAL_DAYS}-day free trial. Pick the AI, design and video you need, and add auto-publishing when you're ready.`}
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
              Everything in Starter, for good. {n(plan.aiUsed)} of {n(plan.aiLimit ?? 0)} AI actions and{" "}
              {(plan.graphicsLimit ?? 0) - (plan.graphicsLeft ?? 0)} of {plan.graphicsLimit} feed graphics used this month.
              Upgrade to Launch or Pro to publish automatically; your Lifetime stays if you ever cancel.
            </p>
          </CardContent>
        </Card>
      )}

      {plan.paid && plan.tier !== "lifetime" && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">
                Current plan: {PRISM_TIER_LABEL[plan.tier]}
                {plan.billingInterval ? ` · ${plan.billingInterval}ly` : ""}
              </p>
              <p className="text-sm text-muted-foreground">
                {plan.aiLimit === null
                  ? "Unlimited AI actions"
                  : `${n(plan.aiUsed)} of ${n(plan.aiLimit)} AI actions used this month`}
                {plan.graphicsLimit !== null ? ` · ${plan.graphicsLeft} of ${plan.graphicsLimit} feed graphics left` : ""}
              </p>
            </div>
            {plan.selfServe && (
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void openPortal()}>
                {busy === "portal" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Invoices, card and cancellation"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {plan.subscriptionStatus === "past_due" && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">Your last Prism payment failed. Update your card to keep your plan.</p>
            <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void openPortal()}>
              Update payment
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-center">
        <div className="inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
          {(["month", "year"] as const).map((i) => (
            <Button
              key={i}
              type="button"
              size="sm"
              variant={billingInterval === i ? "default" : "ghost"}
              onClick={() => setBillingInterval(i)}
            >
              {i === "month" ? "Monthly" : "Yearly"}
              {i === "year" && yearlySavings ? (
                <span className={cn("ml-2 text-xs", billingInterval === "year" ? "opacity-90" : "text-emerald-600")}>
                  2 months free
                </span>
              ) : null}
            </Button>
          ))}
        </div>
      </div>

      {showPromo && (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="py-4 text-sm">
            Code <span className="font-mono font-semibold">{promo}</span> is saved. We&rsquo;ll apply it at checkout in place of
            the free trial, and you&rsquo;ll see the discount before you pay.
          </CardContent>
        </Card>
      )}

      {plan.trialEndsAt && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-4 text-sm">
            Your free trial ends {new Date(plan.trialEndsAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })}.
            Your card is charged then unless you cancel from &ldquo;Invoices, card and cancellation&rdquo;.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {PLANS.map((p) => {
          const Icon = p.icon;
          const cents = billingInterval === "year" ? prices[p.tier].yearlyCents : prices[p.tier].monthlyCents;
          const perMonth = billingInterval === "year" && cents ? money(Math.round(cents / 12), currency) : null;
          const current = plan.tier === p.tier && !plan.loading;
          const a = action(p.tier);
          const featured = p.tier === "launch";
          return (
            <Card key={p.tier} className={cn("relative flex flex-col", featured && "border-primary/50 shadow-md")}>
              {featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="shadow-sm">Recommended</Badge>
                </div>
              )}
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2">
                    <Icon className={cn("h-5 w-5", featured ? "text-primary" : p.tier === "pro" ? "text-amber-500" : "text-muted-foreground")} />
                    {p.name}
                  </CardTitle>
                  {current && <Badge>Current</Badge>}
                </div>
                <CardDescription>{p.blurb}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 space-y-4">
                <div>
                  <p className="text-3xl font-semibold tracking-tight">
                    {billingInterval === "year" ? perMonth ?? "—" : money(cents, currency) ?? "—"}
                    <span className="ml-1 text-base font-normal text-muted-foreground">/month</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {billingInterval === "year"
                      ? `${money(cents, currency) ?? "—"} billed yearly${savings(p.tier) ? ` · save ${savings(p.tier)}%` : ""}`
                      : "billed monthly, cancel any time"}
                  </p>
                  {!plan.loading && !plan.selfServe && plan.trialEligible && !showPromo && !(plan.tier === "lifetime" && p.tier === "starter") && (
                    <p className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      Free for {PRISM_TRIAL_DAYS} days, then {money(cents, currency) ?? "—"}/{billingInterval}. Cancel before then
                      and pay nothing.
                    </p>
                  )}
                </div>
                <FeatureList items={p.features} />
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  variant={a.variant ?? "default"}
                  disabled={a.disabled || busy !== null}
                  onClick={a.onClick}
                >
                  {busy === p.tier ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {a.label}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">The calendar stays free.</span> Without a plan your team can still plan,
          write, review and approve posts by hand, and invited reviewers never need a seat. AI writing, Studio, design, video
          and auto-publishing come with a plan.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 py-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-lg font-semibold">Enterprise</p>
              {plan.tier === "enterprise" && <Badge>Current</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">For agencies and teams running several brands. Custom terms, monthly or annual.</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {enterpriseFeatures.map((f) => (
                <span key={f} className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-emerald-600" />
                  {f}
                </span>
              ))}
            </div>
          </div>
          <Button variant="outline" asChild className="shrink-0">
            <a href={ENTERPRISE_MAIL}>
              <Mail className="mr-2 h-4 w-4" />
              Talk to us
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compare plans</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium" />
                {(["starter", "launch", "pro"] as const).map((t) => (
                  <th key={t} className={cn("py-2 pr-4 font-medium", plan.tier === t && "text-foreground")}>
                    {PRISM_TIER_LABEL[t].replace("Prism ", "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((row) => (
                <tr key={row.label} className="border-b last:border-0">
                  <td className="py-2 pr-4 text-muted-foreground">{row.label}</td>
                  {(["starter", "launch", "pro"] as const).map((t) => (
                    <td key={t} className="py-2 pr-4">
                      {row.value(t)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="mx-auto max-w-3xl space-y-2 text-center text-xs text-muted-foreground">
        <p>
          Prices are per brand. An AI action is one piece of generated copy: adapting a post to one channel, one Studio
          draft, a script or a newsletter. A weekly plan counts as 2 and a month plan as 5. Usage resets on the 1st of
          each month (UTC).
        </p>
        <p>
          Video: 1 credit is 1 second of finished 1080p video. Included seconds reset monthly; extra packs (60 seconds for
          $18, 200 for $55, 600 for $150) never expire. X charges per post: beyond your included fees you pay X&apos;s
          rates plus {PRISM_X_MARKUP * 100}% processing on your next invoice.
        </p>
      </div>

      <AlertDialog open={preview !== null} onOpenChange={(open) => !open && busy !== "confirm" && setPreview(null)}>
        <AlertDialogContent>
          {preview && <ChangeSummary preview={preview} />}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "confirm"}>Keep my plan</AlertDialogCancel>
            {preview && !preview.same && (
              <Button disabled={busy === "confirm"} onClick={() => void confirmSwitch()}>
                {busy === "confirm" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {preview.dueNowCents ? `Pay ${money(preview.dueNowCents, preview.currency)} and switch` : "Confirm switch"}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ChangeSummary({ preview: p }: { preview: ChangePreview }) {
  const price = (cents: number, interval: Interval) => `${money(cents, p.currency)}/${interval}`;
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const rows: [string, string][] = [
    ["Current plan", `${PRISM_TIER_LABEL[p.fromTier]} · ${price(p.fromCents, p.fromInterval)}`],
    ["New plan", `${PRISM_TIER_LABEL[p.toTier]} · ${price(p.toCents, p.toInterval)}`],
  ];
  if (!p.same) {
    if (p.trialEndsAt) rows.push(["Due today", `${money(0, p.currency)} (you're still in your free trial)`]);
    else if (p.dueNowCents) rows.push(["Due today", `${money(p.dueNowCents, p.currency)}, prorated for the rest of this period`]);
    else rows.push(["Due today", money(0, p.currency) ?? "$0"]);
    if (p.creditCents) rows.push(["Credit", `${money(p.creditCents, p.currency)} for the unused part of your plan, applied to future invoices`]);
    if (p.nextChargeAt && p.nextChargeCents) rows.push(["Next charge", `${money(p.nextChargeCents, p.currency)} on ${date(p.nextChargeAt)}`]);
  }
  return (
    <AlertDialogHeader>
      <AlertDialogTitle>{p.same ? "You're already on this plan" : `Switch to ${PRISM_TIER_LABEL[p.toTier]}?`}</AlertDialogTitle>
      <AlertDialogDescription asChild>
        <div className="space-y-3 pt-2">
          <dl className="divide-y rounded-md border text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-3 py-2">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right font-medium text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
          {!p.same && (
            <p className="text-xs">
              {RANK[p.toTier] < RANK[p.fromTier]
                ? "Your new limits apply right away, including anything above them this month."
                : "Your new limits apply as soon as the payment goes through."}
            </p>
          )}
        </div>
      </AlertDialogDescription>
    </AlertDialogHeader>
  );
}
