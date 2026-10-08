import {brandKitRef} from "../agency/brandKit";
import type {BrandProduct} from "../types";
import type {PrismVisualLayout} from "./channelFormats";
import type {PrismBrandCategory} from "./types";

const MAX_CATALOG = 30;
const MAX_IMAGES = 6;

/** A brand kit product as Prism uses it. */
export type PrismCatalogItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  url: string;
  usps: string[];
  /** Main image first. */
  images: string[];
};

/**
 * Every image for a product, main image first. Older products only have imageUrl.
 * @param {Partial<BrandProduct>} p Product.
 * @return {!Array<string>} Image URLs.
 */
export function productImageUrls(p: Partial<BrandProduct>): string[] {
  const list = Array.isArray(p.images) && p.images.length ? p.images : [p.imageUrl];
  return list
    .filter((u): u is string => typeof u === "string" && /^https:\/\//i.test(u.trim()))
    .map((u) => u.trim())
    .slice(0, MAX_IMAGES);
}

/**
 * Loads the brand kit product catalog.
 * @param {string} agencyId Agency id.
 * @return {!Promise<!Array<PrismCatalogItem>>} Products with a name.
 */
export async function loadPrismCatalog(agencyId: string): Promise<PrismCatalogItem[]> {
  const snap = await brandKitRef(agencyId).get();
  const raw = snap.data()?.products;
  if (!Array.isArray(raw)) return [];
  return (raw as Partial<BrandProduct>[])
    .filter((p) => typeof p?.id === "string" && typeof p.name === "string" && p.name.trim())
    .slice(0, MAX_CATALOG)
    .map((p) => ({
      id: String(p.id),
      name: String(p.name).trim().slice(0, 80),
      description: String(p.description ?? "").trim().slice(0, 300),
      price: Number(p.price) || 0,
      url: String(p.url ?? "").trim(),
      usps: Array.isArray(p.usps) ? p.usps.map((u) => String(u).trim()).filter(Boolean).slice(0, 5) : [],
      images: productImageUrls(p),
    }));
}

/**
 * One catalog line for prompts.
 * @param {PrismCatalogItem} p Product.
 * @return {string} Line.
 */
export function catalogLine(p: PrismCatalogItem): string {
  const price = p.price > 0 ? ` ($${p.price.toFixed(2)})` : "";
  const usps = p.usps.length ? ` Selling points: ${p.usps.join("; ")}.` : "";
  const imgs = p.images.length ? ` [${p.images.length} image${p.images.length > 1 ? "s" : ""}]` : "";
  return `- ${p.name}${price}: ${p.description || "no description"}.${usps}${imgs}`;
}

/**
 * Catalog block for prompts, or "" when the brand has no products.
 * @param {!Array<PrismCatalogItem>} items Catalog.
 * @return {string} Markdown block.
 */
export function formatCatalogForPrompt(items: PrismCatalogItem[]): string {
  if (!items.length) return "";
  return `CATALOG (real products / features; name them exactly, never invent others or their prices):
${items.map(catalogLine).join("\n")}`;
}

/**
 * Real-image slide layout for a brand: screenshots for software, product photos otherwise; null without images.
 * @param {!Array<PrismCatalogItem>} items Catalog.
 * @param {string} category Brand category.
 * @return {PrismVisualLayout} Layout.
 */
export function visualLayoutFor(items: PrismCatalogItem[], category: PrismBrandCategory | ""): PrismVisualLayout {
  if (!items.some((p) => p.images.length)) return null;
  return category === "saas" || category === "app" ? "Screenshot" : "Product";
}

/**
 * Finds a catalog item by id or (case-insensitive) name.
 * @param {!Array<PrismCatalogItem>} items Catalog.
 * @param {unknown} raw Id or name.
 * @return {?PrismCatalogItem} Match.
 */
export function findCatalogItem(items: PrismCatalogItem[], raw: unknown): PrismCatalogItem | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const key = raw.trim().toLowerCase();
  return items.find((p) => p.id === raw.trim()) ?? items.find((p) => p.name.toLowerCase() === key) ?? null;
}
