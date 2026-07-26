"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import {
  AlertTriangle,
  Bell,
  Loader2,
  Sparkles,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { BrandContextStrip } from "@/components/optic/brand-context-strip";
import { OpticIntegrationsSection } from "@/components/optic/optic-integrations-section";
import { OpticBrowserExtensionCard } from "@/components/optic/optic-browser-extension-card";
import { OpticExtensionProgressCard } from "@/components/optic/optic-extension-progress";
import { OpticCreditsBadge } from "@/components/optic/optic-credits-badge";
import { OpticNoCreditsCard } from "@/components/optic/optic-no-credits-card";
import { DiscoveryTimeline } from "@/components/optic/discovery-timeline";
import { MissionsList } from "@/components/optic/missions-list";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useOpticActiveJob } from "@/hooks/use-optic-active-job";
import { useOpticCampaigns } from "@/hooks/use-optic-campaigns";
import { useOpticCredits } from "@/hooks/use-optic-credits";
import { useOpticJobs } from "@/hooks/use-optic-jobs";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";
import {
  OPTIC_AUDIENCE_TIERS,
  OPTIC_AUDIENCE_TIER_SLUGS,
  OPTIC_DEFAULT_AUDIENCE_TIER,
  OPTIC_DEFAULT_BATCH_SIZE,
  OPTIC_MAX_BATCH_SIZE,
  type OpticAudienceTier,
} from "@/lib/optic/constants";
import { startOpticExtensionJob } from "@/lib/optic/extension-bridge";
import {
  firstOpticPlatformFromCampaign,
  OPTIC_PLATFORMS,
} from "@/lib/optic/platforms";
import {
  isOpticJobInFlight,
  OPTIC_ACTIVE_JOB_STORAGE_KEY,
} from "@/lib/optic/types";
import type { Timestamp } from "firebase/firestore";

function tsToDate(ts: Timestamp | undefined | null): Date | null {
  if (!ts || typeof ts.toDate !== "function") return null;
  try {
    return ts.toDate();
  } catch {
    return null;
  }
}

