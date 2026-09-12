import type { Timestamp } from "firebase/firestore";
import type {
  OpticLeadResponse,
  OpticLeadStage,
  OpticPassReason,
} from "@verza/types";
import {
  OPTIC_LEAD_RESPONSE_LABELS,
  OPTIC_LEAD_RESPONSES,
  OPTIC_LEAD_STAGE_LABELS,
  OPTIC_LEAD_STAGES,
  OPTIC_PASS_REASON_LABELS,
  OPTIC_PASS_REASONS,
  isOpticLeadStage,
} from "@verza/types";

import type { OpticLeadRow } from "./types";

export {
  OPTIC_LEAD_RESPONSE_LABELS,
  OPTIC_LEAD_RESPONSES,
  OPTIC_LEAD_STAGE_LABELS,
  OPTIC_LEAD_STAGES,
  OPTIC_PASS_REASON_LABELS,
  OPTIC_PASS_REASONS,
};

export function resolveLeadStage(
  lead: Pick<OpticLeadRow, "pipelineStage" | "outreachEmailed">
): OpticLeadStage {
  if (isOpticLeadStage(lead.pipelineStage)) return lead.pipelineStage;
  return lead.outreachEmailed ? "contacted" : "new";
}

export function resolveLastContactedAt(
  lead: Pick<OpticLeadRow, "lastContactedAt" | "outreachEmailedAt">
): Timestamp | null {
  return lead.lastContactedAt ?? lead.outreachEmailedAt ?? null;
}

export function stageLabel(stage: OpticLeadStage): string {
  return OPTIC_LEAD_STAGE_LABELS[stage];
}

export function responseLabel(response: OpticLeadResponse): string {
  return OPTIC_LEAD_RESPONSE_LABELS[response];
}

export function passReasonLabel(reason: OpticPassReason): string {
  return OPTIC_PASS_REASON_LABELS[reason];
}

export function stageBadgeClasses(stage: OpticLeadStage): string {
  switch (stage) {
    case "contacted":
      return "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300";
    case "replied":
      return "border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-300";
    case "negotiating":
      return "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300";
    case "booked":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300";
    case "passed":
      return "border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-300";
    default:
      return "border-border bg-muted/60 text-muted-foreground";
  }
}
