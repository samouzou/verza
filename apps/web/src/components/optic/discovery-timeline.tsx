"use client";

import { cn } from "@/lib/utils";
import type { OpticJobRow } from "@/lib/optic/types";
import type { Timestamp } from "firebase/firestore";

const STEPS = [
  { id: "prepare", label: "Initialization", hint: "Job queued and worker starting." },
  { id: "search", label: "Search agent", hint: "Gemini seeds + platform scout." },
  { id: "vet", label: "Deep vetting", hint: "Profile screenshots and analysis." },
  { id: "done", label: "Outreach sync", hint: "Leads saved to the vault." },
] as const;

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
                <div className="mt-2 max-h-28 overflow-y-auto rounded border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed">
                  {mini.slice(-12).map((line, i) => {
                    const t = tsToDate(line.ts);
                    return (
                      <div key={i} className="text-muted-foreground">
                        {t ? `[${t.toISOString().slice(11, 19)}] ` : ""}
                        {line.message}
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
