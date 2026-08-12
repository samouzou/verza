"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { ArrowLeft, CheckCircle2, Loader2, Ticket } from "lucide-react";

import { OpticCreditsBadge } from "@/components/optic/optic-credits-badge";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useOpticCredits } from "@/hooks/use-optic-credits";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";

type RedeemResult = {
  codeCount: number;
  allowance: number;
  balance: number;
  leadsPerCode: number;
  maxCodes: number;
};

export default function OpticRedeemPage() {
  const { user, isLoading: authLoading, isAgencyTeam } = useAuth();
  const agencyId = user?.primaryAgencyId ?? null;
  const billing = useOpticCredits(agencyId);
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<RedeemResult | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      toast({ title: "Enter your code", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const fn = httpsCallable<{ code: string }, RedeemResult>(
        functions,
        "redeemAppSumoOpticCode"
      );
      const res = await fn({ code: trimmed });
      setLastResult(res.data);
      setCode("");
      toast({
        title: "Code redeemed",
        description: `${res.data.allowance} Optic leads/mo on this workspace.`,
      });
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Could not redeem code.";
      toast({ title: "Redemption failed", description: msg, variant: "destructive" });
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

  return (
    <div className="container max-w-xl space-y-8 py-8">
      <PageHeader
        title="Redeem AppSumo code"
        description="Each code adds 50 Optic leads and AI drafts per month for life. Stack codes on this workspace for a higher monthly allowance."
        actions={
          <div className="flex flex-wrap gap-2">
            {agencyId && isAgencyTeam && (
              <OpticCreditsBadge balance={billing.balance} loading={billing.loading} />
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href="/optic">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Optic
              </Link>
            </Button>
          </div>
        }
      />

      {!isAgencyTeam && (
        <Alert>
          <AlertTitle>Brand or agency account required</AlertTitle>
          <AlertDescription>
            Sign in with a brand/agency workspace to redeem. Creators do not need Optic
            codes.
          </AlertDescription>
        </Alert>
      )}

      {isAgencyTeam && !agencyId && (
        <Alert variant="destructive">
          <AlertTitle>No workspace yet</AlertTitle>
          <AlertDescription>
            Create your brand or agency on Verza first, then come back to redeem.
          </AlertDescription>
        </Alert>
      )}

      {billing.isAppSumo && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="space-y-1 py-4">
            <p className="font-medium">AppSumo Optic active</p>
            <p className="text-sm text-muted-foreground">
              {billing.appsumoCodeCount} code{billing.appsumoCodeCount === 1 ? "" : "s"} ·{" "}
              {billing.allowance} leads/mo · {billing.balance} remaining this month
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Ticket className="h-5 w-5 text-emerald-600" />
            Enter your code
          </CardTitle>
          <CardDescription>
            Paste the code from your AppSumo library. You can redeem additional codes later
            to stack more monthly leads (up to 10 codes / 500 leads/mo).
          </CardDescription>
        </CardHeader>
        <form onSubmit={(e) => void onSubmit(e)}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="appsumo-code">AppSumo code</Label>
              <Input
                id="appsumo-code"
                autoComplete="off"
                spellCheck={false}
                placeholder="AS-VERZ-XXXXX-XXXXX"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={!isAgencyTeam || !agencyId || busy}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={!isAgencyTeam || !agencyId || busy || !code.trim()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Redeem"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      {lastResult && (
        <Alert className="border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertTitle>You&apos;re set</AlertTitle>
          <AlertDescription>
            {lastResult.codeCount} code{lastResult.codeCount === 1 ? "" : "s"} ·{" "}
            {lastResult.allowance} leads/mo.{" "}
            <Link href="/optic" className="font-medium text-primary underline-offset-4 hover:underline">
              Open Optic discovery
            </Link>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
