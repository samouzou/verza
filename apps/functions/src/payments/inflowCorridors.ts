/** African corridors with payins + payouts active on Inflow (Phase 1). */
export const INFLOW_PAYOUT_COUNTRIES = new Set([
  "BW", // Botswana
  "CD", // DR Congo
  "GA", // Gabon
  "GH", // Ghana
  "CI", // Ivory Coast
  "KE", // Kenya
  "NG", // Nigeria
  "RW", // Rwanda
  "ZA", // South Africa
  "TZ", // Tanzania
  "UG", // Uganda
  "ZM", // Zambia
]);

export const INFLOW_COUNTRY_NAMES: Record<string, string> = {
  BW: "Botswana",
  CD: "DR Congo",
  GA: "Gabon",
  GH: "Ghana",
  CI: "Ivory Coast",
  KE: "Kenya",
  NG: "Nigeria",
  RW: "Rwanda",
  ZA: "South Africa",
  TZ: "Tanzania",
  UG: "Uganda",
  ZM: "Zambia",
};

export function isInflowPayoutCountry(code: string | null | undefined): boolean {
  return !!code && INFLOW_PAYOUT_COUNTRIES.has(code.toUpperCase());
}
