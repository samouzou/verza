import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";
import type {VerzaActor} from "../context.js";
import {isActiveRecruitingStatus, numOrZero} from "../context.js";
import type {GigBudgetInput} from "../lib/budget.js";
import {billingFromActor, saveLeadWithOpticCreditCharge} from "../lib/credits.js";
import {ensureStoredEmailHtml} from "../lib/emailHtml.js";
import {
  OPTIC_AUDIENCE_TIERS,
  canonicalizeProfileUrl,
  checkAudienceGate,
  composeMatchScore,
  normalizeProfileUrl,
  platformLabel,
  type OpticAudienceTier,
} from "../lib/opticAgent.js";

const OPTIC_PLATFORMS = new Set([
  "youtube",
  "instagram",
  "tiktok",
  "facebook",
  "twitch",
  "linkedin",
  "twitter",
]);

/** Platforms where the Chrome extension is used in the web app — MCP agents scout these themselves. */
export const AGENT_PREFERRED_PLATFORMS = new Set(["instagram", "linkedin", "twitter"]);

const OPTIC_DEFAULT_BATCH = 10;
const OPTIC_MAX_BATCH = 100;

export type CampaignSummary = {
  id: string;
  title: string;
  description: string;
  status: string;
  campaignType: string;
  ratePerCreator: number;
  creatorsNeeded: number;
  videosPerCreator: number;
  platforms: string[];
  fundedAmount: number;
  acceptedCount: number;
  paidCount: number;
  affiliateEnabled: boolean;
};

function mapGig(id: string, data: DocumentData): CampaignSummary & GigBudgetInput {
  const accepted = Array.isArray(data.acceptedCreatorIds) ? data.acceptedCreatorIds : [];
  const paid = Array.isArray(data.paidCreatorIds) ? data.paidCreatorIds : [];
  const platforms = Array.isArray(data.platforms) ? (data.platforms as string[]) : [];
  const aff = data.affiliateSettings as GigBudgetInput["affiliateSettings"];
  return {
    id,
    title: typeof data.title === "string" ? data.title : "Campaign",
    description: typeof data.description === "string" ? data.description : "",
    status: String(data.status ?? ""),
    campaignType: typeof data.campaignType === "string" ? data.campaignType : "",
    ratePerCreator: numOrZero(data.ratePerCreator),
    creatorsNeeded: numOrZero(data.creatorsNeeded),
    videosPerCreator: numOrZero(data.videosPerCreator),
    platforms,
    fundedAmount: numOrZero(data.fundedAmount),
    acceptedCount: accepted.length,
    paidCount: paid.length,
    acceptedCreatorIds: accepted,
    paidCreatorIds: paid,
    affiliateEnabled: Boolean(aff?.isEnabled),
    affiliateSettings: aff ?? null,
  };
}

export async function listCampaigns(
  db: Firestore,
  actor: VerzaActor,
  opts?: {activeOnly?: boolean; limit?: number}
): Promise<CampaignSummary[]> {
  const limit = Math.min(50, Math.max(1, opts?.limit ?? 24));
  const snap = await db
    .collection("gigs")
    .where("brandId", "==", actor.agencyId)
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  let rows = snap.docs.map((d) => mapGig(d.id, d.data()));
  if (opts?.activeOnly !== false) {
    rows = rows.filter((g) => isActiveRecruitingStatus(g.status));
  }
  return rows.slice(0, limit);
}

export async function getCampaign(
  db: Firestore,
  actor: VerzaActor,
  campaignId: string
): Promise<(CampaignSummary & GigBudgetInput) | null> {
  const snap = await db.collection("gigs").doc(campaignId).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  if (String(data.brandId ?? "") !== actor.agencyId) {
    throw new Error("Campaign belongs to another brand workspace.");
  }
  return mapGig(snap.id, data);
}

