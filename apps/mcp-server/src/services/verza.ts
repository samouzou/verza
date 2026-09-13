import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";
import type {VerzaActor} from "../context.js";
import {isActiveRecruitingStatus, numOrZero} from "../context.js";
import type {GigBudgetInput} from "../lib/budget.js";

const OPTIC_PLATFORMS = new Set([
  "youtube",
  "instagram",
  "tiktok",
  "facebook",
  "twitch",
  "linkedin",
  "twitter",
]);

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
      `Insufficient Optic credits. This batch needs ${needed}; balance is ${actor.opticCreditsBalance}. Subscribe or top up in /optic/pricing.`
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
        message: "Your scout is queued and will start shortly. (via Verza MCP)",
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

  const abandonedExtensionJob = data.status === "queued" && data.runner === "extension";
  await snap.ref.update({
    cancelRequested: true,
    ...(abandonedExtensionJob
      ? {status: "cancelled", workerCompletedAt: FieldValue.serverTimestamp()}
      : {}),
    updatedAt: FieldValue.serverTimestamp(),
    logs: FieldValue.arrayUnion({
      ts: Timestamp.now(),
      phase: "cancel",
      message: abandonedExtensionJob
        ? "Mission cancelled. (via Verza MCP)"
        : "Cancellation requested. (via Verza MCP)",
    }),
  });
  return {ok: true as const, jobId};
}
