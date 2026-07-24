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
