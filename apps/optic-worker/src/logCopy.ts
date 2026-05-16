/** Customer-facing status lines (no model or infra jargon). */
export const Log = {
  scoutStarted: () => "Scout is running.",
  shortlist: () => "Finding creators who fit your brief…",
  platformSearch: (platform: string) => {
    const labels: Record<string, string> = {
      youtube: "YouTube",
      instagram: "Instagram",
      tiktok: "TikTok",
      facebook: "Facebook",
      twitch: "Twitch",
    };
    const label = labels[platform] ?? platform;
    return `Searching ${label} for people who match your goals…`;
  },
  vetVisit: () => "Reviewing a creator profile…",
  saved: (name: string) => `Added ${name} to your vault.`,
  skip: () => "Skipping a profile that didn’t work out — trying the next one.",
  cancelled: () => "Stopped by you.",
  done: (n: number, wanted: number) =>
    n >= wanted
      ? `All set — ${n} creator${n === 1 ? "" : "s"} are ready in your vault.`
      : `Saved ${n} creator${n === 1 ? "" : "s"}. You asked for up to ${wanted}; there weren’t enough strong matches left to reach that in this run.`,
  jobCancelled: () => "Mission stopped.",
} as const;
