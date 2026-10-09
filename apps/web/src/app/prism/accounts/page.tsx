"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import { AlertTriangle, CalendarDays, CheckCircle2, Link2, Loader2, RefreshCw, Sparkles, Unlink } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { PrismPlanBadge, toastPrismLimit } from "@/components/prism/prism-plan";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { usePrismConnections, usePrismUsageMonth } from "@/hooks/use-prism-connections";
import { PRISM_PRICING_PATH, PRISM_TIER_LABEL, PRISM_TIERS, PRISM_X_MARKUP, usePrismPlan } from "@/hooks/use-prism-plan";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";
import { PRISM_CHANNEL_META, PRISM_CHANNELS, type PrismChannel } from "@/lib/prism/types";

const CHANNEL_NOTES: Record<PrismChannel, string> = {
  linkedin: "Posts, PDF carousels. Pick your profile or a company page when you connect.",
  x: "Posts and threads.",
  instagram: "Carousels from rendered slides. Needs a Business or Creator account linked to a Facebook Page.",
  tiktok: "Connect now; videos are posted by hand until video upload lands.",
};

const PLATFORM_TO_CHANNEL: Record<string, PrismChannel> = {
  linkedin: "linkedin",
  twitter: "x",
  instagram: "instagram",
  tiktok: "tiktok",
};

