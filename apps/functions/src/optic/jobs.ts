import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import {loadAgencyBrandContextForUid, type AgencyBrandContext} from "./agencyContext";
import {
  OPTIC_DEFAULT_AUDIENCE_TIER,
  OPTIC_DEFAULT_BATCH_SIZE,
  OPTIC_MAX_BATCH_SIZE,
  OPTIC_PLATFORMS,
  isOpticAudienceTier,
} from "./constants";
import {continueMissionForUid} from "./continuation";
import {assertSufficientOpticCredits} from "./credits";
import {normalizeSmsPhone} from "./twilio";

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
      "platform must be one of: youtube, instagram, tiktok, facebook, twitch."
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
    platform === "instagram" && useBrowserExtension === true;

  // Only the extension runner enforces size bands today, so a tier on a worker
  // mission would be a promise we do not keep.
  const tier =
    wantsExtension && isOpticAudienceTier(audienceTier) ?
      audienceTier :
      OPTIC_DEFAULT_AUDIENCE_TIER;

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
          ? "Mission queued — open Instagram in Chrome with the Optic extension installed."
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

  // A queued extension job is only ever claimed by an explicit browser hand-off, so
  // no runner will observe cancelRequested. Close it out here or it stays in flight
  // forever and blocks the next batch.
  const abandonedExtensionJob = d.status === "queued" && d.runner === "extension";

  await ref.update({
    cancelRequested: true,
    ...(abandonedExtensionJob ?
      {status: "cancelled", workerCompletedAt: FieldValue.serverTimestamp()} :
      {}),
    updatedAt: FieldValue.serverTimestamp(),
    logs: FieldValue.arrayUnion({
      ts: Timestamp.now(),
      phase: "cancel",
      message: abandonedExtensionJob ? "Mission cancelled." : "Cancellation requested.",
    }),
  });
  return {ok: true as const};
});

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

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("failed-precondition", "User profile not found.");
  }
  const u = userSnap.data()!;
  const primary = u.primaryAgencyId as string | undefined;
  const role = String(u.role ?? "");
  if (!primary || !TEAM_ROLES.has(role)) {
    throw new HttpsError("permission-denied", "You cannot update vault outreach for this brand.");
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
    outreachEmailed: emailed,
    outreachEmailedAt: emailed ? FieldValue.serverTimestamp() : null,
    outreachEmailedBy: emailed ? uid : null,
    updatedAt: FieldValue.serverTimestamp(),
  });
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
