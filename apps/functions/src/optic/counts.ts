import {OPTIC_AUDIENCE_TIERS, OPTIC_MIN_POST_COUNT, type OpticAudienceTier} from "./constants";

const COUNT_SUFFIXES: Record<string, number> = {k: 1_000, m: 1_000_000, b: 1_000_000_000};

/**
 * Parses Instagram's rendered counts ("1,234", "12.3K", "1.2M") into a number.
 * Mirrored in `apps/optic-extension/src/shared/instagram.ts`.
 * @param {string | null | undefined} raw Rendered count text.
 * @return {?number} Parsed count, or null when missing or unrecognized.
 */
export function parseCompactCount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim().toLowerCase().replace(/,/g, "");
  const match = text.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const multiplier = match[2] ? COUNT_SUFFIXES[match[2]] : 1;
  return Math.round(value * multiplier);
}

export type AudienceGateInput = {
  followerCount?: string | null;
  postCount?: string | null;
  bio?: string | null;
  externalUrl?: string | null;
};

export type AudienceGateResult = {ok: true} | {ok: false; reason: string};

/**
 * Decides whether a scraped profile belongs in the vault.
 *
 * Unknown counts never reject: a flaky scrape should not silently discard a good
 * creator. Size bounds only apply when the follower count actually parsed.
 * @param {AudienceGateInput} profile Scraped profile fields.
 * @param {OpticAudienceTier} tier Requested audience size band.
 * @return {AudienceGateResult} Pass, or fail with a human-readable reason.
 */
export function checkAudienceGate(
  profile: AudienceGateInput,
  tier: OpticAudienceTier
): AudienceGateResult {
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
