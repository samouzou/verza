import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import {loadAgencyOpticBilling, chargeOpticPilotTopUpBlock} from "./billing";
import {
  enrichExtensionInstagramLead,
  planInstagramExtensionSearch,
  type ExtensionProfileInput,
} from "./extensionLead";
import type {OpticJobBrandContext} from "./jobs";
import {instagramProfileUrl, normalizeProfileUrl} from "./profileUrl";
import {saveLeadWithOpticCreditCharge} from "./saveLead";

const TEAM_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);

type JobDoc = {
  uid: string;
  agencyId: string;
  agencyName: string;
  platform: string;
  objectives: string;
  maxProfiles: number;
  status: string;
  runner?: string;
  campaignId?: string | null;
  brandContext?: OpticJobBrandContext | null;
  cancelRequested?: boolean;
  processedCount?: number;
};

async function assertJobAccess(uid: string, jobId: string): Promise<JobDoc & {id: string}> {
  const ref = db.collection("optic_jobs").doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Job not found.");
  }
  const job = snap.data() as JobDoc;
  if (job.uid !== uid) {
    throw new HttpsError("permission-denied", "Not your mission.");
  }
  if (job.runner !== "extension") {
    throw new HttpsError("failed-precondition", "This mission is not configured for the browser extension.");
  }
  const userSnap = await db.collection("users").doc(uid).get();
  const role = String(userSnap.data()?.role ?? "");
  if (!TEAM_ROLES.has(role)) {
    throw new HttpsError("permission-denied", "Optic requires a brand team account.");
  }
  return {id: snap.id, ...job};
}

