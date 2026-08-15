import {OPTIC_AUDIENCE_TIERS, type OpticAudienceTier} from "./constants";
import {parseCompactCount} from "./counts";

export type MatchBreakdown = {
  brief: number;
  audience: number;
  contact: number;
  activity: number;
};

export type MatchScoreResult = {
  matchScore: number;
  matchReason: string;
  matchBreakdown: MatchBreakdown;
};

/**
 * Clamps a Gemini brief-fit score to 0–100.
 * @param {unknown} raw Model output.
 * @return {number} Integer score.
 */
export function clampBriefFitScore(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 65;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * How well follower count sits in the mission's audience band.
 * @param {number | null} followers Parsed follower count.
 * @param {OpticAudienceTier} tier Mission audience tier.
 * @return {number} 0–100.
 */
export function scoreAudienceFit(
  followers: number | null,
  tier: OpticAudienceTier
): number {
  if (followers === null) return 55;
  const {min, max} = OPTIC_AUDIENCE_TIERS[tier];
  if (followers < min) {
    const gap = min - followers;
    if (gap <= min * 0.25) return 55;
    return 35;
  }
  if (max === null) {
    // Open-ended band (any / macro): reward being clearly above the floor.
    if (followers >= min * 5) return 95;
    if (followers >= min * 2) return 85;
    return 75;
  }
  if (followers > max) {
    const gap = followers - max;
    if (gap <= max * 0.25) return 55;
    return 35;
  }
  // Inside band: peak near geometric mid.
  const mid = Math.sqrt(min * max);
  const span = Math.max(max - min, 1);
  const dist = Math.abs(followers - mid) / span;
  return Math.round(Math.max(70, 100 - dist * 50));
}

/**
 * Contactability from email / link.
 * @param {object} opts Contact signals.
 * @return {number} 0–100.
 */
export function scoreContactability(opts: {
  email?: string | null;
  externalUrl?: string | null;
}): number {
  if (opts.email?.trim()) return 100;
  if (opts.externalUrl?.trim()) return 55;
  return 15;
}

/**
 * Activity proxy from post count.
 * @param {number | null} posts Parsed post count.
 * @return {number} 0–100.
 */
export function scoreActivity(posts: number | null): number {
  if (posts === null) return 50;
  if (posts >= 50) return 100;
  if (posts >= 20) return 85;
  if (posts >= 10) return 75;
  if (posts >= 3) return 60;
  return 25;
}

/**
 * Combines brief fit with hard signals into a vault match score.
 * @param {object} input Brief fit + scraped signals + audience tier.
 * @return {MatchScoreResult} Final score, reason, and breakdown.
 */
export function composeMatchScore(input: {
  briefFitScore: number;
  matchReason?: string | null;
  followerCount?: string | number | null;
  postCount?: string | number | null;
  email?: string | null;
  externalUrl?: string | null;
  audienceTier?: OpticAudienceTier | null;
}): MatchScoreResult {
  const brief = clampBriefFitScore(input.briefFitScore);
  const followers =
    typeof input.followerCount === "number"
      ? input.followerCount
      : parseCompactCount(
          typeof input.followerCount === "string" ? input.followerCount : null
        );
  const posts =
    typeof input.postCount === "number"
      ? input.postCount
      : parseCompactCount(
          typeof input.postCount === "string" ? input.postCount : null
        );
  const tier = input.audienceTier && input.audienceTier in OPTIC_AUDIENCE_TIERS
    ? input.audienceTier
    : "any";

  const audience = scoreAudienceFit(followers, tier);
  const contact = scoreContactability({
    email: input.email,
    externalUrl: input.externalUrl,
  });
  const activity = scoreActivity(posts);

  const matchScore = Math.round(
    brief * 0.45 + audience * 0.25 + contact * 0.15 + activity * 0.15
  );

  const reason =
    typeof input.matchReason === "string" && input.matchReason.trim()
      ? input.matchReason.trim().slice(0, 220)
      : "Fits the campaign brief based on niche and profile signals.";

  return {
    matchScore: Math.max(0, Math.min(100, matchScore)),
    matchReason: reason,
    matchBreakdown: {brief, audience, contact, activity},
  };
}
