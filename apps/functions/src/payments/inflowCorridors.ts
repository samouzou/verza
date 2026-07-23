/** Inflow uses 3-letter corridor codes (often matching currency), not ISO-3166 alpha-2. */
export const INFLOW_PAYOUT_CODES = new Set([
  "BWP", // Botswana
  "XAF", // Cameroon, Congo (Brazzaville), Gabon
  "CDF", // DR Congo
  "GHS", // Ghana
  "XOF", // Ivory Coast, Senegal, Togo
  "KES", // Kenya
  "MWK", // Malawi
  "NGN", // Nigeria
  "RWF", // Rwanda
  "ZAR", // South Africa
  "TZS", // Tanzania
  "UGX", // Uganda
  "ZMW", // Zambia
]);

/** @deprecated alias — corridors are 3-letter Inflow codes */
export const INFLOW_PAYOUT_COUNTRIES = INFLOW_PAYOUT_CODES;

/** ISO-3166 alpha-2 → Inflow corridor code */
export const ISO2_TO_INFLOW_CODE: Record<string, string> = {
  BW: "BWP",
  CM: "XAF",
  CG: "XAF",
  CD: "CDF",
  GA: "XAF",
  GH: "GHS",
  CI: "XOF",
  KE: "KES",
  MW: "MWK",
  NG: "NGN",
  RW: "RWF",
  SN: "XOF",
  ZA: "ZAR",
  TZ: "TZS",
  TG: "XOF",
  UG: "UGX",
  ZM: "ZMW",
};

export const INFLOW_COUNTRY_NAMES: Record<string, string> = {
  BWP: "Botswana",
  XAF: "Cameroon, Congo (Brazzaville), Gabon",
  CDF: "DR Congo",
  GHS: "Ghana",
  XOF: "Ivory Coast, Senegal, Togo",
  KES: "Kenya",
  MWK: "Malawi",
  NGN: "Nigeria",
  RWF: "Rwanda",
  ZAR: "South Africa",
  TZS: "Tanzania",
  UGX: "Uganda",
  ZMW: "Zambia",
};

export type InflowCountryOption = {
  inflowCode: string;
  iso2: string;
  name: string;
};

export const INFLOW_COUNTRY_OPTIONS: InflowCountryOption[] = [
  {inflowCode: "NGN", iso2: "NG", name: "Nigeria"},
  {inflowCode: "GHS", iso2: "GH", name: "Ghana"},
  {inflowCode: "KES", iso2: "KE", name: "Kenya"},
  {inflowCode: "ZAR", iso2: "ZA", name: "South Africa"},
  {inflowCode: "UGX", iso2: "UG", name: "Uganda"},
  {inflowCode: "TZS", iso2: "TZ", name: "Tanzania"},
  {inflowCode: "RWF", iso2: "RW", name: "Rwanda"},
  {inflowCode: "ZMW", iso2: "ZM", name: "Zambia"},
  {inflowCode: "BWP", iso2: "BW", name: "Botswana"},
  {inflowCode: "XOF", iso2: "CI", name: "Ivory Coast"},
  {inflowCode: "XOF", iso2: "SN", name: "Senegal"},
  {inflowCode: "XOF", iso2: "TG", name: "Togo"},
  {inflowCode: "CDF", iso2: "CD", name: "DR Congo"},
  {inflowCode: "XAF", iso2: "CM", name: "Cameroon"},
  {inflowCode: "XAF", iso2: "CG", name: "Congo (Brazzaville)"},
  {inflowCode: "XAF", iso2: "GA", name: "Gabon"},
  {inflowCode: "MWK", iso2: "MW", name: "Malawi"},
];

/** Resolve ISO-2 or legacy values to an Inflow corridor code. */
export function toInflowCountryCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const upper = code.trim().toUpperCase();
  if (INFLOW_PAYOUT_CODES.has(upper)) return upper;
  return ISO2_TO_INFLOW_CODE[upper] ?? null;
}

export function isInflowPayoutCountry(code: string | null | undefined): boolean {
  return toInflowCountryCode(code) !== null;
}

export function normalizeInflowPayoutCountry(code: string): string {
  const normalized = toInflowCountryCode(code);
  if (!normalized) {
    throw new Error(`Unsupported Inflow corridor: ${code}`);
  }
  return normalized;
}

export function getInflowCountryDisplayName(code: string | null | undefined): string | null {
  const inflowCode = toInflowCountryCode(code);
  if (!inflowCode) return null;
  const byIso2 = INFLOW_COUNTRY_OPTIONS.find(
    (option) => option.iso2 === code?.trim().toUpperCase()
  );
  if (byIso2) return byIso2.name;
  return INFLOW_COUNTRY_NAMES[inflowCode] ?? inflowCode;
}
