"use client";

import { useState } from "react";
import { Check, Copy, Gift } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { usePrismPlan, PRISM_TIER_LABEL, type PrismPlanTier } from "@/hooks/use-prism-plan";
import { usePrismReferral, type PrismReferral } from "@/hooks/use-prism-referral";

type Eligible = Extract<PrismReferral, { eligible: true }>;

function rewardText(referral: Eligible, tier: PrismPlanTier): string {
  if (referral.reward === "video") return `${referral.videoSeconds} seconds of AI video`;
  const worth = referral.monthCents ? ` (worth $${Math.round(referral.monthCents / 100)})` : "";
  return `a free month of ${PRISM_TIER_LABEL[tier]}${worth}, taken off your next bill`;
}

function offerText(referral: Eligible, tier: PrismPlanTier): string {
  return `Friends get ${referral.friendPercentOff}% off their first month. When they pay, you get ${rewardText(referral, tier)}. Up to ${referral.capPerYear} a year.`;
}

/** Link, copy button and progress. */
function ReferralShare({ referral }: { referral: Eligible }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(referral.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input readOnly value={referral.url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-sm" />
        <Button variant="outline" onClick={() => void copy()}>
          {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {referral.joined} joined · {referral.rewarded} rewarded · {referral.rewardsThisYear} of {referral.capPerYear}{" "}
        rewards used this year
      </p>
    </div>
  );
}

/** Pricing page card for brands on a paid plan or Lifetime. */
export function PrismReferralCard({ agencyId, tier }: { agencyId: string; tier: PrismPlanTier }) {
  const { referral } = usePrismReferral(agencyId, tier);
  if (!referral?.eligible) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Gift className="h-5 w-5 text-primary" />
          Share Prism, get a free month
        </CardTitle>
        <CardDescription>{offerText(referral, tier)}</CardDescription>
      </CardHeader>
      <CardContent>
        <ReferralShare referral={referral} />
      </CardContent>
    </Card>
  );
}

/** Always-visible sidebar entry that opens the share dialog. Hidden for brands that can't earn rewards. */
export function PrismReferralSidebarBlock({ agencyId }: { agencyId: string }) {
  const plan = usePrismPlan(agencyId);
  const canRefer = !plan.loading && plan.paid && plan.tier !== "enterprise";
  const { referral } = usePrismReferral(canRefer ? agencyId : null, plan.tier);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!canRefer || !referral?.eligible) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(referral.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const youGet = referral.reward === "video" ? `${referral.videoSeconds}s of AI video` : "a free month";

  return (
    <div className="p-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Share Prism, get a free month"
        className="hidden h-9 w-9 items-center justify-center rounded-md text-primary hover:bg-sidebar-accent group-data-[collapsible=icon]:flex"
      >
        <Gift className="h-5 w-5" />
      </button>
      <div className="space-y-3 rounded-lg border border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5 p-3 group-data-[collapsible=icon]:hidden">
        <div className="flex items-start gap-2">
          <div className="rounded-md bg-primary/15 p-1.5">
            <Gift className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">Share Prism, get {youGet}</p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              Friends get {referral.friendPercentOff}% off their first month. You get {youGet} when they pay.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="h-8 flex-1" onClick={() => void copy()}>
            {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button size="sm" variant="outline" className="h-8 bg-background/60" onClick={() => setOpen(true)}>
            Details
          </Button>
        </div>
        {referral.rewarded > 0 && (
          <p className="text-xs text-muted-foreground">
            {referral.rewarded} earned · {referral.joined} joined
          </p>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-primary" />
              Share Prism, get a free month
            </DialogTitle>
            <DialogDescription>{offerText(referral, plan.tier)}</DialogDescription>
          </DialogHeader>
          <ReferralShare referral={referral} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
