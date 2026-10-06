/**
 * Ink + Evergreen tokens — keep in sync with apps/web/src/app/globals.css and
 * apps/web/public/verza-icon.svg (chevron gradient stops).
 */
export const VERZA_INK = "#0B100E";
export const VERZA_EVERGREEN = "#0E7C5A";
export const VERZA_EMERALD = "#16C088";
export const VERZA_WHITE = "#FFFFFF";
/** Muted body copy on ink backgrounds (dark theme muted-foreground). */
export const VERZA_MUTED_ON_INK = "#96A29C";

/** Chevron path from verza-icon.svg (viewBox 0 0 304 219). */
export const VERZA_CHEVRON_PATH = "M24 24L152 194.666L280 24";

export type CarouselTheme = {
  background: string;
  text: string;
  muted: string;
  accentFrom: string;
  accentTo: string;
  /** Text color on the accent-filled CTA button. */
  onAccent: string;
  /** Bottom-left footer, e.g. the brand's domain. */
  footer: string;
  showVerzaMark: boolean;
};

export const VERZA_THEME: CarouselTheme = {
  background: VERZA_INK,
  text: VERZA_WHITE,
  muted: VERZA_MUTED_ON_INK,
  accentFrom: VERZA_EVERGREEN,
  accentTo: VERZA_EMERALD,
  onAccent: VERZA_WHITE,
  footer: "tryverza.com",
  showVerzaMark: true,
};

const NEUTRAL_INK = "#111214";
const NEUTRAL_MUTED = "#A1A1AA";

/**
 * Normalizes #rgb / #rrggbb to #rrggbb, or null.
 * @param {unknown} raw Candidate color.
 * @return {?string} Hex color.
 */
function hex(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const body = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return `#${body.toLowerCase()}`;
}

/**
 * Relative luminance (0 = black, 1 = white).
 * @param {string} color #rrggbb.
 * @return {number} Luminance.
 */
function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Builds a slide theme from a brand's guide colors. Slides use a dark background, so
 * accents must be bright enough to read on it.
 * @param {object} opts Brand colors and footer text.
 * @param {unknown} opts.primary Primary color.
 * @param {unknown} opts.secondary Secondary color.
 * @param {unknown} opts.accent Accent color.
 * @param {string} opts.footer Footer text.
 * @return {CarouselTheme} Theme.
 */
export function brandTheme(opts: {
  primary?: unknown;
  secondary?: unknown;
  accent?: unknown;
  footer: string;
}): CarouselTheme {
  const readable = [opts.primary, opts.accent, opts.secondary]
    .map(hex)
    .filter((c): c is string => Boolean(c) && luminance(c as string) > 0.08 && luminance(c as string) < 0.9);
  const from = readable[0] ?? VERZA_WHITE;
  const to = readable[1] ?? from;
  return {
    background: NEUTRAL_INK,
    text: VERZA_WHITE,
    muted: NEUTRAL_MUTED,
    accentFrom: from,
    accentTo: to,
    onAccent: luminance(from) > 0.45 ? NEUTRAL_INK : VERZA_WHITE,
    footer: opts.footer,
    showVerzaMark: false,
  };
}
