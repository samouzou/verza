import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import {loadAgencyBrandContextForUid, type AgencyBrandContext} from "./agencyContext";
import {
  OPTIC_DEFAULT_AUDIENCE_TIER,
  OPTIC_DEFAULT_BATCH_SIZE,
  OPTIC_EXTENSION_PLATFORMS,
  OPTIC_MAX_BATCH_SIZE,
  OPTIC_PLATFORMS,
  isOpticAudienceTier,
  opticPlatformLabel,
} from "./constants";
import {continueMissionForUid} from "./continuation";
import {assertSufficientOpticCredits} from "./credits";
import {normalizeSmsPhone} from "./twilio";
import {
  isOpticLeadResponse,
  isOpticLeadStage,
  isOpticPassReason,
  type OpticLeadResponse,
  type OpticLeadStage,
  type OpticPassReason,
} from "./leadCrm";
import {isEmailDraftEmpty, sanitizeStoredEmailDraft} from "../gmail/emailHtml";
import {parseCompactCount} from "./counts";
import {regenerateVaultEmailDraft} from "./extensionLead";
import {recomposeMatchScoreFromLead} from "./matchScore";

const TEAM_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);

export type OpticJobBrandContext = Pick<
  AgencyBrandContext,
  | "agencyName"
  | "brandSummary"
  | "userDisplayName"
  | "campaignPaySummary"
  | "paySourceCampaignTitle"
  | "paySourceCampaignType"
>;

/** Subset of agency context stored on each Optic job for the worker.
 * @param {AgencyBrandContext} full Loaded agency context from Firestore.
 * @return {OpticJobBrandContext} Fields persisted on the job document.
 */
function toJobBrandContext(full: AgencyBrandContext): OpticJobBrandContext {
  return {
    agencyName: full.agencyName,
    brandSummary: full.brandSummary,
    userDisplayName: full.userDisplayName,
    campaignPaySummary: full.campaignPaySummary,
    paySourceCampaignTitle: full.paySourceCampaignTitle,
    paySourceCampaignType: full.paySourceCampaignType,
  };
}

/**
 * Ensures the caller is an agency owner, admin, or member with a primary agency.
 * @param {string} uid Firebase Auth user id.
 * @return {Promise<void>} Resolves when valid; throws HttpsError otherwise.
 */
async function assertAgencyTeam(uid: string): Promise<void> {
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("failed-precondition", "User profile not found.");
  }
  const user = userSnap.data()!;
  const role = String(user.role ?? "");
  if (!TEAM_ROLES.has(role)) {
    throw new HttpsError(
      "permission-denied",
      "Optic discovery requires an agency owner, admin, or member account."
    );
  }
  if (!user.primaryAgencyId) {
    throw new HttpsError("failed-precondition", "Set a primary agency before running Optic.");
  }
}

/**
 * Creates a Firestore `optic_jobs` document (queued). A Firestore trigger dispatches the job to the
 * Cloud Run worker when `OPTIC_WORKER_URL` and `OPTIC_WORKER_SHARED_SECRET` are configured.
 */
