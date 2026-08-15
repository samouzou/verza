import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import {loadAgencyOpticBilling, chargeOpticPilotTopUpBlock} from "./billing";
import {
  OPTIC_AUDIENCE_TIERS,
  OPTIC_DEFAULT_AUDIENCE_TIER,
  OPTIC_MIN_POST_COUNT,
  isOpticAudienceTier,
  opticPoolMultiplier,
  type OpticAudienceTier,
} from "./constants";
import {persistOpticAvatar} from "./avatar";
import {checkAudienceGate, parseCompactCount} from "./counts";
import {composeMatchScore} from "./matchScore";
import {
  enrichExtensionInstagramLead,
  planInstagramExtensionSearch,
  type ExtensionProfileInput,
} from "./extensionLead";
import type {OpticJobBrandContext} from "./jobs";
import {instagramProfileUrl, normalizeProfileUrl} from "./profileUrl";
import {saveLeadWithOpticCreditCharge} from "./saveLead";
import {loadVaultExclusions, vaultHasProfileUrl} from "./vaultDedup";

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
  batchIndex?: number;
  audienceTier?: string | null;
};

/** Jobs created before audience tiers existed fall back to the unbounded default. */
function jobAudienceTier(job: JobDoc): OpticAudienceTier {
  return isOpticAudienceTier(job.audienceTier) ? job.audienceTier : OPTIC_DEFAULT_AUDIENCE_TIER;
}

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
    throw new HttpsError(
      "failed-precondition",
      "This mission isn't set up to run in your browser. Start a new one from Optic."
    );
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
      throw new HttpsError(
        "failed-precondition",
        "Searching from your browser only works for Instagram right now."
      );
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
          message: "Connected to Chrome — starting your Instagram search.",
        }),
      });
    }

    // Later batches must not re-surface creators already in the vault, otherwise the
    // extension re-scrapes the same profiles and each one is charged again.
    const exclusions = await loadVaultExclusions(
      db,
      job.agencyId,
      job.campaignId?.trim() || null
    );

    const tier = jobAudienceTier(job);
    const bounds = OPTIC_AUDIENCE_TIERS[tier];

    const plan = await planInstagramExtensionSearch(
      job.objectives,
      job.agencyName,
      job.brandContext ?? null,
      job.maxProfiles,
      exclusions.plannerUsernames,
      bounds.label
    );

    const seedProfileUrls = plan.seedProfiles
      .map((s) => instagramProfileUrl(s.username))
      .filter((url) => !exclusions.keys.has(normalizeProfileUrl(url)));
    const hashtag = plan.hashtags[0] ?? "creators";
    const searchQuery = plan.searchQueries[0] ?? job.objectives.trim().slice(0, 80);

    logger.info("[Optic extension] Claimed job", {
      jobId: job.id,
      batchIndex: job.batchIndex ?? 1,
      summary: plan.summary,
      hashtags: plan.hashtags,
      searchQueries: plan.searchQueries,
      seedCount: seedProfileUrls.length,
      excludedCount: exclusions.keys.size,
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
      `Where we're looking: ${plan.summary} · ${plan.hashtags.map((h) => `#${h}`).join(", ")} · “${plan.searchQueries.join("”, “")}”.`
    );

    if (exclusions.keys.size > 0) {
      await appendJobLog(
        job.id,
        "extension",
        `Skipping ${exclusions.keys.size} creator${exclusions.keys.size === 1 ? "" : "s"} already in your vault.`
      );
    }

    if (tier !== "any") {
      await appendJobLog(job.id, "extension", `Only looking for ${bounds.label} creators.`);
    }

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
      excludeUsernames: exclusions.usernames,
      audienceFilter: {
        minFollowers: bounds.min,
        maxFollowers: bounds.max,
        minPostCount: OPTIC_MIN_POST_COUNT,
        poolMultiplier: opticPoolMultiplier(tier),
      },
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

    // Credit charges are keyed per job, so without this a later batch would save the
    // same creator again and bill for them again.
    if (await vaultHasProfileUrl(db, job.agencyId, profileUrl)) {
      return {ok: false as const, reason: "duplicate" as const};
    }

    // Authoritative gate: the extension filters too, but enforcing here means a stale
    // extension build still cannot spend a credit on an out-of-band or dead account.
    const gate = checkAudienceGate(profile, jobAudienceTier(job));
    if (!gate.ok) {
      logger.info("[Optic extension] Filtered profile", {
        jobId: job.id,
        username: profile.username,
        reason: gate.reason,
      });
      return {ok: false as const, reason: "filtered" as const, detail: gate.reason};
    }

    const enriched = await enrichExtensionInstagramLead(
      profile,
      job.objectives,
      job.brandContext ?? null
    );

    const followerCountNumeric = parseCompactCount(enriched.followerCount);
    const postCountNumeric = parseCompactCount(profile.postCount);
    const match = composeMatchScore({
      briefFitScore: enriched.briefFitScore,
      matchReason: enriched.matchReason,
      followerCount: followerCountNumeric,
      postCount: postCountNumeric,
      email: enriched.email,
      externalUrl: profile.externalUrl,
      audienceTier: jobAudienceTier(job),
    });

    const avatarDataUrl =
      typeof profile.avatarDataUrl === "string" ? profile.avatarDataUrl : null;
    const avatarSourceUrl =
      typeof profile.avatarUrl === "string" ? profile.avatarUrl : null;
    const avatarUrl = await persistOpticAvatar({
      agencyId: job.agencyId,
      profileUrl,
      avatarDataUrl,
      avatarSourceUrl,
    });

    let billing = await loadAgencyOpticBilling(job.agencyId);
    const payTitle = job.brandContext?.paySourceCampaignTitle?.trim() || null;
    const {briefFitScore: _briefFit, matchReason: _reason, ...enrichmentFields} = enriched;
    const leadPayload = {
      ...enrichmentFields,
      matchScore: match.matchScore,
      matchReason: match.matchReason,
      matchBreakdown: match.matchBreakdown,
      avatarUrl: avatarUrl ?? null,
      discoveryPlatform: job.platform,
      profileUrl,
      createdAt: FieldValue.serverTimestamp(),
      source: "Verza Optic (Chrome extension)",
      agencyId: job.agencyId,
      agencyName: job.agencyName,
      campaignId: job.campaignId ?? null,
      campaignTitle: payTitle,
      // Numeric mirror of the rendered follower string so the vault can sort and
      // filter. Null when Instagram's count could not be parsed.
      followerCountNumeric,
      postCountNumeric,
      extensionScrape: {
        username: profile.username,
        bio: profile.bio ?? null,
        postCount: profile.postCount ?? null,
        externalUrl: profile.externalUrl ?? null,
        email: profile.email ?? null,
        avatarSourceUrl: avatarSourceUrl,
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
      await appendJobLog(job.id, "extension", "Stopped — you're out of Optic credits.");
      return {ok: false as const, reason: saveResult.reason};
    }

    const processed = (latest.data()?.processedCount ?? 0) + 1;
    await jobRef.update({
      processedCount: processed,
      updatedAt: FieldValue.serverTimestamp(),
      logs: FieldValue.arrayUnion({
        ts: Timestamp.now(),
        phase: "extension",
        message: `Added @${profile.username.replace(/^@/, "")} (${enriched.followerCount} followers).`,
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
      ? `Mission stopped: ${typeof error === "string" ? error.slice(0, 400) : "something went wrong in Chrome."}`
      : cancelled
        ? "Mission cancelled."
        : `Finished — added ${processed} of ${target} creators to your vault.`;

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
