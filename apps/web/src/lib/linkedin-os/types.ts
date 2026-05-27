import type { Timestamp } from "firebase/firestore";

export type LinkedInOsJobStatus = "queued" | "running" | "completed" | "failed";

export type LinkedInOsJobItem = {
  id: string;
  pillar: string;
  format: "short_post" | "carousel_outline";
  hook: string;
  productTruth: string;
  cta: string;
  notes?: string;
};

export type LinkedInOsCarouselSlideAsset = {
  index: number;
  storagePath: string;
  filename: string;
};

export type LinkedInOsCarouselAssets = {
  slides: LinkedInOsCarouselSlideAsset[];
  pdfStoragePath?: string;
  zipStoragePath?: string;
};

export type LinkedInOsJobOutput = {
  id: string;
  format: string;
  pillar: string;
  markdown: string;
  generatedAt: string;
  model: string;
  carouselAssets?: LinkedInOsCarouselAssets;
};

export type LinkedInOsJobRow = {
  id: string;
  status: LinkedInOsJobStatus;
  createdAt?: Timestamp;
  createdBy?: string;
  agencyId?: string;
  weekLabel?: string;
  reviewer?: string;
  items?: LinkedInOsJobItem[];
  outputs?: LinkedInOsJobOutput[];
  error?: string;
};

export const LINKEDIN_OS_PILLARS = [
  { value: "build_in_public", label: "Build in public" },
  { value: "playbooks", label: "Playbooks" },
  { value: "creator_respect", label: "Creator respect" },
  { value: "product_receipts", label: "Product receipts" },
] as const;

export const LINKEDIN_OS_CTAS = [
  { value: "follow", label: "Follow / save" },
  { value: "comment", label: "Comment prompt" },
  { value: "soft_product", label: "Soft product CTA" },
  { value: "hard_product", label: "Direct product CTA" },
] as const;

export const DEFAULT_QUEUE_ITEMS: LinkedInOsJobItem[] = [
  {
    id: "tue-playbooks",
    pillar: "playbooks",
    format: "short_post",
    hook: "",
    productTruth: "",
    cta: "comment",
    notes: "",
  },
  {
    id: "wed-build-in-public",
    pillar: "build_in_public",
    format: "short_post",
    hook: "",
    productTruth: "",
    cta: "follow",
    notes: "",
  },
  {
    id: "thu-product-receipts",
    pillar: "product_receipts",
    format: "carousel_outline",
    hook: "",
    productTruth: "",
    cta: "soft_product",
    notes: "",
  },
];

export function isLinkedInOsJobInFlight(status: string | undefined): boolean {
  return status === "queued" || status === "running";
}