export const enqueueOpticDiscoveryJob = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to run Optic discovery.");
  }
  const uid = request.auth.uid;
  await assertAgencyTeam(uid);

  const {
    platform,
    objectives,
    maxProfiles,
    campaignId,
    smsNotify,
    useBrowserExtension,
    audienceTier,
  } = request.data as {
    platform?: unknown;
    objectives?: unknown;
    maxProfiles?: unknown;
    campaignId?: unknown;
    smsNotify?: unknown;
    useBrowserExtension?: unknown;
    audienceTier?: unknown;
  };

  if (typeof platform !== "string" || !OPTIC_PLATFORMS.has(platform)) {
    throw new HttpsError(
      "invalid-argument",
      "platform must be one of: youtube, instagram, tiktok, facebook, twitch, linkedin, twitter."
    );
  }
  if (typeof objectives !== "string" || !objectives.trim()) {
    throw new HttpsError("invalid-argument", "objectives is required.");
  }

  let mp = OPTIC_DEFAULT_BATCH_SIZE;
  if (typeof maxProfiles === "number" && Number.isFinite(maxProfiles)) {
    mp = Math.max(1, Math.min(OPTIC_MAX_BATCH_SIZE, Math.floor(maxProfiles)));
  }

  const wantSms = smsNotify === true;
  if (wantSms) {
    const userSnap = await db.collection("users").doc(uid).get();
    const phone = userSnap.data()?.opticSmsPhone;
    if (typeof phone !== "string" || !phone.trim()) {
      throw new HttpsError(
        "failed-precondition",
        "Add a mobile number under Text updates before enabling SMS."
      );
    }
  }

  const campaignIdStr =
    typeof campaignId === "string" && campaignId.trim() ? campaignId.trim() : null;

  const wantsExtension =
    OPTIC_EXTENSION_PLATFORMS.has(platform) && useBrowserExtension === true;

  const tier = isOpticAudienceTier(audienceTier)
    ? audienceTier
    : OPTIC_DEFAULT_AUDIENCE_TIER;

  let fullBrand: AgencyBrandContext;
  try {
    fullBrand = await loadAgencyBrandContextForUid(uid, {campaignId: campaignIdStr});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HttpsError("failed-precondition", msg);
  }

  await assertSufficientOpticCredits(fullBrand.agencyId, mp);

  const jobRef = db.collection("optic_jobs").doc();
  const jobId = jobRef.id;
  const brandContext = toJobBrandContext(fullBrand);

  await jobRef.set({
    status: "queued",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    uid,
    agencyId: fullBrand.agencyId,
    agencyName: fullBrand.agencyName,
    platform,
    objectives: objectives.trim().slice(0, 4000),
    maxProfiles: mp,
    campaignId: campaignIdStr,
    brandContext,
    audienceTier: tier,
    batchIndex: 1,
    rootJobId: jobId,
    continuedFromJobId: null,
    smsNotify: wantSms,
    smsCompletionSent: false,
    runner: wantsExtension ? "extension" : "worker",
    logs: [
      {
        ts: Timestamp.now(),
        phase: "enqueue",
        message: wantsExtension
          ? `Mission queued — open ${opticPlatformLabel(platform)} in Chrome with the Optic extension installed.`
          : "Your scout is queued and will start shortly.",
      },
    ],
    error: null,
    processedCount: 0,
    cancelRequested: false,
  });

  logger.info(`[Optic] Created job ${jobId} for agency ${fullBrand.agencyId}`);
  return {jobId};
});

export const cancelOpticDiscoveryJob = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to cancel a job.");
  }
  const uid = request.auth.uid;
  const {jobId} = request.data as {jobId?: unknown};
  if (typeof jobId !== "string" || !jobId.trim()) {
    throw new HttpsError("invalid-argument", "jobId is required.");
  }

  const ref = db.collection("optic_jobs").doc(jobId.trim());
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Job not found.");
  }
  const d = snap.data()!;
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("permission-denied", "User profile not found.");
  }
  const u = userSnap.data()!;
  const primary = u.primaryAgencyId as string | undefined;
  const role = String(u.role ?? "");
  if (!primary || primary !== d.agencyId || !TEAM_ROLES.has(role)) {
    throw new HttpsError("permission-denied", "You cannot cancel this job.");
  }

  // Extension + MCP agent missions have no Cloud Run worker watching cancelRequested.
  // Close them out here or they stay in flight and block the next batch.
  const closeLocalRunner =
    (d.runner === "extension" || d.runner === "agent") &&
    (d.status === "queued" || d.status === "running");

  await ref.update({
    cancelRequested: true,
    ...(closeLocalRunner ?
      {status: "cancelled", workerCompletedAt: FieldValue.serverTimestamp()} :
      {}),
    updatedAt: FieldValue.serverTimestamp(),
    logs: FieldValue.arrayUnion({
      ts: Timestamp.now(),
      phase: "cancel",
      message: closeLocalRunner ? "Mission cancelled." : "Cancellation requested.",
    }),
  });
  return {ok: true as const};
});

async function loadVaultLeadForTeam(uid: string, leadId: string) {
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("failed-precondition", "User profile not found.");
  }
  const u = userSnap.data()!;
  const primary = u.primaryAgencyId as string | undefined;
  const role = String(u.role ?? "");
  if (!primary || !TEAM_ROLES.has(role)) {
    throw new HttpsError("permission-denied", "You cannot update vault leads for this brand.");
  }

  const ref = db.collection("optic_outreach_leads").doc(leadId.trim());
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Lead not found.");
  }
  const lead = snap.data()!;
  if (String(lead.agencyId ?? "") !== primary) {
    throw new HttpsError("permission-denied", "This lead belongs to another brand.");
  }
  return {ref, lead};
}