export async function listJobs(
  db: Firestore,
  actor: VerzaActor,
  opts?: {limit?: number; campaignId?: string | null}
) {
  const limit = Math.min(40, Math.max(1, opts?.limit ?? 15));
  const q = db
    .collection("optic_jobs")
    .where("agencyId", "==", actor.agencyId)
    .orderBy("createdAt", "desc")
    .limit(limit);

  // Firestore can't easily filter campaignId + order without composite; filter client-side.
  const snap = await q.get();
  let rows = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      status: data.status ?? null,
      platform: data.platform ?? null,
      objectives: data.objectives ?? null,
      maxProfiles: data.maxProfiles ?? null,
      processedCount: data.processedCount ?? 0,
      campaignId: data.campaignId ?? null,
      error: data.error ?? null,
      createdAt: data.createdAt ?? null,
      batchIndex: data.batchIndex ?? null,
      runner: data.runner ?? null,
    };
  });
  if (opts?.campaignId) {
    rows = rows.filter((r) => r.campaignId === opts.campaignId);
  }
  return rows;
}

export async function getJob(db: Firestore, actor: VerzaActor, jobId: string) {
  const snap = await db.collection("optic_jobs").doc(jobId).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  if (String(data.agencyId ?? "") !== actor.agencyId) {
    throw new Error("Job belongs to another brand workspace.");
  }
  return {
    id: snap.id,
    status: data.status ?? null,
    platform: data.platform ?? null,
    objectives: data.objectives ?? null,
    maxProfiles: data.maxProfiles ?? null,
    processedCount: data.processedCount ?? 0,
    campaignId: data.campaignId ?? null,
    error: data.error ?? null,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    batchIndex: data.batchIndex ?? null,
    runner: data.runner ?? null,
    brandContext: data.brandContext ?? null,
    logs: Array.isArray(data.logs) ? data.logs.slice(-30) : [],
  };
}

export async function listLeads(
  db: Firestore,
  actor: VerzaActor,
  opts?: {
    campaignId?: string | null;
    limit?: number;
    minMatchScore?: number | null;
    hasEmail?: boolean | null;
    contacted?: boolean | null;
  }
) {
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 25));
  const snap = await db
    .collection("optic_outreach_leads")
    .where("agencyId", "==", actor.agencyId)
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();

  let rows = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      creatorName: data.creatorName ?? null,
      niche: data.niche ?? null,
      email: data.email ?? null,
      followerCount: data.followerCount ?? null,
      followerCountNumeric: data.followerCountNumeric ?? null,
      profileUrl: data.profileUrl ?? null,
      discoveryPlatform: data.discoveryPlatform ?? null,
      campaignId: data.campaignId ?? null,
      campaignTitle: data.campaignTitle ?? null,
      matchScore: typeof data.matchScore === "number" ? data.matchScore : null,
      matchReason: data.matchReason ?? null,
      matchBreakdown: data.matchBreakdown ?? null,
      outreachEmailed: Boolean(data.outreachEmailed),
      pipelineStage: data.pipelineStage ?? null,
      draftEmailSubject: data.draftEmailSubject ?? null,
      hasDraftEmail: Boolean(data.draftEmail),
      hasDraftDm: Boolean(data.draftDm),
      gmailDraftId: data.gmailDraftId ?? null,
      gmailThreadId: data.gmailThreadId ?? null,
      createdAt: data.createdAt ?? null,
    };
  });

  if (opts?.campaignId) {
    rows = rows.filter((r) => r.campaignId === opts.campaignId);
  }
  if (opts?.minMatchScore != null) {
    rows = rows.filter((r) => (r.matchScore ?? -1) >= opts.minMatchScore!);
  }
  if (opts?.hasEmail === true) {
    rows = rows.filter((r) => typeof r.email === "string" && r.email.trim().length > 0);
  } else if (opts?.hasEmail === false) {
    rows = rows.filter((r) => !(typeof r.email === "string" && r.email.trim()));
  }
  if (opts?.contacted === true) {
    rows = rows.filter((r) => r.outreachEmailed);
  } else if (opts?.contacted === false) {
    rows = rows.filter((r) => !r.outreachEmailed);
  }

  rows.sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1));
  return rows.slice(0, limit);
}

