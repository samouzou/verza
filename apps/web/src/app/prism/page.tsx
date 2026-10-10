"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  AlertTriangle,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Loader2,
  Plus,
  Sparkles,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { PostComposer, type ComposerTarget } from "@/components/prism/post-composer";
import { PrismPlanBadge, toastPrismLimit } from "@/components/prism/prism-plan";
import { PostChip, PrismCalendar, PRISM_DRAG_TYPE, type CalendarMarker } from "@/components/prism/prism-calendar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { usePrismBrand } from "@/hooks/use-prism-brand";
import { PRISM_TRIAL_DAYS, usePrismPlan } from "@/hooks/use-prism-plan";
import { usePrismPosts } from "@/hooks/use-prism-posts";
import { useToast } from "@/hooks/use-toast";
import { db, functions } from "@/lib/firebase";
import {
  PRISM_CHANNEL_META,
  PRISM_CHANNELS,
  PRISM_STATUS_META,
  type PrismChannel,
  type PrismPost,
  type PrismPostStatus,
} from "@/lib/prism/types";
import { cn } from "@/lib/utils";

const WEEK_STARTS_ON = 1 as const;

function PrismCalendarPage() {
  const { user, isLoading: authLoading, isAgencyTeam } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const agencyId = user?.primaryAgencyId ?? null;
  const { strategy, loading: strategyLoading } = usePrismBrand(agencyId);
  const plan = usePrismPlan(agencyId);

  const [view, setView] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [channelFilter, setChannelFilter] = useState<PrismChannel[]>([]);
  const [target, setTarget] = useState<ComposerTarget | null>(null);
  const [markers, setMarkers] = useState<CalendarMarker[]>([]);
  const [planOpen, setPlanOpen] = useState(false);
  const [planMonth, setPlanMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [planBrief, setPlanBrief] = useState("");
  const [planning, setPlanning] = useState(false);

  const gridStart = useMemo(
    () =>
      view === "month"
        ? startOfWeek(startOfMonth(anchor), { weekStartsOn: WEEK_STARTS_ON })
        : startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON }),
    [view, anchor]
  );
  const gridEnd = addDays(gridStart, view === "month" ? 42 : 7);
  const fromIso = gridStart.toISOString();
  const toIso = gridEnd.toISOString();
  const { scheduled, unscheduled, loading: postsLoading, error: postsError } = usePrismPosts(agencyId, fromIso, toIso);

  useEffect(() => {
    const id = searchParams.get("post");
    if (id) setTarget({ postId: id });
  }, [searchParams]);

  useEffect(() => {
    const subscribed = searchParams.get("prism_subscribe_success");
    if (!subscribed) return;
    const welcome: Record<string, string> = {
      starter: "Studio, unlimited carousels and 300 AI actions a month are unlocked.",
      launch: "Auto-publishing, 1,000 AI actions and 30 seconds of video a month are unlocked. Connect your accounts next.",
      pro: "Auto-publishing, 3,000 AI actions, unlimited graphics and 2 minutes of video a month are unlocked.",
    };
    const tier = subscribed in welcome ? subscribed : "launch";
    toast({
      title: `Welcome to Prism ${tier.charAt(0).toUpperCase()}${tier.slice(1)}`,
      description:
        (subscribed === "true" ? "Your plan is active." : welcome[tier]) +
        (searchParams.get("trial") === "1" ? ` Your ${PRISM_TRIAL_DAYS}-day free trial has started.` : ""),
    });
    router.replace("/prism");
  }, [searchParams, router, toast]);

  useEffect(() => {
    if (searchParams.get("video_credits") !== "success") return;
    toast({ title: "Video credits added", description: "They show in your balance as soon as the payment clears." });
    const id = searchParams.get("post");
    router.replace(id ? `/prism?post=${id}` : "/prism");
  }, [searchParams, router, toast]);

  useEffect(() => {
    if (!agencyId) return;
    getDocs(query(collection(db, "gigs"), where("brandId", "==", agencyId)))
      .then((snap) =>
        setMarkers(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as { title?: string; status?: string; deliverablesDueDate?: string }) }))
            .filter((g) => g.deliverablesDueDate && (g.status === "open" || g.status === "in-progress"))
            .map((g) => ({ id: g.id, date: new Date(`${String(g.deliverablesDueDate).slice(0, 10)}T12:00:00`), label: `${g.title ?? "Campaign"}: content due` }))
        )
      )
      .catch(() => setMarkers([]));
  }, [agencyId]);

  const matchesFilter = (p: PrismPost) => channelFilter.length === 0 || p.channels.some((ch) => channelFilter.includes(ch));
  const visiblePosts = scheduled.filter(matchesFilter);
  const tray = unscheduled.filter(matchesFilter);

  const pillarLabel = (id: string) => strategy?.pillars.find((p) => p.id === id)?.label ?? id;

  const monthPosts = scheduled.filter((p) => p.scheduledAt && isSameMonth(new Date(p.scheduledAt), anchor));
  const weeksInMonth = (endOfMonth(anchor).getDate()) / 7;
  const pace = strategy
    ? PRISM_CHANNELS.filter((ch) => strategy.channels[ch].enabled).map((ch) => ({
        ch,
        planned: monthPosts.filter((p) => p.channels.includes(ch)).length,
        target: Math.round(strategy.channels[ch].postsPerWeek * weeksInMonth),
      }))
    : [];
  const statusCounts = monthPosts.reduce<Partial<Record<PrismPostStatus, number>>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  const closeComposer = () => {
    setTarget(null);
    if (searchParams.get("post")) router.replace("/prism");
  };

  const move = async (postId: string, day: Date | null) => {
    const post = [...scheduled, ...unscheduled].find((p) => p.id === postId);
    if (!post || post.status === "posted") return;
    let scheduledAt: string | null = null;
    if (day) {
      const prev = post.scheduledAt ? new Date(post.scheduledAt) : null;
      const d = new Date(day);
      d.setHours(prev ? prev.getHours() : 9, prev ? prev.getMinutes() : 0, 0, 0);
      scheduledAt = d.toISOString();
    }
    if (scheduledAt === post.scheduledAt) return;
    try {
      await httpsCallable(functions, "savePrismPost")({
        postId,
        title: post.title,
        angle: post.angle,
        pillar: post.pillar,
        channels: post.channels,
        scheduledAt,
        variants: post.variants,
      });
    } catch (e: unknown) {
      toast({ title: "Couldn't move the post", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const handlePlan = async () => {
    setPlanning(true);
    try {
      const res = await httpsCallable(functions, "generatePrismMonthPlan")({
        month: planMonth,
        ...(planBrief.trim() ? { brief: planBrief.trim() } : {}),
      });
      const data = res.data as { created?: number; rationale?: string };
      setPlanOpen(false);
      setPlanBrief("");
      setView("month");
      setAnchor(new Date(`${planMonth}-01T12:00:00`));
      toast({
        title: `${data.created ?? 0} ideas added`,
        description: data.rationale || "Open an idea and click Write all channels to draft it.",
      });
    } catch (e: unknown) {
      if (toastPrismLimit(toast, e)) return;
      toast({ title: "Planning failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setPlanning(false);
    }
  };

  if (authLoading || (agencyId && strategyLoading)) {
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
          <AlertDescription>
            Prism is for agency team members with a primary agency. Sign in with your agency account or complete
            onboarding first.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const headerActions = <PrismPlanBadge plan={plan} />;

  if (!strategy) {
    return (
      <div className="flex flex-col gap-8 pb-16">
        <PageHeader title="Calendar" description="Your social calendar across LinkedIn, X, Instagram, and TikTok." actions={headerActions} />
        <Card className="border-primary/30 bg-primary/5 max-w-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Set up your brand first
            </CardTitle>
            <CardDescription>
              Prism plans and writes from your brand brief, content pillars, and channel plan. Paste your website and it
              drafts the setup for you in under a minute.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/prism/setup">Set up my brand</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const monthOptions = [0, 1, 2].map((i) => {
    const d = addMonths(new Date(), i);
    return { value: format(d, "yyyy-MM"), label: format(d, "MMMM yyyy") };
  });

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        title="Calendar"
        description={`${strategy.brandName}'s social calendar. Plan the month, write each channel natively, approve, and post.`}
        actions={
          <>
            {headerActions}
            <Button variant="secondary" onClick={() => setPlanOpen(true)}>
              <Sparkles className="mr-2 h-4 w-4" />
              Plan a month
            </Button>
            <Button onClick={() => setTarget({ newOn: null })}>
              <Plus className="mr-2 h-4 w-4" />
              New post
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Previous" onClick={() => setAnchor((a) => (view === "month" ? addMonths(a, -1) : addWeeks(a, -1)))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>
            Today
          </Button>
          <Button variant="outline" size="icon" aria-label="Next" onClick={() => setAnchor((a) => (view === "month" ? addMonths(a, 1) : addWeeks(a, 1)))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <h2 className="text-lg font-semibold">
          {view === "month" ? format(anchor, "MMMM yyyy") : `Week of ${format(gridStart, "MMM d")}`}
        </h2>
        {postsLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {PRISM_CHANNELS.filter((ch) => strategy.channels[ch].enabled).map((ch) => {
            const on = channelFilter.includes(ch);
            return (
              <button
                key={ch}
                type="button"
                onClick={() => setChannelFilter((f) => (on ? f.filter((c) => c !== ch) : [...f, ch]))}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                  on ? PRISM_CHANNEL_META[ch].chip : "text-muted-foreground hover:bg-muted"
                )}
              >
                {PRISM_CHANNEL_META[ch].label}
              </button>
            );
          })}
          <div className="flex rounded-md border p-0.5">
            {(["month", "week"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn("rounded px-2.5 py-1 text-xs font-medium capitalize", view === v ? "bg-muted" : "text-muted-foreground")}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {postsError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn&apos;t load the calendar</AlertTitle>
          <AlertDescription>{postsError}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_280px]">
        <PrismCalendar
          view={view}
          gridStart={gridStart}
          anchor={anchor}
          posts={visiblePosts}
          markers={markers}
          pillarLabel={pillarLabel}
          onOpen={(id) => setTarget({ postId: id })}
          onCreate={(day) => setTarget({ newOn: day })}
          onDropPost={(id, day) => void move(id, day)}
          onShowDay={(day) => {
            setAnchor(day);
            setView("week");
          }}
        />

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarRange className="h-4 w-4 text-primary" />
                {format(anchor, "MMMM")} pace
              </CardTitle>
              <CardDescription>Posts planned against your channel plan.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {pace.map(({ ch, planned, target: goal }) => (
                <div key={ch} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{PRISM_CHANNEL_META[ch].label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {planned} / {goal}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", planned >= goal ? "bg-emerald-500" : "bg-primary")}
                      style={{ width: `${goal > 0 ? Math.min(100, (planned / goal) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-x-3 gap-y-1 border-t pt-3">
                {(Object.keys(PRISM_STATUS_META) as PrismPostStatus[]).map((s) => (
                  <span key={s} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className={cn("h-1.5 w-1.5 rounded-full", PRISM_STATUS_META[s].dot)} />
                    {PRISM_STATUS_META[s].label} {statusCounts[s] ?? 0}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(PRISM_DRAG_TYPE)) e.preventDefault();
            }}
            onDrop={(e) => {
              const id = e.dataTransfer.getData(PRISM_DRAG_TYPE);
              if (id) void move(id, null);
            }}
          >
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Inbox className="h-4 w-4 text-primary" />
                Unscheduled
              </CardTitle>
              <CardDescription>Drag onto a day to schedule, or drop a post here to unschedule it.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {tray.length === 0 ? (
                <p className="text-xs text-muted-foreground">No unscheduled ideas.</p>
              ) : (
                tray.map((p) => <PostChip key={p.id} post={p} pillarLabel={pillarLabel(p.pillar)} onOpen={(id) => setTarget({ postId: id })} />)
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <PostComposer
        target={target}
        strategy={strategy}
        currentUid={user.uid}
        isLead={user.role === "agency_owner" || user.role === "agency_admin"}
        onClose={closeComposer}
      />

      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Plan a month</DialogTitle>
            <DialogDescription>
              Prism proposes ideas across your channels from your brand setup, active campaigns, and what&apos;s already
              scheduled. They land on the calendar as ideas for you to edit, write, and approve.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Month</Label>
              <Select value={planMonth} onValueChange={setPlanMonth}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan-brief">What&apos;s happening this month? (optional)</Label>
              <Textarea
                id="plan-brief"
                rows={4}
                value={planBrief}
                onChange={(e) => setPlanBrief(e.target.value.slice(0, 4000))}
                placeholder="Launches, events, offers, themes to push or avoid…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPlanOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handlePlan()} disabled={planning}>
              {planning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {planning ? "Planning…" : "Plan it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PrismPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <PrismCalendarPage />
    </Suspense>
  );
}
