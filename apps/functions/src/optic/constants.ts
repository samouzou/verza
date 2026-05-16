/** Creators saved per mission batch (keeps runs under HTTP timeout). */
export const OPTIC_DEFAULT_BATCH_SIZE = 10;

/** Hard cap per single mission. */
export const OPTIC_MAX_BATCH_SIZE = 15;

/** Discovery platforms (campaign launch set minus LinkedIn). */
export const OPTIC_PLATFORM_SLUGS = [
  "youtube",
  "instagram",
  "tiktok",
  "facebook",
  "twitch",
] as const;

export const OPTIC_PLATFORMS = new Set<string>(OPTIC_PLATFORM_SLUGS);
