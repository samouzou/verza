import {
  OPTIC_DEFAULT_AUDIENCE_TIER,
  OPTIC_DEFAULT_BATCH_SIZE,
  OPTIC_MAX_BATCH_SIZE,
  type OpticAudienceTier,
} from "@/lib/optic/constants";
import {
  firstOpticPlatformFromCampaign,
  opticPlatformLabel,
  type OpticPlatformSlug,
} from "@/lib/optic/platforms";

export type DashboardChatStats = {
  activeGigsCount: number;
  marketplaceEarnings: number;
  totalPendingIncome: number;
  upcomingIncomeCount: number;
  invoicedThisMonthAmount: number;
  paidThisMonthAmount: number;
  atRiskPaymentsCount: number;
  totalOverdueCount: number;
  totalContractsCount: number;
};

export type DashboardChatCampaign = {
  id: string;
  title: string;
  description: string;
  platforms: string[];
  creatorsNeeded: number;
  acceptedCount: number;
  appliedCount: number;
};

export type DashboardChatResult =
  | { kind: "say"; text: string; href?: string; hrefLabel?: string; awaitCampaign?: boolean }
  | { kind: "reveal" }
  | { kind: "focus" }
  | {
      kind: "optic";
      platform: OpticPlatformSlug;
      objectives: string;
      maxProfiles: number;
      audienceTier: OpticAudienceTier;
      campaignId: string;
      campaignTitle: string;
    };

const PLATFORMS: Array<{ slug: OpticPlatformSlug; pattern: RegExp }> = [
  { slug: "instagram", pattern: /\binstagram\b|\big\b/ },
  { slug: "youtube", pattern: /\byoutube\b|\byt\b/ },
  { slug: "tiktok", pattern: /\btiktok\b|\btik tok\b/ },
  { slug: "facebook", pattern: /\bfacebook\b|\bfb\b/ },
  { slug: "twitch", pattern: /\btwitch\b/ },
  { slug: "linkedin", pattern: /\blinkedin\b/ },
  { slug: "twitter", pattern: /\btwitter\b|\bon x\b/ },
];

const DESTINATIONS: Array<{ pattern: RegExp; href: string; label: string; say: string }> = [
  { pattern: /\b(optic vault|the vault|creator vault|my vault)\b/, href: "/optic/vault", label: "Vault", say: "Opening the vault." },
  { pattern: /\b(prism studio|open studio|the studio)\b/, href: "/prism/studio", label: "Prism Studio", say: "Opening Prism Studio." },
  { pattern: /\b(prism calendar|content calendar|plan (my |the )?(month|content|calendar)|open prism)\b/, href: "/prism", label: "Prism", say: "Opening Prism." },
  { pattern: /\b(brand setup|prism setup)\b/, href: "/prism/setup", label: "Brand setup", say: "Opening brand setup." },
  { pattern: /\b(channels|connected accounts)\b/, href: "/prism/accounts", label: "Channels", say: "Opening channels." },
  { pattern: /\b(prism (plan|pricing|billing)|upgrade prism)\b/, href: "/prism/pricing", label: "Prism pricing", say: "Opening Prism pricing." },
  { pattern: /\boptic pricing\b/, href: "/optic/pricing", label: "Optic pricing", say: "Opening Optic pricing." },
  { pattern: /\b(open|go to|show me|show|take me to)\s+optic\b|\boptic discovery\b/, href: "/optic", label: "Optic", say: "Opening Optic." },
  { pattern: /\b(new campaign|post a campaign|launch a campaign|create a campaign)\b/, href: "/campaigns/post", label: "New campaign", say: "Opening a new campaign." },
  { pattern: /\b(campaigns?|deployments?)\b/, href: "/campaigns", label: "Campaigns", say: "Opening campaigns." },
  { pattern: /\bcontracts?\b/, href: "/contracts", label: "Contracts", say: "Opening contracts." },
  { pattern: /\bbrand guide\b/, href: "/agency/brand-guide", label: "Brand guide", say: "Opening the brand guide." },
  { pattern: /\bproducts?\b/, href: "/agency/products", label: "Products", say: "Opening products." },
  { pattern: /\b(agency|roster|invite (a )?creator)\b/, href: "/agency", label: "Agency", say: "Opening the agency." },
  { pattern: /\bwallet\b|\bpayouts?\b|\bpay creators\b/, href: "/wallet", label: "Wallet", say: "Opening the wallet." },
  { pattern: /\breceipts?\b/, href: "/receipts", label: "Receipts", say: "Opening receipts." },
  { pattern: /\b(banking|taxes)\b/, href: "/banking", label: "Banking", say: "Opening banking and taxes." },
  { pattern: /\btax forms?\b/, href: "/tax-forms", label: "Tax forms", say: "Opening tax forms." },
  { pattern: /\b(creator )?insights?\b/, href: "/insights", label: "Insights", say: "Opening creator insights." },
  { pattern: /\b(reelwright|ai studio)\b/, href: "/ai-studio", label: "Reelwright", say: "Opening Reelwright." },
  { pattern: /\bbrand research\b/, href: "/brand-research", label: "Brand research", say: "Opening brand research." },
  { pattern: /\byoutube writer\b/, href: "/youtube-writer", label: "YouTube Writer", say: "Opening YouTube Writer." },
  { pattern: /\b(my )?store\b/, href: "/store", label: "Store", say: "Opening the store." },
  { pattern: /\bsettings?\b|\bsubscription\b/, href: "/settings", label: "Settings", say: "Opening settings." },
  { pattern: /\bprism\b/, href: "/prism", label: "Prism", say: "Opening Prism." },
];

