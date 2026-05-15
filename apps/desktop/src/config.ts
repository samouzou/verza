/**
 * Central runtime tuning for Optic (env-driven, safe defaults).
 */

function parsePositiveInt(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, n));
}

/** Max profile URLs to deep-vet per mission (caps cost). */
export function getMaxProfilesToVet(): number {
  return parsePositiveInt(process.env.OPTIC_MAX_PROFILES, 12, 80);
}

/** Pause between profile vets to reduce burst load on targets and Gemini. */
export function getMsBetweenVets(): number {
  return parsePositiveInt(process.env.OPTIC_MS_BETWEEN_VETS, 450, 30_000);
}

export function isSmsPerLeadDisabled(): boolean {
  const v = process.env.OPTIC_DISABLE_SMS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Clamp UI-provided cap to a safe range (main process is authoritative). */
export function clampMaxProfilesFromUi(n: unknown): number {
  const def = getMaxProfilesToVet();
  if (n === undefined || n === null || n === "") return def;
  const num = typeof n === "number" ? n : Number.parseInt(String(n), 10);
  if (!Number.isFinite(num)) return def;
  return Math.min(80, Math.max(1, Math.floor(num)));
}
