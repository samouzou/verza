import { doc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db, functions } from "@/lib/firebase";
import type { YouTubeVideoStats } from "@/types";

const fetchYouTubeVideoStatsCallable = httpsCallable<
  { videoUrl: string },
  YouTubeVideoStats
>(functions, "fetchYouTubeVideoStats");

/** Fetches public YouTube stats for a submission link. Returns undefined if the API call fails. */
export async function fetchYouTubeStatsForUrl(
  videoUrl: string
): Promise<YouTubeVideoStats | undefined> {
  try {
    const result = await fetchYouTubeVideoStatsCallable({ videoUrl });
    return result.data;
  } catch (error) {
    console.error("Failed to fetch YouTube video stats:", error);
    return undefined;
  }
}

/** Fetches latest stats and writes `youtubeStats` on the submission document. */
export async function refreshSubmissionYouTubeStats(
  submissionId: string,
  videoUrl: string
): Promise<YouTubeVideoStats> {
  const result = await fetchYouTubeVideoStatsCallable({ videoUrl });
  const stats = result.data;
  await updateDoc(doc(db, "submissions", submissionId), { youtubeStats: stats });
  return stats;
}
