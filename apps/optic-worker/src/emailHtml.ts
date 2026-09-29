/** Gmail-safe HTML for Optic email drafts. Platform DMs stay plain text. */

const HTML_TAG_RE =
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

function looksLikeEmailHtml(value: string): boolean {
  return HTML_TAG_RE.test(value);
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
    .replace(/&quot;/g, "\"")
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

function stripEmailCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : trimmed;
}

function sanitizeEmailFragment(html: string): string {
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
      return `<a href="${escapeAttr(href)}">`;
    }
    return `<${tag}>`;
  });
  return s.trim();
}

export const DRAFT_EMAIL_HTML_HINT =
  "REQUIRED HTML email (not plain text). Use only <p>, <br>, <ul>, <li>, <strong>, <em>, and <a href=\"https://...\">. " +
  "Follow this structure in order: " +
  "(1) <p>Hi FirstName,</p> " +
  "(2) warm opener + who is writing FROM the brand — e.g. \"I'm Alex with <strong>Brand</strong>.\" Use the provided sender display name when given; never invent a job title, street address, phone, or \"Founder & CEO\" line. " +
  "(3) 1–2 sentences on what the brand does (from brand positioning only). " +
  "(4) why creators like them are a fit for this campaign. " +
  "(5) short lead-in then <ul><li>…</li></ul> with 2–4 campaign basics grounded in the facts provided (product access, deliverable, unique link, pay only if a concrete figure appears — never invent). " +
  "(6) soft CTA inviting a brief chat (not a hard close). " +
  "(7) <p>Best,<br>FirstName or Brand</p> " +
  "(8) optional final <p> with the brand name only as a light footer — no street address, suite, city, or legal entity line. " +
  "Write as the brand itself reaching out — never \"we're representing Brand\" or \"partnering via Verza\" unless the brand name is Verza. " +
  "Bold the brand name once with <strong>. No markdown, no <html>/<body>, no CSS.";

function lightMarkdownToHtmlHints(text: string): string {
  // Best-effort if the model ignores HTML and returns markdown instead.
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>");
}

function plaintextToEmailHtml(text: string): string {
  const withHints = lightMarkdownToHtmlHints(text.replace(/\r\n/g, "\n").trim());
  if (looksLikeEmailHtml(withHints)) {
    return sanitizeEmailFragment(withHints);
  }
  const escaped = escapeHtml(withHints);
  if (!escaped) return "";
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Always store email drafts as a sanitized HTML fragment. */
export function ensureStoredEmailHtml(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = stripEmailCodeFences(raw);
  if (!trimmed) return null;
  const html = looksLikeEmailHtml(trimmed)
    ? sanitizeEmailFragment(trimmed)
    : plaintextToEmailHtml(trimmed);
  return html || null;
}
