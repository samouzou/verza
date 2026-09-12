export type GmailThreadMessage = {
  id: string;
  from: string;
  fromEmail: string;
  date: string | null;
  snippet: string;
  body: string;
  direction: "outbound" | "inbound";
};

type GmailHeader = {name?: string; value?: string};
type GmailPart = {
  mimeType?: string;
  body?: {data?: string; size?: number};
  parts?: GmailPart[];
  headers?: GmailHeader[];
};

function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  const needle = name.toLowerCase();
  const found = headers?.find((h) => (h.name ?? "").toLowerCase() === needle);
  return found?.value?.trim() ?? "";
}

function decodeBase64Url(data: string): string {
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function collectText(part: GmailPart | undefined, preferPlain: string[], html: string[]): void {
  if (!part) return;
  const mime = (part.mimeType ?? "").toLowerCase();
  const data = part.body?.data;
  if (data) {
    const text = decodeBase64Url(data);
    if (mime === "text/plain") preferPlain.push(text);
    else if (mime === "text/html") html.push(text);
  }
  for (const child of part.parts ?? []) {
    collectText(child, preferPlain, html);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractEmail(from: string): string {
  const angle = from.match(/<([^>]+)>/);
  if (angle?.[1]) return angle[1].trim().toLowerCase();
  const bare = from.match(/[^\s<>]+@[^\s<>]+/);
  return (bare?.[0] ?? from).trim().toLowerCase();
}

function parseDate(value: string): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Flattens a Gmail thread into vault-friendly messages (newest last).
 * @param {object} thread Gmail users.threads.get payload.
 * @param {string} connectedEmail Connected mailbox address.
 * @return {GmailThreadMessage[]} Up to 20 messages.
 */
export function parseGmailThread(
  thread: unknown,
  connectedEmail: string
): GmailThreadMessage[] {
  const messagesIn =
    thread && typeof thread === "object" && "messages" in thread
      ? (thread as {messages?: Array<{id?: string; snippet?: string; payload?: GmailPart & {headers?: GmailHeader[]}}>}).messages
      : [];
  const mine = connectedEmail.trim().toLowerCase();
  const out: GmailThreadMessage[] = [];
  for (const msg of messagesIn ?? []) {
    if (!msg.id) continue;
    const headers = msg.payload?.headers;
    const from = headerValue(headers, "From");
    const fromEmail = extractEmail(from);
    const plain: string[] = [];
    const html: string[] = [];
    collectText(msg.payload, plain, html);
    const body = (plain.join("\n\n").trim() || stripHtml(html.join("\n"))).slice(0, 8000);
    out.push({
      id: msg.id,
      from: from || fromEmail || "Unknown",
      fromEmail,
      date: parseDate(headerValue(headers, "Date")),
      snippet: (msg.snippet ?? "").trim(),
      body: body || (msg.snippet ?? "").trim(),
      direction: fromEmail && mine && fromEmail === mine ? "outbound" : "inbound",
    });
  }
  return out.slice(-20);
}
