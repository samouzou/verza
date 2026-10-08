import type { Timestamp } from "firebase/firestore";

import type { PrismChannel, PrismFormat } from "@/lib/prism/types";

export type LinkedInOsJobStatus = "queued" | "running" | "completed" | "failed";

export type LinkedInOsJobItem = {
  id: string;
  channel: PrismChannel;
  pillar: string;
  format: PrismFormat;
  hook: string;
  productTruth: string;
  cta: string;
  notes?: string;
  /** Shared idea title. Items with the same idea and day become one calendar post. */
  idea?: string;
  /** Local post date (YYYY-MM-DD) in the brand timezone. */
  date?: string;
  scheduledAt?: string;
  /** Catalog product to feature, by exact name. */
  product?: string;
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

export type LinkedInOsVideoPlatform = "tiktok" | "instagram_reels" | "youtube";

export type LinkedInOsVideoScript = {
  platform: LinkedInOsVideoPlatform;
  markdown: string;
  generatedAt: string;
  model: string;
};

export const LINKEDIN_OS_VIDEO_PLATFORMS = [
  {value: "tiktok" as const, label: "TikTok", description: "30–60s vertical short" },
  {value: "instagram_reels" as const, label: "Instagram Reels", description: "30–60s + caption" },
  {value: "youtube" as const, label: "YouTube", description: "3–8 min long-form" },
] as const;

export type LinkedInOsBeehiivNewsletter = {
  sourceOutputId: string;
  markdown: string;
  generatedAt: string;
  model: string;
  slideImageUrls?: { index: number; filename: string; url: string }[];
};

export const PRODUCT_RECEIPTS_OUTPUT_ID = "thu-product-receipts";

export type LinkedInOsJobOutput = {
  id: string;
  /** Missing on jobs from before Prism (LinkedIn). */
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
  updatedBy?: string;
  model?: string;
  updatedAt?: Timestamp;
};

export type LinkedInOsJobRow = {
  id: string;
  status: LinkedInOsJobStatus;
  createdAt?: Timestamp;
  createdBy?: string;
  agencyId?: string;
  weekLabel?: string;
  /** Monday (YYYY-MM-DD) of the planned week. */
  weekStart?: string;
  reviewer?: string;
  /** Optional markdown: audience, campaign, or launch context for this run only. */
  weeklyBrief?: string;
  /** Optional one-line constraint the model should reflect. */
  mustMention?: string;
  /** Optional one-line topic to avoid. */
  neverMention?: string;
  items?: LinkedInOsJobItem[];
  outputs?: LinkedInOsJobOutput[];
  videoScripts?: LinkedInOsVideoScript[];
  beehiivNewsletter?: LinkedInOsBeehiivNewsletter;
  error?: string;
};

export const LINKEDIN_OS_CTAS = [
  { value: "follow", label: "Follow / save" },
  { value: "comment", label: "Comment prompt" },
  { value: "soft_product", label: "Soft product CTA" },
  { value: "hard_product", label: "Direct product CTA" },
] as const;

export function isLinkedInOsJobInFlight(status: string | undefined): boolean {
  return status === "queued" || status === "running";
}
