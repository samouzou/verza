"use client";

import { formatDistanceToNow } from "date-fns";
import { Loader2 } from "lucide-react";
import type { Timestamp } from "firebase/firestore";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { opticPlatformLabel } from "@/lib/optic/platforms";
import { isOpticJobInFlight, type OpticJobRow } from "@/lib/optic/types";

function tsToDate(ts: Timestamp | undefined | null): Date | null {
  if (!ts || typeof ts.toDate !== "function") return null;
  try {
    return ts.toDate();
  } catch {
    return null;
  }
}

function statusVariant(status: string | undefined) {
  if (status === "failed") return "destructive" as const;
  if (status === "completed") return "default" as const;
  if (status === "cancelled") return "outline" as const;
  return "secondary" as const;
}

type Props = {
  jobs: OpticJobRow[];
  loading?: boolean;
  selectedId: string | null;
  onSelect: (jobId: string) => void;
};

export function MissionsList({ jobs, loading, selectedId, onSelect }: Props) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading missions…
      </p>
    );
  }

  if (jobs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No missions yet. Start one to scout creators and build your vault.
      </p>
    );
  }

  return (
    <ul className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
      {jobs.map((job) => {
        const created = tsToDate(job.createdAt);
        const inFlight = isOpticJobInFlight(job.status);
        const title =
          job.brandContext?.paySourceCampaignTitle?.trim() ||
          job.objectives?.trim().slice(0, 72) ||
          "Discovery mission";
        return (
          <li key={job.id}>
            <button
              type="button"
              onClick={() => onSelect(job.id)}
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                selectedId === job.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/50"
              )}
            >
              <MissionSummary
                inFlight={inFlight}
                platform={job.platform}
                title={title}
                status={job.status}
                processedCount={job.processedCount}
                maxProfiles={job.maxProfiles}
                created={created}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function MissionSummary({
  inFlight,
  platform,
  title,
  status,
  processedCount,
  maxProfiles,
  created,
}: {
  inFlight: boolean;
  platform: string | undefined;
  title: string;
  status: string | undefined;
  processedCount: number | undefined;
  maxProfiles: number | undefined;
  created: Date | null;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          {opticPlatformLabel(platform)}
          {inFlight && (
            <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </span>
        <Badge variant={statusVariant(status)} className="shrink-0 text-[10px] capitalize">
          {status ?? "unknown"}
        </Badge>
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{title}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {typeof processedCount === "number" && processedCount > 0
          ? `${processedCount} saved`
          : maxProfiles
            ? `Up to ${maxProfiles} profiles`
            : null}
        {created ? (
          <>
            {processedCount || maxProfiles ? " · " : ""}
            {formatDistanceToNow(created, { addSuffix: true })}
          </>
        ) : null}
      </p>
    </>
  );
}
