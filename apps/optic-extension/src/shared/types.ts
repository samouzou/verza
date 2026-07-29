export type ExtensionMessage =
  | { type: "VERZA_OPTIC_PING"; requestId: string }
  | { type: "VERZA_OPTIC_START_JOB"; requestId: string; jobId: string; idToken: string; projectId: string; useFunctionsEmulator?: boolean }
  | { type: "VERZA_OPTIC_GET_STATUS"; requestId: string };

export type ExtensionResponse =
  | { requestId: string; ok: true; version?: string; running?: boolean; jobId?: string | null }
  | { requestId: string; ok: false; error: string };

export type ExtensionProgressPhase =
  | "prepare"
  | "seeds"
  | "hashtag"
  | "keyword"
  | "posts"
  | "profiles"
  | "done";

export type ExtensionProgress = {
  phase: ExtensionProgressPhase;
  message: string;
  discovered?: number;
  target?: number;
  hashtag?: string;
  searchQuery?: string;
};

export type ClaimedJob = {
  jobId: string;
  platform: string;
  objectives: string;
  maxProfiles: number;
  hashtag: string;
  searchQuery: string;
  hashtags: string[];
  searchQueries: string[];
  searchSummary?: string;
  seedProfileUrls: string[];
  /** Handles already in the brand's vault — skip without opening a tab. */
  excludeUsernames?: string[];
  audienceFilter?: ExtensionAudienceFilter;
  processedCount: number;
};

export type ScrapedInstagramProfile = {
  username: string;
  displayName: string | null;
  bio: string | null;
  followerCount: string | null;
  postCount: string | null;
  externalUrl: string | null;
};

/** Follower bounds and quality rules the extension applies before submitting a lead. */
export type ExtensionAudienceFilter = {
  minFollowers: number | null;
  maxFollowers: number | null;
  minPostCount: number;
  /** Candidate pool multiplier — larger when a size band rejects many profiles. */
  poolMultiplier: number;
};

export const EXTENSION_VERSION = "0.1.5";
