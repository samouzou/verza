import type {ParsedCarouselSlide} from "./parseCarouselMarkdown";
import {type CarouselTheme, VERZA_CHEVRON_PATH} from "../brandColors";

const W = 1080;
const H = 1350;
const PAD = 96;
const CONTENT_W = W - PAD * 2;
const SANS = "Inter, DejaVu Sans, Arial, sans-serif";
const SERIF = "Instrument Serif, DejaVu Serif, Georgia, serif";
const INK = "#0F1412";

/** A logo prepared in two contrast-safe versions. */
export type SlideLogo = {
  /** Version for dark backgrounds. */
  onDark: string;
  /** Version for light backgrounds. */
  onLight: string;
  /** Width / height. */
  aspect: number;
};

/** Everything a slide needs beyond its copy. */
export type SlideKit = {
  theme: CarouselTheme;
  brandName: string;
  logo?: SlideLogo;
  /** Who's posting: shown on the cover and the CTA. */
  byline?: {name: string; handle: string; avatar?: string};
};

type Surface = {
  kind: "dark" | "light" | "accent";
  text: string;
  muted: string;
  /** Accent that's readable as text on this surface. */
  accent: string;
  rule: string;
  /** Fill for the accent-colored shapes (bullets, rail, button). */
  fill: string;
  logo: "onDark" | "onLight";
};

type Word = {text: string; em: boolean; glue?: boolean};
type Font = {size: number; weight: number; serif?: boolean};

/**
 * Escapes text for safe inclusion in SVG.
 * @param {string} s Raw text.
 * @return {string} Escaped text.
 */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Parses #rrggbb into RGB.
 * @param {string} c Color.
 * @return {!Array<number>} RGB 0–255.
 */