function currentLeadStage(lead: {pipelineStage?: unknown; outreachEmailed?: unknown}): OpticLeadStage {
  if (isOpticLeadStage(lead.pipelineStage)) return lead.pipelineStage;
  return lead.outreachEmailed ? "contacted" : "new";
}

/** Sets whether the team has contacted a vault lead (outreach checkmark). */
export const setOpticLeadOutreachStatus = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to update outreach status.");
  }
  const uid = request.auth.uid;
  const {leadId, emailed} = request.data as {leadId?: unknown; emailed?: unknown};
  if (typeof leadId !== "string" || !leadId.trim()) {
    throw new HttpsError("invalid-argument", "leadId is required.");
  }
  if (typeof emailed !== "boolean") {
    throw new HttpsError("invalid-argument", "emailed must be true or false.");
  }

  const {ref, lead} = await loadVaultLeadForTeam(uid, leadId);
  const stage = currentLeadStage(lead);
  const patch: Record<string, unknown> = {
    outreachEmailed: emailed,
    outreachEmailedAt: emailed ? FieldValue.serverTimestamp() : lead.outreachEmailedAt ?? null,
    outreachEmailedBy: emailed ? uid : lead.outreachEmailedBy ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (emailed) {
    patch.lastContactedAt = FieldValue.serverTimestamp();
    if (stage === "new") patch.pipelineStage = "contacted";
  } else if (stage === "contacted") {
    patch.pipelineStage = "new";
  }

  await ref.update(patch);
  return {success: true as const};
});

const CRM_NOTE_MAX = 500;

