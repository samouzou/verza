"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  NotebookPen,
  Settings2,
  Sparkles,
  Video,
} from "lucide-react";
import type { Timestamp } from "firebase/firestore";

import { PageHeader } from "@/components/page-header";
import { CarouselAssets } from "@/components/prism/carousel-assets";
import { PrismPlanBadge, toastPrismLimit } from "@/components/prism/prism-plan";
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
import { useLinkedInOsJobs } from "@/hooks/use-linkedin-os-jobs";
import { usePrismBrand } from "@/hooks/use-prism-brand";
import { PRISM_PRICING_PATH, PRISM_TRIAL_DAYS, usePrismPlan } from "@/hooks/use-prism-plan";
import { useStudioJobPosts } from "@/hooks/use-prism-posts";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { functions } from "@/lib/firebase";
import {
  isLinkedInOsJobInFlight,
  LINKEDIN_OS_CTAS,
  LINKEDIN_OS_VIDEO_PLATFORMS,
  PRODUCT_RECEIPTS_OUTPUT_ID,
  type LinkedInOsBeehiivNewsletter,
  type LinkedInOsJobItem,
  type LinkedInOsJobOutput,
  type LinkedInOsJobRow,
  type LinkedInOsVideoPlatform,
  type LinkedInOsVideoScript,
} from "@/lib/linkedin-os/types";
import {
  PRISM_CHANNEL_META,
  PRISM_CHANNELS,
  PRISM_FORMATS,
  PRISM_STATUS_META,
  prismFormatLabel,
  type PrismBrandStrategy,
  type PrismChannel,
  type PrismPost,
} from "@/lib/prism/types";
import { cn } from "@/lib/utils";

