/**
 * One slot in a LinkedIn OS draft-generation job (Verza company LinkedIn, not Optic).
 */
export type LinkedInOsJobItem = {
  id: string;
  pillar: string;
  format: "short_post" | "carousel_outline";
  hook: string;
  productTruth: string;
  cta: string;
  notes?: string;
};
