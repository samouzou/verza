import {onDocumentCreated} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import {
  LINKEDIN_OS_WORKER_SHARED_SECRET,
  LINKEDIN_OS_WORKER_URL,
} from "../config/params";

/**
 * When a new `linkedin_os_jobs` document is created in `queued` status, calls the LinkedIn OS
 * Cloud Run worker (separate from Optic).
 */
export const dispatchLinkedInOsJobToWorker = onDocumentCreated(
  {
    document: "linkedin_os_jobs/{jobId}",
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    if (!data || data.status !== "queued") return;

    const workerUrl = LINKEDIN_OS_WORKER_URL.value().trim();
    const secret = LINKEDIN_OS_WORKER_SHARED_SECRET.value().trim();
    if (!workerUrl || !secret) {
      logger.warn(
        "[LinkedIn OS] LINKEDIN_OS_WORKER_URL or LINKEDIN_OS_WORKER_SHARED_SECRET is empty;" +
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
          "x-verza-linkedin-os-secret": secret,
        },
        body: JSON.stringify({jobId}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.error("[LinkedIn OS] Worker returned error", {
          status: res.status,
          jobId,
          text: text.slice(0, 500),
        });
      } else {
        logger.info("[LinkedIn OS] Worker finished HTTP OK", {jobId});
      }
    } catch (e) {
      logger.error("[LinkedIn OS] Failed to reach worker", {
        jobId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
);
