import type {ParsedCarouselSlide} from "./parseCarouselMarkdown";

const W = 1080;
const H = 1080;
const PAD = 88;
const CONTENT_W = W - PAD * 2;

const COLORS = {
  bg: "#120E19",
  white: "#FFFFFF",
  muted: "#94A3B8",
  purple: "#6B37FF",
  magenta: "#EE488E",
};

/**
 * Escapes text for safe inclusion in SVG.
 * @param {string} s Raw text.
 * @return {string} Escaped text.
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Wraps text to approximate max width by character count.
 * @param {string} text Input text.
 * @param {number} maxChars Max chars per line.
 * @return {!Array<string>} Wrapped lines.
 */
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Builds SVG tspans for multiline text.
 * @param {number} x X position.
 * @param {number} startY Starting Y.
 * @param {number} lineHeight Line height in px.
 * @param {!Array<string>} lines Text lines.
 * @return {string} SVG tspan markup.
 */
function tspans(x: number, startY: number, lineHeight: number, lines: string[]): string {
  return lines
    .map((line, i) => {
      const y = startY + i * lineHeight;
      return `<tspan x="${x}" y="${y}">${escapeXml(line)}</tspan>`;
    })
    .join("");
}

/**
 * Renders a pill CTA button with vertically centered, wrapped label text.
 * @param {string} label Button label.
 * @param {number} topY Top edge of the button.
 * @return {string} SVG markup for the button group.
 */
function renderCtaButton(label: string, topY: number): string {
  const fontSize = 30;
  const lineHeight = 36;
  const padY = 28;
  const maxChars = 32;
  const lines = wrapText(label, maxChars).slice(0, 3);
  const lineCount = Math.max(lines.length, 1);

  const btnHeight = Math.max(96, (lineCount - 1) * lineHeight + fontSize + padY * 2);
  const btnRadius = btnHeight / 2;
  const textBlockHeight = (lineCount - 1) * lineHeight + fontSize;
  const firstBaseline = topY + (btnHeight - textBlockHeight) / 2 + fontSize * 0.82;

  return `
      <rect x="${PAD}" y="${topY}" width="${CONTENT_W}" height="${btnHeight}" rx="${btnRadius}" fill="url(#brandGrad)" opacity="0.95"/>
      <text font-family="DejaVu Sans, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="${COLORS.white}" text-anchor="middle">
        ${tspans(W / 2, firstBaseline, lineHeight, lines)}
      </text>`;
}

/**
 * Verza chevron mark (from brand icon).
 * @return {string} SVG path group.
 */
function verzaMark(): string {
  return `
    <g transform="translate(${PAD}, ${PAD - 8}) scale(0.14)">
      <path d="M24 24L152 194.666L280 24" stroke="url(#brandGrad)" stroke-width="48" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </g>`;
}

/**
 * Renders one carousel slide as an SVG string (1080×1080).
 * @param {ParsedCarouselSlide} slide Slide content.
 * @param {number} slideNum 1-based slide number for footer.
 * @param {number} totalSlides Total slide count.
 * @return {string} SVG document.
 */
export function renderSlideSvg(
  slide: ParsedCarouselSlide,
  slideNum: number,
  totalSlides: number
): string {
  const isCover = slideNum === 1 && !slide.isCta;
  const isCta = slide.isCta;

  const titleLines = wrapText(slide.title, isCover ? 18 : 22);
  const titleSize = isCover ? 64 : isCta ? 52 : 48;
  const titleLineHeight = isCover ? 76 : 58;
  const titleStartY = isCover ? 340 : isCta ? 380 : 280;

  const visibleTitleLines = titleLines.slice(0, isCover ? 4 : 3);
  const titleBlockBottom =
    titleStartY + (visibleTitleLines.length - 1) * titleLineHeight + titleSize * 0.28;

  const accentBarHeight = 8;
  const gapAfterTitle = 28;
  const gapAfterAccent = 36;

  let accentBar = "";
  let bodySvg = "";
  if (slide.bullets.length > 0 && !isCta) {
    const bulletLines: string[] = [];
    for (const bullet of slide.bullets.slice(0, 4)) {
      const wrapped = wrapText(bullet, 38);
      bulletLines.push(...wrapped.map((l, j) => (j === 0 ? `• ${l}` : `  ${l}`)));
    }

    let bodyStartY: number;
    if (isCover) {
      const accentY = titleBlockBottom + gapAfterTitle;
      accentBar = `<rect x="${PAD}" y="${accentY}" width="120" height="${accentBarHeight}" rx="4" fill="url(#brandGrad)"/>`;
      bodyStartY = accentY + accentBarHeight + gapAfterAccent;
    } else {
      bodyStartY = titleBlockBottom + 48;
    }

    bodySvg = `
      <text font-family="DejaVu Sans, Arial, sans-serif" font-size="34" fill="${COLORS.muted}">
        ${tspans(PAD, bodyStartY, 46, bulletLines.slice(0, 8))}
      </text>`;
  } else if (isCover) {
    const accentY = titleBlockBottom + gapAfterTitle;
    accentBar = `<rect x="${PAD}" y="${accentY}" width="120" height="${accentBarHeight}" rx="4" fill="url(#brandGrad)"/>`;
  }

  let ctaSvg = "";
  if (isCta) {
    const ctaText = slide.bullets[0] ?? slide.title;
    const btnY = Math.max(titleBlockBottom + 72, 560);
    ctaSvg = renderCtaButton(ctaText, btnY);
  }

  const footer = `
    <text x="${W - PAD}" y="${H - 56}" font-family="DejaVu Sans, Arial, sans-serif" font-size="22" fill="${COLORS.muted}" text-anchor="end">
      ${slideNum} / ${totalSlides}
    </text>
    <text x="${PAD}" y="${H - 56}" font-family="DejaVu Sans, Arial, sans-serif" font-size="22" font-weight="600" fill="${COLORS.purple}">
      tryverza.com
    </text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${COLORS.purple}"/>
      <stop offset="100%" stop-color="${COLORS.magenta}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${COLORS.bg}"/>
  ${verzaMark()}
  ${accentBar}
  <text font-family="DejaVu Sans, Arial, sans-serif" font-size="${titleSize}" font-weight="700" fill="${COLORS.white}">
    ${tspans(PAD, titleStartY, titleLineHeight, visibleTitleLines)}
  </text>
  ${bodySvg}
  ${ctaSvg}
  ${footer}
</svg>`;
}

export const CAROUSEL_SLIDE_SIZE = {width: W, height: H};
