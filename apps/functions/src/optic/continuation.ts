import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {db} from "../config/firebase";
import {assertSufficientOpticCredits} from "./credits";
import {
  OPTIC_DEFAULT_AUDIENCE_TIER,
  OPTIC_DEFAULT_BATCH_SIZE,
  OPTIC_MAX_BATCH_SIZE,
} from "./constants";
type OpticJobBrandContext = {
  agencyName: string;
  brandSummary: string | null;
  userDisplayName: string | null;
  campaignPaySummary: string | null;
  paySourceCampaignTitle: string | null;
  paySourceCampaignType?: string | null;
};

const TEAM_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);

type SourceJob = {
  uid: string;
  agencyId: string;
  agencyName: string;
  platform: string;
  objectives: string;
  maxProfiles: number;
  status?: string;
  runner?: string | null;
  campaignId?: string | null;
  brandContext?: OpticJobBrandContext | null;
  audienceTier?: string | null;
  batchIndex?: number;
  rootJobId?: string | null;
};

/**
 * Finds a user by E.164 phone stored on their profile.
 * @param {string} phoneE164 Normalized phone number.
 * @return {Promise<?string>} User id or null.
 */
export async function findUidByOpticSmsPhone(phoneE164: string): Promise<string | null> {
  const snap = await db
    .collection("users")
    .where("opticSmsPhone", "==", phoneE164)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

export type SmsCommand = "continue" | "stop" | "help" | "unknown";

/**
 * Parses inbound SMS body for continuation commands.
 * @param {string} body Raw SMS text.
 * @return {SmsCommand} Parsed command.
 */
export function parseSmsCommand(body: string): SmsCommand {
  const t = body.trim().toUpperCase();
  if (/^(STOP|UNSUBSCRIBE|CANCEL|END)$/.test(t)) return "stop";
  if (/^(HELP|INFO)$/.test(t)) return "help";
  if (/^(CONTINUE|YES|MORE|NEXT|GO)$/.test(t)) return "continue";
  return "unknown";
}

/**
 * Creates the next queued batch from a completed (or any) source job.
 * @param {object} source Parent mission snapshot.
 * @param {object=} opts Optional smsNotify and fromJobId.
 * @return {Promise<string>} New job id.
 */
export async function enqueueOpticContinuationJob(
  source: SourceJob,
  opts?: {smsNotify?: boolean; fromJobId?: string}
): Promise<string> {
  const batchIndex = (source.batchIndex ?? 1) + 1;
  const rootJobId = source.rootJobId ?? null;
  const maxProfiles = Math.min(
    OPTIC_MAX_BATCH_SIZE,
    Math.max(1, source.maxProfiles || OPTIC_DEFAULT_BATCH_SIZE)
  );

  await assertSufficientOpticCredits(source.agencyId, maxProfiles);

  const jobRef = db.collection("optic_jobs").doc();
  await jobRef.set({
    status: "queued",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    uid: source.uid,
    agencyId: source.agencyId,
    agencyName: source.agencyName,
    platform: source.platform,
    objectives: source.objectives,
    maxProfiles,
    campaignId: source.campaignId ?? null,
    brandContext: source.brandContext ?? null,
    // Losing this would make batch 2 silently ignore the size band picked for batch 1.
    audienceTier: source.audienceTier ?? OPTIC_DEFAULT_AUDIENCE_TIER,
    batchIndex,
    rootJobId: rootJobId || jobRef.id,
    continuedFromJobId: opts?.fromJobId ?? null,
    smsNotify: opts?.smsNotify ?? true,
    runner: source.runner === "extension" ? "extension" : "worker",
    logs: [
      {
        ts: Timestamp.now(),
        phase: "enqueue",
        message: `Batch ${batchIndex} queued. Your scout will pick up shortly.`,
      },
    ],
    error: null,
    processedCount: 0,
    cancelRequested: false,
  });
  return jobRef.id;
}

/**
 * Loads the latest completed job for continuation (same mission chain).
 * @param {string} uid Firebase Auth user id.
 * @return {Promise<object>} Latest continuable job including id.
 */
export async function loadLatestContinuableJob(uid: string): Promise<SourceJob & {id: string}> {
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("failed-precondition", "User profile not found.");
  }
  const user = userSnap.data()!;
  const role = String(user.role ?? "");
  const primary = user.primaryAgencyId as string | undefined;
  if (!primary || !TEAM_ROLES.has(role)) {
    throw new HttpsError("permission-denied", "Optic continuation requires a brand team account.");
  }

  // Query by uid only (mirrors how the completion SMS recipient is resolved in
  // onJobUpdated.ts). Filtering additionally by agencyId here caused false
  // "no completed mission" replies whenever a job's stored agencyId no longer
  // matched the user's current primaryAgencyId (e.g. continuation chains or a
  // changed primary agency).
  const snap = await db
    .collection("optic_jobs")
    .where("uid", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(15)
    .get();

  const completed = snap.docs.find((d) => d.data().status === "completed");
  if (!completed) {
    throw new HttpsError("failed-precondition", "No completed mission to continue yet.");
  }
  const data = completed.data() as SourceJob;
  return {id: completed.id, ...data};
}

/**
 * Throws if the user already has a queued or running Optic job.
 * @param {string} uid Firebase Auth user id.
 * @return {Promise<void>}
 */
async function assertNoInFlightOpticJob(uid: string): Promise<void> {
  const recent = await db
    .collection("optic_jobs")
    .where("uid", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(5)
    .get();
  const busy = recent.docs.some((d) => {
    const s = String(d.data().status ?? "");
    return s === "queued" || s === "running";
  });
  if (busy) {
    throw new HttpsError("failed-precondition", "A batch is already running. Wait for it to finish.");
  }
}

/**
 * Callable path: continue from explicit job id or latest completed.
 * @param {string} uid Firebase Auth user id.
 * @param {string=} fromJobId Optional completed job to chain from.
 * @return {Promise<object>} New job id and the runner the caller must drive.
 */
export async function continueMissionForUid(
  uid: string,
  fromJobId?: string
): Promise<{jobId: string; runner: "extension" | "worker"}> {
  await assertNoInFlightOpticJob(uid);
  let source: SourceJob & {id: string};
  if (fromJobId?.trim()) {
    const snap = await db.collection("optic_jobs").doc(fromJobId.trim()).get();
    if (!snap.exists) throw new HttpsError("not-found", "Mission not found.");
    const data = snap.data() as SourceJob;
    if (data.uid !== uid) throw new HttpsError("permission-denied", "Not your mission.");
    if (data.status !== "completed") {
      throw new HttpsError("failed-precondition", "Wait for the current batch to finish first.");
    }
    source = {id: snap.id, ...data};
  } else {
    source = await loadLatestContinuableJob(uid);
  }
  const jobId = await enqueueOpticContinuationJob(source, {smsNotify: true, fromJobId: source.id});
  return {jobId, runner: source.runner === "extension" ? "extension" : "worker"};
}
