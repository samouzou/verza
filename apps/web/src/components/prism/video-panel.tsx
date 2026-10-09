"use client";

import { useCallback, useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Clapperboard, Coins, Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { functions, getDownloadURL, ref, storage } from "@/lib/firebase";
import { PRISM_VIDEO_LENGTHS, type PrismVariant, type PrismVideoCredits } from "@/lib/prism/types";
import { cn } from "@/lib/utils";

const ACTIVE = new Set(["queued", "planning", "generating", "assembling"]);

function usd(cents: number) {
  return `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
}

/** Credits come back from the callable when the balance is too low. */
function creditShortfall(e: unknown): { needed: number; available: number } | null {
  const details = (e as { details?: { videoCredits?: boolean; needed?: number; available?: number } })?.details;
  return details?.videoCredits ? { needed: details.needed ?? 0, available: details.available ?? 0 } : null;
}

/** Video is stale once the script changed after it was rendered. */
function videoStale(local: PrismVariant, saved: PrismVariant | undefined): boolean {
  if (!local.video) return false;
  if (saved && local.text !== saved.text) return true;
  return (saved?.editedAt ?? saved?.generatedAt ?? "") > local.video.renderedAt;
}

export function VideoPanel({
  variant,
  saved,
  locked,
  disabled,
  onGenerate,
  returnPath,
}: {
  /** The composer's copy of the variant (may have unsaved edits). */
  variant: PrismVariant;
  /** The saved variant; carries the live video and job state. */
  saved: PrismVariant | undefined;
  locked: boolean;
  disabled: boolean;
  /** Saves the post, then starts the render. */
  onGenerate: (seconds: number) => Promise<void>;
  returnPath: string;
}) {
  const { toast } = useToast();
  const [seconds, setSeconds] = useState<number>(saved?.videoJob?.seconds ?? 10);
  const [credits, setCredits] = useState<PrismVideoCredits | null>(null);
  const [starting, setStarting] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  const [buying, setBuying] = useState<number | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  const video = saved?.video;
  const job = saved?.videoJob;
  const rendering = !!job && ACTIVE.has(job.status);
  const enough = !credits || credits.total >= seconds;

  const loadCredits = useCallback(() => {
    httpsCallable(functions, "getPrismVideoCredits")({})
      .then((res) => setCredits(res.data as PrismVideoCredits))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadCredits();
    window.addEventListener("focus", loadCredits);
    return () => window.removeEventListener("focus", loadCredits);
  }, [loadCredits]);

  // Balance changes when a render starts, fails (refund) or finishes.
  useEffect(() => {
    if (job?.status) loadCredits();
  }, [job?.status, loadCredits]);

  useEffect(() => {
    let cancelled = false;
    setVideoUrl(null);
    setCoverUrl(null);
    if (!video) return;
    Promise.all([getDownloadURL(ref(storage, video.storagePath)), getDownloadURL(ref(storage, video.coverPath)).catch(() => null)])
      .then(([v, c]) => {
        if (cancelled) return;
        setVideoUrl(v);
        setCoverUrl(c);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [video?.storagePath, video?.coverPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerate = async () => {
    if (!enough) {
      setBuyOpen(true);
      return;
    }
    setStarting(true);
    try {
      await onGenerate(seconds);
      toast({ title: "Video started", description: "It takes a few minutes. You can close this and come back." });
    } catch (e: unknown) {
      if (creditShortfall(e)) {
        loadCredits();
        setBuyOpen(true);
        return;
      }
      toast({ title: "Could not start the video", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setStarting(false);
    }
  };

  const handleBuy = async (pack: number) => {
    setBuying(pack);
    try {
      const res = await httpsCallable(functions, "createPrismVideoCreditCheckout")({ credits: pack, returnPath });
      const { url } = res.data as { url: string | null };
      if (!url) throw new Error("Checkout did not return a link.");
      window.location.href = url;
    } catch (e: unknown) {
      toast({ title: "Could not open checkout", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      setBuying(null);
    }
  };

  const stale = videoStale({ ...variant, video }, saved);

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Video (9:16, 1080p)</p>
        {credits && (
          <button
            type="button"
            onClick={() => setBuyOpen(true)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            title="Video credits: 1 credit = 1 second"
          >
            <Coins className="h-3 w-3" />
            {credits.total} credits
          </button>
        )}
      </div>

      {!locked && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border p-0.5">
            {PRISM_VIDEO_LENGTHS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={rendering || starting}
                onClick={() => setSeconds(s)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs tabular-nums transition-colors",
                  seconds === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                )}
              >
                {s}s
              </button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant={stale || !video ? "default" : "outline"}
            disabled={disabled || rendering || starting || !variant.text.trim()}
            onClick={() => void handleGenerate()}
          >
            {starting || rendering ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clapperboard className="mr-2 h-4 w-4" />}
            {video ? "Regenerate video" : "Make video"} · {seconds} credits
          </Button>
        </div>
      )}

      {rendering && job && (
        <p className="text-xs text-muted-foreground">
          {job.stage || "Rendering"}… Longer videos take a few minutes per 10 seconds. You can close this.
        </p>
      )}
      {job?.status === "failed" && !rendering && (
        <p className="text-xs text-destructive">Last render failed: {job.error ?? "unknown error"}. Your credits were returned.</p>
      )}
      {!locked && credits && !enough && !rendering && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {seconds} seconds needs {seconds} credits and you have {credits.total}.{" "}
          <button type="button" className="underline" onClick={() => setBuyOpen(true)}>
            Get more credits
          </button>
        </p>
      )}

      {video && (
        <div className="space-y-2">
          <div className="mx-auto aspect-[9/16] w-full max-w-[240px] overflow-hidden rounded border bg-black">
            {videoUrl ? (
              <video src={videoUrl} poster={coverUrl ?? undefined} controls playsInline className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {stale
                ? "The script changed after this video was made. Regenerate it to match."
                : `${video.seconds}s. Auto-publishing posts this video with the caption.`}
            </p>
            {videoUrl && (
              <Button asChild size="sm" variant="secondary">
                <a href={videoUrl} target="_blank" rel="noreferrer" download="video.mp4">
                  <Download className="mr-1 h-4 w-4" />
                  Download
                </a>
              </Button>
            )}
          </div>
        </div>
      )}

      <Dialog open={buyOpen} onOpenChange={setBuyOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Video credits</DialogTitle>
            <DialogDescription>1 credit is 1 second of finished video. A 10-second video uses 10 credits.</DialogDescription>
          </DialogHeader>
          {credits ? (
            <div className="space-y-4">
              <div className="rounded-md border p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Available</span>
                  <span className="font-medium tabular-nums">{credits.total}</span>
                </div>
                {credits.allowance > 0 && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Monthly allowance (resets on the 1st)</span>
                    <span className="tabular-nums">
                      {credits.allowanceLeft} of {credits.allowance}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Purchased (never expire)</span>
                  <span className="tabular-nums">{credits.purchased}</span>
                </div>
              </div>
              {credits.canBuy ? (
                credits.packs.length ? (
                  <div className="grid gap-2">
                    {credits.packs.map((p) => (
                      <Button
                        key={p.credits}
                        variant="outline"
                        className="justify-between"
                        disabled={buying !== null}
                        onClick={() => void handleBuy(p.credits)}
                      >
                        <span>
                          {p.credits} credits <span className="text-muted-foreground">· {p.credits / 10} ten-second videos</span>
                        </span>
                        <span className="font-medium">{buying === p.credits ? <Loader2 className="h-4 w-4 animate-spin" /> : usd(p.cents)}</span>
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Credit packs aren&apos;t available yet.</p>
                )
              ) : (
                <p className="text-sm text-muted-foreground">Ask a brand owner or admin to buy more credits.</p>
              )}
            </div>
          ) : (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
