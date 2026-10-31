"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function clampScore(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] font-medium">
        <span className="text-muted-foreground">{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full", value >= 65 ? "bg-green-500" : "bg-orange-500")}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

export function VerzaScoreFeedback({
  score,
  feedback,
  hookScore,
  pacingScore,
  vibeScore,
  threshold,
  failed,
}: {
  score?: number | null;
  feedback?: string | null;
  hookScore?: number | null;
  pacingScore?: number | null;
  vibeScore?: number | null;
  threshold: number;
  failed: boolean;
}) {
  const overall = clampScore(score);
  const hook = clampScore(hookScore);
  const pacing = clampScore(pacingScore);
  const vibe = clampScore(vibeScore);
  const notes = typeof feedback === "string" ? feedback.trim() : "";
  const hasRun =
    (overall != null && overall > 0) || notes.length > 0 || hook != null || pacing != null || vibe != null;
  if (!hasRun && !failed) return null;

  const fallback =
    `Needed ${threshold}%+. Hook ${hook ?? "—"}${hook != null ? "/100" : ""}, pacing ${pacing ?? "—"}${pacing != null ? "/100" : ""}, vibe ${vibe ?? "—"}${vibe != null ? "/100" : ""}. Open on the first frame and cut anything that doesn't move the story.`;

  return (
    <div className="space-y-3">
      {overall != null && overall > 0 && (
        <p className={cn("text-sm font-medium", failed ? "text-destructive" : "text-foreground")}>
          {failed
            ? `${overall}% — below the ${threshold}% bar. Use this, then retry.`
            : `${overall}% — at or above ${threshold}%.`}
        </p>
      )}
      {(hook != null || pacing != null || vibe != null) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ScoreBar label="Hook" value={hook} />
          <ScoreBar label="Pacing" value={pacing} />
          <ScoreBar label="Vibe" value={vibe} />
        </div>
      )}
      <div className={cn(
        "p-3 rounded border text-sm leading-relaxed",
        failed ? "bg-orange-500/5 border-orange-500/20" : "bg-muted/50 border-border"
      )}>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">What to change</p>
        <p>{notes || fallback}</p>
      </div>
    </div>
  );
}

export function VerzaScoreBadge({ score, failed }: { score?: number | null; failed?: boolean }) {
  const overall = clampScore(score);
  if (overall == null || overall <= 0) return null;
  return (
    <Badge variant={failed ? "destructive" : "default"}>{overall}%</Badge>
  );
}
