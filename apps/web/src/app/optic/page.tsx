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
import { GmailConnectCard } from "@/components/optic/gmail-connect-card";
import { OpticSmsCard } from "@/components/optic/optic-sms-card";
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
import { useOpticJobs } from "@/hooks/use-optic-jobs";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";
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
  const { user, isLoading: authLoading, isAgencyTeam } = useAuth();
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
  const [maxProfiles, setMaxProfiles] = useState(10);
  const [continuing, setContinuing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem(OPTIC_ACTIVE_JOB_STORAGE_KEY);
  });

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
      const res = await enqueue({
        platform,
        objectives: objectives.trim(),
        maxProfiles,
        campaignId: campaignId || null,
        smsNotify: Boolean(user.opticSmsEnabled && user.opticSmsPhone),
      });
      const data = res.data as { jobId?: string };
      if (!data?.jobId) throw new Error("No jobId returned");
      selectJob(data.jobId);
      toast({
        title: "Mission started",
        description: "Track progress here — we’ll add creators to your vault as we go.",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Could not start", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }, [agencyId, campaignId, canRun, maxProfiles, objectives, platform, selectJob, toast, user]);

  const continueNextBatch = useCallback(async () => {
    if (!activeJobId) return;
    setContinuing(true);
    try {
      const callable = httpsCallable(functions, "continueOpticDiscoveryJob");
      const res = await callable({ fromJobId: activeJobId });
      const data = res.data as { jobId?: string };
      if (!data?.jobId) throw new Error("No jobId returned");
      selectJob(data.jobId);
      toast({
        title: "Next batch started",
        description: "We will add more creators to your vault when this batch finishes.",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Could not continue", description: msg, variant: "destructive" });
    } finally {
      setContinuing(false);
    }
  }, [activeJobId, selectJob, toast]);

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
          <Button variant="outline" size="sm" asChild>
            <Link href="/optic/vault">Open vault</Link>
          </Button>
        }
      />

      {brandStrip && <BrandContextStrip strip={brandStrip} payScopeHint={payScopeHint} />}

      {canRun && agencyId && (
        <div className="grid gap-4 md:grid-cols-2">
          <GmailConnectCard
            connected={Boolean(user?.opticGmailConnected)}
            email={user?.opticGmailEmail ?? null}
          />
          <OpticSmsCard
            enabled={Boolean(user?.opticSmsEnabled)}
            phone={user?.opticSmsPhone ?? null}
          />
        </div>
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
                max={15}
                value={maxProfiles}
                onChange={(e) =>
                  setMaxProfiles(
                    Math.min(15, Math.max(1, Number.parseInt(e.target.value || "10", 10)))
                  )
                }
              />
              <p className="text-xs text-muted-foreground">
                Small batches finish faster and keep quality high. Run another batch from here or
                reply <strong>CONTINUE</strong> by text when you have alerts on.
              </p>
            </div>

            {inFlightCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {inFlightCount} mission{inFlightCount === 1 ? "" : "s"} in progress — pick one on the
                right to watch the log.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void startDiscovery()}
                disabled={submitting || !canRun || !agencyId || !objectives.trim()}
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
                    onContinue={() => void continueNextBatch()}
                    onVault={goToVault}
                  />
                )}
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
  onContinue,
  onVault,
}: {
  continuing: boolean;
  onContinue: () => void;
  onVault: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="default" disabled={continuing} onClick={onContinue}>
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
