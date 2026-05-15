import type { Timestamp } from "firebase/firestore";

export const OPTIC_CAMPAIGN_STORAGE_KEY = "optic-selected-campaign-id";

export type OpticCampaignOption = {
  id: string;
  title: string;
  status: string;
  ratePerCreator: number;
  campaignType: string;
  platforms: string[];
  description?: string;
};

export type OpticJobRow = {
  id: string;
  status?: string;
  platform?: string;
  objectives?: string;
  processedCount?: number;
  error?: string | null;
  createdAt?: Timestamp | null;
  agencyName?: string;
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
  agencyName?: string;
  agencyId?: string;
  source?: string;
  createdAt?: Timestamp | null;
};

/** Brand workspace context shown on the discovery page (loaded from Verza agency/brand doc). */
export type OpticBrandStrip = {
  brandName: string;
  brandSummary: string | null;
  userDisplayName: string | null;
  activeCampaignCount: number;
  paySourceCampaignTitle: string | null;
};
