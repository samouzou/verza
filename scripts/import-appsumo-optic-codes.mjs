#!/usr/bin/env node
/**
 * Import AppSumo Optic codes from .local/appsumo-optic-codes.csv into Firestore.
 *
 * Usage (ADC / service account; resolve firebase-admin from apps/functions):
 *   cd apps/functions && node ../../scripts/import-appsumo-optic-codes.mjs [--project verza-canvas-dev] [--dry-run]
 *
 * CSV: one column, no header. Doc id = normalized code. Skips existing docs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const csvPath = path.join(root, ".local", "appsumo-optic-codes.csv");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const projectIdx = args.indexOf("--project");
const projectId =
  (projectIdx >= 0 && args[projectIdx + 1]) ||
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  "verza-canvas-dev";

function normalize(code) {
  return String(code).trim().toUpperCase().replace(/\s+/g, "");
}

if (!fs.existsSync(csvPath)) {
  console.error("Missing CSV:", csvPath);
  process.exit(1);
}

const lines = fs
  .readFileSync(csvPath, "utf8")
  .split(/\r?\n/)
  .map(normalize)
  .filter(Boolean);

const unique = [...new Set(lines)];
console.log(`Project: ${projectId}`);
console.log(`Codes in CSV: ${lines.length} (${unique.length} unique)`);
if (dryRun) {
  console.log("Dry run — no writes.");
  process.exit(0);
}

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credPath && !fs.existsSync(credPath)) {
  console.error(`GOOGLE_APPLICATION_CREDENTIALS points to a missing file:\n  ${credPath}`);
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const col = db.collection("appsumo_optic_codes");

const BATCH = 400;
let created = 0;
let skipped = 0;

function authHint(err) {
  const msg = String(err?.message ?? err ?? "");
  if (
    msg.includes("invalid_rapt") ||
    msg.includes("invalid_grant") ||
    msg.includes("reauth") ||
    msg.includes("Getting metadata from plugin failed")
  ) {
    console.error(`
Google auth failed (expired ADC / reauth required). Fix with:

  unset GOOGLE_APPLICATION_CREDENTIALS
  gcloud auth application-default login

Then re-run this script from apps/functions.
`);
  }
}

for (let i = 0; i < unique.length; i += BATCH) {
  const slice = unique.slice(i, i + BATCH);
  const refs = slice.map((c) => col.doc(c));
  let snaps;
  try {
    snaps = await db.getAll(...refs);
  } catch (err) {
    authHint(err);
    throw err;
  }
  const batch = db.batch();
  let ops = 0;
  for (let j = 0; j < snaps.length; j++) {
    if (snaps[j].exists) {
      skipped++;
      continue;
    }
    batch.set(refs[j], {
      status: "unused",
      createdAt: FieldValue.serverTimestamp(),
      source: "appsumo_optic_csv",
    });
    ops++;
    created++;
  }
  if (ops > 0) await batch.commit();
  console.log(`… ${Math.min(i + BATCH, unique.length)} / ${unique.length}`);
}

console.log(`Done. created=${created} skipped=${skipped}`);
