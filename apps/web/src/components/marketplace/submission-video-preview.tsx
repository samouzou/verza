import { Download } from "lucide-react";

import { YouTubeSubmissionStats } from "@/components/marketplace/youtube-submission-stats";
import { Button } from "@/components/ui/button";
import { extractYouTubeVideoId, isYouTubeUrl } from "@/lib/youtube";
import type { GigSubmission, YouTubeVideoStats } from "@/types";
import { cn } from "@/lib/utils";

type SubmissionVideoPreviewProps = {
  submissionId: string;
  videoUrl: string;
  youtubeStats?: YouTubeVideoStats;
  verzaFeedback?: string;
  /** Tighter layout for brand/agency review grids */
  compact?: boolean;
  showFeedback?: boolean;
  showDownload?: boolean;
  /** Download button on hover (creator upload view) */
  downloadOnHover?: boolean;
  className?: string;
};

export function SubmissionVideoPreview({
  submissionId,
  videoUrl,
  youtubeStats,
  verzaFeedback,
  compact = false,
  showFeedback = true,
  showDownload = false,
  downloadOnHover = false,
  className = "",
}: SubmissionVideoPreviewProps) {
  const isYoutube = isYouTubeUrl(videoUrl);
  const youtubeId = isYoutube ? extractYouTubeVideoId(videoUrl) : null;

  return (
    <div className={cn("space-y-3", className)}>
      <div
        className={cn(
          "relative overflow-hidden rounded-md bg-black",
          downloadOnHover && "group",
          compact ? "aspect-video max-h-40 w-full" : "aspect-video w-full rounded-lg"
        )}
      >
        {isYoutube ? (
          youtubeId ? (
            <iframe
              className="h-full w-full"
              src={`https://www.youtube.com/embed/${youtubeId}`}
              title="YouTube submission"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <div className="flex h-full min-h-[8rem] items-center justify-center bg-muted text-muted-foreground text-xs">
              Invalid YouTube link
            </div>
          )
        ) : (
          <video
            src={videoUrl}
            controls
            className={cn("h-full w-full", compact ? "max-h-40" : "")}
          />
        )}

        {showDownload && !isYoutube && (
          <div className="absolute top-2 right-2">
            <Button size="icon" variant="secondary" className="h-6 w-6" asChild>
              <a href={videoUrl} download target="_blank" rel="noopener noreferrer">
                <Download className="h-3 w-3" />
              </a>
            </Button>
          </div>
        )}

        {downloadOnHover && !isYoutube && (
          <div className="absolute top-2 right-2 flex gap-2">
            <Button
              size="icon"
              variant="secondary"
              className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
              asChild
            >
              <a href={videoUrl} download target="_blank" rel="noopener noreferrer">
                <Download className="h-3 w-3" />
              </a>
            </Button>
          </div>
        )}
      </div>

      {isYoutube && (
        <YouTubeSubmissionStats
          submissionId={submissionId}
          videoUrl={videoUrl}
          stats={youtubeStats}
        />
      )}

      {showFeedback && verzaFeedback && (
        <p
          className={cn(
            "text-muted-foreground italic",
            compact ? "text-[10px] line-clamp-2" : "text-sm"
          )}
        >
          &ldquo;{verzaFeedback}&rdquo;
        </p>
      )}
    </div>
  );
}

export function submissionPreviewProps(
  sub: Pick<GigSubmission, "id" | "videoUrl" | "youtubeStats" | "verzaFeedback">
): Pick<
  SubmissionVideoPreviewProps,
  "submissionId" | "videoUrl" | "youtubeStats" | "verzaFeedback"
> {
  return {
    submissionId: sub.id,
    videoUrl: sub.videoUrl,
    youtubeStats: sub.youtubeStats,
    verzaFeedback: sub.verzaFeedback,
  };
}
