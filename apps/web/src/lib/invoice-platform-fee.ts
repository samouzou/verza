import type { Contract } from "@/types";

/** Verza fee on invoice payments for agency / brand workspace contracts (Stripe processing is separate). */
export const INVOICE_VERZA_FEE_PERCENT_AGENCY = 1;
/** Verza fee on invoice payments for individual creator (user-owned) contracts. */
export const INVOICE_VERZA_FEE_PERCENT_CREATOR = 15;

export function invoiceVerzaFeePercentForOwnerType(ownerType: Contract["ownerType"] | undefined): number {
  return ownerType === "agency" ? INVOICE_VERZA_FEE_PERCENT_AGENCY : INVOICE_VERZA_FEE_PERCENT_CREATOR;
}

export function invoiceVerzaFeeFootnoteForOwnerType(ownerType: Contract["ownerType"] | undefined): string {
  const pct = invoiceVerzaFeePercentForOwnerType(ownerType);
  return `A ${pct}% Verza fee + payment processing fees apply on invoice payments.`;
}

/** Use when creating a contract from the upload dialog (ownerType not persisted yet). */
export function invoiceVerzaFeePercentForNewContract(isAgencyWorkspace: boolean): number {
  return isAgencyWorkspace ? INVOICE_VERZA_FEE_PERCENT_AGENCY : INVOICE_VERZA_FEE_PERCENT_CREATOR;
}

export function invoiceVerzaFeeFootnoteForNewContract(isAgencyWorkspace: boolean): string {
  const pct = invoiceVerzaFeePercentForNewContract(isAgencyWorkspace);
  return `A ${pct}% Verza fee + payment processing fees apply on invoice payments.`;
}
