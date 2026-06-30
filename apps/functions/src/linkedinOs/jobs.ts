import {FieldValue} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import {assertAgencyTeamForLinkedInOs} from "./access";
import type {LinkedInOsJobItem} from "./types";

const MAX_ITEMS = 8;

/**
 * Validates one queue item from the client.
 * @param {unknown} raw Unknown payload entry.
 * @return {LinkedInOsJobItem} Normalized item.
 */
function parseJobItem(raw: unknown): LinkedInOsJobItem {
  if (!raw || typeof raw !== "object") {
    throw new HttpsError("invalid-argument", "Each item must be an object.");
  }
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const pillar = typeof o.pillar === "string" ? o.pillar.trim() : "";
  const hook = typeof o.hook === "string" ? o.hook.trim() : "";
  const productTruth = typeof o.productTruth === "string" ? o.productTruth.trim() : "";
  const cta = typeof o.cta === "string" ? o.cta.trim() : "";
  const format = o.format === "carousel_outline" ? "carousel_outline" : "short_post";
  const notes = typeof o.notes === "string" ? o.notes.trim() : "";
  if (!id) {
    throw new HttpsError("invalid-argument", "Each item needs a non-empty id.");
  }
  if (!pillar) {
    throw new HttpsError("invalid-argument", `Item ${id}: pillar is required.`);
  }
  return {
    id,
    pillar,
    format,
    hook,
    productTruth,
    cta,
    ...(notes ? {notes} : {}),
  };
}

/**
 * Enqueues a LinkedIn OS draft job. Callable by signed-in agency team members (same as Optic).
 * A Firestore trigger dispatches the job to the LinkedIn OS worker when configured.
 * @return {!Promise<{jobId: string, status: string}>} New job id and status.
 */
export const enqueueLinkedInOsDraftJob = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to enqueue a LinkedIn OS job.");
  }
  const uid = request.auth.uid;
  const agencyId = await assertAgencyTeamForLinkedInOs(uid);

  const {weekLabel, reviewer, items} = request.data as {
    weekLabel?: unknown;
    reviewer?: unknown;
    items?: unknown;
  };

  const week =
    typeof weekLabel === "string" && weekLabel.trim() ? weekLabel.trim() : "week";
  const reviewerName =
    typeof reviewer === "string" && reviewer.trim() ? reviewer.trim() : "Reviewer";

  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpsError("invalid-argument", "items must be a non-empty array.");
  }
  if (items.length > MAX_ITEMS) {
    throw new HttpsError("invalid-argument", `At most ${MAX_ITEMS} items per job.`);
  }

  const parsed: LinkedInOsJobItem[] = items.map((x) => parseJobItem(x));

  const jobRef = db.collection("linkedin_os_jobs").doc();
  const jobId = jobRef.id;

  await jobRef.set({
    status: "queued",
    createdAt: FieldValue.serverTimestamp(),
    createdBy: uid,
    agencyId,
    weekLabel: week,
    reviewer: reviewerName,
    items: parsed,
    outputs: [],
  });

  logger.info("[LinkedIn OS] Job queued", {jobId, itemCount: parsed.length, createdBy: uid, agencyId});

  return {jobId, status: "queued"};
});
