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
  share: number;
};

export type PrismChannelPlan = {
  enabled: boolean;
  role: string;
  postsPerWeek: number;
};

export type PrismBrandCategory = "dtc" | "saas" | "app" | "services" | "creator" | "local";

export const PRISM_CATEGORIES: PrismBrandCategory[] = ["dtc", "saas", "app", "services", "creator", "local"];

/** `catalog` names the products step for the category; `imageHint` says what pictures to upload. */
export const PRISM_CATEGORY_META: Record<
  PrismBrandCategory,
  { label: string; hint: string; catalog: string; imageHint: string }
> = {
  dtc: {
    label: "DTC / e-commerce",
    hint: "Physical products sold online",
    catalog: "Products",
    imageHint: "Product photos on a clean background work best.",
  },
  saas: {
    label: "SaaS / software",
    hint: "Software for businesses",
    catalog: "Features & screenshots",
    imageHint: "Desktop screenshots of the feature. Prism frames them in a browser window.",
  },
  app: {
    label: "Consumer app",
    hint: "An app people use on their phone",
    catalog: "App screens",
    imageHint: "Phone screenshots. Prism frames them in a device.",
  },
  services: {
    label: "Agency / services",
    hint: "Expertise, delivered by a team",
    catalog: "Services",
    imageHint: "Optional: team, work samples, or case-study visuals.",
  },
  creator: {
    label: "Creator / personal brand",
    hint: "A person is the brand",
    catalog: "Offers",
    imageHint: "Course covers, book covers, merch, or photos of you.",
  },
  local: {
    label: "Local business",
    hint: "A place people visit",
    catalog: "Menu & offers",
    imageHint: "Photos of the place, the menu, or your best sellers.",
  },
};

export type PrismBrandStrategy = {
  agencyId?: string;
  category: PrismBrandCategory | "";
  brandName: string;
  websiteUrl: string;
  brief: string;
  audience: string;
  pillars: PrismPillar[];
  channels: Record<PrismChannel, PrismChannelPlan>;
  bannedClaims: string;
  timezone: string;
  approvalRequired: boolean;
};

export const PRISM_CHANNELS: PrismChannel[] = ["linkedin", "x", "instagram", "tiktok"];