export async function getLead(db: Firestore, actor: VerzaActor, leadId: string) {
  const snap = await db.collection("optic_outreach_leads").doc(leadId).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  if (String(data.agencyId ?? "") !== actor.agencyId) {
    throw new Error("Lead belongs to another brand workspace.");
  }
  return {id: snap.id, ...data};
}

async function loadBrandContextForJob(
  db: Firestore,
  actor: VerzaActor,
  campaignId: string | null
) {
  let campaignPaySummary: string | null = null;
  let paySourceCampaignTitle: string | null = null;
  let paySourceCampaignType: string | null = null;

  if (campaignId) {
    const gig = await getCampaign(db, actor, campaignId);
    if (gig && isActiveRecruitingStatus(gig.status)) {
      paySourceCampaignTitle = gig.title;
      paySourceCampaignType = gig.campaignType || null;
      const rate =
        gig.ratePerCreator > 0
          ? `$${gig.ratePerCreator.toLocaleString("en-US")} USD per creator (listed on Verza)`
          : "compensation set in campaign (see Verza)";
      campaignPaySummary =
        `The recruiting team selected this Verza campaign for this outreach mission. ` +
        `Use ONLY this campaign's pay and scope:\n` +
        `- "${gig.title}" (${gig.status}): ${rate} · ${gig.campaignType || "sponsorship"}` +
        (gig.platforms.length ? ` · platforms: ${gig.platforms.join(", ")}` : "") +
        ` · ${gig.creatorsNeeded} creator slot(s), ${gig.videosPerCreator} deliverable(s) each`;
    }
  }

  let brandSummary: string | null = null;
  try {
    const agSnap = await db.collection("agencies").doc(actor.agencyId).get();
    const brandGuide = agSnap.data()?.brandGuide as {missionStatement?: string} | undefined;
    if (typeof brandGuide?.missionStatement === "string" && brandGuide.missionStatement.trim()) {
      brandSummary = brandGuide.missionStatement.trim().slice(0, 800);
    }
  } catch {
    // optional
  }

  return {
    agencyName: actor.agencyName,
    brandSummary,
    userDisplayName: actor.displayName,
    campaignPaySummary,
    paySourceCampaignTitle,
    paySourceCampaignType,
  };
}

function assertCredits(actor: VerzaActor, needed: number) {
  if (actor.opticSubscriptionActive) {
    const plan = actor.opticPlan ?? "";
    // Pilot/enterprise/flagship/appsumo may start with auto top-up / overage at save time.
    // Launch is hard-capped on balance (same spirit as assertSufficientOpticCredits).
    if (plan === "enterprise" || plan === "flagship" || plan === "pilot" || plan === "appsumo") {
      return;
    }
  }
  if (actor.opticCreditsBalance < needed) {
    throw new Error(
      `Not enough Optic credits. This search needs ${needed}; you have ${actor.opticCreditsBalance}. Top up under Optic → Pricing.`
    );
  }
}

