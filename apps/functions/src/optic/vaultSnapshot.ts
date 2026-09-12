import {
  OPTIC_LEAD_RESPONSE_LABELS,
  OPTIC_LEAD_RESPONSES,
  OPTIC_LEAD_STAGE_LABELS,
  OPTIC_LEAD_STAGES,
  OPTIC_PASS_REASON_LABELS,
  OPTIC_PASS_REASONS,
  isOpticLeadResponse,
  isOpticLeadStage,
  isOpticPassReason,
  type OpticLeadResponse,
  type OpticLeadStage,
  type OpticPassReason,
} from "./leadCrm";

export const VAULT_SNAPSHOT_LIMIT = 500;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type VaultCampaignScope = "__all__" | "__pooled__" | string;

export type VaultAnalyticsSnapshot = {
  scopeLabel: string;
  leadCount: number;
  truncated: boolean;
  stages: Record<OpticLeadStage, number>;
  responses: Record<OpticLeadResponse, number>;
  passReasons: Record<OpticPassReason, number>;
  last7dContacts: number;
  neverTouched: number;
  hasEmail: number;
  reachedOut: number;
  inProgress: number;
  platforms: Record<string, number>;
  matchBands: {strong: number; good: number; fair: number; weak: number; unknown: number};
};

function emptyCounts<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;
}

function tsMillis(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const ts = value as {toMillis?: () => number; toDate?: () => Date};
  try {
    if (typeof ts.toMillis === "function") return ts.toMillis();
    if (typeof ts.toDate === "function") return ts.toDate().getTime();
  } catch {
    return null;
  }
  return null;
}

export type VaultLeadDoc = {
  pipelineStage?: unknown;
  outreachEmailed?: unknown;
  outreachResponse?: unknown;
  passReason?: unknown;
  lastContactedAt?: unknown;
  outreachEmailedAt?: unknown;
  email?: unknown;
  discoveryPlatform?: unknown;
  matchScore?: unknown;
  campaignId?: unknown;
};

function resolveStage(lead: VaultLeadDoc): OpticLeadStage {
  if (isOpticLeadStage(lead.pipelineStage)) return lead.pipelineStage;
  return lead.outreachEmailed === true ? "contacted" : "new";
}

function matchBand(score: unknown): keyof VaultAnalyticsSnapshot["matchBands"] {
  if (typeof score !== "number" || !Number.isFinite(score)) return "unknown";
  if (score >= 90) return "strong";
  if (score >= 70) return "good";
  if (score >= 50) return "fair";
  return "weak";
}

/**
 * Counts vault CRM fields. Stage falls back to the contacted checkbox for older leads.
 * @param {VaultLeadDoc[]} leads Agency leads already scoped.
 * @param {string} scopeLabel Human label for the campaign filter.
 * @param {boolean} truncated True when the query hit the vault cap.
 * @return {VaultAnalyticsSnapshot} Deterministic rollup for chat.
 */
export function buildVaultSnapshot(
  leads: VaultLeadDoc[],
  scopeLabel: string,
  truncated: boolean
): VaultAnalyticsSnapshot {
  const stages = emptyCounts(OPTIC_LEAD_STAGES);
  const responses = emptyCounts(OPTIC_LEAD_RESPONSES);
  const passReasons = emptyCounts(OPTIC_PASS_REASONS);
  const platforms: Record<string, number> = {};
  const matchBands = {strong: 0, good: 0, fair: 0, weak: 0, unknown: 0};
  const weekAgo = Date.now() - WEEK_MS;
  let last7dContacts = 0;
  let neverTouched = 0;
  let hasEmail = 0;

  for (const lead of leads) {
    const stage = resolveStage(lead);
    stages[stage] += 1;
    if (isOpticLeadResponse(lead.outreachResponse)) {
      responses[lead.outreachResponse] += 1;
    }
    if (stage === "passed" && isOpticPassReason(lead.passReason)) {
      passReasons[lead.passReason] += 1;
    }
    const last = tsMillis(lead.lastContactedAt) ?? tsMillis(lead.outreachEmailedAt);
    if (last != null && last >= weekAgo) last7dContacts += 1;
    if (last == null && stage === "new") neverTouched += 1;
    if (typeof lead.email === "string" && lead.email.trim()) hasEmail += 1;
    const platform =
      typeof lead.discoveryPlatform === "string" && lead.discoveryPlatform.trim()
        ? lead.discoveryPlatform.trim().toLowerCase()
        : "unknown";
    platforms[platform] = (platforms[platform] ?? 0) + 1;
    matchBands[matchBand(lead.matchScore)] += 1;
  }

  const reachedOut = stages.contacted + stages.replied + stages.negotiating + stages.booked;
  const inProgress = stages.replied + stages.negotiating;

  return {
    scopeLabel,
    leadCount: leads.length,
    truncated,
    stages,
    responses,
    passReasons,
    last7dContacts,
    neverTouched,
    hasEmail,
    reachedOut,
    inProgress,
    platforms,
    matchBands,
  };
}

/**
 * Prompt-facing JSON: labels instead of enum keys, zeros omitted from sparse maps.
 * @param {VaultAnalyticsSnapshot} snap Rollup.
 * @return {Record<string, unknown>} Compact object for Gemini.
 */
export function snapshotForPrompt(snap: VaultAnalyticsSnapshot): Record<string, unknown> {
  const labeled = <T extends string>(
    counts: Record<T, number>,
    labels: Record<T, string>
  ) => {
    const out: Record<string, number> = {};
    for (const [key, n] of Object.entries(counts) as [T, number][]) {
      if (n > 0) out[labels[key] ?? key] = n;
    }
    return out;
  };
  return {
    view: snap.scopeLabel,
    creatorsInView: snap.leadCount,
    mayBeIncomplete: snap.truncated
      ? `Only the latest ${VAULT_SNAPSHOT_LIMIT} vault leads were counted.`
      : false,
    stages: labeled(snap.stages, OPTIC_LEAD_STAGE_LABELS),
    reachedOut: snap.reachedOut,
    inConversationOrReplied: snap.inProgress,
    booked: snap.stages.booked,
    passed: snap.stages.passed,
    neverTouched: snap.neverTouched,
    contactedInLast7Days: snap.last7dContacts,
    haveEmail: snap.hasEmail,
    replies: labeled(snap.responses, OPTIC_LEAD_RESPONSE_LABELS),
    passReasons: labeled(snap.passReasons, OPTIC_PASS_REASON_LABELS),
    platforms: snap.platforms,
    matchScoreBands: snap.matchBands,
    glossary: {
      New: "In the vault, no outreach logged.",
      Contacted: "Team marked a first touch.",
      Replied: "Creator came back.",
      "In conversation": "Rate, usage, or deliverables in play.",
      Booked: "Deal closed.",
      Passed: "Not moving forward (see pass reasons).",
    },
    notInThisData: [
      "Gmail open or reply rates",
      "Dollars booked or campaign budget spent",
      "Whether a post went live",
    ],
  };
}