const OPTIC_LAUNCH =
  /\b(launch|start|run|kick off|begin)\s+optic\b|\bfind(?:\s+me)?\s+(?:\d+\s+)?creators?\b|\bdiscover(?:\s+creators?)?\s+on\b|\boptic\s+(?:for|on)\b/;

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function platformFrom(text: string): OpticPlatformSlug | null {
  for (const entry of PLATFORMS) {
    if (entry.pattern.test(text)) return entry.slug;
  }
  return null;
}

function tierFrom(text: string): OpticAudienceTier {
  if (/\bnano\b/.test(text)) return "nano";
  if (/\bmicro\b/.test(text)) return "micro";
  if (/\bmid(?:-tier)?\b/.test(text)) return "mid";
  if (/\bmacro\b/.test(text)) return "macro";
  return OPTIC_DEFAULT_AUDIENCE_TIER;
}

function clampCount(n: number): number {
  if (!Number.isFinite(n)) return OPTIC_DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(OPTIC_MAX_BATCH_SIZE, Math.round(n)));
}

function isQuestion(text: string): boolean {
  return /\?$/.test(text) || /^(how|what|why|when|who|can you|could you|tell me|is |are )/.test(text);
}

function matchCampaign(text: string, campaigns: DashboardChatCampaign[]): DashboardChatCampaign | null {
  const exactNumber = text.match(/^(?:#\s*|number\s+)?(\d{1,2})$/);
  if (exactNumber) return campaigns[Number(exactNumber[1]) - 1] ?? null;
  if (/^(the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth)( one)?$/.test(text)) {
    const ordinals = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
    const index = ordinals.findIndex((word) => text.includes(word));
    return campaigns[index] ?? null;
  }
  if (isQuestion(text)) return null;
  const hits = campaigns.filter((campaign) => {
    const title = campaign.title.toLowerCase().trim();
    if (title.length < 3) return false;
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`).test(text);
  });
  return hits.length === 1 ? hits[0] : null;
}

function campaignOffer(campaigns: DashboardChatCampaign[]): DashboardChatResult {
  if (campaigns.length === 0) {
    return {
      kind: "say",
      text: "Optic searches from a campaign, and there isn’t an active one yet. Post one and I can search it.",
      awaitCampaign: false,
    };
  }
  if (campaigns.length === 1) {
    return {
      kind: "say",
      text: `Optic searches from your active campaign, “${campaigns[0].title}”. Say yes and I’ll start it.`,
      awaitCampaign: true,
    };
  }
  const lines = campaigns
    .slice(0, 8)
    .map((campaign, index) => `${index + 1}. ${campaign.title}`)
    .join("\n");
  const more = campaigns.length > 8 ? `\n${campaigns.length - 8} more are on the Campaigns page.` : "";
  return {
    kind: "say",
    text: `Optic searches from a campaign. Which one?\n${lines}${more}`,
    awaitCampaign: true,
  };
}

function opticJob(campaign: DashboardChatCampaign, text: string): DashboardChatResult {
  const objectives = [campaign.title ? `Campaign: ${campaign.title}` : "", campaign.description.trim()]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 4000);
  if (objectives.length < 3) {
    return {
      kind: "say",
      text: `“${campaign.title || "This campaign"}” has no brief yet, so Optic has nothing to search.`,
      awaitCampaign: false,
    };
  }
  const explicit = text.match(/\b(\d{1,3})\s*(?:creators?|profiles?|people)\b/);
  const maxProfiles = explicit
    ? clampCount(Number(explicit[1]))
    : campaign.creatorsNeeded > 0
      ? clampCount(campaign.creatorsNeeded)
      : OPTIC_DEFAULT_BATCH_SIZE;
  return {
    kind: "optic",
    platform: platformFrom(text) ?? firstOpticPlatformFromCampaign(campaign.platforms),
    objectives,
    maxProfiles,
    audienceTier: tierFrom(text),
    campaignId: campaign.id,
    campaignTitle: campaign.title || "Campaign",
  };
}

function statsReply(text: string, stats: DashboardChatStats): string | null {
  if (/\b(at risk|overdue)\b/.test(text)) {
    return `${stats.atRiskPaymentsCount} payment${stats.atRiskPaymentsCount === 1 ? "" : "s"} at risk, ${stats.totalOverdueCount} overdue.`;
  }
  if (/\b(collected|paid this month|cash in)\b/.test(text)) {
    return `${money(stats.paidThisMonthAmount)} collected this month.`;
  }
  if (/\binvoic/.test(text)) {
    return `${money(stats.invoicedThisMonthAmount)} invoiced this month.`;
  }
  if (/\b(pending|upcoming|contract income)\b/.test(text)) {
    return `${money(stats.totalPendingIncome)} in contract income across ${stats.upcomingIncomeCount} pending payment${stats.upcomingIncomeCount === 1 ? "" : "s"}.`;
  }
  if (/\b(secured|marketplace|network earnings)\b/.test(text)) {
    return `${money(stats.marketplaceEarnings)} secured from the network.`;
  }
  if (/\b(active campaigns?|how many campaigns|our campaigns?|campaigns? doing)\b/.test(text) || /\bhow is\b.*\bcampaign/.test(text)) {
    return `${stats.activeGigsCount} active campaign${stats.activeGigsCount === 1 ? "" : "s"}. ${money(stats.paidThisMonthAmount)} collected this month, ${money(stats.totalPendingIncome)} still pending, ${stats.atRiskPaymentsCount} at risk.`;
  }
  if (/\b(how (?:am i|are we) doing|what'?s going on|summary|overview|the numbers)\b/.test(text)) {
    return `${stats.activeGigsCount} active campaign${stats.activeGigsCount === 1 ? "" : "s"}. ${money(stats.paidThisMonthAmount)} collected this month, ${money(stats.totalPendingIncome)} still pending, ${stats.atRiskPaymentsCount} at risk.`;
  }
  return null;
}

function pipelineReply(text: string, campaigns: DashboardChatCampaign[]): string | null {
  const asks =
    /\bhow many creators\b/.test(text) ||
    /\b(pipeline|applicants?|applications?)\b/.test(text);
  if (!asks) return null;
  if (campaigns.length === 0) return "No active campaigns, so there are no creators in the pipeline.";
  const accepted = campaigns.reduce((sum, campaign) => sum + campaign.acceptedCount, 0);
  const applied = campaigns.reduce((sum, campaign) => sum + campaign.appliedCount, 0);
  const campaignBit = `${campaigns.length} active campaign${campaigns.length === 1 ? "" : "s"}`;
  return `${campaignBit}. ${accepted} creator${accepted === 1 ? "" : "s"} accepted, ${applied} application${applied === 1 ? "" : "s"} in.`;
}

function opticFrom(
  text: string,
  isBrandTeam: boolean,
  campaigns: DashboardChatCampaign[]
): DashboardChatResult | null {
  if (!OPTIC_LAUNCH.test(text)) return null;
  if (!isBrandTeam) {
    return {
      kind: "say",
      text: "Optic runs from a brand workspace. I can open insights, contracts, or the wallet instead.",
      href: "/insights",
      hrefLabel: "Insights",
    };
  }
  const named = matchCampaign(text, campaigns);
  if (named) return opticJob(named, text);
  return campaignOffer(campaigns);
}

/** Turns a dashboard message into a navigation, a metric, or an Optic launch. */
const HELP =
  "I can search an active campaign with Optic, read the numbers behind this, or open Campaigns, Prism, contracts, the agency, or the wallet.";

export function interpretDashboardChat(
  raw: string,
  stats: DashboardChatStats,
  isBrandTeam: boolean,
  awaitingCampaign: boolean,
  campaigns: DashboardChatCampaign[]
): DashboardChatResult {
  const text = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return { kind: "say", text: "Tell me what you want done." };

  if (/\b(show|see|view) (the )?(numbers|metrics|dashboard)\b/.test(text)) return { kind: "reveal" };
  if (/\b(hide (the )?(numbers|metrics)|back to chat|ask verza)\b/.test(text)) return { kind: "focus" };

  if (/^(what can i do|what can you do|what should (i|we) do|help)\b/.test(text)) {
    return { kind: "say", text: HELP };
  }

  const fromStats = statsReply(text, stats);
  if (fromStats) return { kind: "say", text: fromStats };

  const fromPipeline = pipelineReply(text, campaigns);
  if (fromPipeline) return { kind: "say", text: fromPipeline };

  if (awaitingCampaign && isBrandTeam && campaigns.length > 0) {
    const confirmed = /^(yes|yeah|yep|sure|do it|go ahead|start it|that one)$/.test(text);
    if (confirmed && campaigns.length === 1) return opticJob(campaigns[0], text);
    if (confirmed) return campaignOffer(campaigns);
    const picked = matchCampaign(text, campaigns);
    if (picked) return opticJob(picked, text);
  }

  const optic = opticFrom(text, isBrandTeam, campaigns);
  if (optic) return optic;

  const opening = /^(please\s+)?(open|go to|show|take me|launch)\b/.test(text);
  if (!isQuestion(text) || opening) {
    const destination = DESTINATIONS.find((entry) => entry.pattern.test(text));
    if (destination) {
      return {
        kind: "say",
        text: destination.say,
        href: destination.href,
        hrefLabel: destination.label,
        awaitCampaign: false,
      };
    }
  }

  return { kind: "say", text: HELP };
}

export function opticLaunchLine(
  platform: OpticPlatformSlug,
  campaignTitle: string,
  maxProfiles: number
): string {
  return `Optic is searching “${campaignTitle}” for ${maxProfiles} creator${maxProfiles === 1 ? "" : "s"} on ${opticPlatformLabel(platform)}.`;
}
