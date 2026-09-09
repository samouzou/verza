/** Mirrors apps/functions/src/optic/matchScore.ts for the Optic worker. */

const AUDIENCE_TIERS = {
  any: {min: 100, max: null as number | null},
  nano: {min: 100, max: 10_000},
  micro: {min: 10_000, max: 100_000},
  mid: {min: 100_000, max: 500_000},
  macro: {min: 500_000, max: null as number | null},
} as const;

type AudienceTier = keyof typeof AUDIENCE_TIERS;

const COUNT_SUFFIXES: Record<string, number> = {k: 1_000, m: 1_000_000, b: 1_000_000_000};

function parseOneCount(value: number, suffix: string | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  const multiplier = suffix ? COUNT_SUFFIXES[suffix] : 1;
  return Math.round(value * multiplier);
}

function parseCompactCount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim().toLowerCase().replace(/,/g, "");
  const strict = text.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (strict) return parseOneCount(Number.parseFloat(strict[1]), strict[2]);
  const labeled = text.match(
    /(\d+(?:\.\d+)?)\s*([kmb])?\s*(subscribers?|followers?|connections?|videos?|posts?)/
  );
  if (labeled) return parseOneCount(Number.parseFloat(labeled[1]), labeled[2]);
  const suffixed = text.match(/(\d+(?:\.\d+)?)\s*([kmb])\b/);
  if (suffixed) return parseOneCount(Number.parseFloat(suffixed[1]), suffixed[2]);
  return null;
}

export type MatchBreakdown = {
  brief: number;
  audience: number;
  contact: number;
  activity: number;
};

function clampBriefFitScore(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 65;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function scoreAudienceFit(followers: number | null, tier: AudienceTier): number {
  if (followers === null) return 55;
  const {min, max} = AUDIENCE_TIERS[tier];
  if (followers < min) {
    const gap = min - followers;
    if (gap <= min * 0.25) return 55;
    return 35;
  }
  if (max === null) {
    if (followers >= min * 5) return 95;
    if (followers >= min * 2) return 85;
    return 75;
  }
  if (followers > max) {
    const gap = followers - max;
    if (gap <= max * 0.25) return 55;
    return 35;
  }
  const mid = Math.sqrt(min * max);
  const span = Math.max(max - min, 1);
  const dist = Math.abs(followers - mid) / span;
  return Math.round(Math.max(70, 100 - dist * 50));
}

function scoreContactability(opts: {email?: string | null; externalUrl?: string | null}): number {
  if (opts.email?.trim()) return 100;
  if (opts.externalUrl?.trim()) return 55;
  return 15;
}

function scoreActivity(posts: number | null): number {
  if (posts === null) return 50;
  if (posts >= 50) return 100;
  if (posts >= 20) return 85;
  if (posts >= 10) return 75;
  if (posts >= 3) return 60;
  return 25;
}

export function composeMatchScore(input: {
  briefFitScore: number;
  matchReason?: string | null;
  followerCount?: string | number | null;
  postCount?: string | number | null;
  email?: string | null;
  externalUrl?: string | null;
  audienceTier?: string | null;
}): {
  matchScore: number;
  matchReason: string;
  matchBreakdown: MatchBreakdown;
  followerCountNumeric: number | null;
  postCountNumeric: number | null;
} {
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
      : parseCompactCount(typeof input.postCount === "string" ? input.postCount : null);
  const tier =
    input.audienceTier && input.audienceTier in AUDIENCE_TIERS
      ? (input.audienceTier as AudienceTier)
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
    followerCountNumeric: followers,
    postCountNumeric: posts,
  };
}

export type AudienceGateResult = {ok: true} | {ok: false; reason: string};

/** Skip dead or out-of-band profiles before they cost a credit. */
export function checkAudienceGate(
  profile: {
    followerCount?: string | number | null;
    postCount?: string | number | null;
    bio?: string | null;
    externalUrl?: string | null;
  },
  tier: string | null | undefined
): AudienceGateResult {
  const posts =
    typeof profile.postCount === "number"
      ? profile.postCount
      : parseCompactCount(typeof profile.postCount === "string" ? profile.postCount : null);
  if (posts !== null && posts < 3) {
    return {ok: false, reason: `only ${posts} post(s)`};
  }

  const hasBio = Boolean(profile.bio?.trim());
  const hasLink = Boolean(profile.externalUrl?.trim());
  if (!hasBio && !hasLink && posts === null) {
    return {ok: false, reason: "no readable profile details"};
  }

  const followers =
    typeof profile.followerCount === "number"
      ? profile.followerCount
      : parseCompactCount(
          typeof profile.followerCount === "string" ? profile.followerCount : null
        );
  if (followers === null) return {ok: true};

  const bounds =
    tier && tier in AUDIENCE_TIERS
      ? AUDIENCE_TIERS[tier as AudienceTier]
      : AUDIENCE_TIERS.any;
  if (bounds.min !== null && followers < bounds.min) {
    return {ok: false, reason: `${followers} followers is below the selected range`};
  }
  if (bounds.max !== null && followers > bounds.max) {
    return {ok: false, reason: `${followers} followers is above the selected range`};
  }
  return {ok: true};
}
