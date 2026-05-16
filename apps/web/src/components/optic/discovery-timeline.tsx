"use client";

import { cn } from "@/lib/utils";
import type { OpticJobRow } from "@/lib/optic/types";
import type { Timestamp } from "firebase/firestore";

const STEPS = [
  {
    id: "prepare",
    label: "Starting your mission",
    hint: "We’re getting your brief and opening the scout.",
  },
  {
    id: "search",
    label: "Finding the right people",
    hint: "Shortlist and public search on the platform you chose.",
  },
  {
    id: "vet",
    label: "Reviewing profiles",
    hint: "We visit each profile and draft a tailored outreach note when it’s a fit.",
  },
  {
    id: "done",
    label: "Saving to your vault",
    hint: "Qualified creators appear in Optic vault with a draft you can send.",
  },
] as const;

/** Softens older status lines that used internal wording. */
function humanizeLogMessage(message: string): string {
  let m = message;
  if (/Worker started/i.test(m)) return "Scout is running.";
  if (/Generating seed leads/i.test(m)) return "Finding creators who fit your brief…";
  if (/Launching scout on/i.test(m)) {
    const plat = m.match(/on (\w+)/i)?.[1]?.toLowerCase() ?? "";
    const label =
      plat === "youtube"
        ? "YouTube"
        : plat === "instagram"
          ? "Instagram"
          : plat === "tiktok"
            ? "TikTok"
            : plat || "the platform";
    return `Searching ${label} for people who match your goals…`;
  }
  if (/^Saved lead:/i.test(m)) {
    const name = m.replace(/^Saved lead:\s*/i, "").trim();
    return name ? `Added ${name} to your vault.` : "Added a creator to your vault.";
  }
  if (/Completed\.\s*Saved/i.test(m)) {
    const n = m.match(/(\d+)/)?.[1];
    return n ? `All set — ${n} creator${n === "1" ? "" : "s"} are ready in your vault.` : m;
  }
  if (/^Skipped\s+https?:\/\//i.test(m)) return "Skipping a profile that didn’t work out — trying the next one.";
  return m;
}

function tsToDate(ts: Timestamp | undefined): Date | null {
  if (!ts || typeof ts.toDate !== "function") return null;
  try {
    return ts.toDate();
  } catch {
    return null;
  }
}

function stepState(
  stepId: string,
  status: string | undefined,
  logs: OpticJobRow["logs"]
): "idle" | "active" | "done" {
  const hasPhase = (p: string) => logs?.some((l) => l.phase === p);
  if (status === "completed") return "done";
  if (status === "failed" || status === "cancelled") {
    if (stepId === "done") return "idle";
    return hasPhase(stepId === "prepare" ? "worker" : stepId) ? "done" : "idle";
  }
  if (status === "running") {
    if (stepId === "prepare" && (hasPhase("worker") || hasPhase("search"))) return "done";
    if (stepId === "search" && hasPhase("vet")) return "done";
    if (stepId === "search" && hasPhase("search")) return "active";
    if (stepId === "vet" && hasPhase("vet")) return "active";
    if (stepId === "prepare" && status === "running") return hasPhase("worker") ? "done" : "active";
  }
  if (status === "queued" && stepId === "prepare") return "active";
  return "idle";
}

type Props = {
  job: OpticJobRow | null;
};

export function DiscoveryTimeline({ job }: Props) {
  const status = job?.status;
  const logs = job?.logs ?? [];

  const logsForPhase = (phase: string) =>
    logs.filter((l) => l.phase === phase || (phase === "prepare" && l.phase === "enqueue"));

  return (
    <div className="space-y-4">
      {STEPS.map((step) => {
        const state = job ? stepState(step.id, status, logs) : "idle";
        const mini =
          step.id === "search"
            ? logsForPhase("search")
            : step.id === "vet"
              ? logsForPhase("vet")
              : [];
        return (
          <div key={step.id} className="flex gap-3">
            <div
              className={cn(
                "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2",
                state === "done" && "border-primary bg-primary",
                state === "active" && "border-primary bg-primary/30 animate-pulse",
                state === "idle" && "border-muted-foreground/40 bg-transparent"
              )}
            />
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-medium", state === "idle" && "text-muted-foreground")}>
                {step.label}
              </p>
              <p className="text-xs text-muted-foreground">{step.hint}</p>
              {mini.length > 0 && (
                <div className="mt-2 max-h-28 overflow-y-auto rounded border bg-muted/30 p-2 text-[11px] leading-relaxed text-muted-foreground">
                  {mini.slice(-12).map((line, i) => {
                    const t = tsToDate(line.ts);
                    return (
                      <div key={i}>
                        {t ? `${t.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · ` : ""}
                        {humanizeLogMessage(line.message ?? "")}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
