import {FieldValue} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import {assertAgencyTeamForLinkedInOs} from "./access";
import type {LinkedInOsJobOutput, LinkedInOsPublishStatus} from "./types";

const STATUSES = new Set<LinkedInOsPublishStatus>([
  "draft",
  "approved",
  "scheduled",
  "posted",
]);

/**
 * Updates publish workflow status on one draft output (approve / schedule / posted).
 * LinkedIn API posting is not wired yet — scheduled means "approved for this time."
 * @return {!Promise<{jobId: string, outputId: string, publishStatus: string}>} Result.
 */
export const updateLinkedInOsDraftPublishStatus = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to update draft status.");
  }
  const uid = request.auth.uid;
  const agencyId = await assertAgencyTeamForLinkedInOs(uid);

  const jobId = typeof request.data?.jobId === "string" ? request.data.jobId.trim() : "";
  const outputId =
    typeof request.data?.outputId === "string" ? request.data.outputId.trim() : "";
  const publishStatusRaw =
    typeof request.data?.publishStatus === "string" ? request.data.publishStatus.trim() : "";
  const scheduledAtRaw =
    typeof request.data?.scheduledAt === "string" ? request.data.scheduledAt.trim() : "";

  if (!jobId || !outputId) {
    throw new HttpsError("invalid-argument", "jobId and outputId are required.");
  }
  if (!STATUSES.has(publishStatusRaw as LinkedInOsPublishStatus)) {
    throw new HttpsError(
      "invalid-argument",
      "publishStatus must be draft, approved, scheduled, or posted."
    );
  }
  const publishStatus = publishStatusRaw as LinkedInOsPublishStatus;

  let scheduledAt: string | undefined;
  if (publishStatus === "scheduled") {
    if (!scheduledAtRaw) {
      throw new HttpsError("invalid-argument", "scheduledAt is required when status is scheduled.");
    }
    const d = new Date(scheduledAtRaw);
    if (Number.isNaN(d.getTime())) {
      throw new HttpsError("invalid-argument", "scheduledAt must be a valid ISO date.");
    }
    scheduledAt = d.toISOString();
  }

  const ref = db.collection("linkedin_os_jobs").doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Job not found.");
  }
  const data = snap.data()!;
  if (data.agencyId !== agencyId && data.createdBy !== uid) {
    throw new HttpsError("permission-denied", "Not allowed to update this job.");
  }
  if (data.status !== "completed") {
    throw new HttpsError("failed-precondition", "Only completed jobs can enter the publish queue.");
  }

  const outputs = Array.isArray(data.outputs) ? ([...data.outputs] as LinkedInOsJobOutput[]) : [];
  const idx = outputs.findIndex((o) => o.id === outputId);
  if (idx < 0) {
    throw new HttpsError("not-found", "Draft output not found on this job.");
  }

  const prev = outputs[idx];
  const cleaned: LinkedInOsJobOutput = {
    id: prev.id,
    format: prev.format,
    pillar: prev.pillar,
    markdown: prev.markdown,
    generatedAt: prev.generatedAt,
    model: prev.model,
    publishStatus,
    ...(prev.carouselAssets ? {carouselAssets: prev.carouselAssets} : {}),
  };
  if (scheduledAt) {
    cleaned.scheduledAt = scheduledAt;
  } else if (publishStatus === "posted" && typeof prev.scheduledAt === "string") {
    cleaned.scheduledAt = prev.scheduledAt;
  }

  outputs[idx] = cleaned;

  await ref.update({
    outputs,
    updatedAt: FieldValue.serverTimestamp(),
  });

  logger.info("[LinkedIn OS] Draft publish status updated", {
    jobId,
    outputId,
    publishStatus,
    scheduledAt: scheduledAt ?? null,
    uid,
  });

  return {jobId, outputId, publishStatus, scheduledAt: cleaned.scheduledAt ?? null};
});