export async function startDiscovery(
  db: Firestore,
  actor: VerzaActor,
  input: {
    platform: string;
    objectives: string;
    maxProfiles?: number;
    campaignId?: string | null;
    audienceTier?: string | null;
  }
) {
  const platform = input.platform.trim().toLowerCase();
  if (!OPTIC_PLATFORMS.has(platform)) {
    throw new Error(
      `platform must be one of: ${[...OPTIC_PLATFORMS].join(", ")}`
    );
  }
  const objectives = input.objectives.trim();
  if (!objectives) throw new Error("objectives is required");

  let maxProfiles = OPTIC_DEFAULT_BATCH;
  if (typeof input.maxProfiles === "number" && Number.isFinite(input.maxProfiles)) {
    maxProfiles = Math.max(1, Math.min(OPTIC_MAX_BATCH, Math.floor(input.maxProfiles)));
  }

  const campaignId =
    typeof input.campaignId === "string" && input.campaignId.trim()
      ? input.campaignId.trim()
      : null;

  if (campaignId) {
    const gig = await getCampaign(db, actor, campaignId);
    if (!gig) throw new Error(`Campaign ${campaignId} not found`);
  }

  assertCredits(actor, maxProfiles);

  const brandContext = await loadBrandContextForJob(db, actor, campaignId);
  const audienceTier =
    typeof input.audienceTier === "string" && input.audienceTier.trim()
      ? input.audienceTier.trim()
      : "any";

  const jobRef = db.collection("optic_jobs").doc();
  await jobRef.set({
    status: "queued",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    uid: actor.uid,
    agencyId: actor.agencyId,
    agencyName: actor.agencyName,
    platform,
    objectives: objectives.slice(0, 4000),
    maxProfiles,
    campaignId,
    brandContext,
    audienceTier,
    batchIndex: 1,
    rootJobId: jobRef.id,
    continuedFromJobId: null,
    smsNotify: false,
    smsCompletionSent: false,
    runner: "worker",
    logs: [
      {
        ts: Timestamp.now(),
        phase: "enqueue",
        message: "Your scout is queued and will start shortly.",
      },
    ],
    error: null,
    processedCount: 0,
    cancelRequested: false,
  });

  return {
    jobId: jobRef.id,
    platform,
    maxProfiles,
    campaignId,
    agencyId: actor.agencyId,
    status: "queued" as const,
  };
}

export async function cancelDiscovery(db: Firestore, actor: VerzaActor, jobId: string) {
  const snap = await db.collection("optic_jobs").doc(jobId).get();
  if (!snap.exists) throw new Error("Job not found");
  const data = snap.data()!;
  if (String(data.agencyId ?? "") !== actor.agencyId) {
    throw new Error("Job belongs to another brand workspace.");
  }

  // Extension + agent missions have no Cloud Run worker watching cancelRequested.
  const closeLocalRunner =
    (data.runner === "extension" || data.runner === "agent") &&
    (data.status === "queued" || data.status === "running");
  await snap.ref.update({
    cancelRequested: true,
    ...(closeLocalRunner
      ? {status: "cancelled", workerCompletedAt: FieldValue.serverTimestamp()}
      : {}),
    updatedAt: FieldValue.serverTimestamp(),
    logs: FieldValue.arrayUnion({
      ts: Timestamp.now(),
      phase: "cancel",
      message: closeLocalRunner
        ? "Mission cancelled."
        : "Cancellation requested.",
    }),
  });
  return {ok: true as const, jobId};
}

async function loadExcludeHandles(
  db: Firestore,
  agencyId: string,
  campaignId: string | null,
  platform: string
): Promise<string[]> {
  const snap = await db
    .collection("optic_outreach_leads")
    .where("agencyId", "==", agencyId)
    .limit(400)
    .get();
  const handles: string[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const url = typeof data.profileUrl === "string" ? data.profileUrl : "";
    if (!url) continue;
    const leadCampaignId =
      typeof data.campaignId === "string" && data.campaignId.trim()
        ? data.campaignId.trim()
        : null;
    if (campaignId) {
      if (leadCampaignId !== campaignId && leadCampaignId !== null) continue;
    }
    try {
      const u = new URL(canonicalizeProfileUrl(platform, url));
      const parts = u.pathname.split("/").filter(Boolean);
      if (platform === "linkedin") {
        const idx = parts.indexOf("in");
        if (idx >= 0 && parts[idx + 1]) handles.push(parts[idx + 1]);
      } else if (parts[0]) {
        handles.push(parts[0].replace(/^@/, ""));
      }
    } catch {
      /* skip */
    }
  }
  return [...new Set(handles)].slice(0, 120);
}

