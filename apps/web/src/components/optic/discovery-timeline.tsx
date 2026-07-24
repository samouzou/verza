"use client";

import { cn } from "@/lib/utils";
import { opticPlatformLabel } from "@/lib/optic/platforms";
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
    const label = plat ? opticPlatformLabel(plat) : "the platform";
    return `Searching ${label} for people who match your goals…`;
  }
  if (/^Saved lead:/i.test(m)) {
    const name = m.replace(/^Saved lead:\s*/i, "").trim();
    return name ? `Added ${name} to your vault.` : "Added a creator to your vault.";
  }
  if (/Chrome extension connected/i.test(m)) return "Chrome extension connected — searching Instagram in your browser.";
  if (/AI shortlist:/i.test(m)) return m.replace(/^AI shortlist:\s*/i, "AI shortlist: ");
  if (/Browsing #/i.test(m)) return m;
  if (/Keyword search/i.test(m)) return m;
  if (/Saved @/i.test(m)) {
    const rest = m.replace(/^Saved @/i, "").trim();
    return `Added @${rest}`;
  }
  if (/^Done — saved/i.test(m)) return m;
  if (/Completed\.\s*Saved/i.test(m)) {
    const n = m.match(/(\d+)/)?.[1];
    return n ? `All set — ${n} creator${n === "1" ? "" : "s"} are ready in your vault.` : m;
  }
  return m;
}

function profileDisplayLabel(profileUrl: string): string {
  try {
    const u = new URL(profileUrl);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/$/, "");
    if (!path || path === "/") return host;
    const combined = `${host}${path}`;
    return combined.length > 48 ? `${combined.slice(0, 45)}…` : combined;
  } catch {
    return profileUrl.length > 48 ? `${profileUrl.slice(0, 45)}…` : profileUrl;
  }
}

function parseProfileLog(
  message: string
): { kind: "opening" | "skipped" | "known"; url: string } | null {
  const open = message.match(/^Opening\s+(https?:\/\/\S+)/i);
  if (open?.[1]) return { kind: "opening", url: open[1] };
  const skip = message.match(/^Skipped\s+(https?:\/\/\S+)/i);
  if (skip?.[1]) return { kind: "skipped", url: skip[1] };
  const known = message.match(/^Already in vault:\s*(https?:\/\/\S+)/i);
  if (known?.[1]) return { kind: "known", url: known[1] };
  return null;
}

function LogLineContent({ message }: { message: string }) {
  const text = humanizeLogMessage(message);
  const parsed = parseProfileLog(message);

  if (parsed) {
    const label = profileDisplayLabel(parsed.url);
    const prefix =
      parsed.kind === "opening"
        ? "Opening "
        : parsed.kind === "known"
          ? "Already in vault: "
          : "Skipped ";
    const suffix = parsed.kind === "skipped" ? " — trying the next one" : "";
    return (
      <span>
        {prefix}
        <span className="font-mono text-foreground/80">{label}</span>
        {suffix}
      </span>
    );
  }

  return <>{text}</>;
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
  logs: OpticJobRow["logs"],
  runner?: string
): "idle" | "active" | "done" {
  const isExtension = runner === "extension";
  const hasPhase = (p: string) =>
    logs?.some((l) => l.phase === p || (isExtension && p === "search" && l.phase === "extension"));
  if (status === "completed") return "done";
  if (status === "failed" || status === "cancelled") {
    if (stepId === "done") return "idle";
    return hasPhase(stepId === "prepare" ? "worker" : stepId) ? "done" : "idle";
  }
  if (status === "running") {
    if (isExtension) {
      if (stepId === "prepare" && (hasPhase("extension") || hasPhase("enqueue"))) return "done";
      if (stepId === "search" && hasPhase("extension")) {
        const extensionLogs = logs?.filter((l) => l.phase === "extension") ?? [];
        const last = extensionLogs[extensionLogs.length - 1]?.message ?? "";
        if (/Reviewing @|saved \d+ of/i.test(last)) return "done";
        return "active";
      }
      if (stepId === "vet" && hasPhase("extension")) {
        const extensionLogs = logs?.filter((l) => l.phase === "extension") ?? [];
        const last = extensionLogs[extensionLogs.length - 1]?.message ?? "";
        if (/Reviewing @|Saved @/i.test(last)) return "active";
      }
      if (stepId === "prepare") return hasPhase("extension") ? "done" : "active";
    }
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
        const state = job ? stepState(step.id, status, logs, job.runner) : "idle";
        const mini =
          step.id === "search"
            ? logsForPhase("search").concat(
                job?.runner === "extension" ? logsForPhase("extension") : []
              )
            : step.id === "vet"
              ? logsForPhase("vet").concat(
                  job?.runner === "extension"
                    ? (logs ?? []).filter(
                        (l) =>
                          l.phase === "extension" &&
                          (l.message?.includes("Saved @") || l.message?.includes("Reviewing @"))
                      )
                    : []
                )
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
                        <LogLineContent message={line.message ?? ""} />
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
