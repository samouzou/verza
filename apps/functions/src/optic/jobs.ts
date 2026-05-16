import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import {loadAgencyBrandContextForUid, type AgencyBrandContext} from "./agencyContext";

const PLATFORMS = new Set(["youtube", "instagram", "tiktok"]);
const TEAM_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);

export type OpticJobBrandContext = Pick<
  AgencyBrandContext,
  "agencyName" | "brandSummary" | "userDisplayName" | "campaignPaySummary" | "paySourceCampaignTitle"
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

  const {platform, objectives, maxProfiles, campaignId} = request.data as {
    platform?: unknown;
    objectives?: unknown;
    maxProfiles?: unknown;
    campaignId?: unknown;
  };

  if (typeof platform !== "string" || !PLATFORMS.has(platform)) {
    throw new HttpsError(
      "invalid-argument",
      "platform must be one of: youtube, instagram, tiktok."
    );
  }
  if (typeof objectives !== "string" || !objectives.trim()) {
    throw new HttpsError("invalid-argument", "objectives is required.");
  }

  let mp = 5;
  if (typeof maxProfiles === "number" && Number.isFinite(maxProfiles)) {
    // Keep in sync with apps/optic-worker/src/limits.ts OPTIC_MAX_SAVED_PER_RUN
    mp = Math.max(1, Math.min(75, Math.floor(maxProfiles)));
  }

  const campaignIdStr =
    typeof campaignId === "string" && campaignId.trim() ? campaignId.trim() : null;

  let fullBrand: AgencyBrandContext;
  try {
    fullBrand = await loadAgencyBrandContextForUid(uid, {campaignId: campaignIdStr});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HttpsError("failed-precondition", msg);
  }

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
    logs: [
      {
        ts: Timestamp.now(),
        phase: "enqueue",
        message: "Mission queued. Your scout will start as soon as the system is ready.",
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

  await ref.update({
    cancelRequested: true,
    updatedAt: FieldValue.serverTimestamp(),
    logs: FieldValue.arrayUnion({
      ts: Timestamp.now(),
      phase: "cancel",
      message: "Cancellation requested.",
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