/**
 * Starts an agent-scout mission. The MCP client (Claude / Cursor / ChatGPT) searches
 * with its own tools — Chrome extension is not used.
 */
export async function prepareAgentMission(
  db: Firestore,
  actor: VerzaActor,
  input: {
    platform: string;
    objectives: string;
    maxProfiles?: number;
    campaignId?: string | null;
    audienceTier?: string | null;
  }
) {
  const platform = input.platform.trim().toLowerCase();
  if (!OPTIC_PLATFORMS.has(platform)) {
    throw new Error(`platform must be one of: ${[...OPTIC_PLATFORMS].join(", ")}`);
  }
  const objectives = input.objectives.trim();
  if (!objectives) throw new Error("objectives is required");

  let maxProfiles = OPTIC_DEFAULT_BATCH;
  if (typeof input.maxProfiles === "number" && Number.isFinite(input.maxProfiles)) {
    maxProfiles = Math.max(1, Math.min(OPTIC_MAX_BATCH, Math.floor(input.maxProfiles)));
  }

  const campaignId =
    typeof input.campaignId === "string" && input.campaignId.trim()
      ? input.campaignId.trim()
      : null;
  if (campaignId) {
    const gig = await getCampaign(db, actor, campaignId);
    if (!gig) throw new Error(`Campaign ${campaignId} not found`);
  }

  assertCredits(actor, maxProfiles);

  const brandContext = await loadBrandContextForJob(db, actor, campaignId);
  const audienceTierRaw =
    typeof input.audienceTier === "string" && input.audienceTier.trim()
      ? input.audienceTier.trim()
      : "any";
  const audienceTier = (
    audienceTierRaw in OPTIC_AUDIENCE_TIERS ? audienceTierRaw : "any"
  ) as OpticAudienceTier;

  const excludeHandles = await loadExcludeHandles(db, actor.agencyId, campaignId, platform);
  const tier = OPTIC_AUDIENCE_TIERS[audienceTier];
  const network = platformLabel(platform);

  const jobRef = db.collection("optic_jobs").doc();
  await jobRef.set({
    status: "running",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    workerStartedAt: FieldValue.serverTimestamp(),
    uid: actor.uid,
    agencyId: actor.agencyId,
    agencyName: actor.agencyName,
    platform,
    objectives: objectives.slice(0, 4000),
    maxProfiles,
    campaignId,
    brandContext,
    audienceTier,
    batchIndex: 1,
    rootJobId: jobRef.id,
    continuedFromJobId: null,
    smsNotify: false,
    smsCompletionSent: false,
    runner: "agent",
    logs: [
      {
        ts: Timestamp.now(),
        phase: "agent",
        message: `Creator search started on ${network}.`,
      },
    ],
    error: null,
    processedCount: 0,
    cancelRequested: false,
  });

  return {
    jobId: jobRef.id,
    runner: "agent" as const,
    platform,
    platformLabel: network,
    maxProfiles,
    campaignId,
    audienceTier,
    audienceLabel: tier.label,
    followerMin: tier.min,
    followerMax: tier.max,
    objectives: objectives.slice(0, 4000),
    brandContext,
    excludeHandles,
    agentInstructions: [
      `Help this brand find up to ${maxProfiles} ${network} creators who fit the brief.`,
      `Audience size: ${tier.label}${tier.max == null ? ` (at least ${tier.min})` : ` (${tier.min}–${tier.max})`}.`,
      "Skip anyone already in excludeHandles — they’re already in the vault.",
      "Search with your own tools. Prefer real public profiles with follower counts.",
      "For each strong fit, save them with optic_submit_agent_lead (profile link, name, followers, niche, bio, email if visible, and a short why-they-fit note).",
      "Include a short outreach draft when you can. For emails, draftEmail MUST be HTML with <p> tags (and optional <strong>, <em>, <a>) — never plain text paragraphs. Example: <p>Hi …</p><p>I'm with <strong>Brand</strong>…</p>. Platform DMs stay plain text.",
      "After saving creators with emails, check optic_gmail_status and use optic_create_gmail_draft to put HTML drafts in Gmail.",
      "When finished, mark the mission complete with optic_complete_agent_mission.",
      "Talk to the brand in plain language — don’t mention tools, APIs, or extension internals.",
    ].join("\n"),
    creditsNote: "Each creator saved to the vault uses 1 Optic credit.",
  };
}