function rgb(c: string): number[] {
  const h = /^#[0-9a-f]{6}$/i.test(c) ? c : "#ffffff";
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/**
 * Mixes two colors.
 * @param {string} a First color.
 * @param {string} b Second color.
 * @param {number} t Share of b, 0–1.
 * @return {string} #rrggbb.
 */
function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Relative luminance (0 = black, 1 = white).
 * @param {string} c #rrggbb.
 * @return {number} Luminance.
 */
function lum(c: string): number {
  const [r, g, b] = rgb(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * The three surfaces a carousel alternates between.
 * @param {CarouselTheme} t Theme.
 * @return {object} Dark, light and accent surfaces.
 */
function surfaces(t: CarouselTheme): Record<Surface["kind"], Surface> {
  const paper = mix("#FFFFFF", t.accentFrom, 0.045);
  const accentOnLight = lum(t.accentFrom) < 0.3 ? t.accentFrom : mix(t.accentFrom, INK, 0.55);
  const onAccentDark = lum(t.onAccent) < 0.2;
  return {
    dark: {
      kind: "dark", text: t.text, muted: t.muted, accent: t.accentTo, rule: mix(t.background, t.text, 0.14),
      fill: "url(#brandGrad)", logo: "onDark",
    },
    light: {
      kind: "light", text: INK, muted: mix(INK, paper, 0.4), accent: accentOnLight, rule: mix(paper, INK, 0.12),
      fill: "url(#brandGrad)", logo: "onLight",
    },
    accent: {
      kind: "accent", text: t.onAccent, muted: mix(t.onAccent, t.accentFrom, 0.3), accent: t.onAccent,
      rule: mix(t.accentFrom, t.onAccent, 0.25), fill: t.onAccent, logo: onAccentDark ? "onLight" : "onDark",
    },
  };
}

/**
 * Approximate rendered width of text.
 * @param {string} s Text.
 * @param {Font} f Font.
 * @return {number} Width in px.
 */
function measure(s: string, f: Font): number {
  let units = 0;
  for (const ch of s) {
    if (/[ilj.,:;'|!\s]/.test(ch)) units += 0.28;
    else if (/[MWmw@%]/.test(ch)) units += 0.86;
    else if (/[A-Z]/.test(ch)) units += 0.68;
    else if (/[0-9]/.test(ch)) units += 0.6;
    else if (/[ftr]/.test(ch)) units += 0.38;
    else units += 0.55;
  }
  const weight = f.serif ? 0.8 : f.weight >= 800 ? 1.1 : f.weight >= 700 ? 1.07 : f.weight >= 600 ? 1.04 : 1;
  return units * f.size * weight;
}

/**
 * Splits text into words, marking *emphasized* runs.
 * @param {string} text Text with optional *emphasis*.
 * @return {!Array<Word>} Words.
 */
function words(text: string): Word[] {
  const out: Word[] = [];
  text.split(/(\*[^*]+\*)/).forEach((part, i, parts) => {
    const em = /^\*[^*]+\*$/.test(part);
    const glue = out.length > 0 && /^\S/.test(part) && /\S$/.test(parts[i - 1] ?? "");
    part.replace(/\*/g, "").split(/\s+/).filter(Boolean).forEach((w, j) => out.push({text: w, em, glue: glue && j === 0}));
  });
  return out;
}

/**
 * Greedy line wrap.
 * @param {!Array<Word>} ws Words.
 * @param {number} maxW Max line width.
 * @param {Font} f Font.
 * @return {!Array<!Array<Word>>} Lines.
 */
function wrap(ws: Word[], maxW: number, f: Font): Word[][] {
  const lines: Word[][] = [];
  let line: Word[] = [];
  const width = (l: Word[]) => l.reduce((n, w, i) => n + measure((i ? " " : "") + w.text, emFont(f, w)), 0);
  for (const w of ws) {
    if (line.length && width([...line, w]) > maxW) {
      lines.push(line);
      line = [w];
    } else {
      line.push(w);
    }
  }
  if (line.length) lines.push(line);
  if (lines.length > 1 && lines[lines.length - 1]!.length === 1 && lines[lines.length - 2]!.length > 2) {
    lines[lines.length - 1]!.unshift(lines[lines.length - 2]!.pop()!);
  }
  return lines;
}

/**
 * Emphasized words are set in the serif italic, a touch larger.
 * @param {Font} f Base font.
 * @param {Word} w Word.
 * @return {Font} Font for this word.
 */
function emFont(f: Font, w: Word): Font {
  return w.em && !f.serif ? {size: f.size * 1.12, weight: 400, serif: true} : f;
}

/**
 * Picks the largest size at which the text fits the line limit.
 * @param {string} text Text.
 * @param {number} maxW Max line width.
 * @param {!Array<number>} sizes Candidate sizes, largest first.
 * @param {number} maxLines Line limit.
 * @param {Omit<Font, "size">} f Font without size.
 * @return {{font: Font, lines: !Array<!Array<Word>>}} Fitted text.
 */
function fit(
  text: string,
  maxW: number,
  sizes: number[],
  maxLines: number,
  f: Omit<Font, "size">
): {font: Font; lines: Word[][]} {
  const ws = words(text);
  for (const size of sizes) {
    const font = {...f, size};
    const lines = wrap(ws, maxW, font);
    if (lines.length <= maxLines) return {font, lines};
  }
  const font = {...f, size: sizes[sizes.length - 1]!};
  const lines = wrap(ws, maxW, font).slice(0, maxLines);
  const last = lines[lines.length - 1];
  if (last?.length) last[last.length - 1] = {...last[last.length - 1]!, text: `${last[last.length - 1]!.text}…`};
  return {font, lines};
}

/**
 * Renders wrapped lines; emphasized words use the serif italic in the accent color.
 * @param {object} o Options.
 * @param {!Array<!Array<Word>>} o.lines Lines.
 * @param {Font} o.font Font.
 * @param {number} o.x X.
 * @param {number} o.y First baseline.
 * @param {number} o.lh Line height.
 * @param {string} o.color Text color.
 * @param {string} o.accent Emphasis color.
 * @param {number} [o.tracking] Letter spacing in em.
 * @param {string} [o.anchor] Text anchor.
 * @param {boolean} [o.italic] Italic.
 * @return {string} SVG.
 */
function textBlock(o: {
  lines: Word[][];
  font: Font;
  x: number;
  y: number;
  lh: number;
  color: string;
  accent: string;
  tracking?: number;
  anchor?: "start" | "middle" | "end";
  italic?: boolean;
}): string {
  const family = o.font.serif ? SERIF : SANS;
  const ls = ((o.tracking ?? 0) * o.font.size).toFixed(1);
  return o.lines.map((line, i) => {
    const runs: Word[] = [];
    for (const w of line) {
      const em = w.em && !o.font.serif;
      const prev = runs[runs.length - 1];
      if (prev && prev.em === em) prev.text += `${w.glue ? "" : " "}${w.text}`;
      else runs.push({text: w.text, em, glue: w.glue});
    }
    const gap = (o.font.size * 0.28).toFixed(1);
    const spans = runs.map((r, j) => {
      const dx = j && !r.glue ? ` dx="${gap}"` : "";
      if (!r.em) return `<tspan${dx}>${esc(r.text)}</tspan>`;
      const ef = emFont(o.font, r);
      return `<tspan${dx} font-family="${SERIF}" font-style="italic" font-weight="400" font-size="${ef.size.toFixed(0)}" ` +
        `letter-spacing="0" fill="${esc(o.accent)}">${esc(r.text)}</tspan>`;
    }).join("");
    return `<text x="${o.x}" y="${(o.y + i * o.lh).toFixed(0)}" font-family="${family}" font-size="${o.font.size}" ` +
      `font-weight="${o.font.weight}" fill="${esc(o.color)}" letter-spacing="${ls}"` +
      `${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.italic ? " font-style=\"italic\"" : ""}>${spans}</text>`;
  }).join("\n");
}

/**
 * Brand logo, Verza mark, or a text wordmark, top-left.
 * @param {SlideKit} kit Kit.
 * @param {Surface} s Surface.
 * @param {number} y Top.
 * @param {number} h Height.
 * @return {string} SVG.
 */
function brandMark(kit: SlideKit, s: Surface, y: number, h: number): string {
  if (kit.logo) {
    const w = Math.min(h * kit.logo.aspect, 320);
    const hh = w / kit.logo.aspect;
    return `<image x="${PAD}" y="${y + (h - hh) / 2}" width="${w}" height="${hh}" xlink:href="${kit.logo[s.logo]}" ` +
      "preserveAspectRatio=\"xMinYMid meet\"/>";
  }
  if (kit.theme.showVerzaMark) {
    const scale = h / 219;
    return `<g transform="translate(${PAD}, ${y}) scale(${scale.toFixed(3)})">
      <path d="${VERZA_CHEVRON_PATH}" stroke="${s.kind === "accent" ? esc(s.text) : "url(#brandGrad)"}" stroke-width="44" ` +
      `stroke-linecap="round" stroke-linejoin="round" fill="none"/></g>
      <text x="${PAD + 304 * scale + 14}" y="${y + h * 0.8}" font-family="${SANS}" font-size="${Math.round(h * 0.78)}" ` +
      `font-weight="700" letter-spacing="-0.5" fill="${esc(s.text)}">${esc(kit.brandName || "Verza")}</text>`;
  }
  return `<text x="${PAD}" y="${y + h * 0.78}" font-family="${SANS}" font-size="${Math.round(h * 0.7)}" font-weight="700" ` +
    `letter-spacing="-0.5" fill="${esc(s.text)}">${esc(kit.brandName || kit.theme.footer)}</text>`;
}

/**
 * Avatar, name and handle.
 * @param {SlideKit} kit Kit.
 * @param {Surface} s Surface.
 * @param {number} y Vertical center.
 * @param {string} [prefix] Small line above the name, e.g. "Follow".
 * @return {string} SVG.
 */
function byline(kit: SlideKit, s: Surface, y: number, prefix?: string): string {
  const b = kit.byline ?? {name: kit.brandName, handle: kit.theme.footer};
  if (!b.name) return "";
  const r = 44;
  const x = b.avatar ? PAD + r * 2 + 24 : PAD;
  const avatar = b.avatar ?
    `<clipPath id="av${y}"><circle cx="${PAD + r}" cy="${y}" r="${r}"/></clipPath>
    <image x="${PAD}" y="${y - r}" width="${r * 2}" height="${r * 2}" xlink:href="${b.avatar}" clip-path="url(#av${y})" ` +
    `preserveAspectRatio="xMidYMid slice"/>
    <circle cx="${PAD + r}" cy="${y}" r="${r + 3}" fill="none" stroke="${s.kind === "accent" ? esc(s.text) : "url(#brandGrad)"}" ` +
    "stroke-width=\"3\"/>" :
    "";
  const name = prefix ? `${prefix} ${b.name}` : b.name;
  return `${avatar}
  <text x="${x}" y="${y - 4}" font-family="${SANS}" font-size="30" font-weight="600" fill="${esc(s.text)}">${esc(name)}</text>
  ${b.handle ? `<text x="${x}" y="${y + 34}" font-family="${SANS}" font-size="24" fill="${esc(s.muted)}">${esc(b.handle)}</text>` : ""}`;
}

/**
 * Shared chrome: background, brand mark, page count, progress rail and footer.
 * @param {SlideKit} kit Kit.
 * @param {Surface} s Surface.
 * @param {number} n Slide number.
 * @param {number} total Slide count.
 * @param {boolean} footer Whether to show the footer domain.
 * @return {{back: string, front: string}} Background and foreground layers.
 */
function chrome(kit: SlideKit, s: Surface, n: number, total: number, footer: boolean): {back: string; front: string} {
  const t = kit.theme;
  const bg = s.kind === "dark" ? t.background : s.kind === "light" ? mix("#FFFFFF", t.accentFrom, 0.045) : t.accentFrom;
  const glow = s.kind === "dark" ?
    `<circle cx="${W + 80}" cy="-60" r="520" fill="url(#glow)"/>` :
    s.kind === "accent" ? `<circle cx="${W}" cy="${H}" r="720" fill="url(#glow)"/>
    <circle cx="${W - 60}" cy="${H - 120}" r="420" fill="#FFFFFF" opacity="0.05"/>` : "";
  const railY = H - 84;
  const filled = Math.max(24, (CONTENT_W * n) / total);
  const back = `<rect width="${W}" height="${H}" fill="${bg}"/>${glow}`;
  const front = `
  ${brandMark(kit, s, 82, 40)}
  <text x="${W - PAD}" y="${82 + 30}" font-family="${SANS}" font-size="22" font-weight="500" letter-spacing="3" ` +
    `fill="${esc(s.muted)}" text-anchor="end">${String(n).padStart(2, "0")} / ${String(total).padStart(2, "0")}</text>
  <rect x="${PAD}" y="${railY}" width="${CONTENT_W}" height="4" rx="2" fill="${esc(s.rule)}"/>
  <rect x="${PAD}" y="${railY}" width="${filled.toFixed(0)}" height="4" rx="2" fill="${s.fill}"/>
  ${footer ? `<text x="${PAD}" y="${railY - 30}" font-family="${SANS}" font-size="22" font-weight="500" fill="${esc(s.muted)}">` +
    `${esc(t.footer)}</text>` : ""}`;
  return {back, front};
}

/**
 * Giant ghosted slide number behind the content.
 * @param {Surface} s Surface.
 * @param {number} n Slide number.
 * @return {string} SVG.
 */
function ghost(s: Surface, n: number): string {
  return `<text x="${W - 40}" y="${H - 150}" font-family="${SERIF}" font-size="560" fill="${esc(s.text)}" opacity="0.05" ` +
    `text-anchor="end">${String(n).padStart(2, "0")}</text>`;
}

/**
 * Bottom of a fitted text block.
 * @param {number} y First baseline.
 * @param {number} lines Line count.
 * @param {number} lh Line height.
 * @param {number} size Font size.
 * @return {number} Y below the last line's descenders.
 */
function bottom(y: number, lines: number, lh: number, size: number): number {
  return y + (lines - 1) * lh + size * 0.28;
}

/**
 * Section title used by list, steps and split slides.
 * @param {string} title Title.
 * @param {Surface} s Surface.
 * @param {number} y Top.
 * @return {{svg: string, end: number}} SVG and bottom edge.
 */
function sectionTitle(title: string, s: Surface, y: number): {svg: string; end: number} {
  const {font, lines} = fit(title, CONTENT_W, [80, 72, 64, 56], 3, {weight: 700});
  const lh = font.size * 1.06;
  const first = y + font.size;
  return {
    svg: textBlock({lines, font, x: PAD, y: first, lh, color: s.text, accent: s.accent, tracking: -0.025}),
    end: bottom(first, lines.length, lh, font.size),
  };
}

/**
 * Cover: oversized headline, subline and who's posting.
 * @param {ParsedCarouselSlide} slide Slide.
 * @param {SlideKit} kit Kit.
 * @param {Surface} s Surface.
 * @return {string} SVG.
 */
function cover(slide: ParsedCarouselSlide, kit: SlideKit, s: Surface): string {
  const {font, lines} = fit(slide.title, CONTENT_W, [116, 104, 92, 80, 68], 5, {weight: 800});
  const lh = font.size * 1.02;
  const f = slide.bullets[0] ? fit(slide.bullets[0], CONTENT_W - 60, [40, 36, 32], 3, {weight: 400}) : null;
  const subH = f ? 56 + (f.lines.length - 1) * f.font.size * 1.35 + f.font.size * 1.1 : 0;
  const blockH = 46 + (lines.length - 1) * lh + font.size * 1.1 + subH;
  const top = Math.round(Math.max(230, (230 + H - 320 - blockH) / 2 - 20));
  const first = top + 40 + font.size;
  const end = bottom(first, lines.length, lh, font.size);
  const sub = f ? textBlock({...f, x: PAD, y: end + 56 + f.font.size, lh: f.font.size * 1.35, color: s.muted, accent: s.accent}) : "";
  return `
  <rect x="${PAD}" y="${top}" width="72" height="6" rx="3" fill="${s.fill}"/>
  ${textBlock({lines, font, x: PAD, y: first, lh, color: s.text, accent: s.accent, tracking: -0.035})}
  ${sub}
  ${byline(kit, s, H - 236)}
  <text x="${W - PAD}" y="${H - 114}" font-family="${SANS}" font-size="24" font-weight="600" fill="${esc(s.accent)}" ` +
    "text-anchor=\"end\">Swipe →</text>";
}

/**
 * Stat: one big number on the accent surface.
 * @param {ParsedCarouselSlide} slide Slide.
 * @param {Surface} s Surface.
 * @return {string} SVG.
 */
function stat(slide: ParsedCarouselSlide, s: Surface): string {
  const source = slide.bullets.find((b) => /^source\s*:/i.test(b));
  const meaning = slide.bullets.find((b) => b !== source) ?? "";
  const num = fit(slide.title.replace(/\*/g, ""), CONTENT_W, [320, 280, 240, 200, 160, 130], 1, {weight: 800});
  const y = 700;
  const m = meaning ? fit(meaning, CONTENT_W - 40, [56, 50, 44, 40], 3, {weight: 600}) : null;
  return `
  ${textBlock({...num, x: PAD - 6, y, lh: 0, color: s.text, accent: s.accent, tracking: -0.05})}
  <rect x="${PAD}" y="${y + 64}" width="${CONTENT_W}" height="2" fill="${esc(s.rule)}"/>
  ${m ? textBlock({...m, x: PAD, y: y + 140 + m.font.size * 0.4, lh: m.font.size * 1.18, color: s.text, accent: s.accent,
    tracking: -0.015}) : ""}
  ${source ? `<text x="${PAD}" y="${H - 160}" font-family="${SANS}" font-size="22" font-weight="500" fill="${esc(s.muted)}">` +
    `${esc(source)}</text>` : ""}`;
}

/**
 * Split: a muted "before" card above a bold "after" card.
 * @param {ParsedCarouselSlide} slide Slide.
 * @param {Surface} s Surface.
 * @param {SlideKit} kit Kit.
 * @return {string} SVG.
 */
function split(slide: ParsedCarouselSlide, s: Surface, kit: SlideKit): string {
  const pairs = slide.bullets
    .map((b) => b.match(/^([^:]{2,20}):\s*(.+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .slice(0, 2)
    .map((m) => ({label: m[1]!.trim(), text: m[2]!.trim()}));
  const t = sectionTitle(slide.title, s, 200);
  const gap = 28;
  const top = t.end + 64;
  const cardH = (H - 200 - top - gap) / 2;
  const cards = pairs.map((p, i) => {
    const y = top + i * (cardH + gap);
    const strong = i === 1;
    const fill = strong ? kit.theme.accentFrom : s.kind === "light" ? mix(mix("#FFFFFF", kit.theme.accentFrom, 0.045), INK, 0.05) :
      mix(kit.theme.background, kit.theme.text, 0.06);
    const color = strong ? kit.theme.onAccent : s.muted;
    const f = fit(p.text, CONTENT_W - 112, strong ? [50, 44, 40, 36] : [44, 40, 36, 32], 4, {weight: strong ? 600 : 500});
    const lh = f.font.size * 1.2;
    return `
    <rect x="${PAD}" y="${y}" width="${CONTENT_W}" height="${cardH}" rx="32" fill="${fill}"/>
    <text x="${PAD + 56}" y="${y + 76}" font-family="${SANS}" font-size="22" font-weight="700" letter-spacing="3.5" ` +
      `fill="${esc(color)}" opacity="${strong ? 0.85 : 1}">${esc(p.label.toUpperCase())}</text>
    ${textBlock({...f, x: PAD + 56, y: y + 76 + 40 + f.font.size, lh, color: strong ? kit.theme.onAccent : s.text,
    accent: color, tracking: -0.01})}`;
  }).join("");
  return `${t.svg}${cards}`;
}

/**
 * Steps: numbered rows with serif numerals.
 * @param {ParsedCarouselSlide} slide Slide.
 * @param {Surface} s Surface.
 * @return {string} SVG.
 */
function steps(slide: ParsedCarouselSlide, s: Surface): string {
  const t = sectionTitle(slide.title, s, 200);
  const items = slide.bullets.slice(0, 4);
  const top = t.end + 72;
  const rowH = Math.min(200, (H - 220 - top) / Math.max(items.length, 1));
  const rows = items.map((b, i) => {
    const y = top + i * rowH;
    const f = fit(b.replace(/^\d+[.)]\s*/, ""), CONTENT_W - 150, [40, 36, 32], 2, {weight: 500});
    const lh = f.font.size * 1.25;
    const textTop = y + (rowH - (f.lines.length - 1) * lh - f.font.size) / 2 + f.font.size * 0.82;
    return `
    ${i ? `<rect x="${PAD}" y="${y}" width="${CONTENT_W}" height="2" fill="${esc(s.rule)}"/>` : ""}
    <text x="${PAD}" y="${y + rowH / 2 + 30}" font-family="${SERIF}" font-size="88" font-style="italic" ` +
      `fill="${esc(s.accent)}">${String(i + 1).padStart(2, "0")}</text>
    ${textBlock({...f, x: PAD + 150, y: textTop, lh, color: s.text, accent: s.accent, tracking: -0.01})}`;
  }).join("");
  return `${t.svg}${rows}`;
}

/**
 * Quote: serif pull quote with attribution.
 * @param {ParsedCarouselSlide} slide Slide.
 * @param {Surface} s Surface.
 * @return {string} SVG.
 */
function quote(slide: ParsedCarouselSlide, s: Surface): string {
  const who = slide.bullets[0]?.replace(/^[—–-]\s*/, "") ?? "";
  const q = slide.title.replace(/^["“]|["”]$/g, "");
  const f = fit(q, CONTENT_W, [88, 78, 70, 62, 54], 6, {weight: 400, serif: true});
  const lh = f.font.size * 1.1;
  const first = 560;
  const end = bottom(first, f.lines.length, lh, f.font.size);
  return `
  <text x="${PAD - 12}" y="520" font-family="${SERIF}" font-size="380" fill="${esc(s.accent)}">“</text>
  ${textBlock({...f, x: PAD, y: first, lh, color: s.text, accent: s.accent, tracking: -0.01})}
  ${who ? `<rect x="${PAD}" y="${end + 58}" width="48" height="4" rx="2" fill="${s.fill}"/>
  <text x="${PAD + 68}" y="${end + 70}" font-family="${SANS}" font-size="28" font-weight="600" fill="${esc(s.text)}">` +
    `${esc(who)}</text>` : ""}`;
}

/**
 * List: title and up to three points with accent markers.
 * @param {ParsedCarouselSlide} slide Slide.
 * @param {Surface} s Surface.
 * @return {string} SVG.
 */
function list(slide: ParsedCarouselSlide, s: Surface): string {
  const t = sectionTitle(slide.title, s, 220);
  let y = t.end + 84;
  const items = slide.bullets.slice(0, 3).map((b) => {
    const f = fit(b, CONTENT_W - 52, [42, 38, 34], 3, {weight: 400});
    const lh = f.font.size * 1.3;
    const first = y + f.font.size;
    const svg = `
    <rect x="${PAD}" y="${first - f.font.size * 0.62}" width="16" height="16" rx="4" fill="${esc(s.accent)}"/>
    ${textBlock({...f, x: PAD + 52, y: first, lh, color: s.text, accent: s.accent})}`;
    y = bottom(first, f.lines.length, lh, f.font.size) + 48;
    return svg;
  }).join("");
  return `<rect x="${PAD}" y="${200}" width="72" height="6" rx="3" fill="${s.fill}"/>${t.svg}${items}`;
}

/**
 * CTA: headline, one action button and who to follow.
 * @param {ParsedCarouselSlide} slide Slide.
 * @param {SlideKit} kit Kit.
 * @param {Surface} s Surface.
 * @return {string} SVG.
 */
function cta(slide: ParsedCarouselSlide, kit: SlideKit, s: Surface): string {
  const action = slide.bullets[0] ?? "";
  const head = action ? slide.title : "Found this useful?";
  const label = action || slide.title;
  const h = fit(head, CONTENT_W, [104, 92, 80, 68], 4, {weight: 800});
  const lh = h.font.size * 1.03;
  const b = fit(label.replace(/\*/g, ""), CONTENT_W - 120, [36, 32, 28], 2, {weight: 700});
  const blh = b.font.size * 1.25;
  const btnH = Math.max(112, (b.lines.length - 1) * blh + b.font.size + 64);
  const blockH = (h.lines.length - 1) * lh + h.font.size * 1.1 + 72 + btnH;
  const first = Math.round(Math.max(230, (230 + H - 320 - blockH) / 2 - 20)) + h.font.size;
  const end = bottom(first, h.lines.length, lh, h.font.size);
  const textW = Math.max(...b.lines.map((l) => measure(l.map((w) => w.text).join(" "), b.font)));
  const btnW = Math.min(CONTENT_W, textW + 136);
  const btnY = end + 72;
  const baseline = btnY + (btnH - ((b.lines.length - 1) * blh + b.font.size)) / 2 + b.font.size * 0.8;
  return `
  ${textBlock({...h, x: PAD, y: first, lh, color: s.text, accent: s.accent, tracking: -0.035})}
  <rect x="${PAD}" y="${btnY}" width="${btnW.toFixed(0)}" height="${btnH}" rx="${btnH / 2}" fill="${esc(kit.theme.accentFrom)}"/>
  ${textBlock({...b, x: PAD + btnW / 2, y: baseline, lh: blh, color: kit.theme.onAccent, accent: kit.theme.onAccent,
    anchor: "middle"})}
  ${byline(kit, s, H - 236, kit.byline ? "Follow" : undefined)}`;
}

/**
 * Picks each slide's surface so the carousel has rhythm: dark cover and CTA, accent stats,
 * and alternating light/dark content in between.
 * @param {!Array<ParsedCarouselSlide>} slides Slides.
 * @return {!Array<Surface["kind"]>} Surface per slide.
 */
export function slideSurfaces(slides: ParsedCarouselSlide[]): Surface["kind"][] {
  let alt = 0;
  return slides.map((s) => {
    if (s.layout === "cover" || s.layout === "cta" || s.layout === "quote") return "dark";
    if (s.layout === "stat") return "accent";
    return alt++ % 2 === 0 ? "light" : "dark";
  });
}

/**
 * Renders one carousel slide as an SVG string (1080×1350, 4:5).
 * @param {ParsedCarouselSlide} slide Slide content.
 * @param {number} n 1-based slide number.
 * @param {number} total Total slide count.
 * @param {SlideKit} kit Brand kit.
 * @param {Surface["kind"]} kind Surface for this slide.
 * @return {string} SVG document.
 */
export function renderSlideSvg(
  slide: ParsedCarouselSlide,
  n: number,
  total: number,
  kit: SlideKit,
  kind: Surface["kind"]
): string {
  const s = surfaces(kit.theme)[kind];
  const people = slide.layout === "cover" || slide.layout === "cta";
  const {back, front} = chrome(kit, s, n, total, !people);
  const body =
    slide.layout === "cover" ? cover(slide, kit, s) :
      slide.layout === "stat" ? stat(slide, s) :
        slide.layout === "split" ? split(slide, s, kit) :
          slide.layout === "steps" ? steps(slide, s) :
            slide.layout === "quote" ? quote(slide, s) :
              slide.layout === "cta" ? cta(slide, kit, s) :
                list(slide, s);
  const decor = slide.layout === "list" || slide.layout === "steps" || slide.layout === "split" ? ghost(s, n) : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${esc(kit.theme.accentFrom)}"/>
      <stop offset="100%" stop-color="${esc(kit.theme.accentTo)}"/>
    </linearGradient>
    <radialGradient id="glow">
      <stop offset="0%" stop-color="${esc(kit.theme.accentTo)}" stop-opacity="${kind === "accent" ? 0.55 : 0.28}"/>
      <stop offset="100%" stop-color="${esc(kit.theme.accentTo)}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  ${back}
  ${decor}
  ${body}
  ${front}
</svg>`;
}

export const CAROUSEL_SLIDE_SIZE = {width: W, height: H};
