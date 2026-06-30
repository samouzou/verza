"use client";

import { useState } from "react";
import { Eye, Loader2, MessageCircle, RefreshCw, ThumbsUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { refreshSubmissionYouTubeStats } from "@/lib/submissions/youtube-stats";
import {
  formatYouTubeCount,
  youtubeStatsAgeLabel,
  type YouTubeVideoStats,
} from "@/lib/youtube";

type YouTubeSubmissionStatsProps = {
  submissionId: string;
  videoUrl: string;
  stats?: YouTubeVideoStats;
  className?: string;
};

export function YouTubeSubmissionStats({
  submissionId,
  videoUrl,
  stats,
  className = "",
}: YouTubeSubmissionStatsProps) {
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshSubmissionYouTubeStats(submissionId, videoUrl);
      toast({
        title: stats ? "Stats refreshed" : "YouTube stats loaded",
        description: "View, like, and comment counts are up to date.",
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Could not load YouTube stats.";
      toast({
        title: "Refresh failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  };

  const age = stats ? youtubeStatsAgeLabel(stats.fetchedAt) : null;

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          YouTube analytics
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {stats ? "Refresh stats" : "Load stats"}
        </Button>
      </div>

      {stats ? (
        <>
          {(stats.title || stats.channelTitle) && (
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              {stats.title && (
                <p className="line-clamp-2 text-sm font-medium leading-snug">{stats.title}</p>
              )}
              {stats.channelTitle && (
                <p className="mt-0.5 text-xs text-muted-foreground">{stats.channelTitle}</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3">
            <StatCell icon={Eye} label="Views" value={formatYouTubeCount(stats.viewCount)} />
            <StatCell icon={ThumbsUp} label="Likes" value={formatYouTubeCount(stats.likeCount)} />
            <StatCell
              icon={MessageCircle}
              label="Comments"
              value={formatYouTubeCount(stats.commentCount)}
            />
          </div>

          {age && (
            <p className="text-center text-[10px] text-muted-foreground">
              Last updated {age}
            </p>
          )}
        </>
      ) : (
        <p className="rounded-lg border border-dashed bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
          No stats saved yet. Load stats to pull the latest views, likes, and comments from
          YouTube.
        </p>
      )}
    </div>
  );
}

function StatCell({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Eye;
  label: string;
  value: string;
}) {
  return (
    <div className="text-center">
      <div className="mb-1 flex items-center justify-center gap-1 text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}