/** Updates vault CRM fields: stage, last contact, reply, pass reason, note. */
export const setOpticLeadCrm = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to update vault CRM.");
  }
  const uid = request.auth.uid;
  const {
    leadId,
    pipelineStage,
    outreachResponse,
    passReason,
    crmNote,
    touchLastContacted,
  } = request.data as {
    leadId?: unknown;
    pipelineStage?: unknown;
    outreachResponse?: unknown;
    passReason?: unknown;
    crmNote?: unknown;
    touchLastContacted?: unknown;
  };
  if (typeof leadId !== "string" || !leadId.trim()) {
    throw new HttpsError("invalid-argument", "leadId is required.");
  }

  const hasStage = pipelineStage !== undefined;
  const hasResponse = outreachResponse !== undefined;
  const hasPassReason = passReason !== undefined;
  const hasNote = crmNote !== undefined;
  const touch = touchLastContacted === true;
  if (!hasStage && !hasResponse && !hasPassReason && !hasNote && !touch) {
    throw new HttpsError("invalid-argument", "Provide a CRM field to update.");
  }
  if (hasStage && !isOpticLeadStage(pipelineStage)) {
    throw new HttpsError("invalid-argument", "Invalid pipeline stage.");
  }
  if (hasResponse && outreachResponse !== null && !isOpticLeadResponse(outreachResponse)) {
    throw new HttpsError("invalid-argument", "Invalid outreach response.");
  }
  if (hasPassReason && passReason !== null && !isOpticPassReason(passReason)) {
    throw new HttpsError("invalid-argument", "Invalid pass reason.");
  }
  if (hasNote && crmNote !== null && typeof crmNote !== "string") {
    throw new HttpsError("invalid-argument", "crmNote must be a string.");
  }

  const {ref, lead} = await loadVaultLeadForTeam(uid, leadId);
  const nextStage: OpticLeadStage = hasStage ? pipelineStage : currentLeadStage(lead);
  const patch: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    crmUpdatedBy: uid,
  };

  if (hasStage) {
    patch.pipelineStage = nextStage;
    if (nextStage === "new") {
      patch.passReason = null;
    } else if (nextStage === "passed") {
      /* keep or set pass reason below */
    } else {
      patch.passReason = null;
      patch.outreachEmailed = true;
      if (nextStage === "contacted" || !lead.lastContactedAt) {
        patch.lastContactedAt = FieldValue.serverTimestamp();
      }
    }
  }

  if (hasResponse) {
    patch.outreachResponse = outreachResponse as OpticLeadResponse | null;
  }
  if (hasPassReason) {
    patch.passReason = nextStage === "passed" ? (passReason as OpticPassReason | null) : null;
  } else if (hasStage && nextStage !== "passed") {
    patch.passReason = null;
  }
  if (hasNote) {
    const trimmed = typeof crmNote === "string" ? crmNote.trim() : "";
    if (trimmed.length > CRM_NOTE_MAX) {
      throw new HttpsError("invalid-argument", `Note must be ${CRM_NOTE_MAX} characters or fewer.`);
    }
    patch.crmNote = trimmed || null;
  }
  if (touch) {
    patch.lastContactedAt = FieldValue.serverTimestamp();
    patch.outreachEmailed = true;
    patch.outreachEmailedAt = FieldValue.serverTimestamp();
    patch.outreachEmailedBy = uid;
    if (currentLeadStage(lead) === "new" && !hasStage) {
      patch.pipelineStage = "contacted";
    }
  }

  await ref.update(patch);
  return {success: true as const};
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Updates a vault lead's contact email (manual entry when discovery did not find one). */
export const setOpticLeadEmail = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to update lead email.");
  }
  const uid = request.auth.uid;
  const {leadId, email} = request.data as {leadId?: unknown; email?: unknown};
  if (typeof leadId !== "string" || !leadId.trim()) {
    throw new HttpsError("invalid-argument", "leadId is required.");
  }
  if (typeof email !== "string") {
    throw new HttpsError("invalid-argument", "email must be a string.");
  }
  const trimmed = email.trim();
  if (trimmed && !EMAIL_RE.test(trimmed)) {
    throw new HttpsError("invalid-argument", "Enter a valid email address.");
  }

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("failed-precondition", "User profile not found.");
  }
  const u = userSnap.data()!;
  const primary = u.primaryAgencyId as string | undefined;
  const role = String(u.role ?? "");
  if (!primary || !TEAM_ROLES.has(role)) {
    throw new HttpsError("permission-denied", "You cannot update vault leads for this brand.");
  }

  const ref = db.collection("optic_outreach_leads").doc(leadId.trim());
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Lead not found.");
  }
  const lead = snap.data()!;
  if (String(lead.agencyId ?? "") !== primary) {
    throw new HttpsError("permission-denied", "This lead belongs to another brand.");
  }

  const nextEmail = trimmed || null;
  const match = recomposeMatchScoreFromLead(lead, {email: nextEmail});

  await ref.update({
    email: nextEmail,
    emailUpdatedAt: FieldValue.serverTimestamp(),
    emailUpdatedBy: uid,
    matchScore: match.matchScore,
    matchBreakdown: match.matchBreakdown,
    // Keep original matchReason; only hard-signal components move.
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {
    success: true as const,
    matchScore: match.matchScore,
    matchBreakdown: match.matchBreakdown,
    contactability: match.matchBreakdown.contact,
  };
});

function optionalProfileString(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "Expected a string field.");
  }
  const t = value.trim();
  return t ? t.slice(0, max) : null;
}

/**
 * Updates editable vault creator profile fields (name, niche, bio, followers, etc.).
 * Recalculates match score when audience/contact signals change.
 */
