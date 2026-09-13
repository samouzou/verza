/** Shared Optic helpers for MCP agent missions (mirrors functions optic/* — no extension changes). */

export const OPTIC_AUDIENCE_TIERS = {
  any: {label: "Any size (100+)", min: 100, max: null as number | null},
  nano: {label: "Nano (100 – 10K)", min: 100, max: 10_000},
  micro: {label: "Micro (10K – 100K)", min: 10_000, max: 100_000},
  mid: {label: "Mid (100K – 500K)", min: 100_000, max: 500_000},
  macro: {label: "Macro (500K+)", min: 500_000, max: null},
} as const;

export type OpticAudienceTier = keyof typeof OPTIC_AUDIENCE_TIERS;

export const OPTIC_MIN_POST_COUNT = 3;

const COUNT_SUFFIXES: Record<string, number> = {k: 1_000, m: 1_000_000, b: 1_000_000_000};

export function parseCompactCount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim().toLowerCase().replace(/,/g, "").replace(/\+$/, "");
  const match = text.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const multiplier = match[2] ? COUNT_SUFFIXES[match[2]] : 1;
  return Math.round(value * multiplier);
}

export function normalizeProfileUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = (u.pathname.replace(/\/$/, "") || "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Canonical profile URL for common platforms. */
export function canonicalizeProfileUrl(platform: string, profileUrl: string): string {
  const raw = profileUrl.trim();
  if (!raw) return raw;
  try {
    if (platform === "instagram") {
      if (/^https?:\/\//i.test(raw)) {
        const u = new URL(raw);
        const seg = u.pathname.split("/").filter(Boolean)[0];
        if (seg) return `https://www.instagram.com/${seg}/`;
      }
      return `https://www.instagram.com/${raw.replace(/^@/, "").split(/[/?#]/)[0]}/`;
    }
    if (platform === "linkedin") {
      if (/^https?:\/\//i.test(raw)) {
        const u = new URL(raw);
        const m = u.pathname.match(/^\/in\/([^/]+)/);
        if (m?.[1]) return `https://www.linkedin.com/in/${decodeURIComponent(m[1])}`;
      }
      return `https://www.linkedin.com/in/${raw.replace(/^@/, "").replace(/^\/?in\//, "").split(/[/?#]/)[0]}`;
    }
    if (platform === "twitter") {
      if (/^https?:\/\//i.test(raw)) {
        const u = new URL(raw);
        const seg = u.pathname.split("/").filter(Boolean)[0];
        if (seg) return `https://x.com/${seg}`;
      }
      return `https://x.com/${raw.replace(/^@/, "").split(/[/?#]/)[0]}`;
    }
    if (platform === "tiktok") {
      if (/^https?:\/\//i.test(raw)) return raw.split("?")[0].replace(/\/$/, "");
      return `https://www.tiktok.com/@${raw.replace(/^@/, "")}`;
    }
    if (platform === "youtube") {
      return raw;
    }
  } catch {
    /* fall through */
  }
  return raw;
}

export function checkAudienceGate(
  profile: {
    followerCount?: string | null;
    postCount?: string | null;
    bio?: string | null;
    externalUrl?: string | null;
  },
  tier: OpticAudienceTier
): {ok: true} | {ok: false; reason: string} {
  const posts = parseCompactCount(profile.postCount);
  if (posts !== null && posts < OPTIC_MIN_POST_COUNT) {
    return {ok: false, reason: `only ${posts} post(s)`};
  }
  const hasBio = Boolean(profile.bio?.trim());
  const hasLink = Boolean(profile.externalUrl?.trim());
  if (!hasBio && !hasLink && posts === null) {
    return {ok: false, reason: "no readable profile details"};
  }
  const followers = parseCompactCount(profile.followerCount);
  if (followers === null) return {ok: true};
  const bounds = OPTIC_AUDIENCE_TIERS[tier];
  if (bounds.min !== null && followers < bounds.min) {
    return {ok: false, reason: `${followers} followers is below the selected range`};
  }
  if (bounds.max !== null && followers > bounds.max) {
    return {ok: false, reason: `${followers} followers is above the selected range`};
  }
  return {ok: true};
}

function clampBriefFitScore(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 65;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function scoreAudienceFit(followers: number | null, tier: OpticAudienceTier): number {
  if (followers === null) return 55;
  const {min, max} = OPTIC_AUDIENCE_TIERS[tier];
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
  audienceTier?: OpticAudienceTier | null;
}): {
  matchScore: number;
  matchReason: string;
  matchBreakdown: {brief: number; audience: number; contact: number; activity: number};
  followerCountNumeric: number | null;
  postCountNumeric: number | null;
} {
  const brief = clampBriefFitScore(input.briefFitScore);
  const followers =
    typeof input.followerCount === "number"
      ? input.followerCount
      : parseCompactCount(typeof input.followerCount === "string" ? input.followerCount : null);
  const posts =
    typeof input.postCount === "number"
      ? input.postCount
      : parseCompactCount(typeof input.postCount === "string" ? input.postCount : null);
  const tier =
    input.audienceTier && input.audienceTier in OPTIC_AUDIENCE_TIERS
      ? input.audienceTier
      : "any";
  const audience = scoreAudienceFit(followers, tier);
  const contact = scoreContactability({email: input.email, externalUrl: input.externalUrl});
  const activity = scoreActivity(posts);
  const matchScore = Math.round(brief * 0.45 + audience * 0.25 + contact * 0.15 + activity * 0.15);
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

export function platformLabel(slug: string): string {
  switch (slug) {
    case "youtube":
      return "YouTube";
    case "instagram":
      return "Instagram";
    case "tiktok":
      return "TikTok";
    case "facebook":
      return "Facebook";
    case "twitch":
      return "Twitch";
    case "linkedin":
      return "LinkedIn";
    case "twitter":
      return "X";
    default:
      return slug;
  }
}
