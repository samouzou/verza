import {onDocumentCreated} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import {OPTIC_WORKER_SHARED_SECRET, OPTIC_WORKER_URL} from "../config/params";

/**
 * When a new `optic_jobs` document is created in `queued` status, calls the Cloud Run worker
 * and waits for the HTTP response. Firestore triggers are capped at 540s; longer missions rely on
 * the worker finishing within that window or should move to Cloud Tasks / async invoke.
 */
export const dispatchOpticJobToWorker = onDocumentCreated(
  {
    document: "optic_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    if (!data || data.status !== "queued") return;

    const workerUrl = OPTIC_WORKER_URL.value().trim();
    const secret = OPTIC_WORKER_SHARED_SECRET.value().trim();
    if (!workerUrl || !secret) {
      logger.warn(
        "[Optic] OPTIC_WORKER_URL or OPTIC_WORKER_SHARED_SECRET is empty;" +
        " job will stay queued until the worker is deployed and params are set."
      );
      return;
    }

    const jobId = event.params.jobId;
    const runUrl = `${workerUrl.replace(/\/$/, "")}/internal/run-job`;
    try {
      const res = await fetch(runUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-verza-optic-secret": secret,
        },
        body: JSON.stringify({jobId}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.error("[Optic] Worker returned error", {status: res.status, jobId, text: text.slice(0, 500)});
      } else {
        logger.info("[Optic] Worker finished HTTP OK", {jobId});
      }
    } catch (e) {
      logger.error("[Optic] Failed to reach worker", {
        jobId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
);
