/**
 * One slot in a LinkedIn OS draft-generation job (Verza company LinkedIn, not Optic).
 */
export type LinkedInOsJobItem = {
  id: string;
  pillar: string;
  format: "short_post" | "carousel_outline";
  hook: string;
  productTruth: string;
  cta: string;
  notes?: string;
};

export type LinkedInOsPublishStatus = "draft" | "approved" | "scheduled" | "posted";

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
  format: string;
  pillar: string;
  markdown: string;
  generatedAt: string;
  model: string;
  carouselAssets?: LinkedInOsCarouselAssets;
  /** Human publish workflow — LinkedIn API post comes later. */
  publishStatus?: LinkedInOsPublishStatus;
  scheduledAt?: string;
};