export async function submitAgentLead(
  db: Firestore,
  actor: VerzaActor,
  input: {
    jobId: string;
    profileUrl: string;
    creatorName?: string | null;
    followerCount?: string | null;
    postCount?: string | null;
    niche?: string | null;
    bio?: string | null;
    email?: string | null;
    externalUrl?: string | null;
    matchReason?: string | null;
    briefFitScore?: number | null;
    draftEmail?: string | null;
    draftEmailSubject?: string | null;
    draftDm?: string | null;
  }
) {
  const jobSnap = await db.collection("optic_jobs").doc(input.jobId.trim()).get();
  if (!jobSnap.exists) throw new Error("Job not found");
  const job = jobSnap.data()!;
  if (String(job.agencyId ?? "") !== actor.agencyId) {
    throw new Error("Job belongs to another brand workspace.");
  }
  if (job.runner !== "agent") {
    throw new Error(
      "This search isn’t set up for assisted scouting. Start a new creator search first."
    );
  }
  if (job.cancelRequested) {
    return {ok: false as const, reason: "cancelled" as const};
  }
  if (job.status !== "running" && job.status !== "queued") {
    return {ok: false as const, reason: "not_running" as const, status: job.status};
  }

  const platform = String(job.platform ?? "");
  const profileUrl = canonicalizeProfileUrl(platform, input.profileUrl);
  if (!profileUrl || !/^https?:\/\//i.test(profileUrl)) {
    throw new Error("profileUrl must be a full http(s) profile URL");
  }

  const maxProfiles =
    typeof job.maxProfiles === "number" && Number.isFinite(job.maxProfiles)
      ? job.maxProfiles
      : OPTIC_DEFAULT_BATCH;
  const processed =
    typeof job.processedCount === "number" && Number.isFinite(job.processedCount)
      ? job.processedCount
      : 0;
  if (processed >= maxProfiles) {
    return {ok: false as const, reason: "batch_full" as const, processedCount: processed};
  }

  // Duplicate check (exact URL + normalized variants via agency scan of recent is enough for exact)
  const dupExact = await db
    .collection("optic_outreach_leads")
    .where("agencyId", "==", actor.agencyId)
    .where("profileUrl", "==", profileUrl)
    .limit(1)
    .get();
  if (!dupExact.empty) {
    return {ok: false as const, reason: "duplicate" as const};
  }

  const audienceTier = (
    typeof job.audienceTier === "string" && job.audienceTier in OPTIC_AUDIENCE_TIERS
      ? job.audienceTier
      : "any"
  ) as OpticAudienceTier;

  const gate = checkAudienceGate(
    {
      followerCount: input.followerCount,
      postCount: input.postCount,
      bio: input.bio,
      externalUrl: input.externalUrl,
    },
    audienceTier
  );
  if (!gate.ok) {
    return {ok: false as const, reason: "filtered" as const, detail: gate.reason};
  }

  const match = composeMatchScore({
    briefFitScore: input.briefFitScore ?? 70,
    matchReason: input.matchReason,
    followerCount: input.followerCount,
    postCount: input.postCount,
    email: input.email,
    externalUrl: input.externalUrl,
    audienceTier,
  });

  const brandCtx =
    job.brandContext && typeof job.brandContext === "object"
      ? (job.brandContext as Record<string, unknown>)
      : null;
  const payTitle =
    typeof brandCtx?.paySourceCampaignTitle === "string"
      ? brandCtx.paySourceCampaignTitle.trim() || null
      : null;

  const creatorName =
    (typeof input.creatorName === "string" && input.creatorName.trim()
      ? input.creatorName.trim()
      : null) ||
    profileUrl;

  const leadPayload: Record<string, unknown> = {
    creatorName: creatorName.slice(0, 200),
    niche: typeof input.niche === "string" ? input.niche.trim().slice(0, 200) : null,
    email:
      typeof input.email === "string" && input.email.trim()
        ? input.email.trim().slice(0, 200)
        : null,
    followerCount:
      typeof input.followerCount === "string" && input.followerCount.trim()
        ? input.followerCount.trim().slice(0, 40)
        : match.followerCountNumeric != null
          ? String(match.followerCountNumeric)
          : null,
    followerCountNumeric: match.followerCountNumeric,
    postCountNumeric: match.postCountNumeric,
    draftEmail:
      typeof input.draftEmail === "string" && input.draftEmail.trim()
        ? ensureStoredEmailHtml(input.draftEmail).slice(0, 8000) || null
        : null,
    draftEmailSubject:
      typeof input.draftEmailSubject === "string" && input.draftEmailSubject.trim()
        ? input.draftEmailSubject.trim().slice(0, 200)
        : null,
    draftDm:
      typeof input.draftDm === "string" && input.draftDm.trim()
        ? input.draftDm.trim().slice(0, 4000)
        : null,
    matchScore: match.matchScore,
    matchReason: match.matchReason,
    matchBreakdown: match.matchBreakdown,
    discoveryPlatform: platform,
    profileUrl,
    createdAt: FieldValue.serverTimestamp(),
    source: "Verza Optic",
    agencyId: actor.agencyId,
    agencyName: actor.agencyName,
    campaignId: job.campaignId ?? null,
    campaignTitle: payTitle,
    agentScrape: {
      bio: typeof input.bio === "string" ? input.bio.slice(0, 2000) : null,
      externalUrl:
        typeof input.externalUrl === "string" ? input.externalUrl.slice(0, 500) : null,
      normalizedKey: normalizeProfileUrl(profileUrl),
    },
  };

  const saveResult = await saveLeadWithOpticCreditCharge({
    db,
    jobId: jobSnap.id,
    agencyId: actor.agencyId,
    profileUrl,
    leadData: leadPayload,
    billing: billingFromActor(actor),
  });

  if (!saveResult.ok) {
    return {
      ok: false as const,
      reason: saveResult.reason,
    };
  }

  await jobSnap.ref.update({
    processedCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
    logs: FieldValue.arrayUnion({
      ts: Timestamp.now(),
      phase: "agent",
      message: `Saved ${creatorName.slice(0, 60)} (${match.matchScore}% match).`,
    }),
  });

  return {
    ok: true as const,
    leadId: saveResult.leadId,
    matchScore: match.matchScore,
    charged: saveResult.charged,
    overage: saveResult.overage ?? false,
    profileUrl,
    processedCount: processed + 1,
    maxProfiles,
  };
}

export async function completeAgentMission(
  db: Firestore,
  actor: VerzaActor,
  jobId: string
) {
  const snap = await db.collection("optic_jobs").doc(jobId.trim()).get();
  if (!snap.exists) throw new Error("Job not found");
  const data = snap.data()!;
  if (String(data.agencyId ?? "") !== actor.agencyId) {
    throw new Error("Job belongs to another brand workspace.");
  }
  if (data.runner !== "agent") {
    throw new Error("This search isn’t an assisted scout mission.");
  }
  await snap.ref.update({
    status: "completed",
    workerCompletedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    logs: FieldValue.arrayUnion({
      ts: Timestamp.now(),
      phase: "agent",
      message: "Creator search completed.",
    }),
  });
  return {
    ok: true as const,
    jobId: snap.id,
    processedCount: data.processedCount ?? 0,
    maxProfiles: data.maxProfiles ?? null,
  };
}
