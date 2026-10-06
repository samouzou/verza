"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Images,
  Loader2,
  MessageSquareWarning,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Trash2,
  Wand2,
  XCircle,
} from "lucide-react";
import Link from "next/link";

import { CarouselAssets } from "@/components/prism/carousel-assets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { usePrismConnections } from "@/hooks/use-prism-connections";
import { usePrismPlan } from "@/hooks/use-prism-plan";
import { useToast } from "@/hooks/use-toast";
import { toastPrismLimit } from "@/components/prism/prism-plan";
import { db, functions } from "@/lib/firebase";
import {
  PRISM_CHANNEL_META,
  PRISM_CHANNELS,
  PRISM_FORMATS,
  PRISM_MANUAL_FORMATS,
  PRISM_STATUS_META,
  type PrismBrandStrategy,
  type PrismConnectedAccount,
  type PrismChannel,
  type PrismFormat,
  type PrismPost,
  type PrismVariant,
} from "@/lib/prism/types";
import { captionOf, checkVariant, hasCaption } from "@/lib/prism/validate";
import { cn } from "@/lib/utils";

type Form = {
  title: string;
  angle: string;
  pillar: string;
  channels: PrismChannel[];
  date: string;
  time: string;
  variants: Partial<Record<PrismChannel, PrismVariant>>;
  autoPublish: boolean;
};

export type ComposerTarget = { postId: string } | { newOn: Date | null };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function localDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formFromPost(p: PrismPost): Form {
  const d = p.scheduledAt ? new Date(p.scheduledAt) : null;
  return {
    title: p.title,
    angle: p.angle,
    pillar: p.pillar,
    channels: p.channels,
    date: d ? localDate(d) : "",
    time: d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "09:00",
    variants: p.variants ?? {},
    autoPublish: p.autoPublish !== false,
  };
}

function emptyForm(strategy: PrismBrandStrategy, on: Date | null): Form {
  const channels = PRISM_CHANNELS.filter((ch) => strategy.channels[ch].enabled);
  const variants: Partial<Record<PrismChannel, PrismVariant>> = {};
  for (const ch of channels) variants[ch] = { format: PRISM_FORMATS[ch][0].value, text: "" };
  return {
    title: "",
    angle: "",
    pillar: strategy.pillars[0]?.id ?? "",
    channels,
    date: on ? localDate(on) : "",
    time: "09:00",
    variants,
    autoPublish: true,
  };
}

/** History stores ISO times; show them in the viewer's local time. */
function readableAction(action: string): string {
  return action.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, (iso) =>
    new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
  );
}

const CAROUSEL_FORMATS = new Set<PrismFormat>(["carousel_outline", "ig_carousel"]);

/** Slides are stale once the copy changed after they were rendered, saved or not. */
function assetsStale(local: PrismVariant, saved: PrismVariant | undefined): boolean {
  if (!local.assets) return false;
  if (saved && local.text !== saved.text) return true;
  const changedAt = saved?.editedAt ?? saved?.generatedAt ?? "";
  return changedAt > local.assets.renderedAt;
}

/** What auto-publishing will do with one channel, before anything is sent. */
function publishPlan(v: PrismVariant | undefined, account: PrismConnectedAccount | undefined): { ok: boolean; note: string } {
  if (!account) return { ok: false, note: "Not connected" };
  if (account.status !== "connected") return { ok: false, note: "Reconnect needed" };
  if (!v?.text.trim()) return { ok: false, note: "No copy yet" };
  if (PRISM_MANUAL_FORMATS.has(v.format)) return { ok: false, note: "Needs a video or image, post by hand" };
  if (v.format === "carousel_outline" && !v.assets?.pdfStoragePath) return { ok: false, note: "Render the slides first" };
  if (v.format === "ig_carousel" && (v.assets?.slides.length ?? 0) < 2) return { ok: false, note: "Render the slides first" };
  return { ok: true, note: `Publishes as @${account.username || account.displayName || "connected account"}` };
}

