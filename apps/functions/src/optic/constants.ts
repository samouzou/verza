/** Creators saved per mission batch. */
export const OPTIC_DEFAULT_BATCH_SIZE = 10;

/** Max creators per batch (extension can run the full amount client-side). */
export const OPTIC_MAX_BATCH_SIZE = 100;

/**
 * Cloud Run worker cap per run — keeps vetting inside Firestore trigger / HTTP limits.
 * Jobs above this still store `maxProfiles` on the doc but the worker saves at most this many.
 */
export const OPTIC_MAX_WORKER_BATCH_SIZE = 25;

/** Discovery platforms (campaign launch set minus LinkedIn). */
export const OPTIC_PLATFORM_SLUGS = [
  "youtube",
  "instagram",
  "tiktok",
  "facebook",
  "twitch",
] as const;

export const OPTIC_PLATFORMS = new Set<string>(OPTIC_PLATFORM_SLUGS);

/**
 * Audience size bands for discovery. Nano is deliberately included by default:
 * brands run UGC with creators in the low hundreds, so `any` applies no size bound.
 */
export const OPTIC_AUDIENCE_TIERS = {
  any: {label: "Any size", min: null, max: null},
  nano: {label: "Nano (100 – 10K)", min: 100, max: 10_000},
  micro: {label: "Micro (10K – 100K)", min: 10_000, max: 100_000},
  mid: {label: "Mid (100K – 500K)", min: 100_000, max: 500_000},
} as const;

export type OpticAudienceTier = keyof typeof OPTIC_AUDIENCE_TIERS;

export const OPTIC_DEFAULT_AUDIENCE_TIER: OpticAudienceTier = "any";

/** Narrows untrusted callable input to a known audience tier.
 * @param {unknown} value Raw request value.
 * @return {boolean} True when the value names a tier.
 */
export function isOpticAudienceTier(value: unknown): value is OpticAudienceTier {
  return typeof value === "string" && value in OPTIC_AUDIENCE_TIERS;
}

/**
 * Minimum posts for an account to read as an active creator rather than a dead or
 * placeholder profile. Applied whenever post count could be scraped.
 */
export const OPTIC_MIN_POST_COUNT = 3;

/**
 * Candidate pool multiplier. A size band rejects many profiles after scraping, so
 * batches would under-deliver without a deeper pool.
 * @param {OpticAudienceTier} tier Requested audience size band.
 * @return {number} Multiplier applied to the batch target.
 */
export function opticPoolMultiplier(tier: OpticAudienceTier): number {
  return tier === "any" ? 2 : 3;
}
