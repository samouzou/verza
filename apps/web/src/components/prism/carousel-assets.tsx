"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getDownloadURL, ref, storage } from "@/lib/firebase";

export type CarouselAssetFiles = {
  slides: { index: number; storagePath: string; filename: string }[];
  pdfStoragePath?: string;
  zipStoragePath?: string;
};

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

/** Rendered carousel slides with thumbnails and PDF / ZIP downloads. */
export function CarouselAssets({ assets, stale }: { assets: CarouselAssetFiles; stale?: boolean }) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const slides = [...(assets.slides ?? [])].sort((a, b) => a.index - b.index);
  const slideKey = slides.map((s) => s.storagePath).join("|");

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      slides.map(async (s) => {
        try {
          return [s.storagePath, await getDownloadURL(ref(storage, s.storagePath))] as const;
        } catch {
          return null;
        }
      })
    ).then((pairs) => {
      if (!cancelled) setThumbs(Object.fromEntries(pairs.filter((p): p is readonly [string, string] => !!p)));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideKey]);

  const handleDownload = async (storagePath: string, filename: string) => {
    setDownloading(storagePath);
    try {
      await downloadStoragePath(storagePath, filename);
    } catch (e: unknown) {
      toast({ title: "Could not download", description: e instanceof Error ? e.message : "Download failed.", variant: "destructive" });
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Slides ({slides.length}, 1080×1080)
        </p>
        <div className="flex flex-wrap gap-2">
          {assets.pdfStoragePath && (
            <Button size="sm" disabled={downloading !== null} onClick={() => void handleDownload(assets.pdfStoragePath!, "carousel.pdf")}>
              {downloading === assets.pdfStoragePath ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
              PDF
            </Button>
          )}
          {assets.zipStoragePath && (
            <Button
              size="sm"
              variant="secondary"
              disabled={downloading !== null}
              onClick={() => void handleDownload(assets.zipStoragePath!, "carousel.zip")}
            >
              {downloading === assets.zipStoragePath ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
              PNG ZIP
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
        {slides.map((s, i) => (
          <button
            key={s.storagePath}
            type="button"
            title={`Download ${s.filename}`}
            disabled={downloading !== null}
            onClick={() => void handleDownload(s.storagePath, s.filename)}
            className="relative aspect-square overflow-hidden rounded border bg-muted hover:ring-2 hover:ring-primary/40"
          >
            {thumbs[s.storagePath] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbs[s.storagePath]} alt={s.filename} className="h-full w-full object-cover" />
            ) : (
              <span className="text-[10px] text-muted-foreground">{i + 1}</span>
            )}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {stale
          ? "The copy changed after these slides were made, so they may not match the outline above."
          : "Upload the PDF to LinkedIn as a document post, or post the PNGs as an Instagram carousel."}
      </p>
    </div>
  );
}
