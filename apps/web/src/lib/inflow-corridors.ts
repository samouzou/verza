/** African corridors with payins + payouts active on Inflow (Phase 1). */
export const INFLOW_PAYOUT_COUNTRIES = new Set([
  "BW",
  "CD",
  "GA",
  "GH",
  "CI",
  "KE",
  "NG",
  "RW",
  "ZA",
  "TZ",
  "UG",
  "ZM",
]);

export const INFLOW_COUNTRY_OPTIONS = [
  { code: "NG", name: "Nigeria" },
  { code: "GH", name: "Ghana" },
  { code: "KE", name: "Kenya" },
  { code: "ZA", name: "South Africa" },
  { code: "UG", name: "Uganda" },
  { code: "TZ", name: "Tanzania" },
  { code: "RW", name: "Rwanda" },
  { code: "ZM", name: "Zambia" },
  { code: "BW", name: "Botswana" },
  { code: "CI", name: "Ivory Coast" },
  { code: "CD", name: "DR Congo" },
  { code: "GA", name: "Gabon" },
];

export function isInflowPayoutCountry(code: string | null | undefined): boolean {
  return !!code && INFLOW_PAYOUT_COUNTRIES.has(code.toUpperCase());
}
