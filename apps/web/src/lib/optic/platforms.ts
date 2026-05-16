/** Optic discovery platforms (matches campaign launch minus LinkedIn). */
export const OPTIC_PLATFORMS = [
  { value: "youtube", label: "YouTube" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "facebook", label: "Facebook" },
  { value: "twitch", label: "Twitch" },
] as const;

export type OpticPlatformSlug = (typeof OPTIC_PLATFORMS)[number]["value"];

const CAMPAIGN_TO_OPTIC: Record<string, OpticPlatformSlug> = {
  youtube: "youtube",
  instagram: "instagram",
  tiktok: "tiktok",
  facebook: "facebook",
  twitch: "twitch",
};

/** Maps a campaign platform name to an Optic slug, or null (e.g. LinkedIn). */
export function campaignPlatformToOpticSlug(name: string): OpticPlatformSlug | null {
  const key = name.trim().toLowerCase();
  return CAMPAIGN_TO_OPTIC[key] ?? null;
}

/** First Optic-supported platform on a campaign, or YouTube as fallback. */
export function firstOpticPlatformFromCampaign(platforms: string[]): OpticPlatformSlug {
  for (const p of platforms) {
    const slug = campaignPlatformToOpticSlug(p);
    if (slug) return slug;
  }
  return "youtube";
}

export function opticPlatformLabel(slug: string | undefined): string {
  const found = OPTIC_PLATFORMS.find((p) => p.value === slug);
  if (found) return found.label;
  if (!slug) return "Unknown";
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}
