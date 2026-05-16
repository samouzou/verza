/** Single synchronous run cap — must complete within Firestore trigger + HTTP limits (~540s). */
export const OPTIC_MAX_SAVED_PER_RUN = 75;

/** Unique profile URLs to consider before vetting (over-fetch so skips still hit the target). */
export function urlPoolCap(targetSaved: number): number {
  const t = Math.max(1, targetSaved);
  return Math.min(350, Math.max(t * 12, t + 60));
}

/** Pause between vets — lighter when runs are larger to protect platform and stay in time budget. */
export function vetDelayMs(targetSaved: number): number {
  if (targetSaved >= 50) return 350;
  if (targetSaved >= 25) return 500;
  return 750;
}