const NO_DATE = "none";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function isoDay(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses YYYY-MM-DD as a local date (noon, so DST never shifts the day). */
function fromIsoDay(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

function addDays(s: string, n: number) {
  const d = fromIsoDay(s);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

function mondayOf(d: Date) {
  const back = (d.getDay() + 6) % 7;
  return isoDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, 12));
}

/** This week while at least two days are left, otherwise next week. */
function defaultWeekStart() {
  const now = new Date();
  const monday = mondayOf(now);
  return now.getDay() === 6 || now.getDay() === 0 ? addDays(monday, 7) : monday;
}

function weekLabelFor(weekStart: string) {
  return `Week of ${fromIsoDay(weekStart).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/** Days of the week that haven't passed yet. */
function openDays(weekStart: string) {
  const today = isoDay(new Date());
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter((d) => d >= today);
}

/** One starter slot per enabled channel, cycling through the brand's pillars and the open days. */
function defaultQueue(strategy: PrismBrandStrategy, weekStart: string): LinkedInOsJobItem[] {
  const channels = PRISM_CHANNELS.filter((ch) => strategy.channels[ch].enabled);
  const days = openDays(weekStart);
  return channels.map((channel, i) => ({
    id: `${channel}-${i + 1}`,
    channel,
    pillar: strategy.pillars[i % Math.max(1, strategy.pillars.length)]?.id ?? "",
    format: PRISM_FORMATS[channel][0].value,
    hook: "",
    productTruth: "",
    cta: "comment",
    notes: "",
    ...(days.length ? { date: days[(i * 2) % days.length] } : {}),
  }));
}

function ChannelChip({ channel }: { channel: PrismChannel | undefined }) {
  const meta = PRISM_CHANNEL_META[channel ?? "linkedin"];
  return (
    <Badge variant="outline" className={meta.chip}>
      {meta.label}
    </Badge>
  );
}

function tsToDate(ts: Timestamp | undefined | null): Date | null {
  if (!ts || typeof ts.toDate !== "function") return null;
  try {
    return ts.toDate();
  } catch {
    return null;
  }
}

function statusBadgeVariant(status: string | undefined) {
  if (status === "completed") return "default" as const;
  if (status === "failed") return "destructive" as const;
  if (status === "running" || status === "queued") return "secondary" as const;
  return "outline" as const;
}

/**
 * One Studio draft. Once it's on the calendar, shows the live post (status, date, latest copy);
 * edits and approvals happen in the calendar.
 */
function StudioDraftCard({
  out,
  post,
  postsLoaded,
  pillarLabel,
  adding,
  onAdd,
  onOpen,
}: {
  out: LinkedInOsJobOutput;
  post: PrismPost | undefined;
  postsLoaded: boolean;
  pillarLabel: (id: string) => string;
  adding: boolean;
  onAdd: () => void;
  onOpen: (postId: string) => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const channel: PrismChannel = out.channel ?? "linkedin";
  const variant = post?.variants?.[channel];
  const text = variant?.text ?? out.markdown;
  const assets = variant ? variant.assets : out.carouselAssets;
  const removed = postsLoaded && !!out.postId && !post;

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: "Copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ChannelChip channel={out.channel} />
            <p className="text-sm font-medium truncate">{post?.title ?? out.id}</p>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {pillarLabel(out.pillar)} · {prismFormatLabel(variant?.format ?? out.format)}
            {post && (
              <>
                {" · "}
                {post.scheduledAt
                  ? new Date(post.scheduledAt).toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "Unscheduled"}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {post ? (
            <>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("h-2 w-2 rounded-full", PRISM_STATUS_META[post.status].dot)} />
                {PRISM_STATUS_META[post.status].label}
              </span>
              <Button size="sm" variant="outline" onClick={() => onOpen(post.id)}>
                <ExternalLink className="mr-1 h-4 w-4" />
                Open
              </Button>
            </>
          ) : postsLoaded ? (
            <Button size="sm" variant="outline" disabled={adding} onClick={onAdd}>
              {adding ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CalendarPlus className="mr-1 h-4 w-4" />}
              {removed ? "Add again" : "Add to calendar"}
            </Button>
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          <Button size="sm" variant="ghost" onClick={() => void copy()} title="Copy">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {removed && <p className="text-xs text-muted-foreground">This draft was deleted from the calendar.</p>}
      {post && post.channels.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Shares one calendar post with {post.channels.filter((c) => c !== channel).map((c) => PRISM_CHANNEL_META[c].label).join(", ")}.
        </p>
      )}
      <pre className="text-sm whitespace-pre-wrap font-sans text-muted-foreground max-h-64 overflow-y-auto">{text}</pre>
      {assets && assets.slides.length > 0 && <CarouselAssets assets={assets} />}
    </div>
  );
}

function VideoRepurposePanel({
  jobId,
  videoScripts,
}: {
  jobId: string;
  videoScripts?: LinkedInOsVideoScript[];
}) {
  const { toast } = useToast();
  const [platform, setPlatform] = useState<LinkedInOsVideoPlatform>("tiktok");
  const [generating, setGenerating] = useState(false);
  const [copiedPlatform, setCopiedPlatform] = useState<LinkedInOsVideoPlatform | null>(null);

  const platformMeta = LINKEDIN_OS_VIDEO_PLATFORMS.find((p) => p.value === platform);
  const activeScript = videoScripts?.find((s) => s.platform === platform);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const generate = httpsCallable(functions, "generateLinkedInOsVideoScript");
      await generate({ jobId, platform });
      toast({
        title: "Video script ready",
        description: `${platformMeta?.label ?? platform} script saved on this job.`,
      });
    } catch (e: unknown) {
      if (toastPrismLimit(toast, e)) return;
      const msg = e instanceof Error ? e.message : "Could not generate video script.";
      toast({ title: "Generation failed", description: msg, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const copyScript = async (script: LinkedInOsVideoScript) => {
    await navigator.clipboard.writeText(script.markdown);
    setCopiedPlatform(script.platform);
    toast({ title: "Script copied" });
    setTimeout(() => setCopiedPlatform(null), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Video className="h-5 w-5 text-primary" />
          Repurpose for video
        </CardTitle>
        <CardDescription>
          Turn this week&apos;s drafts into one platform-specific script. Edit before you
          film.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Platform</Label>
          <Select
            value={platform}
            onValueChange={(v) => setPlatform(v as LinkedInOsVideoPlatform)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LINKEDIN_OS_VIDEO_PLATFORMS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label} — {p.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          className="w-full"
          variant="secondary"
          disabled={generating}
          onClick={() => void handleGenerate()}
        >
          {generating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Writing script…
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Generate {platformMeta?.label ?? "video"} script
            </>
          )}
        </Button>

        {activeScript ? (
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{platformMeta?.label} script</p>
              <Button size="sm" variant="outline" onClick={() => void copyScript(activeScript)}>
                {copiedPlatform === activeScript.platform ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <pre className="text-sm whitespace-pre-wrap font-sans text-muted-foreground max-h-80 overflow-y-auto">
              {activeScript.markdown}
            </pre>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No {platformMeta?.label} script yet—generate one from the drafts above.
          </p>
        )}

        {(videoScripts?.length ?? 0) > 1 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {videoScripts!.map((script) => {
              const label =
                LINKEDIN_OS_VIDEO_PLATFORMS.find((p) => p.value === script.platform)?.label ??
                script.platform;
              return (
                <Badge
                  key={script.platform}
                  variant={script.platform === platform ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setPlatform(script.platform)}
                >
                  {label}
                </Badge>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BeehiivNewsletterPanel({
  jobId,
  weekLabel,
  carouselSlideCount,
  beehiivNewsletter,
}: {
  jobId: string;
  weekLabel?: string;
  carouselSlideCount: number;
  beehiivNewsletter?: LinkedInOsBeehiivNewsletter;
}) {
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const generate = httpsCallable(functions, "generateLinkedInOsBeehiivNewsletter");
      await generate({ jobId });
      toast({
        title: "Beehiiv draft ready",
        description: "Newsletter saved on this job—copy into Beehiiv and add slide images.",
      });
    } catch (e: unknown) {
      if (toastPrismLimit(toast, e)) return;
      const msg = e instanceof Error ? e.message : "Could not generate newsletter.";
      toast({ title: "Generation failed", description: msg, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const copyNewsletter = async () => {
    if (!beehiivNewsletter?.markdown) return;
    await navigator.clipboard.writeText(beehiivNewsletter.markdown);
    setCopied(true);
    toast({ title: "Newsletter copied" });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          Beehiiv newsletter
        </CardTitle>
        <CardDescription>
          Repurpose <span className="font-medium">{PRODUCT_RECEIPTS_OUTPUT_ID}</span>
          {weekLabel ? ` (${weekLabel})` : ""} — one section per carousel slide
          {carouselSlideCount > 0 ? ` (${carouselSlideCount} slides)` : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          className="w-full"
          variant="secondary"
          disabled={generating}
          onClick={() => void handleGenerate()}
        >
          {generating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Writing newsletter…
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Generate Beehiiv draft
            </>
          )}
        </Button>

        {beehiivNewsletter ? (
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Newsletter draft</p>
              <Button size="sm" variant="outline" onClick={() => void copyNewsletter()}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            {(beehiivNewsletter.slideImageUrls?.length ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                Slide images are included as links you can paste into Beehiiv. Those links stop
                working after about a week—copy the newsletter soon if you need the images.
              </p>
            )}
            <pre className="text-sm whitespace-pre-wrap font-sans text-muted-foreground max-h-96 overflow-y-auto">
              {beehiivNewsletter.markdown}
            </pre>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Builds from your Thursday product-receipts carousel text and slide images when they exist.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function PrismStudioPage() {
  const { user, isLoading: authLoading, isAgencyTeam } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const agencyId = user?.primaryAgencyId ?? null;
  const { jobs, error: jobsError, loading: jobsLoading } = useLinkedInOsJobs(agencyId);
  const { strategy, loading: strategyLoading } = usePrismBrand(agencyId);
  const plan = usePrismPlan(agencyId);

  const [weekStart, setWeekStart] = useState(defaultWeekStart);
  const weekLabel = weekLabelFor(weekStart);
  const [items, setItems] = useState<LinkedInOsJobItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [weeklyBrief, setWeeklyBrief] = useState("");
  const [mustMention, setMustMention] = useState("");
  const [neverMention, setNeverMention] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planRationale, setPlanRationale] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  const selectedJob: LinkedInOsJobRow | null = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) ?? jobs[0] ?? null,
    [jobs, selectedJobId]
  );
  const { posts: jobPosts, loaded: jobPostsLoaded } = useStudioJobPosts(agencyId, selectedJob?.id ?? null);

  const weekOptions = useMemo(() => {
    const current = mondayOf(new Date());
    return [0, 1, 2, 3].map((n) => {
      const start = addDays(current, n * 7);
      const end = fromIsoDay(addDays(start, 6));
      const range = `${fromIsoDay(start).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
      return { value: start, label: n === 0 ? `This week (${range})` : n === 1 ? `Next week (${range})` : range };
    });
  }, []);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const todayIso = isoDay(new Date());

  /** Moves the queue to another week, keeping each post on the same weekday when it's still ahead. */
  const changeWeek = (next: string) => {
    const shift = Math.round((fromIsoDay(next).getTime() - fromIsoDay(weekStart).getTime()) / 86400000);
    setItems((prev) =>
      prev.map((it) => {
        if (!it.date) return it;
        const date = addDays(it.date, shift);
        return date >= todayIso ? { ...it, date } : { ...it, date: undefined };
      })
    );
    setWeekStart(next);
  };

  const productReceiptsOutput = useMemo(() => {
    if (!selectedJob?.outputs?.length) return null;
    return (
      selectedJob.outputs.find(
        (o) => o.id === PRODUCT_RECEIPTS_OUTPUT_ID && o.format === "carousel_outline"
      ) ??
      selectedJob.outputs.find((o) => o.format === "carousel_outline") ??
      null
    );
  }, [selectedJob]);

  const inFlight = jobs.some((j) => isLinkedInOsJobInFlight(j.status));

  useEffect(() => {
    if (strategy && items.length === 0) setItems(defaultQueue(strategy, weekStart));
    // Seed once when the brand loads; week changes are handled by changeWeek.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy, items.length]);

  const pillarLabel = useCallback(
    (id: string) => strategy?.pillars.find((p) => p.id === id)?.label ?? id.replace(/_/g, " "),
    [strategy]
  );

  const updateItem = useCallback((index: number, patch: Partial<LinkedInOsJobItem>) => {
    setItems((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }, []);

  const handleResetQueue = () => {
    setWeeklyBrief("");
    setMustMention("");
    setNeverMention("");
    setPlanRationale(null);
    setItems(strategy ? defaultQueue(strategy, weekStart) : []);
  };

  const handleGeneratePlan = async () => {
    setPlanning(true);
    try {
      const plan = httpsCallable(functions, "generateLinkedInOsWeeklyPlan");
      const result = await plan({
        weekLabel,
        weekStart,
        ...(weeklyBrief.trim() ? { weeklyBrief: weeklyBrief.trim() } : {}),
        ...(mustMention.trim() ? { mustMention: mustMention.trim() } : {}),
        ...(neverMention.trim() ? { neverMention: neverMention.trim() } : {}),
      });
      const data = result.data as { items?: LinkedInOsJobItem[]; rationale?: string };
      if (!data.items?.length) {
        throw new Error("Plan returned no items.");
      }
      setItems(data.items.map((x) => ({ ...x })));
      setPlanRationale(data.rationale?.trim() || null);
      toast({
        title: "Weekly plan ready",
        description: "Review hooks, truths and days, then write the drafts.",
      });
    } catch (e: unknown) {
      if (toastPrismLimit(toast, e)) return;
      const msg = e instanceof Error ? e.message : "Could not generate plan.";
      toast({ title: "Plan failed", description: msg, variant: "destructive" });
    } finally {
      setPlanning(false);
    }
  };

  const handleGenerate = async () => {
    if (!user) return;
    const valid = items.filter((x) => x.pillar.trim());
    if (valid.length === 0) {
      toast({ title: "Add at least one post", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const enqueue = httpsCallable(functions, "enqueueLinkedInOsDraftJob");
      const result = await enqueue({
        weekLabel,
        weekStart,
        reviewer: user.displayName || user.email || "Reviewer",
        items: valid,
        ...(weeklyBrief.trim() ? { weeklyBrief: weeklyBrief.trim() } : {}),
        ...(mustMention.trim() ? { mustMention: mustMention.trim() } : {}),
        ...(neverMention.trim() ? { neverMention: neverMention.trim() } : {}),
      });
      const data = result.data as { jobId?: string };
      if (data.jobId) setSelectedJobId(data.jobId);
      toast({
        title: "Writing your drafts",
        description: "They'll land on the calendar as drafts in a minute or two.",
      });
    } catch (e: unknown) {
      if (toastPrismLimit(toast, e)) return;
      const msg = e instanceof Error ? e.message : "Failed to enqueue job.";
      toast({ title: "Could not start job", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const openPost = (postId: string) => router.push(`/prism?post=${postId}`);

  /** For drafts from jobs that ran before Studio wrote straight to the calendar. */
  const addToCalendar = async (out: LinkedInOsJobOutput) => {
    if (!selectedJob) return;
    setAddingId(out.id);
    try {
      const res = await httpsCallable(functions, "addStudioDraftToCalendar")({ jobId: selectedJob.id, outputId: out.id });
      const { postId, existing } = res.data as { postId: string; existing: boolean };
      toast({
        title: existing ? "Already on the calendar" : "Added to the calendar",
        description: existing || out.scheduledAt ? undefined : "It's in Unscheduled. Drag it onto a day.",
        action: (
          <ToastAction altText="Open" onClick={() => openPost(postId)}>
            Open
          </ToastAction>
        ),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not add to the calendar.";
      toast({ title: "Add failed", description: msg, variant: "destructive" });
    } finally {
      setAddingId(null);
    }
  };

  const postForOutput = (out: LinkedInOsJobOutput): PrismPost | undefined => {
    if (out.postId) return jobPosts.get(out.postId);
    for (const p of jobPosts.values()) {
      if (p.studio?.itemId === out.id || p.studio?.itemIds?.includes(out.id)) return p;
    }
    return undefined;
  };

  if (authLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user || !isAgencyTeam) {
    return (
      <div className="max-w-lg mx-auto py-16">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Agency account required</AlertTitle>
          <AlertDescription>
            Prism is for agency team members. Sign in with your agency account or complete
            onboarding first.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!agencyId) {
    return (
      <div className="max-w-lg mx-auto py-16">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Primary agency missing</AlertTitle>
          <AlertDescription>
            Set a primary agency on your profile before using Prism.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-16">
      <PageHeader
        title="Studio"
        description="Batch a week of drafts across channels, render carousels, and spin off video scripts and newsletters. Send the keepers to the calendar."
        actions={
          <>
            <PrismPlanBadge plan={plan} />
            <Button variant="outline" asChild>
              <Link href="/prism">
                <CalendarDays className="mr-2 h-4 w-4" />
                Calendar
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/prism/setup">
                <Settings2 className="mr-2 h-4 w-4" />
                Brand setup
              </Link>
            </Button>
          </>
        }
      />

      {strategyLoading ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : !strategy ? (
        <Card className="border-primary/30 bg-primary/5 max-w-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Set up your brand first
            </CardTitle>
            <CardDescription>
              Prism plans and writes from your brand brief, content pillars, and channel plan. Paste your
              website and it drafts the setup for you in under a minute.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/prism/setup">Set up my brand</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
      <>
      <Alert className="border-primary/30 bg-primary/5">
        <CalendarDays className="h-4 w-4" />
        <AlertTitle>Drafts go straight to the calendar</AlertTitle>
        <AlertDescription>
          Each draft lands on its day as a calendar post. Edit, send for review, approve and mark posted from the
          calendar. Prism only uses facts from {strategy.brandName}&apos;s brand setup.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Plan a week
            </CardTitle>
            <CardDescription>
              Prism proposes the week across your channels from your brand setup and voice. Edit
              anything, then write the drafts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-lg border p-4 space-y-4 bg-muted/5">
              <div className="flex items-start gap-2">
                <NotebookPen className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">Context for this run</p>
                  <p className="text-xs text-muted-foreground">
                    Optional. If this week is different—new audience, launch, or angle—say it here
                    before you generate. We fold this into every post in the run,
                    together with your usual brand guardrails.
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="weekly-brief">Weekly brief / narrative</Label>
                <Textarea
                  id="weekly-brief"
                  rows={4}
                  value={weeklyBrief}
                  onChange={(e) => setWeeklyBrief(e.target.value.slice(0, 6000))}
                  placeholder="Who you're talking to this week, what changed, what to stress or avoid…"
                />
                <p className="text-xs text-muted-foreground text-right">
                  {weeklyBrief.length}/6000
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="must-mention">Must mention (optional)</Label>
                  <Input
                    id="must-mention"
                    value={mustMention}
                    onChange={(e) => setMustMention(e.target.value.slice(0, 500))}
                    placeholder="e.g. a product line you want threaded through"
                    maxLength={500}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="never-mention">Never mention (optional)</Label>
                  <Input
                    id="never-mention"
                    value={neverMention}
                    onChange={(e) => setNeverMention(e.target.value.slice(0, 500))}
                    placeholder="e.g. topics or names to avoid"
                    maxLength={500}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2 max-w-xs">
              <Label>Week</Label>
              <Select value={weekStart} onValueChange={changeWeek}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {weekOptions.map((w) => (
                    <SelectItem key={w.value} value={w.value}>
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={planning}
                onClick={() => void handleGeneratePlan()}
              >
                {planning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Planning…
                  </>
                ) : (
                  <>
                    <CalendarClock className="mr-2 h-4 w-4" />
                    Generate weekly plan
                  </>
                )}
              </Button>
              <Button type="button" variant="ghost" onClick={handleResetQueue}>
                Reset
              </Button>
            </div>
            {planRationale && (
              <p className="text-sm text-muted-foreground rounded-md border bg-muted/10 px-3 py-2">
                {planRationale}
              </p>
            )}

            {items.map((item, index) => (
              <div key={item.id} className="rounded-lg border p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <ChannelChip channel={item.channel} />
                    <p className="text-sm font-medium truncate">{item.id}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Channel</Label>
                    <Select
                      value={item.channel}
                      onValueChange={(v) => {
                        const channel = v as PrismChannel;
                        updateItem(index, { channel, format: PRISM_FORMATS[channel][0].value });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRISM_CHANNELS.map((ch) => (
                          <SelectItem key={ch} value={ch}>
                            {PRISM_CHANNEL_META[ch].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Format</Label>
                    <Select
                      value={item.format}
                      onValueChange={(v) => updateItem(index, { format: v as LinkedInOsJobItem["format"] })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRISM_FORMATS[item.channel].map((f) => (
                          <SelectItem key={f.value} value={f.value}>
                            {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Pillar</Label>
                    <Select value={item.pillar} onValueChange={(v) => updateItem(index, { pillar: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Pillar" />
                      </SelectTrigger>
                      <SelectContent>
                        {strategy.pillars.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>CTA</Label>
                    <Select value={item.cta} onValueChange={(v) => updateItem(index, { cta: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LINKEDIN_OS_CTAS.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Day</Label>
                    <Select
                      value={item.date && weekDays.includes(item.date) ? item.date : NO_DATE}
                      onValueChange={(v) => updateItem(index, { date: v === NO_DATE ? undefined : v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {weekDays.map((d) => (
                          <SelectItem key={d} value={d} disabled={d < todayIso}>
                            {fromIsoDay(d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                          </SelectItem>
                        ))}
                        <SelectItem value={NO_DATE}>No date (Unscheduled)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Idea (optional)</Label>
                  <Input
                    value={item.idea ?? ""}
                    onChange={(e) => updateItem(index, { idea: e.target.value.slice(0, 160) })}
                    placeholder="Same idea + same day on other channels = one calendar post"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Hook</Label>
                  <Input
                    value={item.hook}
                    onChange={(e) => updateItem(index, { hook: e.target.value })}
                    placeholder="First line, or first seconds of the video"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Product truth (one sentence you stand behind)</Label>
                  <Textarea
                    value={item.productTruth}
                    onChange={(e) => updateItem(index, { productTruth: e.target.value })}
                    rows={2}
                    placeholder="From your brand brief. Prism won't go beyond it."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Notes (optional)</Label>
                  <Input
                    value={item.notes ?? ""}
                    onChange={(e) => updateItem(index, { notes: e.target.value })}
                  />
                </div>
              </div>
            ))}

            {items.length < 12 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const channel =
                    PRISM_CHANNELS.find((ch) => strategy.channels[ch].enabled) ?? "linkedin";
                  setItems((prev) => [
                    ...prev,
                    {
                      id: `${channel}-${Date.now().toString(36)}`,
                      channel,
                      pillar: strategy.pillars[0]?.id ?? "",
                      format: PRISM_FORMATS[channel][0].value,
                      hook: "",
                      productTruth: "",
                      cta: "comment",
                      notes: "",
                      ...(openDays(weekStart)[0] ? { date: openDays(weekStart)[0] } : {}),
                    },
                  ]);
                }}
              >
                Add post
              </Button>
            )}

            <Button
              className="w-full"
              size="lg"
              disabled={submitting || inFlight}
              onClick={handleGenerate}
            >
              {submitting || inFlight ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {inFlight ? "Job running…" : "Queuing…"}
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Write drafts to the calendar
                </>
              )}
            </Button>
            {!plan.paid && !plan.loading && (
              <p className="text-center text-xs text-muted-foreground">
                Studio is part of every Prism plan.{" "}
                <Link href={PRISM_PRICING_PATH} className="font-medium text-primary hover:underline">
                  {plan.trialEligible ? `Start a ${PRISM_TRIAL_DAYS}-day free trial` : "Pick a plan"}
                </Link>{" "}
                to batch drafts every week.
              </p>
            )}
          </CardContent>
        </Card>

        {selectedJob?.status === "completed" && productReceiptsOutput && (
          <BeehiivNewsletterPanel
            jobId={selectedJob.id}
            weekLabel={selectedJob.weekLabel}
            carouselSlideCount={productReceiptsOutput.carouselAssets?.slides.length ?? 0}
            beehiivNewsletter={selectedJob.beehiivNewsletter}
          />
        )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent jobs</CardTitle>
              <CardDescription>Job status updates here as soon as they change.</CardDescription>
            </CardHeader>
            <CardContent>
              {jobsError && (
                <p className="text-sm text-destructive mb-3">{jobsError}</p>
              )}
              {jobsLoading ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : jobs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No jobs yet—queue your first week.</p>
              ) : (
                <ul className="space-y-2">
                  {jobs.map((job) => {
                    const created = tsToDate(job.createdAt);
                    return (
                      <li key={job.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedJobId(job.id)}
                          className={`w-full text-left rounded-md border px-3 py-2 transition-colors hover:bg-muted/50 ${
                            selectedJob?.id === job.id ? "border-primary bg-muted/30" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium truncate">
                              {job.weekLabel || job.id}
                            </span>
                            <Badge variant={statusBadgeVariant(job.status)}>{job.status}</Badge>
                          </div>
                          {created && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatDistanceToNow(created, { addSuffix: true })}
                            </p>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {selectedJob && (
            <Card>
              <CardHeader>
                <CardTitle>Drafts</CardTitle>
                <CardDescription>
                  {selectedJob.status === "completed"
                    ? "Each draft is a calendar post. Open it to edit, review and mark posted."
                    : selectedJob.status === "failed"
                      ? selectedJob.error || "Job failed."
                      : "Waiting for the worker…"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {(selectedJob.weeklyBrief ||
                  selectedJob.mustMention ||
                  selectedJob.neverMention) && (
                  <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs space-y-1">
                    <p className="font-medium text-muted-foreground">Run context for this job</p>
                    {selectedJob.weeklyBrief && (
                      <pre className="whitespace-pre-wrap font-sans text-muted-foreground max-h-24 overflow-y-auto">
                        {selectedJob.weeklyBrief}
                      </pre>
                    )}
                    {selectedJob.mustMention && (
                      <p>
                        <span className="text-muted-foreground">Must mention:</span>{" "}
                        {selectedJob.mustMention}
                      </p>
                    )}
                    {selectedJob.neverMention && (
                      <p>
                        <span className="text-muted-foreground">Never mention:</span>{" "}
                        {selectedJob.neverMention}
                      </p>
                    )}
                  </div>
                )}
                {selectedJob.status === "completed" &&
                  (selectedJob.outputs ?? []).map((out) => (
                    <StudioDraftCard
                      key={out.id}
                      out={out}
                      post={postForOutput(out)}
                      postsLoaded={jobPostsLoaded}
                      pillarLabel={pillarLabel}
                      adding={addingId === out.id}
                      onAdd={() => void addToCalendar(out)}
                      onOpen={openPost}
                    />
                  ))}
                {selectedJob.status === "running" && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Still writing your drafts…
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {selectedJob?.status === "completed" && (selectedJob.outputs?.length ?? 0) > 0 && (
            <VideoRepurposePanel
              jobId={selectedJob.id}
              videoScripts={selectedJob.videoScripts}
            />
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
}
