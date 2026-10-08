export type SlideLayout = "cover" | "stat" | "split" | "steps" | "quote" | "list" | "cta";

export type ParsedCarouselSlide = {
  index: number;
  /** Header text after "## Slide N —". */
  label: string;
  layout: SlideLayout;
  /** First bullet: headline, number, quote or action, depending on layout. May contain *emphasis*. */
  title: string;
  bullets: string[];
  isCta: boolean;
};

const LAYOUT_WORDS: [RegExp, SlideLayout][] = [
  [/\bcta\b|call to action/i, "cta"],
  [/\bcover\b|\bhook\b/i, "cover"],
  [/\bstat\b|\bnumber\b|\bdata\b|\bmetric\b/i, "stat"],
  [/\bsplit\b|\bvs\.?\b|before|myth|compare|old way/i, "split"],
  [/\bsteps?\b|how to|process|framework/i, "steps"],
  [/\bquote\b|testimonial/i, "quote"],
  [/\blist\b/i, "list"],
];

const NUMERIC = /^[~≈$€£+\-]?\d[\d.,]*\s*(%|×|x|k|m|b|\+|pts?|hrs?|h|days?|weeks?|min)?$/i;

/**
 * Picks the layout from the header label, falling back to the slide's position and content.
 * @param {string} label Header label.
 * @param {string} title First bullet.
 * @param {!Array<string>} bullets Remaining bullets.
 * @param {boolean} first Whether this is slide 1.
 * @param {boolean} last Whether this is the last slide.
 * @return {SlideLayout} Layout.
 */
function pickLayout(label: string, title: string, bullets: string[], first: boolean, last: boolean): SlideLayout {
  if (first) return "cover";
  if (last) return "cta";
  const named = LAYOUT_WORDS.find(([re]) => re.test(label))?.[1];
  if (named === "split" && bullets.filter((b) => /^[^:]{2,20}:\s*\S/.test(b)).length < 2) return "list";
  if (named === "stat" && !NUMERIC.test(title.replace(/\*/g, "").trim())) return "list";
  if (named && named !== "cover" && named !== "cta") return named;
  if (NUMERIC.test(title.replace(/\*/g, "").trim())) return "stat";
  return "list";
}

/**
 * Parses carousel markdown into slide objects.
 * Expects "## Slide N — Layout" headers and "- " bullet lines beneath each; text before slide 1 (e.g. a caption) is ignored.
 * @param {string} markdown Carousel outline markdown.
 * @return {!Array<ParsedCarouselSlide>} Parsed slides.
 */
export function parseCarouselMarkdown(markdown: string): ParsedCarouselSlide[] {
  const text = markdown.trim();
  if (!text) return [];

  const headers = [...text.matchAll(/^##\s*Slide\s+(\d+)[^\S\n]*(?:[—–:-][^\S\n]*)?(.*)$/gim)];
  const sections = text.split(/^##\s*Slide\s+\d+.*$/im).slice(1);

  const raw = sections.map((section, i) => {
    const bullets = section
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[-*•]\s+\S/.test(l))
      .map((l) => l.replace(/^[-*•]\s*/, "").trim())
      .filter(Boolean);
    return {
      index: Number(headers[i]?.[1] ?? i + 1),
      label: (headers[i]?.[2] ?? "").trim(),
      title: bullets.shift() ?? "",
      bullets,
    };
  });

  return raw
    .sort((a, b) => a.index - b.index)
    .map((s, i, all) => {
      const layout = pickLayout(s.label, s.title, s.bullets, i === 0, i === all.length - 1);
      return {
        ...s,
        title: s.title || s.label || `Slide ${s.index}`,
        layout,
        isCta: layout === "cta",
      };
    });
}
