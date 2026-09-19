import type { Timestamp } from "firebase/firestore";
import type {
  OpticLeadResponse,
  OpticLeadStage,
  OpticPassReason,
} from "@verza/types";

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

/** Persisted on `gigs/{id}.opticRoasInsight` by MCP launch brief or vault refresh. */
export type OpticRoasInsight = {
  predictedRoas: number | null;
  spendUsd: number;
  expectedRevenueUsd: number;
  expectedViews: number;
  expectedConversions: number;
  hireCount: number;
  confidence: "low" | "medium";
  vaultLeadsUsed: number;
  usedProxies: boolean;
  inputs: {
    averageOrderValueUsd: number;
    conversionRate: number;
    viewRate: number;
    engagementRate: number | null;
  };
  budget: {
    creatorCompensationUsd: number;
    ratePerCreator: number;
    creatorsNeeded: number;
  };
  creatorsPreview: Array<{
    name: string | null;
    followers: number;
    matchScore: number | null;
  }>;
  caveats: string[];
  source: "mcp" | "web";
  updatedAt?: Timestamp | null;
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

export type OpticMatchBreakdown = {
  brief?: number;
  audience?: number;
  contact?: number;
  activity?: number;
};

export type OpticLeadRow = {
  id: string;
  creatorName?: string;
  /** Durable Firebase Storage URL for the creator profile photo. */
  avatarUrl?: string | null;
  niche?: string;
  email?: string;
  followerCount?: string;
  /** Numeric mirror of followerCount for sorting; absent on leads saved before this existed. */
  followerCountNumeric?: number | null;
  postCountNumeric?: number | null;
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
  /** CRM pipeline. Absent on older leads — derive from outreachEmailed. */
  pipelineStage?: OpticLeadStage | null;
  lastContactedAt?: Timestamp | null;
  outreachResponse?: OpticLeadResponse | null;
  passReason?: OpticPassReason | null;
  crmNote?: string | null;
  gmailDraftId?: string | null;
  gmailThreadId?: string | null;
  gmailMessageId?: string | null;
  gmailSentAt?: Timestamp | null;
  gmailThreadLinkedAt?: Timestamp | null;
  gmailThreadLinkSource?: string | null;
  /** Composite campaign fit 0–100 (brief + audience + contact + activity). */
  matchScore?: number | null;
  /** One-sentence why they fit. */
  matchReason?: string | null;
  matchBreakdown?: OpticMatchBreakdown | null;
  extensionScrape?: {
    username?: string | null;
    bio?: string | null;
    postCount?: string | null;
    externalUrl?: string | null;
    email?: string | null;
  } | null;
  /** Manual / agent-found profile notes. */
  agentScrape?: {
    bio?: string | null;
    externalUrl?: string | null;
    normalizedKey?: string | null;
  } | null;
  /** Team-shared Gmail thread copy (read-only for teammates). */
  gmailThreadSnapshot?: Array<{
    id?: string;
    from?: string;
    fromEmail?: string;
    date?: string | null;
    snippet?: string;
    body?: string;
    direction?: "outbound" | "inbound";
  }> | null;
  gmailThreadSyncedByEmail?: string | null;
  gmailReplyCount?: number | null;
};

/** Brand workspace context shown on the discovery page (loaded from Verza agency/brand doc). */
export type OpticBrandStrip = {
  brandName: string;
  brandSummary: string | null;
  userDisplayName: string | null;
  activeCampaignCount: number;
  paySourceCampaignTitle: string | null;
};
