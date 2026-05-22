import { opticPlatformLabel } from "@/lib/optic/platforms";
import type { OpticLeadRow } from "@/lib/optic/types";

export type LeadOutreachDraft = {
  channel: "email" | "dm";
  subject?: string;
  body: string;
  platformLabel: string;
};

/** Splits draft text into paragraphs for display. */
export function draftParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Primary outreach copy for a vault lead (email when available, otherwise platform DM). */
export function getLeadOutreachDraft(lead: OpticLeadRow): LeadOutreachDraft | null {
  const emailBody = lead.draftEmail?.trim();
  if (emailBody) {
    return {
      channel: "email",
      subject: lead.draftEmailSubject?.trim() || undefined,
      body: emailBody,
      platformLabel: opticPlatformLabel(lead.discoveryPlatform),
    };
  }
  const dmBody = lead.draftDm?.trim();
  if (dmBody) {
    return {
      channel: "dm",
      body: dmBody,
      platformLabel: opticPlatformLabel(lead.discoveryPlatform),
    };
  }
  return null;
}

/** Plain text for clipboard (includes subject line for email). */
export function outreachCopyText(draft: LeadOutreachDraft): string {
  if (draft.channel === "email" && draft.subject) {
    return `Subject: ${draft.subject}\n\n${draft.body}`;
  }
  return draft.body;
}
