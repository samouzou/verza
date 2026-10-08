import type {PrismChannel, PrismFormat} from "./types";

/** Default local posting time per channel (HH:mm) when the planner picks a slot. */
export const PRISM_DEFAULT_TIMES: Record<PrismChannel, string> = {
  linkedin: "08:30",
  x: "12:00",
  instagram: "18:00",
  tiktok: "19:00",
};

export const PRISM_MAX_VARIANT_CHARS = 8000;

/**
 * Converts a local date + time in a timezone to an ISO UTC timestamp.
 * @param {string} date YYYY-MM-DD.
 * @param {string} time HH:mm.
 * @param {string} timeZone IANA timezone.
 * @return {string} ISO timestamp.
 */
export function zonedToUtcIso(date: string, time: string, timeZone: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (ts: number): number => {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).formatToParts(new Date(ts));
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
      return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - ts;
    } catch {
      return 0;
    }
  };
  let ts = guess - offset(guess);
  const second = offset(ts);
  if (guess - second !== ts) ts = guess - second;
  return new Date(ts).toISOString();
}

/**
 * Today's date (YYYY-MM-DD) in a timezone.
 * @param {string} timeZone IANA timezone.
 * @return {string} Local date.
 */
export function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {timeZone}).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * The seven dates (YYYY-MM-DD) of the week starting on a given day.
 * @param {string} weekStart YYYY-MM-DD.
 * @return {!Array<string>} Dates.
 */
export function weekDates(weekStart: string): string[] {
  const base = Date.parse(`${weekStart}T00:00:00Z`);
  return Array.from({length: 7}, (_, i) => new Date(base + i * 86400000).toISOString().slice(0, 10));
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const SLIDES = `Slides. Head each one "## Slide N — Layout", then its bullet lines. Layouts:
- Cover (slide 1 only): "- headline" (8 words max), then optional "- subline" (14 words max)
- Stat: "- the number" (e.g. 3.2× or 47%), "- what it means" (10 words max), optional "- Source: …"
- Split: "- title" (6 words max), "- Before: …", "- After: …" (or Myth/Fact, Old way/New way; 12 words each)
- Steps: "- title" (6 words max), then 2–4 steps (8 words each)
- Quote: "- the quote" (22 words max), "- — Name, Role"
- List: "- title" (6 words max), then 2–3 points (12 words each)
- CTA (last slide only): "- headline" (6 words max), "- the action" (e.g. Comment "ROAS" for the demo)
Use at least 3 different layouts and never two of the same in a row. Use Stat only with real numbers from the
brand context, and Quote only with a real person; never invent either.
Wrap the 1–2 words that matter most in the Cover and List titles in *asterisks*.`;

const LINKEDIN_CAPTION = `## Caption
The LinkedIn post text that goes above the PDF. Write it as a real LinkedIn post, not an Instagram caption:
line 1 is a hook under ~140 characters that works before "see more"; then 3–6 short lines with one concrete
insight, number or story that makes people open the document (don't just list the slides); one CTA line;
0–3 hashtags at the end. No "swipe" or "link in bio".`;

/**
 * Writing instructions for one channel format. Keep in sync with the worker's userMessageForItem.
 * @param {PrismFormat} format Target format.
 * @return {string} Instructions.
 */
export function formatInstructions(format: PrismFormat): string {
  switch (format) {
  case "carousel_outline":
    return `A LinkedIn document carousel. Caption FIRST, then 7–10 slides.
${LINKEDIN_CAPTION}
${SLIDES}`;
  case "x_post":
    return "ONE post for X. Plain text, 280 characters max including spaces. One idea, punchy. Max 1 hashtag.";
  case "x_thread":
    return "An X thread of 4–7 posts, each on its own line starting \"1/\", \"2/\"… " +
      "Each post is 280 characters max. Post 1 stands alone as a hook. Last post is the CTA. No hashtags.";
  case "ig_feed":
    return `An Instagram feed post:
## Visual
Describe the ONE graphic to post so an image model can make it: subject, composition, style and mood.
Put any on-image text in double quotes, 8 words max (or say "no text").
## Caption
Hook line under 125 characters, 3–8 short lines, one CTA line, then 3–5 hashtags on the last line.`;
  case "ig_carousel":
    return `An Instagram carousel. Caption FIRST, then 5–8 slides.
## Caption
Hook line under 125 characters, 2–4 short lines, a save/comment CTA, then 3–5 hashtags.
${SLIDES}`;
  case "ig_reel":
    return `An Instagram Reel script (15–45 seconds, vertical):
## Hook (0–2s)
## Beats
3–5 beats with [on-screen text] and what's on camera.
## Spoken script
## Caption
Hook line, 1–2 lines, CTA, 3–5 hashtags.`;
  case "tiktok_video":
    return `A TikTok video script (20–45 seconds, vertical, native — not an ad):
## Hook (0–1s)
First spoken line + [on-screen text]. Must stop the scroll.
## Beats
3–5 fast beats with [on-screen text] cues.
## Spoken script
## Caption
One line + 3–4 hashtags.`;
  default:
    return "ONE LinkedIn post, plain text, no markdown headings. Line 1 works as the preview (under ~140 chars). " +
      "Then 4–10 short lines, then one CTA line. Max 3 hashtags.";
  }
}
