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
  vetVisit: (profileUrl: string) => `Opening ${profileUrl}`,
  saved: (name: string) => `Added ${name} to your vault.`,
  skip: (profileUrl?: string) =>
    profileUrl
      ? `Skipped ${profileUrl} — trying the next one`
      : "Skipping a profile that didn’t work out — trying the next one.",
  alreadyKnown: (profileUrl: string) => `Already in vault: ${profileUrl}`,
  skippingKnown: (n: number) =>
    `Skipping ${n} creator profile${n === 1 ? "" : "s"} already in your vault.`,
  cancelled: () => "Stopped by you.",
  done: (n: number, wanted: number) =>
    n >= wanted
      ? `All set — ${n} creator${n === 1 ? "" : "s"} are ready in your vault.`
      : `Saved ${n} creator${n === 1 ? "" : "s"}. You asked for up to ${wanted}; there weren’t enough strong matches left to reach that in this run.`,
  jobCancelled: () => "Mission stopped.",
  insufficientCredits: () =>
    "Out of Optic credits — saved what we could. Upgrade your tier or add credits to keep sourcing.",
  topUpApplied: () => "Campaign top-up applied — 250 more leads added to your balance.",
  topUpFailed: (reason?: string) =>
    reason === "no_payment_method"
      ? "Could not auto top-up — add a card in billing settings to keep sourcing."
      : "Could not apply a top-up block — check billing or contact support.",
} as const;
