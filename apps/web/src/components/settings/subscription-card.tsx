"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useOpticCredits } from "@/hooks/use-optic-credits";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Settings2, CheckCircle, XCircle, CalendarClock, AlertCircle, Zap, Crown, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import Link from "next/link";

const LEGACY_PLAN_NAMES: Record<string, string> = {
  agency_pilot_monthly: "Pilot (1–9 talents)",
  agency_pilot_yearly: "Pilot (1–9 talents)",
  agency_pro_monthly: "Pro (10–24 talents)",
  agency_pro_yearly: "Pro (10–24 talents)",
  agency_network_monthly: "Network (25–124 talents)",
  agency_network_yearly: "Network (25–124 talents)",
  agency_enterprise_monthly: "Enterprise (125–500 talents)",
  agency_enterprise_yearly: "Enterprise (125–500 talents)",
};

const LIVE_LEGACY_STATUSES = new Set(["active", "trialing", "past_due"]);

function formatDateSafe(timestamp: unknown) {
  if (!timestamp) return "N/A";
  try {
    const t = timestamp as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (t.toDate && typeof t.toDate === "function") {
      return format(t.toDate(), "PPP");
    }
    if (typeof t.seconds === "number" && typeof t.nanoseconds === "number") {
      return format(new Date(t.seconds * 1000 + t.nanoseconds / 1000000), "PPP");
    }
    return format(new Date(timestamp as string | number | Date), "PPP");
  } catch (e) {
    console.warn("Error formatting date:", e, "Timestamp value:", timestamp);
    return "Invalid Date";
  }
}

function legacyPlanName(planId?: string | null) {
  if (!planId) return "Legacy plan";
  return LEGACY_PLAN_NAMES[planId] || planId;
}

