/** Per-batch save target — keep runs under ~9 min HTTP / Firestore limits. */
export const OPTIC_MAX_SAVED_PER_RUN = 15;

/** Unique profile URLs to consider before vetting. */
export function urlPoolCap(targetSaved: number): number {
  const t = Math.max(1, targetSaved);
  return Math.min(120, Math.max(t * 8, t + 25));
}

/** Pause between profile reviews. */
export function vetDelayMs(targetSaved: number): number {
  if (targetSaved >= 12) return 450;
  return 650;
}
