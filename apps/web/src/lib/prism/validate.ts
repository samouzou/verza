import type { PrismChannel, PrismVariant } from "./types";

export type PrismIssue = { level: "error" | "warn"; message: string };

export type PrismVariantCheck = {
  /** e.g. "212 / 280", "4 posts", "8 slides" */
  counter: string;
  over: boolean;
  issues: PrismIssue[];
};

const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu;

/** The "## Caption" section of a sectioned draft, or the whole text. */
export function captionOf(text: string): string {
  const m = text.match(/^##\s*Caption\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/im);
  return (m ? m[1] : text).trim();
}

/** The "## Visual" section of a feed post, or "". */
export function visualOf(text: string): string {
  const m = text.match(/^##\s*Visual\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/im);
  return m ? m[1].trim() : "";
}

export function hasCaption(text: string): boolean {
  return /^##\s*Caption\s*$/im.test(text);
}

function hashtags(text: string): number {
  return (text.match(HASHTAG) ?? []).length;
}

function slides(text: string): number {
  return (text.match(/^##\s*Slide\s+\d+/gim) ?? []).length;
}

function firstLine(text: string): string {
  return text.split("\n").find((l) => l.trim())?.trim() ?? "";
}

/** X splits on "1/", "2/"… lines; falls back to blank-line paragraphs. */
export function threadPosts(text: string): string[] {
  const parts = text.split(/^\s*\d+\s*\/\s*/m).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) return parts;
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

/** Channel rules a social manager checks before posting. Character counts are approximate (links and emoji vary). */
export function checkVariant(channel: PrismChannel, v: PrismVariant | undefined): PrismVariantCheck {
  const text = (v?.text ?? "").trim();
  const issues: PrismIssue[] = [];
  if (!text) return { counter: "No copy yet", over: false, issues: [{ level: "warn", message: "No copy yet." }] };

  switch (v?.format) {
    case "x_post": {
      const n = text.length;
      if (n > 280) issues.push({ level: "error", message: `${n - 280} characters over X's 280 limit.` });
      if (hashtags(text) > 1) issues.push({ level: "warn", message: "Hashtags rarely help on X; keep it to one." });
      return { counter: `${n} / 280`, over: n > 280, issues };
    }
    case "x_thread": {
      const posts = threadPosts(text);
      const long = posts.map((p, i) => ({ i: i + 1, n: p.length })).filter((p) => p.n > 280);
      for (const p of long) issues.push({ level: "error", message: `Post ${p.i} is ${p.n - 280} characters over 280.` });
      if (posts.length < 2) issues.push({ level: "warn", message: "A thread needs at least 2 posts (start lines with 1/, 2/…)." });
      return { counter: `${posts.length} posts`, over: long.length > 0, issues };
    }
    case "carousel_outline":
    case "ig_carousel": {
      const count = slides(text);
      const max = 20;
      if (count < 2) issues.push({ level: "error", message: "Needs at least 2 slides (## Slide 1, ## Slide 2…)." });
      if (count > max) issues.push({ level: "error", message: `${count} slides; the limit is ${max}.` });
      if (channel === "instagram") checkInstagramCaption(captionOf(text), issues);
      if (channel === "linkedin") {
        const cap = hasCaption(text) ? captionOf(text) : "";
        if (!cap) {
          issues.push({ level: "warn", message: "Add a ## Caption section: it's the post text that goes above the PDF." });
        } else {
          if (cap.length > 3000) issues.push({ level: "error", message: `Caption is ${cap.length - 3000} characters over LinkedIn's 3,000 limit.` });
          if (firstLine(cap).length > 140) issues.push({ level: "warn", message: "Caption's first line may be cut before \u201csee more\u201d." });
          if (hashtags(cap) > 3) issues.push({ level: "warn", message: "More than 3 hashtags reads as spam on LinkedIn." });
        }
        return { counter: `${count} slides${cap ? ` · caption ${cap.length}` : ""}`, over: count > max || cap.length > 3000, issues };
      }
      return { counter: `${count} slides`, over: count > max, issues };
    }
    case "ig_feed":
    case "ig_reel": {
      const cap = captionOf(text);
      checkInstagramCaption(cap, issues);
      if (v?.format === "ig_feed" && !visualOf(text)) {
        issues.push({ level: "warn", message: "Add a ## Visual section: Prism makes the graphic from it." });
      }
      return { counter: `${cap.length} / 2,200`, over: cap.length > 2200, issues };
    }
    case "tiktok_video": {
      const cap = captionOf(text);
      if (cap.length > 4000) issues.push({ level: "error", message: "Caption is over TikTok's 4,000 limit." });
      if (hashtags(cap) > 5) issues.push({ level: "warn", message: "3–5 hashtags is plenty on TikTok." });
      if (!/^##\s*Hook/im.test(text)) issues.push({ level: "warn", message: "No hook section; the first second decides the view." });
      return { counter: `Caption ${cap.length} / 4,000`, over: cap.length > 4000, issues };
    }
    default: {
      const n = text.length;
      if (n > 3000) issues.push({ level: "error", message: `${n - 3000} characters over LinkedIn's 3,000 limit.` });
      if (firstLine(text).length > 140) {
        issues.push({ level: "warn", message: "First line is long; it may be cut before \u201csee more\u201d." });
      }
      if (hashtags(text) > 3) issues.push({ level: "warn", message: "More than 3 hashtags reads as spam on LinkedIn." });
      return { counter: `${n} / 3,000`, over: n > 3000, issues };
    }
  }
}

function checkInstagramCaption(cap: string, issues: PrismIssue[]) {
  if (cap.length > 2200) issues.push({ level: "error", message: "Caption is over Instagram's 2,200 limit." });
  const tags = hashtags(cap);
  if (tags > 30) issues.push({ level: "error", message: "Instagram allows 30 hashtags at most." });
  else if (tags > 5) issues.push({ level: "warn", message: "3–5 focused hashtags beat a wall of them." });
  if (firstLine(cap).length > 125) issues.push({ level: "warn", message: "Hook line is cut after ~125 characters." });
}
