/** Keep in sync with `apps/functions/src/optic/constants.ts`. */
export const OPTIC_DEFAULT_BATCH_SIZE = 10;
export const OPTIC_MAX_BATCH_SIZE = 100;

/**
 * Audience size bands for discovery. Keep labels in sync with
 * `apps/functions/src/optic/constants.ts`. `any` floors at 100 so tiny / spam
 * accounts are skipped; there is no upper bound.
 */
export const OPTIC_AUDIENCE_TIERS = {
  any: { label: "Any size (100+)", hint: "100 followers and up — skips tiny or empty accounts" },
  nano: { label: "Nano (100 – 10K)", hint: "Best for UGC and high-trust niches" },
  micro: { label: "Micro (10K – 100K)", hint: "Balanced reach and engagement" },
  mid: { label: "Mid (100K – 500K)", hint: "Wider reach, higher rates" },
  macro: { label: "Macro (500K+)", hint: "Large creators and celebrities — expect higher rates" },
} as const;

export type OpticAudienceTier = keyof typeof OPTIC_AUDIENCE_TIERS;

export const OPTIC_AUDIENCE_TIER_SLUGS = Object.keys(
  OPTIC_AUDIENCE_TIERS
) as OpticAudienceTier[];

export const OPTIC_DEFAULT_AUDIENCE_TIER: OpticAudienceTier = "any";