export const PRISM_CHANNEL_META: Record<PrismChannel, { label: string; chip: string }> = {
  linkedin: { label: "LinkedIn", chip: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30" },
  x: { label: "X", chip: "bg-zinc-500/10 text-zinc-800 dark:text-zinc-200 border-zinc-500/30" },
  instagram: { label: "Instagram", chip: "bg-pink-500/10 text-pink-700 dark:text-pink-300 border-pink-500/30" },
  tiktok: { label: "TikTok", chip: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30" },
};

export const PRISM_FORMATS: Record<PrismChannel, { value: PrismFormat; label: string }[]> = {
  linkedin: [
    { value: "short_post", label: "Post" },
    { value: "carousel_outline", label: "Carousel (+ slides)" },
  ],
  x: [
    { value: "x_post", label: "Post" },
    { value: "x_thread", label: "Thread" },
  ],
  instagram: [
    { value: "ig_feed", label: "Feed post" },
    { value: "ig_carousel", label: "Carousel (+ slides)" },
    { value: "ig_reel", label: "Reel script" },
  ],
  tiktok: [{ value: "tiktok_video", label: "Video script" }],
};

export function prismFormatLabel(format: string): string {
  for (const ch of PRISM_CHANNELS) {
    const hit = PRISM_FORMATS[ch].find((f) => f.value === format);
    if (hit) return hit.label;
  }
  return format;
}

export function emptyPrismStrategy(): PrismBrandStrategy {
  return {
    category: "",
    brandName: "",
    websiteUrl: "",
    brief: "",
    audience: "",
    pillars: [],
    channels: {
      linkedin: { enabled: true, role: "", postsPerWeek: 3 },
      x: { enabled: true, role: "", postsPerWeek: 3 },
      instagram: { enabled: true, role: "", postsPerWeek: 3 },
      tiktok: { enabled: false, role: "", postsPerWeek: 2 },
    },
    bannedClaims: "",
    timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/New_York",
    approvalRequired: true,
  };
}

/** Fills missing fields so partially saved docs render safely. */
export function normalizePrismStrategy(raw: Partial<PrismBrandStrategy> | undefined): PrismBrandStrategy {
  const base = emptyPrismStrategy();
  if (!raw) return base;
  const channels = { ...base.channels };
  for (const ch of PRISM_CHANNELS) {
    channels[ch] = { ...base.channels[ch], ...(raw.channels?.[ch] ?? {}) };
  }
  return {
    ...base,
    ...raw,
    pillars: Array.isArray(raw.pillars) ? raw.pillars : [],
    channels,
  };
}

export type PrismPostStatus = "idea" | "draft" | "in_review" | "changes_requested" | "approved" | "posted";

export type PrismVariantAssets = {
  slides: { index: number; storagePath: string; filename: string }[];
  pdfStoragePath?: string;
  zipStoragePath?: string;
  renderedAt: string;
  /** Feed graphics: the "## Visual" text the image was made from. */
  visual?: string;
};

export type PrismVariantVideo = {
  storagePath: string;
  coverPath: string;
  seconds: number;
  renderedAt: string;
  jobId: string;
};

export type PrismVideoJobStatus = "queued" | "planning" | "generating" | "assembling" | "done" | "failed";

export type PrismVariantVideoJob = {
  jobId: string;
  status: PrismVideoJobStatus;
  stage: string;
  seconds: number;
  error?: string;
  updatedAt: string;
};

export type PrismVariant = {
  format: PrismFormat;
  text: string;
  generatedAt?: string;
  editedAt?: string;
  postedUrl?: string;
  assets?: PrismVariantAssets;
  /** Reels and TikToks: the generated video. */
  video?: PrismVariantVideo;
  /** The latest video render for this variant, mirrored from prism_video_jobs. */
  videoJob?: PrismVariantVideoJob;
};

/** Formats Prism turns into a vertical video. */
export const PRISM_VIDEO_FORMATS = new Set<PrismFormat>(["ig_reel", "tiktok_video"]);
/** 1 credit = 1 second. Omni makes 10s and extends in 10s steps. */
export const PRISM_VIDEO_LENGTHS = [10, 20, 30, 40] as const;

export type PrismVideoCredits = {
  tier: "free" | "launch" | "enterprise";
  allowance: number;
  allowanceLeft: number;
  freeLeft: number;
  purchased: number;
  total: number;
  packs: { credits: number; cents: number }[];
  canBuy: boolean;
};

export type PrismPostEvent = {
  at: string;
  uid: string;
  name: string;
  action: string;
  comment?: string;
};

export type PrismPost = {
  id: string;
  agencyId: string;
  title: string;
  angle: string;
  pillar: string;
  channels: PrismChannel[];
  scheduledAt: string | null;
  status: PrismPostStatus;
  variants: Partial<Record<PrismChannel, PrismVariant>>;
  history: PrismPostEvent[];
  source: "manual" | "plan" | "studio";
  studio?: { jobId: string; itemId: string; itemIds?: string[] };
  /** false = post by hand even when accounts are connected. */
  autoPublish?: boolean;
  publish?: PrismPublish;
  /** Brand kit product this post features; its images go into slides and graphics. */
  productId?: string;
  createdBy: string;
  createdByName: string;
};

export type PrismChannelPublishState = "pending" | "published" | "failed" | "manual";

export type PrismPublish = {
  state: "sending" | "scheduled" | "published" | "partial" | "failed" | "manual" | "cancelled";
  zernioPostId?: string;
  attempts: number;
  nextAttemptAt?: string;
  lastError?: string;
  sentAt?: string;
  updatedAt: string;
  channels: Partial<Record<PrismChannel, { state: PrismChannelPublishState; url?: string; error?: string }>>;
};

export type PrismConnectedAccount = {
  accountId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  status: "connected" | "disconnected";
  connectedAt: string;
};

export type PrismConnections = {
  agencyId: string;
  zernioProfileId: string;
  accounts: Partial<Record<PrismChannel, PrismConnectedAccount>>;
};

/** A brand's third-party API usage for one month. Stored at prism_usage/{agencyId}/months/{YYYY-MM}. */
export type PrismUsageMonth = {
  agencyId: string;
  periodKey: string;
  x?: { posts?: number; tweets?: number; linkTweets?: number; costMicros?: number };
};

export const PRISM_STATUS_META: Record<PrismPostStatus, { label: string; dot: string }> = {
  idea: { label: "Idea", dot: "bg-zinc-400" },
  draft: { label: "Draft", dot: "bg-amber-500" },
  in_review: { label: "In review", dot: "bg-blue-500" },
  changes_requested: { label: "Changes requested", dot: "bg-red-500" },
  approved: { label: "Approved", dot: "bg-emerald-500" },
  posted: { label: "Posted", dot: "bg-violet-500" },
};
