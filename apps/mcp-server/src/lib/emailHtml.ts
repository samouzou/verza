/** Gmail-safe HTML for Optic email drafts. Platform DMs stay plain text. */

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

export function looksLikeEmailHtml(value: string): boolean {
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

export function stripEmailCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : trimmed;
}

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

export function plaintextToEmailHtml(text: string): string {
  const escaped = escapeHtml(text.replace(/\r\n/g, "\n").trim());
  if (!escaped) return "";
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Always store email drafts as a sanitized HTML fragment. */
export function ensureStoredEmailHtml(raw: string): string {
  const trimmed = stripEmailCodeFences(raw);
  if (!trimmed) return "";
  if (!looksLikeEmailHtml(trimmed)) return plaintextToEmailHtml(trimmed);
  return sanitizeEmailFragment(trimmed);
}
