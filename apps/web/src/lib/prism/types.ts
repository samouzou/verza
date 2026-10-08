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

export type PrismBrandStrategy = {
  agencyId?: string;
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

/** Channels Prism can't post through the API yet (no video upload). */
export const PRISM_MANUAL_FORMATS = new Set<PrismFormat>(["ig_reel", "tiktok_video"]);

export const PRISM_STATUS_META: Record<PrismPostStatus, { label: string; dot: string }> = {
  idea: { label: "Idea", dot: "bg-zinc-400" },
  draft: { label: "Draft", dot: "bg-amber-500" },
  in_review: { label: "In review", dot: "bg-blue-500" },
  changes_requested: { label: "Changes requested", dot: "bg-red-500" },
  approved: { label: "Approved", dot: "bg-emerald-500" },
  posted: { label: "Posted", dot: "bg-violet-500" },
};