function scheduledIso(f: Form): string | null {
  if (!f.date) return null;
  const d = new Date(`${f.date}T${f.time || "09:00"}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function PostComposer({
  target,
  strategy,
  currentUid,
  isLead,
  onClose,
}: {
  target: ComposerTarget | null;
  strategy: PrismBrandStrategy;
  currentUid: string;
  isLead: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [postId, setPostId] = useState<string | null>(null);
  const [post, setPost] = useState<PrismPost | null>(null);
  const [form, setForm] = useState<Form>(() => emptyForm(strategy, null));
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<PrismChannel | "">("");
  const [busy, setBusy] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [comment, setComment] = useState("");
  const [showChanges, setShowChanges] = useState(false);
  const [showPosted, setShowPosted] = useState(false);
  const [postedUrls, setPostedUrls] = useState<Partial<Record<PrismChannel, string>>>({});
  const [copied, setCopied] = useState<PrismChannel | null>(null);

  const open = target !== null;

  useEffect(() => {
    setDirty(false);
    setShowChanges(false);
    setShowPosted(false);
    setComment("");
    setInstruction("");
    if (!target) return;
    if ("postId" in target) {
      setPostId(target.postId);
    } else {
      setPostId(null);
      setPost(null);
      const f = emptyForm(strategy, target.newOn);
      setForm(f);
      setTab(f.channels[0] ?? "");
    }
  }, [target, strategy]);

  useEffect(() => {
    if (!postId) return;
    return onSnapshot(doc(db, "prism_posts", postId), (snap) => {
      if (!snap.exists()) {
        setPost(null);
        return;
      }
      setPost({ id: snap.id, ...(snap.data() as Omit<PrismPost, "id">) });
    });
  }, [postId]);

  // Pull in server changes (AI copy, teammates' edits) unless the user has unsaved edits.
  useEffect(() => {
    if (!post || dirty) return;
    const f = formFromPost(post);
    setForm(f);
    setTab((t) => (t && f.channels.includes(t as PrismChannel) ? t : f.channels[0] ?? ""));
  }, [post, dirty]);

  const edit = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };

  const toggleChannel = (ch: PrismChannel) => {
    const on = form.channels.includes(ch);
    const channels = on ? form.channels.filter((c) => c !== ch) : PRISM_CHANNELS.filter((c) => c === ch || form.channels.includes(c));
    const variants = { ...form.variants };
    if (!on && !variants[ch]) variants[ch] = { format: PRISM_FORMATS[ch][0].value, text: "" };
    edit({ channels, variants });
    if (!on) setTab(ch);
    else if (tab === ch) setTab(channels[0] ?? "");
  };

  const setVariant = (ch: PrismChannel, patch: Partial<PrismVariant>) => {
    const prev = form.variants[ch] ?? { format: PRISM_FORMATS[ch][0].value, text: "" };
    edit({ variants: { ...form.variants, [ch]: { ...prev, ...patch } } });
  };

  const status = post?.status ?? "idea";
  const agencyId = post?.agencyId ?? strategy.agencyId ?? null;
  const plan = usePrismPlan(agencyId);
  const { accounts } = usePrismConnections(agencyId);
  const publish = post?.publish;
  const withPublisher = publish?.state === "sending" || publish?.state === "scheduled";
  const locked = status === "posted" || withPublisher;
  const checks = useMemo(
    () => Object.fromEntries(form.channels.map((ch) => [ch, checkVariant(ch, form.variants[ch])])),
    [form]
  ) as Record<PrismChannel, ReturnType<typeof checkVariant>>;
  const blocking = form.channels.filter((ch) => checks[ch]?.issues.some((i) => i.level === "error") || !form.variants[ch]?.text.trim());

  const call = async <T,>(name: string, data: unknown): Promise<T> => {
    const res = await httpsCallable(functions, name)(data);
    return res.data as T;
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e: unknown) {
      if (toastPrismLimit(toast, e)) return;
      toast({ title: "Something went wrong", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  /** Saves if needed and returns the post id. */
  const save = async (): Promise<string> => {
    if (postId && !dirty) return postId;
    const res = await call<{ postId: string }>("savePrismPost", {
      ...(postId ? { postId } : {}),
      title: form.title,
      angle: form.angle,
      pillar: form.pillar,
      channels: form.channels,
      scheduledAt: scheduledIso(form),
      variants: Object.fromEntries(form.channels.map((ch) => [ch, form.variants[ch] ?? { format: PRISM_FORMATS[ch][0].value, text: "" }])),
      autoPublish: form.autoPublish,
    });
    setDirty(false);
    if (!postId) setPostId(res.postId);
    return res.postId;
  };

  const handleSave = () =>
    run("save", async () => {
      await save();
      toast({ title: "Saved" });
    });

  const handleAdapt = (channels?: PrismChannel[]) =>
    run(channels ? `adapt-${channels[0]}` : "adapt", async () => {
      if (!form.title.trim()) throw new Error("Give the idea a title first.");
      const id = await save();
      await call("adaptPrismPost", {
        postId: id,
        ...(channels ? { channels } : {}),
        ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
      });
      setInstruction("");
      toast({ title: "Copy written", description: "Review every channel before sending it on." });
    });

  const handleRender = (ch: PrismChannel) =>
    run(`render-${ch}`, async () => {
      if (!form.title.trim()) throw new Error("Give the idea a title first.");
      const id = await save();
      const { slides } = await call<{ slides: number }>("renderPrismSlides", { postId: id, channel: ch });
      toast({ title: `${slides} slides ready`, description: "Download the PDF or PNGs below." });
    });

  const transition = (action: string, extra: Record<string, unknown> = {}) =>
    run(action, async () => {
      const id = await save();
      await call("transitionPrismPost", { postId: id, action, ...extra });
      setShowChanges(false);
      setShowPosted(false);
      setComment("");
    });

  const handlePublishNow = () =>
    run("publish", async () => {
      const id = await save();
      const { state } = await call<{ state: string | null }>("publishPrismPostNow", { postId: id });
      toast({
        title: state === "manual" ? "Nothing to auto-publish" : state === "failed" ? "Publishing failed" : "Sent to the publisher",
        description:
          state === "manual"
            ? "None of this post's channels can be published automatically. Post it by hand."
            : state === "failed"
              ? "See the error below."
              : "Results appear here as each network confirms.",
        ...(state === "failed" ? { variant: "destructive" as const } : {}),
      });
    });

  const handleCancelPublish = () =>
    run("cancel-publish", async () => {
      if (!postId) return;
      await call("cancelPrismPublish", { postId });
      toast({ title: "Auto-publish cancelled", description: "You can edit the post again." });
    });

  const handleDelete = () =>
    run("delete", async () => {
      if (postId) await call("deletePrismPost", { postId });
      onClose();
    });

  /** Carousels post the slides as media, so only the caption is pasted as text. */
  const copyText = (v: PrismVariant | undefined) =>
    v && CAROUSEL_FORMATS.has(v.format) && hasCaption(v.text) ? captionOf(v.text) : v?.text ?? "";

  const copy = async (ch: PrismChannel) => {
    await navigator.clipboard.writeText(copyText(form.variants[ch]));
    setCopied(ch);
    setTimeout(() => setCopied(null), 1500);
  };

  const isAuthor = !post || post.createdBy === currentUid;
  const canApprove = !strategy.approvalRequired || !isAuthor || isLead;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="pr-8">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", PRISM_STATUS_META[status].dot)} />
            <span className="text-xs text-muted-foreground">{PRISM_STATUS_META[status].label}</span>
            {dirty && <Badge variant="outline" className="text-[10px]">Unsaved</Badge>}
          </div>
          <SheetTitle>{postId ? form.title || "Untitled post" : "New post"}</SheetTitle>
          <SheetDescription>One idea, written natively for each channel.</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="post-title">Idea</Label>
            <Input
              id="post-title"
              value={form.title}
              disabled={locked}
              onChange={(e) => edit({ title: e.target.value.slice(0, 200) })}
              placeholder="e.g. 3 mistakes we made pricing creators"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="post-angle">Angle and notes</Label>
            <Textarea
              id="post-angle"
              rows={3}
              value={form.angle}
              disabled={locked}
              onChange={(e) => edit({ angle: e.target.value.slice(0, 2000) })}
              placeholder="The hook, the point, the proof to use."
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Pillar</Label>
              <Select value={form.pillar} onValueChange={(v) => edit({ pillar: v })} disabled={locked}>
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
              <Label htmlFor="post-date">Date</Label>
              <Input id="post-date" type="date" value={form.date} disabled={locked} onChange={(e) => edit({ date: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="post-time">Time</Label>
              <Input
                id="post-time"
                type="time"
                value={form.time}
                disabled={locked || !form.date}
                onChange={(e) => edit({ time: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Channels</Label>
            <div className="flex flex-wrap gap-2">
              {PRISM_CHANNELS.map((ch) => {
                const on = form.channels.includes(ch);
                return (
                  <button
                    key={ch}
                    type="button"
                    disabled={locked}
                    onClick={() => toggleChannel(ch)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      on ? PRISM_CHANNEL_META[ch].chip : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {on && <Check className="mr-1 inline h-3 w-3" />}
                    {PRISM_CHANNEL_META[ch].label}
                  </button>
                );
              })}
            </div>
          </div>

          {!locked && (
            <div className="rounded-lg border bg-primary/5 p-3 space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value.slice(0, 500))}
                  placeholder="Optional direction, e.g. punchier, add a stat from the brief"
                />
                <Button type="button" onClick={() => void handleAdapt()} disabled={!!busy || form.channels.length === 0}>
                  {busy === "adapt" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Write all channels
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Prism writes each channel natively from the idea, your brand setup, and your voice. It overwrites the
                current copy.
              </p>
            </div>
          )}

          {form.channels.length > 0 && (
            <Tabs value={tab || form.channels[0]} onValueChange={(v) => setTab(v as PrismChannel)}>
              <TabsList className="flex-wrap h-auto">
                {form.channels.map((ch) => {
                  const c = checks[ch];
                  const err = c?.issues.some((i) => i.level === "error");
                  return (
                    <TabsTrigger key={ch} value={ch} className="gap-1.5">
                      {PRISM_CHANNEL_META[ch].label}
                      {err ? (
                        <AlertTriangle className="h-3 w-3 text-destructive" />
                      ) : form.variants[ch]?.text.trim() ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      ) : null}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              {form.channels.map((ch) => {
                const v = form.variants[ch] ?? { format: PRISM_FORMATS[ch][0].value as PrismFormat, text: "" };
                const c = checks[ch];
                return (
                  <TabsContent key={ch} value={ch} className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Select
                        value={v.format}
                        disabled={locked}
                        onValueChange={(f) => setVariant(ch, { format: f as PrismFormat })}
                      >
                        <SelectTrigger className="w-[200px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRISM_FORMATS[ch].map((f) => (
                            <SelectItem key={f.value} value={f.value}>
                              {f.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-1">
                        <span className={cn("text-xs tabular-nums", c?.over ? "text-destructive font-medium" : "text-muted-foreground")}>
                          {c?.counter}
                        </span>
                        {!locked && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={!!busy}
                            onClick={() => void handleAdapt([ch])}
                            title={`Rewrite ${PRISM_CHANNEL_META[ch].label}`}
                          >
                            {busy === `adapt-${ch}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                          </Button>
                        )}
                        <Button type="button" size="sm" variant="ghost" onClick={() => void copy(ch)} title={CAROUSEL_FORMATS.has(v.format) && hasCaption(v.text) ? "Copy caption" : "Copy"}>
                          {copied === ch ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      rows={14}
                      value={v.text}
                      disabled={locked}
                      onChange={(e) => setVariant(ch, { text: e.target.value })}
                      placeholder={`Write the ${PRISM_CHANNEL_META[ch].label} version, or let Prism write it.`}
                      className="font-mono text-sm"
                    />
                    {c && c.issues.length > 0 && v.text.trim() && (
                      <ul className="space-y-1">
                        {c.issues.map((i, n) => (
                          <li
                            key={n}
                            className={cn("flex items-start gap-1.5 text-xs", i.level === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-400")}
                          >
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            {i.message}
                          </li>
                        ))}
                      </ul>
                    )}
                    {CAROUSEL_FORMATS.has(v.format) && !locked && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={v.assets && assetsStale(v, post?.variants?.[ch]) ? "default" : "outline"}
                          disabled={!!busy || !v.text.trim()}
                          onClick={() => void handleRender(ch)}
                        >
                          {busy === `render-${ch}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Images className="mr-2 h-4 w-4" />}
                          {v.assets?.slides.length ? "Re-render slides" : "Make slides"}
                        </Button>
                        {busy === `render-${ch}` && <span className="text-xs text-muted-foreground">Rendering in your brand colors…</span>}
                      </div>
                    )}
                    {v.assets && v.assets.slides.length > 0 && CAROUSEL_FORMATS.has(v.format) && (
                      <CarouselAssets assets={v.assets} stale={assetsStale(v, post?.variants?.[ch])} />
                    )}
                    {v.postedUrl && (
                      <a href={v.postedUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
                        View live post
                      </a>
                    )}
                  </TabsContent>
                );
              })}
            </Tabs>
          )}

          {showChanges && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2">
              <Label htmlFor="changes">What should change?</Label>
              <Textarea id="changes" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" disabled={!comment.trim() || !!busy} onClick={() => void transition("request_changes", { comment })}>
                  Send back
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowChanges(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {showPosted && (
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-medium">Links to the live posts (optional)</p>
              {form.channels.map((ch) => (
                <Input
                  key={ch}
                  value={postedUrls[ch] ?? ""}
                  onChange={(e) => setPostedUrls((u) => ({ ...u, [ch]: e.target.value }))}
                  placeholder={`${PRISM_CHANNEL_META[ch].label} post URL`}
                />
              ))}
              <div className="flex gap-2">
                <Button size="sm" disabled={!!busy} onClick={() => void transition("mark_posted", { postedUrls })}>
                  Mark posted
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowPosted(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {post && plan.paid && (status === "approved" || publish) && (
            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Publishing</p>
                  <p className="text-xs text-muted-foreground">
                    {publish?.state === "scheduled" || publish?.state === "sending"
                      ? `With the publisher for ${post.scheduledAt ? new Date(post.scheduledAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "now"}. Editing is locked.`
                      : publish?.state === "published"
                        ? "Published."
                        : publish?.state === "partial"
                          ? "Some channels published. Handle the rest by hand."
                          : publish?.state === "failed"
                            ? publish.nextAttemptAt
                              ? `Failed, retrying ${formatDistanceToNow(new Date(publish.nextAttemptAt), { addSuffix: true })}.`
                              : "Failed. Retry or post by hand."
                            : publish?.state === "cancelled"
                              ? "Auto-publish cancelled."
                              : publish?.state === "manual"
                                ? "Nothing here can be auto-published. Post by hand."
                                : !form.autoPublish
                                  ? "Off for this post. Post it by hand."
                                  : post.scheduledAt
                                    ? "Prism publishes connected channels at the scheduled time."
                                    : "Pick a date and time to publish automatically."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!publish && status === "approved" && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Switch checked={form.autoPublish} onCheckedChange={(on) => edit({ autoPublish: on })} disabled={!!busy} />
                      Auto-publish
                    </label>
                  )}
                  {withPublisher && (
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void handleCancelPublish()}>
                      {busy === "cancel-publish" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                      Cancel auto-publish
                    </Button>
                  )}
                  {status === "approved" && (!publish || ["failed", "manual", "cancelled"].includes(publish.state)) && (
                    <Button size="sm" disabled={!!busy} onClick={() => void handlePublishNow()}>
                      {busy === "publish" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      {publish?.state === "failed" ? "Retry now" : "Publish now"}
                    </Button>
                  )}
                </div>
              </div>
              <ul className="space-y-1.5">
                {form.channels.map((ch) => {
                  const result = publish?.channels?.[ch];
                  const planned = publishPlan(form.variants[ch], accounts[ch]);
                  return (
                    <li key={ch} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="w-20 font-medium">{PRISM_CHANNEL_META[ch].label}</span>
                      {result?.state === "published" ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" />
                          Published
                          {result.url && (
                            <a href={result.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">
                              view <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </span>
                      ) : result?.state === "failed" ? (
                        <span className="text-destructive">Failed: {result.error ?? "unknown error"}</span>
                      ) : result?.state === "manual" ? (
                        <span className="text-muted-foreground">Post by hand: {result.error}</span>
                      ) : result?.state === "pending" ? (
                        <span className="text-muted-foreground">Waiting for the network…</span>
                      ) : (
                        <span className={planned.ok ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400"}>
                          {planned.note}
                          {(planned.note === "Not connected" || planned.note === "Reconnect needed") && (
                            <>
                              {" · "}
                              <Link href="/prism/accounts" className="underline">
                                Connect
                              </Link>
                            </>
                          )}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {post && !plan.loading && !plan.paid && status === "approved" && (
            <p className="text-xs text-muted-foreground">
              Copy each channel and mark it posted, or{" "}
              <Link href="/prism/pricing" className="text-primary underline">
                upgrade to Launch
              </Link>{" "}
              to publish automatically.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            {!locked && (
              <Button variant="outline" disabled={!!busy || (!dirty && !!postId)} onClick={() => void handleSave()}>
                {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save
              </Button>
            )}
            {["idea", "draft", "changes_requested"].includes(status) && strategy.approvalRequired && (
              <Button disabled={!!busy || blocking.length > 0} onClick={() => void transition("submit")}>
                <Send className="mr-2 h-4 w-4" />
                Send for review
              </Button>
            )}
            {((status === "in_review") || (!strategy.approvalRequired && ["idea", "draft", "changes_requested"].includes(status))) && (
              <Button disabled={!!busy || blocking.length > 0 || !canApprove} onClick={() => void transition("approve")}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Approve
              </Button>
            )}
            {status === "in_review" && (
              <Button variant="outline" disabled={!!busy} onClick={() => setShowChanges(true)}>
                <MessageSquareWarning className="mr-2 h-4 w-4" />
                Request changes
              </Button>
            )}
            {(status === "approved" || (!strategy.approvalRequired && ["idea", "draft", "changes_requested"].includes(status))) && (
              <Button variant={status === "approved" ? "default" : "outline"} disabled={!!busy || (status !== "approved" && blocking.length > 0)} onClick={() => setShowPosted(true)}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Mark posted
              </Button>
            )}
            {(status === "approved" || status === "posted" || status === "in_review") && !withPublisher && (
              <Button variant="ghost" disabled={!!busy} onClick={() => void transition("reopen")}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Reopen
              </Button>
            )}
            {postId && !withPublisher && (
              <Button variant="ghost" className="ml-auto text-destructive" disabled={!!busy} onClick={() => void handleDelete()}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            )}
          </div>
          {blocking.length > 0 && ["idea", "draft", "changes_requested", "in_review"].includes(status) && (
            <p className="text-xs text-muted-foreground">
              Before approval: {blocking.map((ch) => PRISM_CHANNEL_META[ch].label).join(", ")} need{blocking.length === 1 ? "s" : ""} copy
              within the channel&apos;s limits.
            </p>
          )}
          {status === "in_review" && !canApprove && (
            <p className="text-xs text-muted-foreground">A teammate needs to approve your post.</p>
          )}

          {post && post.history?.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">Activity</p>
              <ul className="space-y-2">
                {[...post.history].reverse().slice(0, 12).map((h, i) => (
                  <li key={i} className="text-xs">
                    <span className="font-medium">{h.name}</span> <span className="text-muted-foreground">{readableAction(h.action)}</span>
                    <span className="text-muted-foreground"> · {formatDistanceToNow(new Date(h.at), { addSuffix: true })}</span>
                    {h.comment && <p className="mt-0.5 rounded bg-muted px-2 py-1 text-muted-foreground">{h.comment}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
