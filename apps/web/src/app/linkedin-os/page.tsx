"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Lightbulb,
  Linkedin,
  Loader2,
  Mail,
  NotebookPen,
  Sparkles,
  Video,
} from "lucide-react";
import type { Timestamp } from "firebase/firestore";

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
import { useLinkedInOsJobs } from "@/hooks/use-linkedin-os-jobs";
import { useToast } from "@/hooks/use-toast";
import { functions, getDownloadURL, ref, storage } from "@/lib/firebase";
import {
  applyInspirationPreset,
  LINKEDIN_OS_INSPIRATION_PRESETS,
} from "@/lib/linkedin-os/inspiration";
import {
  DEFAULT_QUEUE_ITEMS,
  isLinkedInOsJobInFlight,
  LINKEDIN_OS_CTAS,
  LINKEDIN_OS_PILLARS,
  LINKEDIN_OS_VIDEO_PLATFORMS,
  PRODUCT_RECEIPTS_OUTPUT_ID,
  type LinkedInOsBeehiivNewsletter,
  type LinkedInOsJobItem,
  type LinkedInOsJobRow,
  type LinkedInOsVideoPlatform,
  type LinkedInOsVideoScript,
} from "@/lib/linkedin-os/types";

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

async function downloadStoragePath(storagePath: string, filename: string) {
  const url = await getDownloadURL(ref(storage, storagePath));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.target = "_blank";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function CarouselAssetsPanel({
  assets,
  outputId,
}: {
  assets: LinkedInOsCarouselAssets;
  outputId: string;
}) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const { toast } = useToast();

  const handleDownload = async (storagePath: string, filename: string, key: string) => {
    setDownloading(key);
    try {
      await downloadStoragePath(storagePath, filename);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Download failed.";
      toast({ title: "Could not download", description: msg, variant: "destructive" });
    } finally {
      setDownloading(null);
    }
  };

  const sortedSlides = [...(assets.slides ?? [])].sort((a, b) => a.index - b.index);

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Carousel assets (1080×1080)
        </p>
        <div className="flex flex-wrap gap-2">
          {assets.pdfStoragePath && (
            <Button
              size="sm"
              disabled={downloading !== null}
              onClick={() =>
                void handleDownload(assets.pdfStoragePath!, "carousel.pdf", `${outputId}-pdf`)
              }
            >
              {downloading === `${outputId}-pdf` ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Download className="h-4 w-4 mr-1" />
                  Download PDF
                </>
              )}
            </Button>
          )}
          {assets.zipStoragePath && (
            <Button
              size="sm"
              variant="secondary"
              disabled={downloading !== null}
              onClick={() =>
                void handleDownload(assets.zipStoragePath!, "carousel.zip", `${outputId}-zip`)
              }
            >
              {downloading === `${outputId}-zip` ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Download className="h-4 w-4 mr-1" />
                  PNG ZIP
                </>
              )}
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {sortedSlides.map((slide) => (
          <Button
            key={slide.storagePath}
            size="sm"
            variant="outline"
            className="justify-start text-xs h-auto py-2"
            disabled={downloading !== null}
            onClick={() =>
              void handleDownload(slide.storagePath, slide.filename, slide.storagePath)
            }
          >
            {downloading === slide.storagePath ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1 shrink-0" />
            ) : (
              <Download className="h-3 w-3 mr-1 shrink-0" />
            )}
            {slide.filename}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Upload the PDF to LinkedIn as a document post, or use individual PNGs in a design tool.
      </p>
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
          Turn this week&apos;s LinkedIn drafts into one platform-specific script. Edit before you
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
            No {platformMeta?.label} script yet—generate one from the LinkedIn drafts above.
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

export default function LinkedInOsPage() {
  const { user, isLoading: authLoading, isAgencyTeam } = useAuth();
  const { toast } = useToast();
  const agencyId = user?.primaryAgencyId ?? null;
  const { jobs, error: jobsError, loading: jobsLoading } = useLinkedInOsJobs(agencyId);

  const [weekLabel, setWeekLabel] = useState(() => {
    const d = new Date();
    const onejan = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
  });
  const [items, setItems] = useState<LinkedInOsJobItem[]>(() =>
    DEFAULT_QUEUE_ITEMS.map((x) => ({ ...x }))
  );
  const [submitting, setSubmitting] = useState(false);
  const [inspirationId, setInspirationId] = useState("");
  const [weeklyBrief, setWeeklyBrief] = useState("");
  const [mustMention, setMustMention] = useState("");
  const [neverMention, setNeverMention] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const selectedJob: LinkedInOsJobRow | null = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) ?? jobs[0] ?? null,
    [jobs, selectedJobId]
  );

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

  const updateItem = useCallback((index: number, patch: Partial<LinkedInOsJobItem>) => {
    setItems((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }, []);

  const selectedInspiration = useMemo(
    () => LINKEDIN_OS_INSPIRATION_PRESETS.find((p) => p.id === inspirationId) ?? null,
    [inspirationId]
  );

  const handleApplyInspiration = () => {
    if (!selectedInspiration) return;
    setItems(applyInspirationPreset(selectedInspiration));
    toast({
      title: "Queue pre-filled",
      description: `${selectedInspiration.label} — edit hooks and truths before generating.`,
    });
  };

  const handleResetQueue = () => {
    setInspirationId("");
    setWeeklyBrief("");
    setMustMention("");
    setNeverMention("");
    setItems(DEFAULT_QUEUE_ITEMS.map((x) => ({ ...x })));
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
        reviewer: user.displayName || user.email || "Reviewer",
        items: valid,
        ...(weeklyBrief.trim() ? { weeklyBrief: weeklyBrief.trim() } : {}),
        ...(mustMention.trim() ? { mustMention: mustMention.trim() } : {}),
        ...(neverMention.trim() ? { neverMention: neverMention.trim() } : {}),
      });
      const data = result.data as { jobId?: string };
      if (data.jobId) setSelectedJobId(data.jobId);
      toast({
        title: "Draft job queued",
        description:
          "We'll draft your posts next—watch Recent jobs for when they're ready.",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to enqueue job.";
      toast({ title: "Could not start job", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const copyMarkdown = async (outputId: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(outputId);
    toast({ title: "Copied to clipboard" });
    setTimeout(() => setCopiedId(null), 2000);
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
            LinkedIn OS is for agency team members promoting Verza on LinkedIn. Sign in with your
            agency account or complete onboarding first.
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
            Set a primary agency on your profile before generating LinkedIn drafts.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-16">
      <PageHeader
        title="LinkedIn OS"
        description="First-pass LinkedIn drafts for Verza—we generate a starting point, you edit and publish."
        actions={
          <Button variant="outline" asChild>
            <Link href="/optic">Optic (separate)</Link>
          </Button>
        }
      />

      <Alert className="border-blue-500/30 bg-blue-50/10">
        <Linkedin className="h-4 w-4" />
        <AlertTitle>Human in the loop</AlertTitle>
        <AlertDescription>
          Paste one product truth per post from your brief. Edit every draft before posting to
          LinkedIn—this tool removes the blank page, not your judgment.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              This week&apos;s queue
            </CardTitle>
            <CardDescription>
              Add hooks and product truths—we draft the rest from your team&apos;s saved brand voice.
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
                    before you pick inspiration or generate. We fold this into every post in the run,
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

            <div className="rounded-lg border border-dashed p-4 space-y-3 bg-muted/10">
              <div className="flex items-start gap-2">
                <Lightbulb className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">Inspiration</p>
                  <p className="text-xs text-muted-foreground">
                    Pick a Verza feature to pre-fill hooks and product truths for all three posts.
                  </p>
                </div>
              </div>
              <Select value={inspirationId || undefined} onValueChange={setInspirationId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a feature angle…" />
                </SelectTrigger>
                <SelectContent>
                  {LINKEDIN_OS_INSPIRATION_PRESETS.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedInspiration && (
                <p className="text-xs text-muted-foreground">{selectedInspiration.description}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!selectedInspiration}
                  onClick={handleApplyInspiration}
                >
                  Apply to queue
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={handleResetQueue}>
                  Reset queue
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="week-label">Week label</Label>
                <Input
                  id="week-label"
                  value={weekLabel}
                  onChange={(e) => setWeekLabel(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Reviewer</Label>
                <Input value={user.displayName || user.email || ""} disabled />
              </div>
            </div>

            {items.map((item, index) => (
              <div key={item.id} className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{item.id}</p>
                  <Select
                    value={item.format}
                    onValueChange={(v) =>
                      updateItem(index, {
                        format: v === "carousel_outline" ? "carousel_outline" : "short_post",
                      })
                    }
                  >
                    <SelectTrigger className="w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="short_post">Short post</SelectItem>
                      <SelectItem value="carousel_outline">Carousel (+ PNG slides)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Pillar</Label>
                    <Select
                      value={item.pillar}
                      onValueChange={(v) => updateItem(index, { pillar: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pillar" />
                      </SelectTrigger>
                      <SelectContent>
                        {LINKEDIN_OS_PILLARS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
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
                </div>
                <div className="space-y-2">
                  <Label>Hook (line 1)</Label>
                  <Input
                    value={item.hook}
                    onChange={(e) => updateItem(index, { hook: e.target.value })}
                    placeholder="What shows before “see more”"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Product truth (one sentence you stand behind)</Label>
                  <Textarea
                    value={item.productTruth}
                    onChange={(e) => updateItem(index, { productTruth: e.target.value })}
                    rows={2}
                    placeholder="From brand brief—do not let the model invent facts"
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
                  Generate first passes
                </>
              )}
            </Button>
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
                    ? "Copy, edit in your voice, then post on LinkedIn."
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
                    <div key={out.id} className="rounded-lg border p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{out.id}</p>
                          <p className="text-xs text-muted-foreground">
                            {out.pillar} · {out.format}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => copyMarkdown(out.id, out.markdown)}
                        >
                          {copiedId === out.id ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <pre className="text-sm whitespace-pre-wrap font-sans text-muted-foreground max-h-64 overflow-y-auto">
                        {out.markdown}
                      </pre>
                      {out.carouselAssets && out.carouselAssets.slides.length > 0 && (
                        <CarouselAssetsPanel assets={out.carouselAssets} outputId={out.id} />
                      )}
                    </div>
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
    </div>
  );
}