export const updateOpticLeadProfile = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to update creator details.");
  }
  const uid = request.auth.uid;
  const data = (request.data ?? {}) as Record<string, unknown>;
  const leadId = typeof data.leadId === "string" ? data.leadId.trim() : "";
  if (!leadId) {
    throw new HttpsError("invalid-argument", "leadId is required.");
  }

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("failed-precondition", "User profile not found.");
  }
  const u = userSnap.data()!;
  const primary = u.primaryAgencyId as string | undefined;
  const role = String(u.role ?? "");
  if (!primary || !TEAM_ROLES.has(role)) {
    throw new HttpsError("permission-denied", "You cannot update vault leads for this brand.");
  }

  const ref = db.collection("optic_outreach_leads").doc(leadId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Lead not found.");
  }
  const lead = snap.data()!;
  if (String(lead.agencyId ?? "") !== primary) {
    throw new HttpsError("permission-denied", "This lead belongs to another brand.");
  }

  const creatorName = optionalProfileString(data.creatorName, 200);
  const niche = optionalProfileString(data.niche, 200);
  const bio = optionalProfileString(data.bio, 2000);
  const followerCount = optionalProfileString(data.followerCount, 40);
  const externalUrl = optionalProfileString(data.externalUrl, 500);
  const matchReason = optionalProfileString(data.matchReason, 220);
  let platform: string | undefined;
  if (data.discoveryPlatform !== undefined) {
    if (typeof data.discoveryPlatform !== "string" || !data.discoveryPlatform.trim()) {
      throw new HttpsError("invalid-argument", "discoveryPlatform must be a platform slug.");
    }
    platform = data.discoveryPlatform.trim().toLowerCase();
    if (!OPTIC_PLATFORMS.has(platform)) {
      throw new HttpsError(
        "invalid-argument",
        `Unsupported platform. Use one of: ${[...OPTIC_PLATFORMS].join(", ")}.`
      );
    }
  }

  const hasAny =
    creatorName !== undefined ||
    niche !== undefined ||
    bio !== undefined ||
    followerCount !== undefined ||
    externalUrl !== undefined ||
    matchReason !== undefined ||
    platform !== undefined;
  if (!hasAny) {
    throw new HttpsError("invalid-argument", "Provide at least one profile field to update.");
  }

  const patch: Record<string, unknown> = {
    profileUpdatedAt: FieldValue.serverTimestamp(),
    profileUpdatedBy: uid,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (creatorName !== undefined) {
    if (!creatorName) {
      throw new HttpsError("invalid-argument", "Creator name cannot be empty.");
    }
    patch.creatorName = creatorName;
  }
  if (niche !== undefined) patch.niche = niche;
  if (matchReason !== undefined) patch.matchReason = matchReason;
  if (platform !== undefined) patch.discoveryPlatform = platform;

  let nextFollowerCount =
    typeof lead.followerCount === "string" ? lead.followerCount : null;
  let nextFollowerNumeric =
    typeof lead.followerCountNumeric === "number" ? lead.followerCountNumeric : null;
  if (followerCount !== undefined) {
    nextFollowerCount = followerCount;
    nextFollowerNumeric = parseCompactCount(followerCount);
    patch.followerCount = followerCount;
    patch.followerCountNumeric = nextFollowerNumeric;
  }

  const existingAgent: Record<string, unknown> =
    lead.agentScrape && typeof lead.agentScrape === "object"
      ? {...(lead.agentScrape as Record<string, unknown>)}
      : {};
  const existingExt: Record<string, unknown> | null =
    lead.extensionScrape && typeof lead.extensionScrape === "object"
      ? {...(lead.extensionScrape as Record<string, unknown>)}
      : null;

  let nextExternalUrl =
    (typeof existingAgent.externalUrl === "string" ? existingAgent.externalUrl : null) ??
    (typeof existingExt?.externalUrl === "string" ? existingExt.externalUrl : null);

  let scrapeTouched = false;
  if (bio !== undefined) {
    existingAgent.bio = bio;
    if (existingExt) existingExt.bio = bio;
    scrapeTouched = true;
  }
  if (externalUrl !== undefined) {
    existingAgent.externalUrl = externalUrl;
    if (existingExt) existingExt.externalUrl = externalUrl;
    nextExternalUrl = externalUrl;
    scrapeTouched = true;
  }
  if (scrapeTouched) {
    patch.agentScrape = existingAgent;
    if (existingExt) patch.extensionScrape = existingExt;
  }

  const match = recomposeMatchScoreFromLead(
    {
      ...lead,
      followerCount: nextFollowerCount,
      followerCountNumeric: nextFollowerNumeric,
      matchReason:
        matchReason !== undefined
          ? matchReason
          : typeof lead.matchReason === "string"
            ? lead.matchReason
            : null,
      agentScrape: {
        externalUrl: nextExternalUrl,
        postCount:
          typeof existingAgent.postCount === "string" ? existingAgent.postCount : null,
      },
      extensionScrape: existingExt
        ? {
            externalUrl:
              typeof existingExt.externalUrl === "string"
                ? existingExt.externalUrl
                : nextExternalUrl,
            postCount:
              typeof existingExt.postCount === "string" ? existingExt.postCount : null,
          }
        : lead.extensionScrape ?? null,
    },
    {externalUrl: nextExternalUrl}
  );
  patch.matchScore = match.matchScore;
  patch.matchBreakdown = match.matchBreakdown;

  await ref.update(patch);
  return {
    success: true as const,
    matchScore: match.matchScore,
    matchBreakdown: match.matchBreakdown,
  };
});

