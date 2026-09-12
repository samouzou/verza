/** Runtime CRM allowlists. Do not import these from @verza/types — that package is TS-only. */

export const OPTIC_LEAD_STAGES = [
  "new",
  "contacted",
  "replied",
  "negotiating",
  "booked",
  "passed",
] as const;
export type OpticLeadStage = (typeof OPTIC_LEAD_STAGES)[number];

export const OPTIC_LEAD_RESPONSES = [
  "awaiting",
  "interested",
  "rate_card",
  "countered",
  "needs_brief",
  "needs_usage",
  "declined",
  "ghosted",
] as const;
export type OpticLeadResponse = (typeof OPTIC_LEAD_RESPONSES)[number];

export const OPTIC_PASS_REASONS = [
  "no_upfront",
  "rate_too_high",
  "out_of_budget",
  "product_only",
  "usage_rights",
  "exclusivity",
  "already_booked",
  "competitor",
  "off_brief",
  "audience",
  "inactive",
  "ghosted",
  "other",
] as const;
export type OpticPassReason = (typeof OPTIC_PASS_REASONS)[number];

export const OPTIC_LEAD_STAGE_LABELS: Record<OpticLeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  replied: "Replied",
  negotiating: "In conversation",
  booked: "Booked",
  passed: "Passed",
};

export const OPTIC_LEAD_RESPONSE_LABELS: Record<OpticLeadResponse, string> = {
  awaiting: "Awaiting reply",
  interested: "Interested",
  rate_card: "Sent rate card",
  countered: "Countered",
  needs_brief: "Needs the brief",
  needs_usage: "Asked about usage",
  declined: "Declined",
  ghosted: "Ghosted",
};

export const OPTIC_PASS_REASON_LABELS: Record<OpticPassReason, string> = {
  no_upfront: "No upfront pay",
  rate_too_high: "Rate too high",
  out_of_budget: "Out of budget",
  product_only: "Gifting / product-only",
  usage_rights: "Usage / whitelisting",
  exclusivity: "Exclusivity",
  already_booked: "Already booked",
  competitor: "With a competitor",
  off_brief: "Off-brief",
  audience: "Audience mismatch",
  inactive: "Not posting",
  ghosted: "No reply",
  other: "Other",
};

export function isOpticLeadStage(value: unknown): value is OpticLeadStage {
  return typeof value === "string" && (OPTIC_LEAD_STAGES as readonly string[]).includes(value);
}

export function isOpticLeadResponse(value: unknown): value is OpticLeadResponse {
  return typeof value === "string" && (OPTIC_LEAD_RESPONSES as readonly string[]).includes(value);
}

export function isOpticPassReason(value: unknown): value is OpticPassReason {
  return typeof value === "string" && (OPTIC_PASS_REASONS as readonly string[]).includes(value);
}
