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

  await ref.update({
    email: trimmed || null,
    emailUpdatedAt: FieldValue.serverTimestamp(),
    emailUpdatedBy: uid,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {success: true as const};
});

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
