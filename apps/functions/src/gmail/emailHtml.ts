/** Gmail-like HTML for Optic outreach drafts. Allowlist only — no scripts or images. */

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

const HTML_TAG_RE =
  /<\/?(p|br|div|span|strong|b|em|i|u|s|ul|ol|li|a|blockquote|h[1-6]|html|body)\b/i;

/**
 * True when the draft already contains email HTML rather than plain paragraphs.
 * @param {string} value Draft body.
 * @return {boolean} Whether HTML tags are present.
 */
export function looksLikeEmailHtml(value: string): boolean {
  return HTML_TAG_RE.test(value);
}

function stripHtmlToPlain(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|blockquote|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * True when Quill's empty `<p><br></p>` or whitespace-only HTML has no copy.
 * @param {string} value Draft body.
 * @return {boolean} Whether there is nothing to send.
 */
export function isEmailDraftEmpty(value: string): boolean {
  return !stripHtmlToPlain(value);
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

/**
 * Keeps Gmail-safe tags (bold, italic, lists, links) and drops the rest.
 * @param {string} html Raw HTML from the editor or a paste.
 * @return {string} Sanitized fragment.
 */
export function sanitizeEmailFragment(html: string): string {
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

/**
 * Drops ```html fences agents sometimes wrap around a body.
 * @param {string} raw Draft text or HTML.
 * @return {string} Inner content.
 */
export function stripEmailCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : trimmed;
}

/**
 * Converts plain paragraphs into Quill/Gmail-safe HTML fragments.
 * @param {string} text Plain outreach copy.
 * @return {string} HTML using p/br only.
 */
export function plaintextToEmailHtml(text: string): string {
  const escaped = escapeHtml(text.replace(/\r\n/g, "\n").trim());
  if (!escaped) return "";
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * Stores sanitized HTML (never bare plain text).
 * @param {string} raw Draft from the client, worker, or MCP.
 * @return {string} HTML fragment to write on the lead.
 */
export function sanitizeStoredEmailDraft(raw: string): string {
  const trimmed = stripEmailCodeFences(raw);
  if (!trimmed) return "";
  if (!looksLikeEmailHtml(trimmed)) return plaintextToEmailHtml(trimmed);
  return sanitizeEmailFragment(trimmed);
}

function plaintextToGmailHtml(text: string): string {
  const escaped = escapeHtml(text.replace(/\r\n/g, "\n"));
  if (!escaped.trim()) return "";
  return escaped
    .split("\n")
    .map((line) => (line ? `<div>${line}</div>` : "<div><br></div>"))
    .join("");
}

/**
 * Builds the plain + HTML parts Gmail expects (multipart/alternative).
 * @param {string} raw Stored draft (plain paragraphs or HTML).
 * @return {{plain: string, html: string}} MIME bodies.
 */
export function prepareGmailBodies(raw: string): {plain: string; html: string} {
  const trimmed = stripEmailCodeFences(raw);
  const fragment = looksLikeEmailHtml(trimmed)
    ? sanitizeEmailFragment(trimmed)
    : plaintextToGmailHtml(trimmed);
  const gmailish = fragment
    .replace(/<p>/gi, "<div>")
    .replace(/<\/p>/gi, "</div>");
  const html =
    `<div dir="ltr" style="font-family:Arial,Helvetica,sans-serif;` +
    `font-size:14px;line-height:1.5;color:#222222">${gmailish}</div>`;
  const plain = stripHtmlToPlain(fragment) || stripHtmlToPlain(trimmed);
  return {plain, html};
}