/**
 * Regenerates an HTML email outreach draft for a vault lead that now has a contact email.
 * Clears the DM draft when switching to email outreach.
 */
export const regenerateOpticLeadDraft = onCall(
  {region: "us-central1", timeoutSeconds: 120},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to regenerate outreach.");
    }
    const uid = request.auth.uid;
    const {leadId} = request.data as {leadId?: unknown};
    if (typeof leadId !== "string" || !leadId.trim()) {
      throw new HttpsError("invalid-argument", "leadId is required.");
    }

    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) {
      throw new HttpsError("failed-precondition", "User profile not found.");
    }
    const u = userSnap.data()!;
    const primary = u.primaryAgencyId as string | undefined;
    const role = String(u.role ?? "");
    if (!primary || !TEAM_ROLES.has(role)) {
      throw new HttpsError(
        "permission-denied",
        "You cannot regenerate drafts for this brand."
      );
    }

    const ref = db.collection("optic_outreach_leads").doc(leadId.trim());
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Lead not found.");
    }
    const lead = snap.data()!;
    if (String(lead.agencyId ?? "") !== primary) {
      throw new HttpsError("permission-denied", "This lead belongs to another brand.");
    }

    const email =
      typeof lead.email === "string" && lead.email.trim() ? lead.email.trim() : "";
    if (!email || !EMAIL_RE.test(email)) {
      throw new HttpsError(
        "failed-precondition",
        "Add a valid contact email before regenerating an email draft."
      );
    }

    const campaignId =
      typeof lead.campaignId === "string" && lead.campaignId.trim()
        ? lead.campaignId.trim()
        : undefined;
    let brand: OpticJobBrandContext | null = null;
    try {
      const full = await loadAgencyBrandContextForUid(uid, {campaignId});
      brand = toJobBrandContext(full);
    } catch (e) {
      logger.warn("[Optic] Draft regen brand context failed", {
        uid,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    const scrape =
      (lead.agentScrape && typeof lead.agentScrape === "object"
        ? (lead.agentScrape as Record<string, unknown>)
        : null) ||
      (lead.extensionScrape && typeof lead.extensionScrape === "object"
        ? (lead.extensionScrape as Record<string, unknown>)
        : null);
    const bio =
      typeof scrape?.bio === "string"
        ? scrape.bio
        : typeof lead.bio === "string"
          ? lead.bio
          : null;
    const externalUrl =
      typeof scrape?.externalUrl === "string" ? scrape.externalUrl : null;

    const drafts = await regenerateVaultEmailDraft(
      {
        creatorName:
          typeof lead.creatorName === "string" && lead.creatorName.trim()
            ? lead.creatorName
            : "Creator",
        platform:
          typeof lead.discoveryPlatform === "string"
            ? lead.discoveryPlatform
            : "instagram",
        email,
        niche: typeof lead.niche === "string" ? lead.niche : null,
        bio,
        followerCount:
          typeof lead.followerCount === "string" ? lead.followerCount : null,
        externalUrl,
        profileUrl: typeof lead.profileUrl === "string" ? lead.profileUrl : null,
        matchReason: typeof lead.matchReason === "string" ? lead.matchReason : null,
        objectives:
          typeof lead.campaignTitle === "string" && lead.campaignTitle.trim()
            ? `Campaign: ${lead.campaignTitle}`
            : null,
      },
      brand
    );

    // Also refresh contactability now that email is confirmed on the lead.
    const match = recomposeMatchScoreFromLead(lead, {email});

    await ref.update({
      draftEmail: drafts.draftEmail,
      draftEmailSubject: drafts.draftEmailSubject,
      draftDm: null,
      draftUpdatedBy: uid,
      draftUpdatedAt: FieldValue.serverTimestamp(),
      draftRegeneratedAt: FieldValue.serverTimestamp(),
      matchScore: match.matchScore,
      matchBreakdown: match.matchBreakdown,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true as const,
      draftEmail: drafts.draftEmail,
      draftEmailSubject: drafts.draftEmailSubject,
      matchScore: match.matchScore,
      matchBreakdown: match.matchBreakdown,
    };
  }
);

const DRAFT_SUBJECT_MAX = 200;
const DRAFT_BODY_MAX = 8000;

/** Updates the vault outreach draft (email subject/body or platform DM) before send. */
export const setOpticLeadOutreachDraft = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to edit outreach.");
  }
  const uid = request.auth.uid;
  const {leadId, draftEmail, draftEmailSubject, draftDm} = request.data as {
    leadId?: unknown;
    draftEmail?: unknown;
    draftEmailSubject?: unknown;
    draftDm?: unknown;
  };
  if (typeof leadId !== "string" || !leadId.trim()) {
    throw new HttpsError("invalid-argument", "leadId is required.");
  }
  const hasEmail = draftEmail !== undefined;
  const hasSubject = draftEmailSubject !== undefined;
  const hasDm = draftDm !== undefined;
  if (!hasEmail && !hasSubject && !hasDm) {
    throw new HttpsError("invalid-argument", "Provide a draft field to update.");
  }

  const patch: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    draftUpdatedBy: uid,
    draftUpdatedAt: FieldValue.serverTimestamp(),
  };
  if (hasEmail) {
    if (typeof draftEmail !== "string") {
      throw new HttpsError("invalid-argument", "draftEmail must be a string.");
    }
    const body = sanitizeStoredEmailDraft(draftEmail);
    if (!body || isEmailDraftEmpty(body)) {
      throw new HttpsError("invalid-argument", "Email body cannot be empty.");
    }
    if (body.length > DRAFT_BODY_MAX) {
      throw new HttpsError("invalid-argument", `Email must be ${DRAFT_BODY_MAX} characters or fewer.`);
    }
    patch.draftEmail = body;
  }
  if (hasSubject) {
    if (typeof draftEmailSubject !== "string") {
      throw new HttpsError("invalid-argument", "draftEmailSubject must be a string.");
    }
    const subject = draftEmailSubject.trim();
    if (subject.length > DRAFT_SUBJECT_MAX) {
      throw new HttpsError("invalid-argument", `Subject must be ${DRAFT_SUBJECT_MAX} characters or fewer.`);
    }
    patch.draftEmailSubject = subject || null;
  }
  if (hasDm) {
    if (typeof draftDm !== "string") {
      throw new HttpsError("invalid-argument", "draftDm must be a string.");
    }
    const dm = draftDm.trim();
    if (!dm) {
      throw new HttpsError("invalid-argument", "DM cannot be empty.");
    }
    if (dm.length > DRAFT_BODY_MAX) {
      throw new HttpsError("invalid-argument", `DM must be ${DRAFT_BODY_MAX} characters or fewer.`);
    }
    patch.draftDm = dm;
  }

  const {ref} = await loadVaultLeadForTeam(uid, leadId);
  await ref.update(patch);
  return {success: true as const};
});

