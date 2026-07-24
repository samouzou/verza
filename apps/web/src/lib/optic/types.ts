import type { Timestamp } from "firebase/firestore";

export const OPTIC_CAMPAIGN_STORAGE_KEY = "optic-selected-campaign-id";
export const OPTIC_ACTIVE_JOB_STORAGE_KEY = "optic-active-job-id";

const IN_FLIGHT_JOB_STATUSES = new Set(["queued", "running"]);

export function isOpticJobInFlight(status: string | undefined): boolean {
  return IN_FLIGHT_JOB_STATUSES.has(status ?? "");
}

export type OpticCampaignOption = {
  id: string;
  title: string;
  status: string;
  ratePerCreator: number;
  campaignType: string;
  platforms: string[];
  description?: string;
};

export type OpticExtensionProgress = {
  phase?: string;
  message?: string;
  discovered?: number;
  target?: number;
  hashtag?: string;
  searchQuery?: string;
  searchSummary?: string;
  hashtags?: string[];
  searchQueries?: string[];
  updatedAt?: Timestamp | null;
};

export type OpticJobRow = {
  id: string;
  status?: string;
  platform?: string;
  objectives?: string;
  batchIndex?: number;
  maxProfiles?: number;
  processedCount?: number;
  runner?: string;
  extensionProgress?: OpticExtensionProgress | null;
  error?: string | null;
  createdAt?: Timestamp | null;
  agencyName?: string;
  brandContext?: {
    paySourceCampaignTitle?: string | null;
    paySourceCampaignType?: string | null;
  };
  logs?: Array<{ phase?: string; message?: string; ts?: Timestamp }>;
};

export type OpticLeadRow = {
  id: string;
  creatorName?: string;
  niche?: string;
  email?: string;
  followerCount?: string;
  profileUrl?: string;
  draftEmail?: string;
  draftEmailSubject?: string;
  /** Platform DM copy when no email is on the profile. */
  draftDm?: string;
  /** Platform slug from the discovery mission (youtube, instagram, …). */
  discoveryPlatform?: string;
  agencyName?: string;
  agencyId?: string;
  source?: string;
  createdAt?: Timestamp | null;
  /** Gig id when the discovery mission was scoped to one campaign. */
  campaignId?: string | null;
  /** Pay / scope label from the mission (often the campaign title). */
  campaignTitle?: string | null;
  /** User marked they've reached out (draft sent, email sent, etc.). */
  outreachEmailed?: boolean;
  outreachEmailedAt?: Timestamp | null;
};

/** Brand workspace context shown on the discovery page (loaded from Verza agency/brand doc). */
export type OpticBrandStrip = {
  brandName: string;
  brandSummary: string | null;
  userDisplayName: string | null;
  activeCampaignCount: number;
  paySourceCampaignTitle: string | null;
};
