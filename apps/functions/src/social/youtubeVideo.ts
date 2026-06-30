import {HttpsError} from "firebase-functions/v2/https";
import axios from "axios";

const YOUTUBE_VIDEO_ID_RE =
  /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]{11}).*/;

export interface YouTubeVideoStats {
  videoId: string;
  title?: string;
  channelTitle?: string;
  publishedAt?: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  fetchedAt: string;
}

export function extractYouTubeVideoId(url: string): string | null {
  const trimmed = url.trim();
  const match = trimmed.match(YOUTUBE_VIDEO_ID_RE);
  if (!match || match[2].length !== 11) return null;
  return match[2];
}

export function isYouTubeUrl(url: string): boolean {
  return url.includes("youtube.com") || url.includes("youtu.be");
}

export async function fetchYouTubeVideoStatsById(
  videoId: string,
  apiKey: string
): Promise<YouTubeVideoStats> {
  const response = await axios.get("https://www.googleapis.com/youtube/v3/videos", {
    params: {
      part: "snippet,statistics",
      id: videoId,
      key: apiKey,
    },
  });

  const item = response.data?.items?.[0];
  if (!item) {
    throw new HttpsError(
      "not-found",
      "YouTube video not found. It may be private, deleted, or the link is invalid."
    );
  }

  const statistics = item.statistics ?? {};
  const snippet = item.snippet ?? {};

  return {
    videoId,
    title: snippet.title,
    channelTitle: snippet.channelTitle,
    publishedAt: snippet.publishedAt,
    viewCount: parseInt(statistics.viewCount ?? "0", 10) || 0,
    likeCount: parseInt(statistics.likeCount ?? "0", 10) || 0,
    commentCount: parseInt(statistics.commentCount ?? "0", 10) || 0,
    fetchedAt: new Date().toISOString(),
  };
}
