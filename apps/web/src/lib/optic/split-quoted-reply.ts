const QUOTE_MARKERS: RegExp[] = [
  /^On .+wrote:\s*$/i,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^_{2,}\s*$/,
  /^From:\s.+\nSent:\s/i,
  /^Le .+a écrit\s*:\s*$/i,
];

/** Splits a Gmail body into the new reply and the quoted chain under it. */
export function splitQuotedReply(body: string): { visible: string; quoted: string } {
  const text = body.replace(/\r\n/g, "\n").trim();
  if (!text) return { visible: "", quoted: "" };

  const lines = text.split("\n");
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const next = (lines[i + 1] ?? "").trim();
    if (QUOTE_MARKERS.some((re) => re.test(line))) {
      cut = i;
      break;
    }
    if (/^On .{8,240}$/i.test(line) && /^wrote:\s*$/i.test(next)) {
      cut = i;
      break;
    }
    if (i > 0 && /^>/.test(line) && !/^>/.test((lines[i - 1] ?? "").trim())) {
      cut = i;
      break;
    }
  }
  if (cut <= 0) return { visible: text, quoted: "" };
  const visible = lines.slice(0, cut).join("\n").trim();
  const quoted = lines.slice(cut).join("\n").trim();
  if (!visible) return { visible: text, quoted: "" };
  return { visible, quoted };
}
