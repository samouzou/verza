import type { YouTubeVideoStats } from "@/types";

const YOUTUBE_VIDEO_ID_RE =
  /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]{11}).*/;

export function extractYouTubeVideoId(url: string): string | null {
  const match = url.trim().match(YOUTUBE_VIDEO_ID_RE);
  if (!match || match[2].length !== 11) return null;
  return match[2];
}

export function isYouTubeUrl(url: string): boolean {
  return url.includes("youtube.com") || url.includes("youtu.be");
}

/** Compact number formatting for view/like/comment counts. */
export function formatYouTubeCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return value.toLocaleString();
}

export function youtubeStatsAgeLabel(fetchedAt: string): string {
  const fetched = new Date(fetchedAt);
  if (Number.isNaN(fetched.getTime())) return "";
  const diffMs = Date.now() - fetched.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export type { YouTubeVideoStats };
