import { opticPlatformLabel } from "@/lib/optic/platforms";
import type { OpticLeadRow } from "@/lib/optic/types";

export type LeadOutreachDraft = {
  channel: "email" | "dm";
  subject?: string;
  body: string;
  platformLabel: string;
};

const EMAIL_HTML_RE =
  /<\/?(p|br|div|span|strong|b|em|i|u|s|ul|ol|li|a|blockquote|h[1-6]|html|body)\b/i;

const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "div",
  "em",
  "i",
  "li",
  "ol",
  "p",
  "s",
  "span",
  "strike",
  "strong",
  "u",
  "ul",
]);

/** True when the stored draft is HTML (Quill / pasted Gmail) rather than plain lines. */
export function looksLikeEmailHtml(value: string): boolean {
  return EMAIL_HTML_RE.test(value);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function decodeAttr(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function safeHref(raw: string): string | null {
  const href = decodeAttr(raw).trim();
  if (!/^(https?:\/\/|mailto:)/i.test(href)) return null;
  if (/[\s<>]/.test(href)) return null;
  return href;
}

/** Allowlist Gmail-safe tags for preview. */
export function sanitizeEmailHtml(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)\/?>/g, (full, name: string, attrs: string) => {
    const tag = name.toLowerCase();
    const closing = full.startsWith("</");
    if (!ALLOWED_TAGS.has(tag)) return "";
    if (closing) return tag === "br" ? "" : `</${tag}>`;
    if (tag === "br") return "<br>";
    if (tag === "a") {
      const match = String(attrs).match(
        /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
      );
      const href = match ? safeHref(match[1] ?? match[2] ?? match[3] ?? "") : null;
      if (!href) return "";
      return `<a href="${escapeAttr(href)}" target="_blank" rel="noreferrer">`;
    }
    return `<${tag}>`;
  });
  return s.trim();
}

/** Readable copy from HTML or plaintext drafts. */
export function htmlToPlaintext(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|blockquote|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isEmailDraftEmpty(value: string): boolean {
  return !htmlToPlaintext(value);
}

function plaintextToQuillHtml(text: string): string {
  return escapeHtml(text.replace(/\r\n/g, "\n"))
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Loads a stored draft into the Gmail-style editor. */
export function emailBodyForEditor(saved: string): string {
  const trimmed = saved.trim();
  if (!trimmed) return "";
  if (looksLikeEmailHtml(trimmed)) return trimmed;
  return plaintextToQuillHtml(trimmed);
}

export function normalizeEmailHtml(html: string): string {
  return html.replace(/\s+/g, " ").replace(/> </g, "><").trim();
}

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
  const body =
    draft.channel === "email" && looksLikeEmailHtml(draft.body)
      ? htmlToPlaintext(draft.body)
      : draft.body;
  if (draft.channel === "email" && draft.subject) {
    return `Subject: ${draft.subject}\n\n${body}`;
  }
  return body;
}
