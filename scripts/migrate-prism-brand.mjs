#!/usr/bin/env node
/**
 * One-time: copy the legacy global LinkedIn OS prompt pack (linkedin_os_prompts/default) into one
 * agency's Prism brand setup (prism_brands/{agencyId}). Skips if that agency already has a setup.
 *
 * Usage (ADC / service account; resolve firebase-admin from apps/functions):
 *   cd apps/functions && node ../../scripts/migrate-prism-brand.mjs --agency <agencyId> [--project verza-canvas] [--dry-run]
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const agencyId = flag("--agency");
const projectId =
  flag("--project") || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "verza-canvas-dev";

if (!agencyId) {
  console.error("Missing --agency <agencyId>");
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

const [legacySnap, agencySnap, existingSnap] = await Promise.all([
  db.collection("linkedin_os_prompts").doc("default").get(),
  db.collection("agencies").doc(agencyId).get(),
  db.collection("prism_brands").doc(agencyId).get(),
]);

if (!agencySnap.exists) {
  console.error(`Agency ${agencyId} not found in ${projectId}.`);
  process.exit(1);
}
if (existingSnap.exists) {
  console.log(`prism_brands/${agencyId} already exists — nothing to do.`);
  process.exit(0);
}

const legacy = legacySnap.exists ? legacySnap.data() : {};
const brandBrief = String(legacy.brandBrief ?? "").trim();
const socialStrategy = String(legacy.socialStrategy ?? "").trim();
const brief = [brandBrief, socialStrategy && `## Social strategy\n${socialStrategy}`]
  .filter(Boolean)
  .join("\n\n")
  .slice(0, 6000);

const setup = {
  agencyId,
  brandName: String(agencySnap.data()?.name ?? "Verza").trim() || "Verza",
  websiteUrl: "https://tryverza.com",
  brief,
  audience: "Brand marketers and agency teams running creator campaigns, and the creators they work with.",
  pillars: [
    { id: "build_in_public", label: "Build in public", description: "What we shipped and why, with real numbers only.", share: 25 },
    { id: "playbooks", label: "Playbooks", description: "Practical creator-marketing how-tos for brand teams.", share: 30 },
    { id: "creator_respect", label: "Creator respect", description: "Fair pay, clear briefs, and treating creators as partners.", share: 20 },
    { id: "product_receipts", label: "Product receipts", description: "Concrete proof of how Verza works, shown not told.", share: 25 },
  ],
  channels: {
    linkedin: { enabled: true, role: "Founder-led insight and proof for brand and agency buyers", postsPerWeek: 3 },
    x: { enabled: false, role: "", postsPerWeek: 0 },
    instagram: { enabled: false, role: "", postsPerWeek: 0 },
    tiktok: { enabled: false, role: "", postsPerWeek: 0 },
  },
  bannedClaims: String(legacy.bannedClaims ?? "").trim().slice(0, 3000),
  timezone: "America/New_York",
  approvalRequired: true,
};

console.log(`Project: ${projectId}`);
console.log(`Legacy pack found: ${legacySnap.exists} (brief ${brief.length} chars, banned ${setup.bannedClaims.length} chars)`);
console.log(`Writing prism_brands/${agencyId} for "${setup.brandName}"`);
if (dryRun) {
  console.log("Dry run — no writes.");
  process.exit(0);
}

await db.collection("prism_brands").doc(agencyId).set({
  ...setup,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
  updatedBy: "migrate-prism-brand",
});
console.log("Done. Review it at /prism/setup.");
