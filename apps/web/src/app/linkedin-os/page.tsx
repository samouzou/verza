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
  Linkedin,
  Loader2,
  Sparkles,
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
  DEFAULT_QUEUE_ITEMS,
  isLinkedInOsJobInFlight,
  LINKEDIN_OS_CTAS,
  LINKEDIN_OS_PILLARS,
  type LinkedInOsCarouselAssets,
  type LinkedInOsJobItem,
  type LinkedInOsJobRow,
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
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const selectedJob: LinkedInOsJobRow | null = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) ?? jobs[0] ?? null,
    [jobs, selectedJobId]
  );

  const inFlight = jobs.some((j) => isLinkedInOsJobInFlight(j.status));

  const updateItem = useCallback((index: number, patch: Partial<LinkedInOsJobItem>) => {
    setItems((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }, []);

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
      });
      const data = result.data as { jobId?: string };
      if (data.jobId) setSelectedJobId(data.jobId);
      toast({
        title: "Draft job queued",
        description: "Gemini will write first passes—check Recent jobs when status is completed.",
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
        description="First-pass LinkedIn drafts for Verza—Gemini writes, you approve and publish."
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
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              This week&apos;s queue
            </CardTitle>
            <CardDescription>
              Hooks and product truths only—Gemini fills the body from your Firestore prompt pack.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
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

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent jobs</CardTitle>
              <CardDescription>Status updates live from Firestore.</CardDescription>
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
                    Gemini is writing…
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
