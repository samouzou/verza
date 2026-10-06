export type PrismChannel = "linkedin" | "x" | "instagram" | "tiktok";

export type PrismFormat =
  | "short_post"
  | "carousel_outline"
  | "x_post"
  | "x_thread"
  | "ig_feed"
  | "ig_carousel"
  | "ig_reel"
  | "tiktok_video";

export type PrismPillar = {
  id: string;
  label: string;
  description: string;
  /** Target share of posts, 0–100. */
  share: number;
};

export type PrismChannelPlan = {
  enabled: boolean;
  /** What this channel is for, e.g. "thought leadership for buyers". */
  role: string;
  postsPerWeek: number;
};

/** Per-brand Prism setup, stored at prism_brands/{agencyId}. */
export type PrismBrandStrategy = {
  agencyId: string;
  brandName: string;
  websiteUrl: string;
  brief: string;
  audience: string;
  pillars: PrismPillar[];
  channels: Record<PrismChannel, PrismChannelPlan>;
  bannedClaims: string;
  timezone: string;
  approvalRequired: boolean;
  updatedBy?: string;
};

export type PrismPostStatus =
  | "idea"
  | "draft"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "posted";

/** Rendered carousel slides attached to a variant. */
export type PrismVariantAssets = {
  slides: LinkedInOsCarouselSlideAsset[];
  pdfStoragePath?: string;
  zipStoragePath?: string;
  renderedAt: string;
};

export type PrismVariant = {
  format: PrismFormat;
  text: string;
  generatedAt?: string;
  editedAt?: string;
  postedUrl?: string;
  assets?: PrismVariantAssets;
};

export type PrismPostEvent = {
  at: string;
  uid: string;
  name: string;
  action: string;
  comment?: string;
};

export type PrismChannelPublishState = "pending" | "published" | "failed" | "manual";

/** Auto-publishing state for one post. */
export type PrismPublish = {
  /** sending: locked by the scheduler; scheduled: Zernio has it; manual: nothing could be sent. */
  state: "sending" | "scheduled" | "published" | "partial" | "failed" | "manual" | "cancelled";
  zernioPostId?: string;
  /** Reused if a send is interrupted, so Zernio never creates the post twice. */
  idempotencyKey?: string;
  attempts: number;
  nextAttemptAt?: string;
  lastError?: string;
  sentAt?: string;
  updatedAt: string;
  channels: Partial<Record<PrismChannel, {state: PrismChannelPublishState; url?: string; error?: string}>>;
};

export type PrismConnectedAccount = {
  accountId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  status: "connected" | "disconnected";
  connectedAt: string;
};

/** Connected social accounts for a brand. Stored at prism_connections/{agencyId}. */
export type PrismConnections = {
  agencyId: string;
  zernioProfileId: string;
  accounts: Partial<Record<PrismChannel, PrismConnectedAccount>>;
};

/** One idea on the calendar with a native version per channel. Stored at prism_posts/{postId}. */
export type PrismPost = {
  agencyId: string;
  title: string;
  angle: string;
  pillar: string;
  channels: PrismChannel[];
  /** ISO timestamp; null while unscheduled. */
  scheduledAt: string | null;
  status: PrismPostStatus;
  variants: Partial<Record<PrismChannel, PrismVariant>>;
  history: PrismPostEvent[];
  source: "manual" | "plan" | "studio";
  /** Set when the post was written by a Studio job. */
  studio?: {jobId: string; itemId: string; itemIds?: string[]};
  /** false = post by hand even when accounts are connected. Default true. */
  autoPublish?: boolean;
  publish?: PrismPublish;
  createdBy: string;
  createdByName: string;
};

/**
 * One slot in a Prism draft-generation job. Older jobs have no channel (LinkedIn).
 */
export type LinkedInOsJobItem = {
  id: string;
  channel?: PrismChannel;
  pillar: string;
  format: PrismFormat;
  hook: string;
  productTruth: string;
  cta: string;
  notes?: string;
  /** Shared idea title. Items with the same idea and date become one calendar post. */
  idea?: string;
  /** Local post date (YYYY-MM-DD) in the brand timezone. */
  date?: string;
  /** Set server-side from date + the channel's default time. */
  scheduledAt?: string;
};

export type LinkedInOsVoiceProfile = {
  agencyId: string;
  voiceSummary: string;
  toneTraits: string[];
  hookPatterns: string[];
  topicsThatWork: string[];
  topicsToAvoid: string[];
  ctaStyle: string;
  doList: string[];
  dontList: string[];
  sampleLines: string[];
  samplePostCount: number;
  updatedBy: string;
  model: string;
};

export type LinkedInOsVideoPlatform = "tiktok" | "instagram_reels" | "youtube";

export type LinkedInOsVideoScript = {
  platform: LinkedInOsVideoPlatform;
  markdown: string;
  generatedAt: string;
  model: string;
};

export type LinkedInOsCarouselSlideAsset = {
  index: number;
  storagePath: string;
  filename: string;
};

export type LinkedInOsCarouselAssets = {
  slides: LinkedInOsCarouselSlideAsset[];
  pdfStoragePath?: string;
  zipStoragePath?: string;
};

export type LinkedInOsBeehiivSlideImage = {
  index: number;
  filename: string;
  url: string;
};

export type LinkedInOsBeehiivNewsletter = {
  sourceOutputId: string;
  markdown: string;
  generatedAt: string;
  model: string;
  slideImageUrls?: LinkedInOsBeehiivSlideImage[];
};

export type LinkedInOsJobOutput = {
  id: string;
  channel?: PrismChannel;
  format: string;
  pillar: string;
  markdown: string;
  generatedAt: string;
  model: string;
  carouselAssets?: LinkedInOsCarouselAssets;
  scheduledAt?: string;
  /** Calendar post created from this draft. */
  postId?: string;
};
