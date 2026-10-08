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

export type WorkerBrand = {
  brandName: string;
  websiteUrl: string;
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
  const setupBlock = [
    `BRAND: ${brandName}${websiteUrl ? ` (${websiteUrl})` : ""}`,
    `BRIEF:\n${String(s.brief ?? "") || "(none)"}`,
    `AUDIENCE:\n${String(s.audience ?? "") || "(none)"}`,
    `PILLARS:\n${pillarLines}`,
    `CHANNEL ROLES:\n${channelLines || "(none)"}`,
  ].join("\n\n");

  const host = hostname(websiteUrl);
  let theme: CarouselTheme;
  let logoUrl = "";
  if (host.includes("tryverza")) {
    theme = VERZA_THEME;
  } else {
    const [kitSnap, agencySnap] = await Promise.all([
      db.collection("agencies").doc(agencyId).collection("private").doc("brandKit").get(),
      db.collection("agencies").doc(agencyId).get(),
    ]);
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
    setupBlock,
    bannedClaims: String(s.bannedClaims ?? ""),
    theme,
    logoUrl,
  };
}