export function SubscriptionCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const optic = useOpticCredits(user?.primaryAgencyId);
  const [isProcessingPortal, setIsProcessingPortal] = useState(false);
  const [isProcessingOpticPortal, setIsProcessingOpticPortal] = useState(false);

  if (!user) return null;

  const openAgencyPortal = async () => {
    if (!user.stripeCustomerId) {
      toast({
        title: "Error",
        description: "No Stripe customer ID found. Cannot manage subscription.",
        variant: "destructive",
      });
      return;
    }
    setIsProcessingPortal(true);
    try {
      const firebaseFunctions = getFunctions();
      const createPortalSessionCallable = httpsCallable(firebaseFunctions, "createStripeCustomerPortalSession");
      const result = await createPortalSessionCallable();
      const { url } = result.data as { url: string };
      if (!url) throw new Error("Could not retrieve customer portal URL.");
      window.location.href = url;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Could not open subscription management.";
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setIsProcessingPortal(false);
    }
  };

  const openOpticPortal = async () => {
    setIsProcessingOpticPortal(true);
    try {
      const firebaseFunctions = getFunctions();
      const createPortal = httpsCallable(firebaseFunctions, "createOpticBillingPortalSession");
      const result = await createPortal({});
      const url = (result.data as { url?: string })?.url;
      if (!url) throw new Error("Could not retrieve Optic billing portal URL.");
      window.location.href = url;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Could not open Optic billing.";
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setIsProcessingOpticPortal(false);
    }
  };

  if (!user.isAgencyOwner && user.role !== "agency_admin" && user.role !== "agency_member") {
    return (
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" />
            Creator Plan
          </CardTitle>
          <CardDescription>Your access to Verza as an individual creator.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 border rounded-lg bg-muted/50 flex items-center justify-between">
            <div>
              <p className="font-semibold text-lg">Free Forever</p>
              <p className="text-sm text-muted-foreground mt-1">
                Full access to contracts, invoicing, and deployments — no subscription needed.
              </p>
            </div>
            <Badge className="bg-green-500 text-white hover:bg-green-600 shrink-0">Free Forever</Badge>
          </div>
          <p className="text-xs text-muted-foreground text-center pt-2">
            Verza earns a small fee on invoice payments. No monthly charges, ever.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (user.role === "agency_admin" || user.role === "agency_member") {
    return (
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            Billing
          </CardTitle>
          <CardDescription>Billing for this account is managed by the owner.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-4 border rounded-lg bg-muted/50 text-center">
            <p className="font-semibold text-lg">Your owner manages billing.</p>
            <p className="text-sm text-muted-foreground mt-2">
              Reach out to them if you need to update payment details or subscribe to Optic.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const workspaceLabel = user.isBrandAccount ? "Brand" : "Agency";
  const hasLegacyAgencyPlan = Boolean(user.subscriptionPlanId?.startsWith("agency_"));
  const legacyLive = hasLegacyAgencyPlan && LIVE_LEGACY_STATUSES.has(user.subscriptionStatus || "");
  const legacyCanceled = hasLegacyAgencyPlan && user.subscriptionStatus === "canceled";
  const showLegacy = legacyLive || legacyCanceled;
  const canManageLegacy = !!user.stripeSubscriptionId && showLegacy;

  const opticLabel =
    optic.plan === "launch"
      ? "Optic Launch"
      : optic.plan === "pilot"
        ? "Optic Studio"
        : optic.plan === "enterprise"
          ? "Optic Enterprise"
          : optic.plan === "flagship"
            ? "Optic Flagship"
            : optic.plan === "appsumo"
              ? "AppSumo Optic"
              : "None";

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Crown className="h-6 w-6 text-primary" />
          {workspaceLabel} billing
        </CardTitle>
        <CardDescription>
          You can always run one live campaign. Optic Launch adds more campaigns and creator leads.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {showLegacy ? (
          <div className="p-4 border rounded-lg bg-muted/50 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Your plan</p>
                <p className="font-semibold text-lg">{legacyPlanName(user.subscriptionPlanId)}</p>
              </div>
              {legacyLive && user.subscriptionStatus === "trialing" && (
                <Badge className="bg-blue-500 text-white hover:bg-blue-600">Trial</Badge>
              )}
              {legacyLive && user.subscriptionStatus === "active" && (
                <Badge className="bg-green-500 text-white hover:bg-green-600">Active</Badge>
              )}
              {user.subscriptionStatus === "past_due" && <Badge variant="destructive">Past due</Badge>}
              {legacyCanceled && <Badge variant="secondary">Canceled</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {user.subscriptionStatus === "canceled"
                ? "This plan has been canceled. You can still manage invoices and payment details below."
                : user.subscriptionStatus === "past_due"
                  ? "We could not process your latest payment. Update your card to keep this plan."
                  : "Update your payment details or cancel anytime."}
            </p>
            {user.subscriptionStatus === "trialing" && user.trialEndsAt && (
              <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-300 p-3 border-l-4 border-blue-500 bg-blue-50 dark:bg-blue-900/30 rounded-md">
                <CalendarClock className="h-5 w-5" />
                <span>Trial ends on {formatDateSafe(user.trialEndsAt)}.</span>
              </div>
            )}
            {(user.subscriptionStatus === "active" || user.subscriptionStatus === "canceled") &&
              user.subscriptionEndsAt && (
                <div
                  className={`flex items-center gap-2 text-sm p-3 border-l-4 rounded-md ${
                    user.subscriptionStatus === "active"
                      ? "border-green-500 bg-green-50 dark:bg-green-900/20 text-muted-foreground"
                      : "border-destructive bg-red-50 dark:bg-red-900/20 text-muted-foreground"
                  }`}
                >
                  {user.subscriptionStatus === "active" ? (
                    <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )}
                  <span>
                    {user.subscriptionStatus === "active" ? "Renews on" : "Access ends on"}{" "}
                    {formatDateSafe(user.subscriptionEndsAt)}.
                  </span>
                </div>
              )}
            {user.subscriptionStatus === "past_due" && (
              <div className="flex items-center gap-2 text-sm text-destructive p-3 border-l-4 border-destructive bg-red-50 dark:bg-red-900/20 rounded-md">
                <AlertCircle className="h-5 w-5" />
                <span>Payment is past due. Update the card in the billing portal to keep this plan.</span>
              </div>
            )}
            {canManageLegacy && (
              <Button
                onClick={() => void openAgencyPortal()}
                disabled={isProcessingPortal || !user.stripeCustomerId}
                variant="outline"
                className="w-full"
              >
                {isProcessingPortal ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Settings2 className="mr-2 h-4 w-4" />
                )}
                Manage billing
              </Button>
            )}
          </div>
        ) : (
          <div className="p-4 border rounded-lg bg-muted/50">
            <p className="font-semibold">You can launch a campaign today</p>
            <p className="text-sm text-muted-foreground mt-1">
              One live campaign is included at no extra cost. When you are ready to run more than one, or to
              source creators with Optic, you can add Launch below.
            </p>
          </div>
        )}

        <div className="p-4 border rounded-lg space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Optic</p>
              <p className="font-semibold text-lg">
                {optic.hasActiveSubscription ? opticLabel : "No Optic plan yet"}
              </p>
            </div>
            {optic.hasActiveSubscription && (
              <Badge className="bg-green-500 text-white hover:bg-green-600 capitalize">{optic.plan}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {optic.hasActiveSubscription
              ? `${optic.balance} leads left this period${optic.allowance ? ` · ${optic.allowance}/mo` : ""}.`
              : "Optic Launch is $69 a month, or $687 a year. It lets you run more than one campaign at a time and includes 100 creator leads each month."}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild className="flex-1">
              <Link href="/optic/pricing">
                <Zap className="mr-2 h-4 w-4" />
                {optic.hasActiveSubscription ? "View Optic plans" : "Get Optic Launch"}
              </Link>
            </Button>
            {optic.hasActiveSubscription && !optic.isAppSumo && (
              <Button
                variant="outline"
                className="flex-1"
                disabled={isProcessingOpticPortal}
                onClick={() => void openOpticPortal()}
              >
                {isProcessingOpticPortal ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Settings2 className="mr-2 h-4 w-4" />
                )}
                Manage Optic billing
              </Button>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Payments are processed securely by Stripe.
        </p>
      </CardContent>
    </Card>
  );
}
