"use client";

import { useEffect, useState } from "react";
import { Chrome, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  subscribeOpticExtensionProgress,
  type OpticExtensionLiveProgress,
} from "@/lib/optic/extension-bridge";
import type { OpticExtensionProgress, OpticJobRow } from "@/lib/optic/types";
import { isOpticJobInFlight } from "@/lib/optic/types";

const PHASE_LABELS: Record<string, string> = {
  prepare: "Planning search",
  seeds: "AI shortlist",
  hashtag: "Hashtag browse",
  keyword: "Keyword search",
  posts: "Reviewing posts",
  profiles: "Reviewing profiles",
  done: "Complete",
};

type Props = {
  job: OpticJobRow | null;
};

function mergeProgress(
  fromJob: OpticExtensionProgress | null | undefined,
  live: OpticExtensionLiveProgress | null
): OpticExtensionProgress | null {
  if (live?.message) {
    return {
      phase: live.phase ?? fromJob?.phase,
      message: live.message,
      discovered: live.discovered ?? fromJob?.discovered,
      target: live.target ?? fromJob?.target,
      hashtag: fromJob?.hashtag,
      searchQuery: fromJob?.searchQuery,
    };
  }
  return fromJob ?? null;
}

export function OpticExtensionProgressCard({ job }: Props) {
  const [live, setLive] = useState<OpticExtensionLiveProgress | null>(null);

  useEffect(() => {
    return subscribeOpticExtensionProgress((progress) => {
      if (job?.id && progress.jobId && progress.jobId !== job.id) return;
      setLive(progress);
    });
  }, [job?.id]);

  if (!job || job.runner !== "extension" || !isOpticJobInFlight(job.status)) {
    return null;
  }

  const progress = mergeProgress(job.extensionProgress, live);
  if (!progress?.message) return null;

  const target = progress.target ?? job.maxProfiles ?? 1;
  const discovered = progress.discovered ?? job.processedCount ?? 0;
  const pct = Math.min(100, Math.round((discovered / Math.max(target, 1)) * 100));
  const phaseLabel = PHASE_LABELS[progress.phase ?? ""] ?? "In progress";

  return (
    <div className="rounded-lg border border-violet-200/80 bg-violet-50/50 p-3 dark:border-violet-900/50 dark:bg-violet-950/30">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Chrome className="h-4 w-4 text-violet-600" />
        <span className="text-sm font-medium">Chrome extension mission</span>
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          {phaseLabel}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">{progress.message}</p>
      {(progress.searchSummary || progress.hashtag || progress.searchQuery) && (
        <p className="mt-1 text-xs text-muted-foreground">
          {progress.searchSummary && <span>{progress.searchSummary}</span>}
          {(progress.hashtags?.length || progress.hashtag) && (
            <>
              {progress.searchSummary ? " · " : ""}
              {(progress.hashtags ?? (progress.hashtag ? [progress.hashtag] : []))
                .map((h) => `#${h}`)
                .join(", ")}
            </>
          )}
        </p>
      )}
      <div className="mt-3 space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{discovered} saved</span>
          <span>Goal: {target}</span>
        </div>
        <Progress value={pct} className="h-2" />
      </div>
    </div>
  );
}
