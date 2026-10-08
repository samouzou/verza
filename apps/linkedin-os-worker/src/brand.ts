import {getFirestore} from "firebase-admin/firestore";

import {brandTheme, type CarouselTheme, VERZA_THEME} from "./brandColors";
import "./firebaseAdmin";

const db = getFirestore();

const CHANNEL_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  x: "X",
  instagram: "Instagram",
  tiktok: "TikTok",
};

const CATEGORY_GUIDANCE: Record<string, string> = {
  dtc: "DTC / e-commerce. Lead with the product in use, what customers feel, social proof, drops and offers.",
  saas: "SaaS / software. Lead with the buyer's problem, the workflow and a measurable outcome; show real screenshots.",
  app: "Consumer app. Show the app in hand with real phone screenshots, moments of use and quick wins.",
  services: "Agency / services. Sell expertise and results: case studies, frameworks, the team's point of view.",
  creator: "Creator / personal brand. First-person stories, opinions and lessons; the person is the product.",
  local: "Local business. Places, people and occasions: offers, events, behind the scenes. Always say where.",
};

/** A brand kit product. */
export type WorkerProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  usps: string[];
  /** https image URLs, main image first. */
  images: string[];
};

export type WorkerBrand = {
  brandName: string;
  websiteUrl: string;
  /** dtc | saas | app | services | creator | local, or "". */
  category: string;
  catalog: WorkerProduct[];
  /** Brief, audience, pillars and channel roles as a prompt block. */
  setupBlock: string;
  bannedClaims: string;
  theme: CarouselTheme;
  logoUrl: string;
};

/**
 * Hostname without www, or "" when the URL is invalid.
 * @param {string} url Website URL.
 * @return {string} Hostname.
 */
function hostname(url: string): string {
  if (!url) return "";
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Parses brand kit products.
 * @param {unknown} raw brandKit.products.
 * @return {!Array<WorkerProduct>} Products with a name.
 */
function parseCatalog(raw: unknown): WorkerProduct[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .filter((p) => typeof p?.id === "string" && typeof p.name === "string" && p.name.trim())
    .slice(0, 30)
    .map((p) => {
      const imgs = Array.isArray(p.images) && p.images.length ? p.images : [p.imageUrl];
      return {
        id: String(p.id),
        name: String(p.name).trim().slice(0, 80),
        description: String(p.description ?? "").trim().slice(0, 300),
        price: Number(p.price) || 0,
        usps: Array.isArray(p.usps) ? p.usps.map((u) => String(u).trim()).filter(Boolean).slice(0, 5) : [],
        images: imgs.filter((u): u is string => typeof u === "string" && /^https:\/\//i.test(u.trim()))
          .map((u) => u.trim()).slice(0, 6),
      };
    });
}

/**
 * One catalog line for prompts.
 * @param {WorkerProduct} p Product.
 * @return {string} Line.
 */
export function catalogLine(p: WorkerProduct): string {
  const price = p.price > 0 ? ` ($${p.price.toFixed(2)})` : "";
  const usps = p.usps.length ? ` Selling points: ${p.usps.join("; ")}.` : "";
  const imgs = p.images.length ? ` [has images]` : " [no images]";
  return `- ${p.name}${price}: ${p.description || "no description"}.${usps}${imgs}`;
}

/**
 * Finds a product by id or case-insensitive name.
 * @param {!Array<WorkerProduct>} catalog Catalog.
 * @param {unknown} raw Id or name.
 * @return {?WorkerProduct} Match.
 */
export function findProduct(catalog: WorkerProduct[], raw: unknown): WorkerProduct | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const key = raw.trim().replace(/\*/g, "").toLowerCase();
  return catalog.find((p) => p.id === raw.trim()) ?? catalog.find((p) => p.name.toLowerCase() === key) ?? null;
}

/**
 * Which image slide layout fits the brand: screenshots for software, product shots otherwise.
 * Null when no catalog item has images.
 * @param {WorkerBrand} brand Brand.
 * @return {?string} "Product" | "Screenshot" | null.
 */
export function visualLayoutFor(brand: Pick<WorkerBrand, "category" | "catalog">): "Product" | "Screenshot" | null {
  if (!brand.catalog.some((p) => p.images.length)) return null;
  return brand.category === "saas" || brand.category === "app" ? "Screenshot" : "Product";
}

/**
 * Loads the brand's Prism setup (prism_brands/{agencyId}) and slide theme.
 * @param {string} agencyId Agency id.
 * @return {!Promise<WorkerBrand>} Brand context.
 */
export async function loadWorkerBrand(agencyId: string): Promise<WorkerBrand> {
  const snap = await db.collection("prism_brands").doc(agencyId).get();
  const s = snap.exists ? snap.data()! : null;
  const brandName = String(s?.brandName ?? "").trim();
  const pillars = Array.isArray(s?.pillars) ? (s!.pillars as Record<string, unknown>[]) : [];
  if (!s || !brandName || pillars.length === 0) {
    throw new Error("Set up your brand in Prism first (brand brief, pillars, and channels).");
  }

  const websiteUrl = String(s.websiteUrl ?? "").trim();
  const channels = (s.channels ?? {}) as Record<string, {enabled?: boolean; role?: string; postsPerWeek?: number}>;
  const pillarLines = pillars
    .map((p) => `- ${String(p.id)} (${String(p.label)}): ${String(p.description ?? "") || "no description"}`)
    .join("\n");
  const channelLines = Object.entries(CHANNEL_LABELS)
    .filter(([id]) => channels[id]?.enabled)
    .map(([id, label]) => `- ${label}: ${channels[id]?.role || "not specified"}`)
    .join("\n");
  const category = typeof s.category === "string" && s.category in CATEGORY_GUIDANCE ? s.category : "";
  const [kitSnap, agencySnap] = await Promise.all([
    db.collection("agencies").doc(agencyId).collection("private").doc("brandKit").get(),
    db.collection("agencies").doc(agencyId).get(),
  ]);
  const catalog = parseCatalog(kitSnap.data()?.products);
  const setupBlock = [
    `BRAND: ${brandName}${websiteUrl ? ` (${websiteUrl})` : ""}`,
    category ? `CATEGORY: ${CATEGORY_GUIDANCE[category]}` : "",
    `BRIEF:\n${String(s.brief ?? "") || "(none)"}`,
    `AUDIENCE:\n${String(s.audience ?? "") || "(none)"}`,
    `PILLARS:\n${pillarLines}`,
    `CHANNEL ROLES:\n${channelLines || "(none)"}`,
    catalog.length ?
      `CATALOG (real products / features; name them exactly, never invent others or their prices):\n${
        catalog.map(catalogLine).join("\n")}` :
      "CATALOG: (none on file — don't name specific products)",
  ].filter(Boolean).join("\n\n");

  const host = hostname(websiteUrl);
  let theme: CarouselTheme;
  let logoUrl = "";
  if (host.includes("tryverza")) {
    theme = VERZA_THEME;
  } else {
    const guide = (kitSnap.data()?.brandGuide ?? agencySnap.data()?.brandGuide ?? {}) as Record<string, unknown>;
    logoUrl = typeof guide.logoUrl === "string" ? guide.logoUrl.trim() : "";
    theme = brandTheme({
      primary: guide.primaryColor,
      secondary: guide.secondaryColor,
      accent: guide.accentColor,
      footer: host || brandName,
    });
  }

  return {
    brandName,
    websiteUrl,
    category,
    catalog,
    setupBlock,
    bannedClaims: String(s.bannedClaims ?? ""),
    theme,
    logoUrl,
  };
}
