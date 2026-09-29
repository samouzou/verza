"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Log = void 0;
/** Customer-facing status lines (no model or infra jargon). */
exports.Log = {
    scoutStarted: () => "Scout is running.",
    shortlist: () => "Finding creators who fit your brief…",
    platformSearch: (platform) => {
        const labels = {
            youtube: "YouTube",
            instagram: "Instagram",
            tiktok: "TikTok",
            facebook: "Facebook",
            twitch: "Twitch",
            linkedin: "LinkedIn",
            twitter: "X",
        };
        const label = labels[platform] ?? platform;
        return `Searching ${label} for people who match your goals…`;
    },
    vetVisit: (profileUrl) => `Opening ${profileUrl}`,
    saved: (name) => `Added ${name} to your vault.`,
    skip: (profileUrl) => profileUrl
        ? `Skipped ${profileUrl} — trying the next one`
        : "Skipping a profile that didn’t work out — trying the next one.",
    alreadyKnown: (profileUrl) => `Already in vault: ${profileUrl}`,
    skippingKnown: (n) => `Skipping ${n} creator profile${n === 1 ? "" : "s"} already in your vault.`,
    cancelled: () => "Stopped by you.",
    done: (n, wanted) => n >= wanted
        ? `All set — ${n} creator${n === 1 ? "" : "s"} are ready in your vault.`
        : `Saved ${n} creator${n === 1 ? "" : "s"}. You asked for up to ${wanted}; there weren’t enough strong matches left to reach that in this run.`,
    jobCancelled: () => "Mission stopped.",
    insufficientCredits: () => "Out of Optic credits — saved what we could. Upgrade your tier or add credits to keep sourcing.",
    topUpApplied: () => "Campaign top-up applied — 250 more leads added to your balance.",
    topUpFailed: (reason) => reason === "no_payment_method"
        ? "Could not auto top-up — add a card in billing settings to keep sourcing."
        : "Could not apply a top-up block — check billing or contact support.",
};