export default function OpticDiscoveryPage() {
  const { user, isLoading: authLoading, isAgencyTeam, getUserIdToken } = useAuth();
  const { toast } = useToast();

  const agencyId = user?.primaryAgencyId ?? null;
  const canRun = isAgencyTeam;

  const {
    campaigns,
    campaignId,
    setCampaignId,
    selectedCampaign,
    brandStrip,
    payScopeHint,
    loading: campaignsLoading,
  } = useOpticCampaigns(agencyId, user?.displayName ?? null);

  const [platform, setPlatform] = useState("youtube");
  const [objectives, setObjectives] = useState("");
  const [maxProfiles, setMaxProfiles] = useState(OPTIC_DEFAULT_BATCH_SIZE);
  const [useInstagramExtension, setUseInstagramExtension] = useState(true);
  const [audienceTier, setAudienceTier] = useState<OpticAudienceTier>(
    OPTIC_DEFAULT_AUDIENCE_TIER
  );
  const [continuing, setContinuing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem(OPTIC_ACTIVE_JOB_STORAGE_KEY);
  });

  const opticBilling = useOpticCredits(agencyId);
  const {
    balance: opticCredits,
    loading: creditsLoading,
    hasActiveSubscription,
    plan: opticPlan,
  } = opticBilling;
  const canAffordBatch =
    hasActiveSubscription || opticCredits >= maxProfiles;
  const showNoCreditsCard =
    canRun &&
    agencyId &&
    !creditsLoading &&
    !canAffordBatch &&
    !(hasActiveSubscription && opticPlan === "pilot" && opticCredits === 0);

  const { jobs, loading: jobsLoading, error: jobsError } = useOpticJobs(agencyId);

  const { jobRow, listenError, requestNotificationPermission, goToVault } =
    useOpticActiveJob(activeJobId);

  const selectJob = useCallback((jobId: string) => {
    setActiveJobId(jobId);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(OPTIC_ACTIVE_JOB_STORAGE_KEY, jobId);
    }
  }, []);

  useEffect(() => {
    if (jobsLoading || jobs.length === 0) return;
    const stillValid = activeJobId && jobs.some((j) => j.id === activeJobId);
    if (stillValid) return;
    const inFlight = jobs.find((j) => isOpticJobInFlight(j.status));
    selectJob(inFlight?.id ?? jobs[0].id);
  }, [jobs, jobsLoading, activeJobId, selectJob]);

  const inFlightCount = jobs.filter((j) => isOpticJobInFlight(j.status)).length;

  useEffect(() => {
    requestNotificationPermission();
  }, [requestNotificationPermission]);

  useEffect(() => {
    if (!selectedCampaign?.platforms?.length) return;
    setPlatform(firstOpticPlatformFromCampaign(selectedCampaign.platforms));
  }, [campaignId, selectedCampaign]);

  const fillFromCampaign = () => {
    if (!selectedCampaign?.description?.trim()) {
      toast({
        title: "No campaign brief",
        description: "This campaign has no description in Verza yet.",
        variant: "destructive",
      });
      return;
    }
    const head = selectedCampaign.title
      ? `Campaign: ${selectedCampaign.title}\n\n`
      : "";
    setObjectives((head + selectedCampaign.description).trim().slice(0, 4000));
    if (selectedCampaign.platforms?.length) {
      setPlatform(firstOpticPlatformFromCampaign(selectedCampaign.platforms));
    }
  };

  const handOffToExtension = useCallback(
    async (jobId: string) => {
      const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
      const idToken = await getUserIdToken();
      if (!projectId || !idToken) {
        throw new Error("We couldn't connect to Chrome. Refresh this page and try again.");
      }
      try {
        await startOpticExtensionJob({
          jobId,
          idToken,
          projectId,
          useFunctionsEmulator:
            typeof window !== "undefined" && window.location.hostname === "localhost",
        });
      } catch (e) {
        // Nothing else ever claims an extension job, so a queued one that never
        // started would block every later batch. Fail it instead of leaving it hanging.
        const markFailed = httpsCallable(functions, "completeOpticExtensionJob");
        await markFailed({
          jobId,
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
        }).catch(() => {});
        throw e;
      }
    },
    [getUserIdToken]
  );

  const startDiscovery = useCallback(async () => {
    if (!user) {
      toast({ title: "Sign in required", variant: "destructive" });
      return;
    }
    if (!canRun || !agencyId) {
      toast({
        title: "Brand team required",
        description: "Optic runs in the context of your brand workspace on Verza.",
        variant: "destructive",
      });
      return;
    }
    if (!objectives.trim()) {
      toast({ title: "Campaign objectives required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const enqueue = httpsCallable(functions, "enqueueOpticDiscoveryJob");
      const wantsExtension = platform === "instagram" && useInstagramExtension;
      const res = await enqueue({
        platform,
        objectives: objectives.trim(),
        maxProfiles,
        campaignId: campaignId || null,
        smsNotify: Boolean(user.opticSmsEnabled && user.opticSmsPhone),
        useBrowserExtension: wantsExtension,
        audienceTier,
      });
      const data = res.data as { jobId?: string };
      if (!data?.jobId) throw new Error("No jobId returned");
      selectJob(data.jobId);

      if (wantsExtension) {
        await handOffToExtension(data.jobId);
      }

      toast({
        title: wantsExtension ? "Mission started in Chrome" : "Mission started",
        description: wantsExtension
          ? "Leave Chrome open — you’ll see Instagram tabs open and close while Optic looks around."
          : "Track progress here — we’ll add creators to your vault as we go.",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Could not start", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }, [agencyId, audienceTier, campaignId, canRun, handOffToExtension, maxProfiles, objectives, platform, selectJob, toast, useInstagramExtension, user]);

  const continueNextBatch = useCallback(async () => {
    if (!activeJobId) return;
    setContinuing(true);
    try {
      const callable = httpsCallable(functions, "continueOpticDiscoveryJob");
      const res = await callable({ fromJobId: activeJobId });
      const data = res.data as { jobId?: string; runner?: string };
      if (!data?.jobId) throw new Error("No jobId returned");
      selectJob(data.jobId);

      const isExtensionBatch = data.runner === "extension";
      if (isExtensionBatch) {
        await handOffToExtension(data.jobId);
      }

      toast({
        title: isExtensionBatch ? "Next batch started in Chrome" : "Next batch started",
        description: isExtensionBatch
          ? "Leave Chrome open — Optic is looking for creators you don’t have yet."
          : "We will add more creators to your vault when this batch finishes.",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Could not continue", description: msg, variant: "destructive" });
    } finally {
      setContinuing(false);
    }
  }, [activeJobId, handOffToExtension, selectJob, toast]);

  const cancelJob = useCallback(async () => {
    if (!activeJobId) return;
    try {
      const cancel = httpsCallable(functions, "cancelOpticDiscoveryJob");
      await cancel({ jobId: activeJobId });
      toast({ title: "Cancellation sent" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Cancel failed", description: msg, variant: "destructive" });
    }
  }, [activeJobId, toast]);

  const jobStatusBadge = (() => {
    const s = jobRow?.status ?? "";
    if (!s) return null;
    const variant =
      s === "failed"
        ? "destructive"
        : s === "completed"
          ? "default"
          : s === "cancelled"
            ? "outline"
            : "secondary";
    return <Badge variant={variant}>{s}</Badge>;
  })();

  if (authLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container max-w-3xl py-10">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Sign in</AlertTitle>
          <AlertDescription>Sign in to run Optic discovery from the web.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container max-w-6xl space-y-6 py-8">
      <PageHeader
        title="Verza Optic"
        description="Run small batches of creator discovery. When a batch finishes, continue in the app or by text to keep your vault growing."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {agencyId && canRun && (
              <OpticCreditsBadge balance={opticCredits} loading={creditsLoading} />
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href="/optic/vault">Open vault</Link>
            </Button>
          </div>
        }
      />

      {brandStrip && <BrandContextStrip strip={brandStrip} payScopeHint={payScopeHint} />}

      {canRun && agencyId && (
        <OpticIntegrationsSection
          gmailConnected={Boolean(user?.opticGmailConnected)}
          gmailEmail={user?.opticGmailEmail ?? null}
          smsEnabled={Boolean(user?.opticSmsEnabled)}
          smsPhone={user?.opticSmsPhone ?? null}
        />
      )}

      {!agencyId && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Brand workspace</AlertTitle>
          <AlertDescription>
            Link or create a brand workspace on your Verza profile before running discovery.
          </AlertDescription>
        </Alert>
      )}

      {agencyId && !canRun && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Brand team only</AlertTitle>
          <AlertDescription>
            Discovery is for brand owners, admins, and members on your team.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" />
              New mission
            </CardTitle>
            <CardDescription>
              Drafts use your brand guide and campaign pay when you pick a campaign below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Platform</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPTIC_PLATFORMS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Same platforms as campaign launch, except LinkedIn (no automated scout yet).
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="optic-objectives">Campaign objectives</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-2 text-xs"
                  disabled={!selectedCampaign?.description}
                  onClick={fillFromCampaign}
                >
                  Use campaign brief
                </Button>
              </div>
              <Textarea
                id="optic-objectives"
                placeholder="Who you want to reach and what the partnership is about…"
                value={objectives}
                onChange={(e) => setObjectives(e.target.value)}
                rows={6}
              />
            </div>

            <div className="space-y-2">
              <Label>Outreach campaign (pay + scope in draft)</Label>
              <Select
                value={campaignId || "__pool__"}
                onValueChange={(v) => setCampaignId(v === "__pool__" ? "" : v)}
                disabled={campaignsLoading || !agencyId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All active campaigns" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__pool__">Auto — pool all active campaigns</SelectItem>
                  {campaigns.map((g) => {
                    const rate =
                      g.ratePerCreator > 0
                        ? `$${g.ratePerCreator.toLocaleString()} · `
                        : "";
                    const plat = g.platforms.slice(0, 2).join(", ");
                    return (
                      <SelectItem key={g.id} value={g.id}>
                        {g.status === "open" ? "Open" : "Live"}: {(g.title || "Campaign").slice(0, 48)}
                        {g.title && g.title.length > 48 ? "…" : ""} · {rate}
                        {plat}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="optic-max">Creators per batch</Label>
              <Input
                id="optic-max"
                type="number"
                min={1}
                max={OPTIC_MAX_BATCH_SIZE}
                value={maxProfiles}
                onChange={(e) =>
                  setMaxProfiles(
                    Math.min(
                      OPTIC_MAX_BATCH_SIZE,
                      Math.max(1, Number.parseInt(e.target.value || String(OPTIC_DEFAULT_BATCH_SIZE), 10))
                    )
                  )
                }
              />
              <p className="text-xs text-muted-foreground">
                Up to {OPTIC_MAX_BATCH_SIZE} per batch when you search Instagram from your own
                browser. Other platforms review up to 25 at a time. To build a bigger list, run
                another batch with <strong>Continue</strong>, or reply <strong>CONTINUE</strong>{" "}
                to the text we send you.
              </p>
            </div>

            <OpticBrowserExtensionCard
              instagramSelected={platform === "instagram"}
              useExtension={useInstagramExtension}
              onUseExtensionChange={setUseInstagramExtension}
            />

            {platform === "instagram" && useInstagramExtension && (
              <div className="space-y-2">
                <Label htmlFor="optic-audience">Audience size</Label>
                <Select
                  value={audienceTier}
                  onValueChange={(v) => setAudienceTier(v as OpticAudienceTier)}
                >
                  <SelectTrigger id="optic-audience">
                    <SelectValue placeholder="Any size (100+)" />
                  </SelectTrigger>
                  <SelectContent>
                    {OPTIC_AUDIENCE_TIER_SLUGS.map((slug) => (
                      <SelectItem key={slug} value={slug}>
                        {OPTIC_AUDIENCE_TIERS[slug].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {OPTIC_AUDIENCE_TIERS[audienceTier].hint}. Anyone outside this range is passed
                  over before they cost you a credit, and we always skip inactive accounts.
                </p>
              </div>
            )}

            {inFlightCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {inFlightCount} mission{inFlightCount === 1 ? "" : "s"} in progress — pick one on the
                right to watch the log.
              </p>
            )}

            {showNoCreditsCard && (
              <OpticNoCreditsCard
                batchSize={maxProfiles}
                balance={opticCredits}
                hasActiveSubscription={hasActiveSubscription}
                plan={opticPlan}
              />
            )}
            {canRun && agencyId && hasActiveSubscription && opticPlan === "pilot" && opticCredits === 0 && (
              <OpticNoCreditsCard
                balance={0}
                hasActiveSubscription
                plan="pilot"
              />
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void startDiscovery()}
                disabled={
                  submitting ||
                  !canRun ||
                  !agencyId ||
                  !objectives.trim() ||
                  creditsLoading ||
                  !canAffordBatch
                }
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting…
                  </>
                ) : (
                  "Start mission"
                )}
              </Button>
              {activeJobId && jobRow && isOpticJobInFlight(jobRow.status) && (
                <Button type="button" variant="outline" onClick={() => void cancelJob()}>
                  Stop
                </Button>
              )}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground"
              onClick={requestNotificationPermission}
            >
              <Bell className="mr-2 h-4 w-4" />
              Enable browser alerts when missions finish
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Missions</CardTitle>
            <CardDescription>
              Recent discovery runs for your brand — select one to see live progress. Leads land in{" "}
              <Link href="/optic/vault" className="text-primary underline">
                Optic vault
              </Link>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {jobsError && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">{jobsError}</AlertDescription>
              </Alert>
            )}
            <MissionsList
              jobs={jobs}
              loading={jobsLoading && !!agencyId}
              selectedId={activeJobId}
              onSelect={selectJob}
            />

            {!activeJobId ? (
              <p className="text-sm text-muted-foreground border-t pt-4">
                Select a mission above, or start a new one on the left.
              </p>
            ) : (
              <div className="space-y-4 border-t pt-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-xs">{activeJobId}</span>
                  {jobStatusBadge}
                  {typeof jobRow?.processedCount === "number" && (
                    <span className="text-muted-foreground">
                      · {jobRow.processedCount} saved
                    </span>
                  )}
                </div>
                {jobRow?.createdAt && (
                  <p className="text-xs text-muted-foreground">
                    Started{" "}
                    {formatDistanceToNow(tsToDate(jobRow.createdAt) ?? new Date(), {
                      addSuffix: true,
                    })}
                  </p>
                )}
                {listenError && (
                  <Alert variant="destructive">
                    <AlertDescription className="text-xs">{listenError}</AlertDescription>
                  </Alert>
                )}
                {jobRow?.status === "completed" && (
                  <CompletedMissionActions
                    continuing={continuing}
                    canContinue={canAffordBatch && !creditsLoading}
                    onContinue={() => void continueNextBatch()}
                    onVault={goToVault}
                  />
                )}
                <OpticExtensionProgressCard job={jobRow} />
                <DiscoveryTimeline job={jobRow} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CompletedMissionActions({
  continuing,
  canContinue,
  onContinue,
  onVault,
}: {
  continuing: boolean;
  canContinue: boolean;
  onContinue: () => void;
  onVault: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        variant="default"
        disabled={continuing || !canContinue}
        onClick={onContinue}
      >
        {continuing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Starting…
          </>
        ) : (
          "Run next batch"
        )}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onVault}>
        View leads in vault
      </Button>
    </div>
  );
}
