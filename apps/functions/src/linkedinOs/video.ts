import * as https from "https";
import {FieldValue} from "firebase-admin/firestore";
import {getFunctions} from "firebase-admin/functions";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onTaskDispatched} from "firebase-functions/v2/tasks";
import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import * as params from "../config/params";
import {isPrismChannel, PRISM_CHANNEL_LABELS} from "./brandStrategy";
import {appendHistory, LOCKED_MESSAGE, loadPrismPost, notify, prismCaller, prismEvent, PRISM_POSTS, withPublisher} from "./posts";
import {refundVideoCredits, spendVideoCredits} from "./videoCredits";
import type {PrismPost, PrismVariantVideoJob, PrismVideoJob, PrismVideoJobStatus} from "./types";

export const PRISM_VIDEO_JOBS = "prism_video_jobs";
export const PRISM_VIDEO_FORMATS = new Set(["ig_reel", "tiktok_video"]);
/** Omni makes 10-second segments; longer videos extend the previous one. */
export const PRISM_VIDEO_LENGTHS = [10, 20, 30, 40];
const ACTIVE: PrismVideoJobStatus[] = ["queued", "planning", "generating", "assembling"];
/** A render with no progress for this long is treated as dead so the brand isn't blocked. */
const STALE_MS = 45 * 60 * 1000;
const TASK_TIMEOUT_S = 1800;

/**
 * Posts a job to the worker and waits for the whole render (global fetch gives up after five minutes).
 * @param {string} jobId Job id.
 * @return {!Promise<{status: number, body: string}>} Worker response.
 */
