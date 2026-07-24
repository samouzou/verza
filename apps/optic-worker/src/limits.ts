/** Per-batch save target for the Cloud Run worker. */
export const OPTIC_MAX_SAVED_PER_RUN = 100;

/** Worker runs are still bounded by HTTP/Firestore dispatch (~9 min). */
export const OPTIC_WORKER_PRACTICAL_CAP = 25;

/** Unique profile URLs to consider before vetting. */
export function urlPoolCap(targetSaved: number): number {
  const t = Math.max(1, targetSaved);
  return Math.min(400, Math.max(t * 8, t + 25));
}

/** Pause between profile reviews — shorter for large batches. */
export function vetDelayMs(targetSaved: number): number {
  if (targetSaved >= 50) return 200;
  if (targetSaved >= 25) return 300;
  if (targetSaved >= 12) return 450;
  return 650;
}

/** Effective save target for one worker HTTP run. */
export function workerSaveTarget(requested: number): number {
  const t = Math.max(1, Math.floor(requested));
  return Math.min(OPTIC_MAX_SAVED_PER_RUN, OPTIC_WORKER_PRACTICAL_CAP, t);
}