async function appendJobLog(jobId: string, phase: string, message: string) {
  await db.collection("optic_jobs").doc(jobId).update({
    logs: FieldValue.arrayUnion({ts: Timestamp.now(), phase, message}),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/** Extension claims an Instagram mission and receives the search plan. */
export const claimOpticExtensionJob = onCall(async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const {jobId} = request.data as {jobId?: unknown};
    if (typeof jobId !== "string" || !jobId.trim()) {
      throw new HttpsError("invalid-argument", "jobId is required.");
    }

    const job = await assertJobAccess(request.auth.uid, jobId.trim());
    if (job.platform !== "instagram") {
      throw new HttpsError("failed-precondition", "Browser extension missions are Instagram-only for now.");
    }
    if (job.status !== "queued" && job.status !== "running") {
      throw new HttpsError("failed-precondition", `Mission is ${job.status}.`);
    }

    const ref = db.collection("optic_jobs").doc(job.id);
    if (job.status === "queued") {
      await ref.update({
        status: "running",
        workerStartedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        logs: FieldValue.arrayUnion({
          ts: Timestamp.now(),
          phase: "extension",
          message: "Chrome extension connected — searching Instagram in your browser.",
        }),
      });
    }

    const plan = await planInstagramExtensionSearch(
      job.objectives,
      job.agencyName,
      job.brandContext ?? null,
      job.maxProfiles
    );

    const seedProfileUrls = plan.seedProfiles.map((s) => instagramProfileUrl(s.username));
    const hashtag = plan.hashtags[0] ?? "creators";
    const searchQuery = plan.searchQueries[0] ?? job.objectives.trim().slice(0, 80);

    logger.info("[Optic extension] Claimed job", {
      jobId: job.id,
      summary: plan.summary,
      hashtags: plan.hashtags,
      searchQueries: plan.searchQueries,
      seedCount: seedProfileUrls.length,
    });

    await ref.update({
      extensionProgress: {
        phase: "prepare",
        message: plan.summary,
        discovered: 0,
        target: job.maxProfiles,
        hashtag,
        searchQuery,
        searchSummary: plan.summary,
        hashtags: plan.hashtags,
        searchQueries: plan.searchQueries,
        updatedAt: FieldValue.serverTimestamp(),
      },
    });

    await appendJobLog(
      job.id,
      "extension",
      `Search plan: ${plan.summary} · ${plan.hashtags.map((h) => `#${h}`).join(", ")} · “${plan.searchQueries.join("”, “")}”.`
    );

    return {
      jobId: job.id,
      platform: job.platform,
      objectives: job.objectives,
      maxProfiles: job.maxProfiles,
      agencyId: job.agencyId,
      agencyName: job.agencyName,
      campaignId: job.campaignId ?? null,
      hashtag,
      searchQuery,
      hashtags: plan.hashtags,
      searchQueries: plan.searchQueries,
      searchSummary: plan.summary,
      seedProfileUrls,
      processedCount: job.processedCount ?? 0,
    };
  }
);

const EXTENSION_PROGRESS_PHASES = new Set([
  "prepare",
  "seeds",
  "hashtag",
  "keyword",
  "posts",
  "profiles",
  "done",
]);

/** Extension reports live browsing progress to the Optic mission doc. */
export const reportOpticExtensionProgress = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const {jobId, phase, message, discovered, target, logMessage} = request.data as {
    jobId?: unknown;
    phase?: unknown;
    message?: unknown;
    discovered?: unknown;
    target?: unknown;
    logMessage?: unknown;
  };

  if (typeof jobId !== "string" || !jobId.trim()) {
    throw new HttpsError("invalid-argument", "jobId is required.");
  }
  if (typeof phase !== "string" || !EXTENSION_PROGRESS_PHASES.has(phase)) {
    throw new HttpsError("invalid-argument", "Invalid progress phase.");
  }
  if (typeof message !== "string" || !message.trim()) {
    throw new HttpsError("invalid-argument", "message is required.");
  }

  const job = await assertJobAccess(request.auth.uid, jobId.trim());
  const ref = db.collection("optic_jobs").doc(job.id);
  const snap = await ref.get();
  const prevProgress = snap.data()?.extensionProgress as {
    hashtag?: string;
    searchQuery?: string;
  } | undefined;

  const progress = {
    phase,
    message: message.trim().slice(0, 500),
    discovered: typeof discovered === "number" && Number.isFinite(discovered) ? Math.max(0, discovered) : undefined,
    target: typeof target === "number" && Number.isFinite(target) ? Math.max(1, target) : job.maxProfiles,
    hashtag: prevProgress?.hashtag,
    searchQuery: prevProgress?.searchQuery,
    updatedAt: FieldValue.serverTimestamp(),
  };

  const update: Record<string, unknown> = {
    extensionProgress: progress,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (typeof logMessage === "string" && logMessage.trim()) {
    update.logs = FieldValue.arrayUnion({
      ts: Timestamp.now(),
      phase: "extension",
      message: logMessage.trim().slice(0, 500),
    });
  }

  await ref.update(update);
  return {ok: true as const};
});

/** Extension submits a scraped Instagram profile as a vault lead. */
export const submitOpticExtensionLead = onCall(async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const {jobId, profile} = request.data as {
      jobId?: unknown;
      profile?: ExtensionProfileInput;
    };
    if (typeof jobId !== "string" || !jobId.trim()) {
      throw new HttpsError("invalid-argument", "jobId is required.");
    }
    if (!profile || typeof profile.username !== "string" || !profile.username.trim()) {
      throw new HttpsError("invalid-argument", "profile.username is required.");
    }

    const job = await assertJobAccess(request.auth.uid, jobId.trim());
    const jobRef = db.collection("optic_jobs").doc(job.id);
    const latest = await jobRef.get();
    if (latest.data()?.cancelRequested) {
      return {ok: false as const, reason: "cancelled" as const};
    }

    const profileUrl = instagramProfileUrl(profile.username);
    const enriched = await enrichExtensionInstagramLead(
      profile,
      job.objectives,
      job.brandContext ?? null
    );

    let billing = await loadAgencyOpticBilling(job.agencyId);
    const payTitle = job.brandContext?.paySourceCampaignTitle?.trim() || null;
    const leadPayload = {
      ...enriched,
      discoveryPlatform: job.platform,
      profileUrl,
      createdAt: FieldValue.serverTimestamp(),
      source: "Verza Optic (Chrome extension)",
      agencyId: job.agencyId,
      agencyName: job.agencyName,
      campaignId: job.campaignId ?? null,
      campaignTitle: payTitle,
      extensionScrape: {
        username: profile.username,
        bio: profile.bio ?? null,
        externalUrl: profile.externalUrl ?? null,
      },
    };

    let saveResult = await saveLeadWithOpticCreditCharge({
      db,
      jobId: job.id,
      agencyId: job.agencyId,
      profileUrl,
      leadData: leadPayload,
      billing,
    });

    if (!saveResult.ok && saveResult.reason === "needs_top_up") {
      const topUp = await chargeOpticPilotTopUpBlock(job.agencyId);
      if (topUp.ok) {
        billing = await loadAgencyOpticBilling(job.agencyId);
        await appendJobLog(job.id, "extension", "Pilot auto top-up applied.");
        saveResult = await saveLeadWithOpticCreditCharge({
          db,
          jobId: job.id,
          agencyId: job.agencyId,
          profileUrl,
          leadData: leadPayload,
          billing,
        });
      }
    }

    if (!saveResult.ok) {
      await appendJobLog(job.id, "extension", "Stopped — insufficient Optic credits.");
      return {ok: false as const, reason: saveResult.reason};
    }

    const processed = (latest.data()?.processedCount ?? 0) + 1;
    await jobRef.update({
      processedCount: processed,
      updatedAt: FieldValue.serverTimestamp(),
      logs: FieldValue.arrayUnion({
        ts: Timestamp.now(),
        phase: "extension",
        message: `Saved @${profile.username.replace(/^@/, "")} (${enriched.followerCount} followers).`,
      }),
    });

    return {
      ok: true as const,
      leadId: saveResult.leadId,
      processedCount: processed,
      profileUrl: normalizeProfileUrl(profileUrl),
    };
  }
);

/** Extension marks a mission complete or failed. */
export const completeOpticExtensionJob = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const {jobId, status, error} = request.data as {
    jobId?: unknown;
    status?: unknown;
    error?: unknown;
  };
  if (typeof jobId !== "string" || !jobId.trim()) {
    throw new HttpsError("invalid-argument", "jobId is required.");
  }
  if (status !== "completed" && status !== "failed" && status !== "cancelled") {
    throw new HttpsError("invalid-argument", "status must be completed, failed, or cancelled.");
  }

  const job = await assertJobAccess(request.auth.uid, jobId.trim());
  const ref = db.collection("optic_jobs").doc(job.id);
  const snap = await ref.get();
  const processed = snap.data()?.processedCount ?? 0;
  const target = job.maxProfiles;
  const cancelled = status === "cancelled" || Boolean(snap.data()?.cancelRequested);

  const message =
    status === "failed"
      ? `Extension error: ${typeof error === "string" ? error.slice(0, 400) : "Unknown error"}`
      : cancelled
        ? "Mission cancelled."
        : `Done — saved ${processed} of ${target} creators.`;

  await ref.update({
    status: cancelled ? "cancelled" : status,
    error: status === "failed" && typeof error === "string" ? error.slice(0, 2000) : null,
    workerCompletedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    logs: FieldValue.arrayUnion({
      ts: Timestamp.now(),
      phase: status === "failed" ? "error" : "done",
      message,
    }),
  });

  return {ok: true as const, processedCount: processed};
});