function callWorker(jobId: string): Promise<{status: number; body: string}> {
  const base = params.LINKEDIN_OS_WORKER_URL.value().trim().replace(/\/$/, "");
  const secret = params.LINKEDIN_OS_WORKER_SHARED_SECRET.value().trim();
  if (!base || !secret) return Promise.reject(new Error("The video renderer isn't configured."));
  const payload = JSON.stringify({jobId});
  return new Promise((resolve, reject) => {
    const req = https.request(`${base}/internal/render-video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "x-verza-linkedin-os-secret": secret,
      },
      timeout: (TASK_TIMEOUT_S - 30) * 1000,
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({status: res.statusCode ?? 0, body}));
    });
    req.on("timeout", () => req.destroy(new Error("The video render timed out.")));
    req.on("error", reject);
    req.end(payload);
  });
}

/**
 * Marks a job failed unless it already finished. The update trigger refunds the credits.
 * @param {string} jobId Job id.
 * @param {string} error Message for the team.
 * @return {!Promise<void>}
 */
async function failJob(jobId: string, error: string): Promise<void> {
  const ref = db.collection(PRISM_VIDEO_JOBS).doc(jobId);
  await db.runTransaction(async (tx) => {
    const job = (await tx.get(ref)).data() as PrismVideoJob | undefined;
    if (!job || job.status === "done" || job.status === "failed") return;
    tx.update(ref, {status: "failed", stage: "Failed", error: error.slice(0, 300), updatedAt: FieldValue.serverTimestamp()});
  });
}

/**
 * Starts a video render for a Reel or TikTok script. Takes the credits up front; a failed render gives them back.
 * @return {!Promise<{jobId: string}>} Job id.
 */
export const renderPrismVideo = onCall(async (request) => {
  const c = await prismCaller(request.auth?.uid);
  const {ref, post, postId} = await loadPrismPost(c, request.data?.postId);
  const channel = request.data?.channel;
  if (!isPrismChannel(channel) || !post.channels.includes(channel)) {
    throw new HttpsError("invalid-argument", "Pick one of the post's channels.");
  }
  const variant = post.variants?.[channel];
  if (!variant || !PRISM_VIDEO_FORMATS.has(variant.format)) {
    throw new HttpsError("failed-precondition", "Videos are for Reel and TikTok scripts.");
  }
  if (!variant.text.trim()) throw new HttpsError("failed-precondition", "Write the script first.");
  if (post.status === "posted") throw new HttpsError("failed-precondition", "This post is already marked posted.");
  if (withPublisher(post)) throw new HttpsError("failed-precondition", LOCKED_MESSAGE);
  const seconds = Number(request.data?.seconds);
  if (!PRISM_VIDEO_LENGTHS.includes(seconds)) throw new HttpsError("invalid-argument", "Pick 10, 20, 30 or 40 seconds.");

  const active = await db.collection(PRISM_VIDEO_JOBS)
    .where("agencyId", "==", c.agencyId)
    .where("status", "in", ACTIVE)
    .get();
  for (const doc of active.docs) {
    const updated = doc.get("updatedAt")?.toMillis?.() ?? 0;
    if (updated && updated < Date.now() - STALE_MS) {
      await failJob(doc.id, "The render stopped responding.");
      continue;
    }
    throw new HttpsError("failed-precondition", "A video is already rendering for this brand. Wait for it to finish.");
  }

  const jobRef = db.collection(PRISM_VIDEO_JOBS).doc();
  const now = new Date().toISOString();
  await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data() as PrismPost | undefined;
    const spend = await spendVideoCredits(tx, c.agencyId, seconds, jobRef.id, c.uid);
    const job: PrismVideoJob = {
      agencyId: c.agencyId,
      postId,
      channel,
      format: variant.format,
      seconds,
      credits: seconds,
      spend,
      status: "queued",
      stage: "Queued",
      createdBy: c.uid,
      createdByName: c.name,
    };
    tx.set(jobRef, {...job, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()});
    const videoJob: PrismVariantVideoJob = {jobId: jobRef.id, status: "queued", stage: "Queued", seconds, updatedAt: now};
    tx.update(ref, {
      [`variants.${channel}.videoJob`]: videoJob,
      history: appendHistory(
        fresh?.history ?? post.history,
        prismEvent(c, `started a ${seconds}s ${PRISM_CHANNEL_LABELS[channel]} video`)
      ),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  try {
    await getFunctions().taskQueue("renderPrismVideoTask").enqueue(
      {jobId: jobRef.id},
      {dispatchDeadlineSeconds: TASK_TIMEOUT_S}
    );
  } catch (e) {
    logger.error("[Prism video] Could not queue render", {jobId: jobRef.id, e: String(e)});
    await failJob(jobRef.id, "Could not start the render.");
    throw new HttpsError("internal", "Could not start the video. Your credits were returned.");
  }
  logger.info("[Prism video] Render queued", {jobId: jobRef.id, postId, channel, seconds});
  return {jobId: jobRef.id};
});

/** Runs one render on the worker. Never retried, so a render is never paid for twice. */
export const renderPrismVideoTask = onTaskDispatched(
  {
    retryConfig: {maxAttempts: 1},
    rateLimits: {maxConcurrentDispatches: 5},
    timeoutSeconds: TASK_TIMEOUT_S,
    memory: "256MiB",
  },
  async (req) => {
    const jobId = typeof req.data?.jobId === "string" ? req.data.jobId : "";
    if (!jobId) return;
    try {
      const res = await callWorker(jobId);
      if (res.status !== 200) {
        const error = (() => {
          try {
            return String(JSON.parse(res.body).error ?? "");
          } catch {
            return "";
          }
        })();
        logger.error("[Prism video] Worker failed", {jobId, status: res.status, error: error.slice(0, 500)});
        await failJob(jobId, error || "The video render failed.");
      }
    } catch (e) {
      logger.error("[Prism video] Worker unreachable", {jobId, e: String(e)});
      await failJob(jobId, e instanceof Error ? e.message : "The video render failed.");
    }
  }
);

/** Mirrors job progress onto the post, refunds failed renders once, and tells the team when a video is ready. */
export const onPrismVideoJobUpdated = onDocumentUpdated(`${PRISM_VIDEO_JOBS}/{jobId}`, async (event) => {
  const before = event.data?.before.data() as PrismVideoJob | undefined;
  const after = event.data?.after.data() as PrismVideoJob | undefined;
  if (!before || !after) return;
  const jobId = event.params.jobId;
  const changed = before.status !== after.status || before.stage !== after.stage || before.error !== after.error;
  if (!changed) return;

  const postRef = db.collection(PRISM_POSTS).doc(after.postId);
  const terminal = after.status === "failed" ? "failed" : after.status === "done" ? "done" : null;
  const outcome = await db.runTransaction(async (tx) => {
    const jobRef = db.collection(PRISM_VIDEO_JOBS).doc(jobId);
    const [job, post] = await Promise.all([
      tx.get(jobRef).then((s) => s.data() as PrismVideoJob | undefined),
      tx.get(postRef).then((s) => s.data() as PrismPost | undefined),
    ]);
    if (!job) return null;
    const refund = job.status === "failed" && !job.refunded;
    if (refund) await refundVideoCredits(tx, job.agencyId, job.spend, jobId);
    if (refund) tx.update(jobRef, {refunded: true});
    const current = post?.variants?.[job.channel]?.videoJob;
    if (post && current?.jobId === jobId) {
      const videoJob: PrismVariantVideoJob = {
        jobId,
        status: job.status,
        stage: job.stage,
        seconds: job.seconds,
        ...(job.error ? {error: job.error} : {}),
        updatedAt: new Date().toISOString(),
      };
      tx.update(postRef, {[`variants.${job.channel}.videoJob`]: videoJob});
    }
    return {post, refunded: refund};
  });

  if (terminal && before.status !== after.status && outcome?.post) {
    const label = PRISM_CHANNEL_LABELS[after.channel];
    await notify(
      [after.createdBy],
      terminal === "done" ? "Video ready" : "Video failed",
      terminal === "done" ?
        `Your ${after.seconds}s ${label} video for "${outcome.post.title}" is ready to review.` :
        `The ${label} video for "${outcome.post.title}" failed${after.error ? `: ${after.error}` : ""}. ` +
          "Your credits were returned.",
      after.postId
    );
  }
  if (outcome?.refunded) logger.info("[Prism video] Credits refunded", {jobId, agencyId: after.agencyId});
});