/** Saves mobile number and SMS opt-in for batch-complete texts. */
export const setOpticSmsSettings = onCall(
  {secrets: []},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to update text settings.");
    }
    const uid = request.auth.uid;
    await assertAgencyTeam(uid);
    const {phone, enabled} = request.data as {phone?: unknown; enabled?: unknown};
    if (typeof enabled !== "boolean") {
      throw new HttpsError("invalid-argument", "enabled must be true or false.");
    }
    const updates: Record<string, unknown> = {
      opticSmsEnabled: enabled,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (typeof phone === "string" && phone.trim()) {
      const normalized = normalizeSmsPhone(phone);
      if (!normalized) {
        throw new HttpsError("invalid-argument", "Enter a valid mobile number.");
      }
      updates.opticSmsPhone = normalized;
    } else if (enabled) {
      const userSnap = await db.collection("users").doc(uid).get();
      const existing = userSnap.data()?.opticSmsPhone;
      if (typeof existing !== "string" || !existing.trim()) {
        throw new HttpsError("invalid-argument", "Phone is required when enabling texts.");
      }
    }
    await db.collection("users").doc(uid).update(updates);
    return {success: true as const};
  }
);

/** Starts the next batch (same brief) without waiting for SMS. */
export const continueOpticDiscoveryJob = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to continue a mission.");
  }
  const uid = request.auth.uid;
  await assertAgencyTeam(uid);
  const {fromJobId} = request.data as {fromJobId?: unknown};
  const {jobId, runner} = await continueMissionForUid(
    uid,
    typeof fromJobId === "string" ? fromJobId : undefined
  );
  return {jobId, runner};
});
