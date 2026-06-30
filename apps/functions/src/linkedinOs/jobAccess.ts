import {HttpsError} from "firebase-functions/v2/https";
import {db} from "../config/firebase";
import {assertAgencyTeamForLinkedInOs} from "./access";
import type {LinkedInOsJobOutput} from "./types";

export const PRODUCT_RECEIPTS_OUTPUT_ID = "thu-product-receipts";

/**
 * Loads a completed LinkedIn OS job the caller may access.
 * @param {string} uid User id.
 * @param {string} jobId Job id.
 * @return {!Promise<object>} Job ref, data, and outputs.
 */
export async function loadCompletedLinkedInOsJob(uid: string, jobId: string) {
  const agencyId = await assertAgencyTeamForLinkedInOs(uid);
  const jobRef = db.collection("linkedin_os_jobs").doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    throw new HttpsError("not-found", "LinkedIn OS job not found.");
  }
  const job = jobSnap.data()!;
  if (job.agencyId !== agencyId && job.createdBy !== uid) {
    throw new HttpsError("permission-denied", "You cannot access this job.");
  }
  if (job.status !== "completed") {
    throw new HttpsError("failed-precondition", "This action requires a completed LinkedIn draft job.");
  }
  const outputs = (job.outputs ?? []) as LinkedInOsJobOutput[];
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new HttpsError("failed-precondition", "Job has no LinkedIn outputs.");
  }
  return {jobRef, job, outputs, agencyId};
}

/**
 * Finds the product-receipts carousel output for Beehiiv repurposing.
 * @param {!Array<LinkedInOsJobOutput>} outputs Job outputs.
 * @return {LinkedInOsJobOutput | undefined} Carousel output if present.
 */
export function findProductReceiptsCarouselOutput(
  outputs: LinkedInOsJobOutput[]
): LinkedInOsJobOutput | undefined {
  return (
    outputs.find((o) => o.id === PRODUCT_RECEIPTS_OUTPUT_ID && o.format === "carousel_outline") ??
    outputs.find((o) => o.format === "carousel_outline")
  );
}
