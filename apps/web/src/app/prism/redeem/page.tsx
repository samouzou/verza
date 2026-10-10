"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { CheckCircle2, Loader2, Ticket } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { PrismPlanBadge } from "@/components/prism/prism-plan";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { PRISM_TIERS, usePrismPlan } from "@/hooks/use-prism-plan";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";

const INCLUDED = [
  "Content calendar, composer and team approvals on every channel",
  "Brand setup, product catalog and voice profile",
  `${PRISM_TIERS.lifetime.ai} AI actions a month, Studio included`,
  "Unlimited branded carousels (PDF and PNG)",
  `${PRISM_TIERS.lifetime.graphics} Instagram feed graphics a month`,
  "AI Reels and TikToks with video credit packs",
];

export default function PrismRedeemPage() {
  const { user, isLoading: authLoading, isAgencyTeam } = useAuth();
  const agencyId = user?.primaryAgencyId ?? null;
  const plan = usePrismPlan(agencyId);
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await httpsCallable(functions, "redeemAppSumoPrismCode")({ code: trimmed });
      setDone(true);
      setCode("");
      toast({ title: "Prism Lifetime unlocked", description: "Your brand is set for life." });
    } catch (err: unknown) {
      toast({
        title: "Couldn't redeem that code",
        description: err instanceof Error ? err.message : "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const lifetime = plan.tier === "lifetime";
  const canRedeem = isAgencyTeam && !!agencyId && !lifetime && !busy;

  return (
    <div className="container max-w-xl space-y-8 py-8">
      <PageHeader
        title="Redeem your AppSumo code"
        description="One code unlocks Prism Lifetime for one brand: plan, write, design and schedule your social content, for life."
        actions={agencyId && isAgencyTeam ? <PrismPlanBadge plan={plan} /> : undefined}
      />

      {!isAgencyTeam && (
        <Alert>
          <AlertTitle>Brand account required</AlertTitle>
          <AlertDescription>Sign in with a brand or agency workspace to redeem your code.</AlertDescription>
        </Alert>
      )}

      {isAgencyTeam && !agencyId && (
        <Alert variant="destructive">
          <AlertTitle>No brand yet</AlertTitle>
          <AlertDescription>Create your brand on Verza first, then come back to redeem.</AlertDescription>
        </Alert>
      )}

      {lifetime && (
        <Alert className="border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertTitle>{done ? "You're set" : "This brand has Prism Lifetime"}</AlertTitle>
          <AlertDescription>
            <Link href="/prism/setup" className="font-medium text-primary underline-offset-4 hover:underline">
              Set up your brand
            </Link>{" "}
            so Prism writes in your voice, then plan your first month from the{" "}
            <Link href="/prism" className="font-medium text-primary underline-offset-4 hover:underline">
              calendar
            </Link>
            . Have another brand? Switch to it and redeem a second code there.
          </AlertDescription>
        </Alert>
      )}

      {!lifetime && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Ticket className="h-5 w-5 text-emerald-600" />
              Enter your code
            </CardTitle>
            <CardDescription>Paste the code from your AppSumo account. It applies to the brand you&apos;re signed in to.</CardDescription>
          </CardHeader>
          <form onSubmit={(e) => void onSubmit(e)}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="appsumo-code">AppSumo code</Label>
                <Input
                  id="appsumo-code"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="AS-PRSM-XXXXX-XXXXX"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={!isAgencyTeam || !agencyId || busy}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full sm:w-auto" disabled={!canRedeem || !code.trim()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Redeem"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What Prism Lifetime includes</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {INCLUDED.map((item) => (
              <li key={item} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            Lifetime matches our $29/month Starter plan, paid once. Auto-publishing to connected accounts starts on Prism
            Launch: on Lifetime you copy each approved post and mark it posted, or upgrade any time.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