function PrismAccountsPage() {
  const { user, isLoading: authLoading, isAgencyTeam } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const agencyId = user?.primaryAgencyId ?? null;
  const plan = usePrismPlan(agencyId);
  const { connections, accounts, loading } = usePrismConnections(agencyId);
  const usage = usePrismUsageMonth(agencyId);
  const x = usage?.x;
  const xSpent = (x?.costMicros ?? 0) / 1e6;
  const xIncluded = PRISM_TIERS[plan.tier].xIncludedDollars;
  const xOver = Math.max(0, xSpent - xIncluded);
  const [busy, setBusy] = useState<string | null>(null);
  const handledRedirect = useRef(false);
  const isLead = user?.role === "agency_owner" || user?.role === "agency_admin";

  const sync = async (quiet = false) => {
    setBusy("sync");
    try {
      await httpsCallable(functions, "syncPrismConnections")({});
      if (!quiet) toast({ title: "Accounts refreshed" });
    } catch (e: unknown) {
      if (!quiet) toast({ title: "Couldn't refresh", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (handledRedirect.current || !user) return;
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (!connected && !error) return;
    handledRedirect.current = true;
    if (error) {
      const message = searchParams.get("error_message");
      toast({ title: "Connection didn't finish", description: message || error.replace(/_/g, " "), variant: "destructive" });
    } else {
      const ch = PLATFORM_TO_CHANNEL[connected ?? ""];
      toast({ title: `${ch ? PRISM_CHANNEL_META[ch].label : "Account"} connected` });
    }
    void sync(true);
    router.replace("/prism/accounts");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, user]);

  const connect = async (ch: PrismChannel) => {
    setBusy(`connect-${ch}`);
    try {
      const res = await httpsCallable(functions, "getPrismConnectUrl")({ channel: ch });
      const url = (res.data as { url?: string })?.url;
      if (!url) throw new Error("No connection URL");
      window.location.href = url;
    } catch (e: unknown) {
      setBusy(null);
      if (toastPrismLimit(toast, e)) return;
      toast({ title: "Couldn't start the connection", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const disconnect = async (ch: PrismChannel) => {
    if (!window.confirm(`Disconnect ${PRISM_CHANNEL_META[ch].label}? Scheduled posts for it will need to be posted by hand.`)) return;
    setBusy(`disconnect-${ch}`);
    try {
      await httpsCallable(functions, "disconnectPrismAccount")({ channel: ch });
      toast({ title: `${PRISM_CHANNEL_META[ch].label} disconnected` });
    } catch (e: unknown) {
      toast({ title: "Couldn't disconnect", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  if (authLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user || !isAgencyTeam || !agencyId) {
    return (
      <div className="max-w-lg mx-auto py-16">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Agency account required</AlertTitle>
          <AlertDescription>Sign in with your brand team account to connect social accounts.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        title="Connected accounts"
        description="Connect your channels and Prism publishes approved posts at their scheduled time."
        actions={
          <>
            <PrismPlanBadge plan={plan} />
            <Button variant="outline" asChild>
              <Link href="/prism">
                <CalendarDays className="mr-2 h-4 w-4" />
                Calendar
              </Link>
            </Button>
            {connections && (
              <Button variant="outline" disabled={busy !== null} onClick={() => void sync()}>
                {busy === "sync" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh
              </Button>
            )}
          </>
        }
      />

      {!plan.loading && !plan.canPublish && (
        <Card className="border-primary/30 bg-primary/5 max-w-3xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Auto-publishing starts on Prism Launch
            </CardTitle>
            <CardDescription>
              On {PRISM_TIER_LABEL[plan.tier]} you copy each approved post and mark it posted. Launch and Pro connect your
              accounts and publish for you at the scheduled time, with retries and alerts if a network rejects a post.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={PRISM_PRICING_PATH}>See plans</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {plan.canPublish && !isLead && (
        <Alert className="max-w-3xl">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Only owners and admins can connect accounts</AlertTitle>
          <AlertDescription>Ask your brand&apos;s owner or an admin to connect the channels you post to.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 max-w-4xl">
        {PRISM_CHANNELS.map((ch) => {
          const account = accounts[ch];
          const connected = account?.status === "connected";
          return (
            <Card key={ch}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{PRISM_CHANNEL_META[ch].label}</CardTitle>
                  {loading ? null : connected ? (
                    <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                      <CheckCircle2 className="h-3 w-3" />
                      Connected
                    </Badge>
                  ) : account ? (
                    <Badge variant="destructive">Reconnect needed</Badge>
                  ) : (
                    <Badge variant="outline">Not connected</Badge>
                  )}
                </div>
                <CardDescription>{CHANNEL_NOTES[ch]}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                {account ? (
                  <div className="flex items-center gap-2 min-w-0">
                    {account.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={account.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                    ) : null}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{account.displayName || account.username}</p>
                      {account.username && <p className="truncate text-xs text-muted-foreground">@{account.username}</p>}
                    </div>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">No account yet</span>
                )}
                <div className="flex gap-2">
                  {(!connected || !account) && (
                    <Button
                      size="sm"
                      disabled={busy !== null || !plan.canPublish || !isLead}
                      onClick={() => void connect(ch)}
                    >
                      {busy === `connect-${ch}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                      {account ? "Reconnect" : "Connect"}
                    </Button>
                  )}
                  {account && isLead && (
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void disconnect(ch)}>
                      {busy === `disconnect-${ch}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unlink className="mr-2 h-4 w-4" />}
                      Disconnect
                    </Button>
                  )}
                </div>
                {ch === "x" && (x?.posts ?? 0) > 0 && (
                  <p className="w-full text-xs text-muted-foreground">
                    This month: {x?.posts} post{x?.posts === 1 ? "" : "s"}, {x?.tweets ?? 0} tweet{x?.tweets === 1 ? "" : "s"}
                    {x?.linkTweets ? ` (${x.linkTweets} with links)` : ""} ·{" "}
                    {plan.tier === "enterprise"
                      ? `about $${xSpent.toFixed(2)} in X API fees, covered by your plan`
                      : `$${Math.min(xSpent, xIncluded).toFixed(2)} of $${xIncluded.toFixed(2)} included X API fees`}
                    {plan.tier !== "enterprise" && xOver > 0 &&
                      ` · $${(xOver * (1 + PRISM_X_MARKUP)).toFixed(2)} over (incl. ${PRISM_X_MARKUP * 100}% processing), added to your next invoice`}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="max-w-3xl text-xs text-muted-foreground">
        Prism publishes a post when it&apos;s approved and its time comes up. Channels that need a video or an image Prism
        doesn&apos;t have yet (Reels, TikTok, single-image Instagram posts) stay on the calendar for you to post by hand.
        You log in on each network&apos;s own page; Prism never sees your password.
      </p>
    </div>
  );
}

export default function PrismAccountsPageWrapper() {
  return (
    <Suspense fallback={null}>
      <PrismAccountsPage />
    </Suspense>
  );
}
