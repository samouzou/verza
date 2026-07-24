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
  processedCount: number;
};

export type ScrapedInstagramProfile = {
  username: string;
  displayName: string | null;
  bio: string | null;
  followerCount: string | null;
  externalUrl: string | null;
};

export const EXTENSION_VERSION = "0.1.0";
