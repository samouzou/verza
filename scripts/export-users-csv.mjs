#!/usr/bin/env node
/**
 * Export Firestore users to CSV for SendGrid / marketing lists.
 *
 * Same auth as deploying Optic worker — active gcloud project, no service account JSON:
 *
 *   export GCP_PROJECT="verza-canvas"   # or verza-canvas-dev
 *   gcloud config set project "$GCP_PROJECT"
 *   node scripts/export-users-csv.mjs --role=creator --out=creators.csv
 *
 * If you get a credentials error once, run:
 *   gcloud auth application-default login
 *
 * Roles: creator | brand | all
 */

import { createRequire } from "node:module";
import { existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(__dirname, "../apps/functions/package.json"));
const admin = require("firebase-admin");

const CREATOR_ROLES = new Set(["individual_creator", "talent"]);
const BRAND_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);

function parseArgs(argv) {
  const opts = {
    role: "all",
    out: "users-export.csv",
    project:
      process.env.GCP_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      "verza-canvas",
    includeNoEmail: false,
  };

  for (const arg of argv) {
    if (arg === "--include-no-email") {
      opts.includeNoEmail = true;
      continue;
    }
    if (arg.startsWith("--role=")) {
      opts.role = arg.slice("--role=".length).trim().toLowerCase();
      continue;
    }
    if (arg.startsWith("--out=")) {
      opts.out = arg.slice("--out=".length).trim();
      continue;
    }
    if (arg.startsWith("--project=")) {
      opts.project = arg.slice("--project=".length).trim();
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/export-users-csv.mjs [options]

  export GCP_PROJECT="verza-canvas"
  gcloud config set project "$GCP_PROJECT"
  node scripts/export-users-csv.mjs --role=creator --out=creators.csv

Options:
  --role=creator|brand|all   (default: all)
  --out=path.csv             (default: users-export.csv)
  --project=...              overrides GCP_PROJECT / gcloud project
  --include-no-email
`);
      process.exit(0);
    }
  }

  if (!["all", "creator", "brand"].includes(opts.role)) {
    console.error(`Invalid --role=${opts.role}. Use creator, brand, or all.`);
    process.exit(1);
  }

  return opts;
}

function csvCell(value) {
  const s = value == null ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function matchesRoleFilter(role, filter) {
  if (filter === "all") return true;
  if (filter === "creator") return CREATOR_ROLES.has(role);
  if (filter === "brand") return BRAND_ROLES.has(role);
  return false;
}

function formatTimestamp(ts) {
  if (!ts) return "";
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  if (ts instanceof Date) return ts.toISOString();
  return "";
}

function assertCredentials() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) return;

  if (!existsSync(credPath)) {
    console.error(`GOOGLE_APPLICATION_CREDENTIALS points to a missing file:\n  ${credPath}`);
    console.error(`
Unset it and use your gcloud login (same as Optic deploy):

  unset GOOGLE_APPLICATION_CREDENTIALS
  gcloud auth application-default login
  gcloud config set project verza-canvas
`);
    process.exit(1);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  assertCredentials();

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.warn(
      `Warning: FIRESTORE_EMULATOR_HOST is set — exporting emulator data, not production.`
    );
  }

  console.log(`Project: ${opts.project}`);

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: opts.project,
    });
  }

  const db = admin.firestore();
  const snap = await db.collection("users").get();

  const header = [
    "uid",
    "email",
    "displayName",
    "role",
    "primaryAgencyId",
    "emailVerified",
    "subscriptionStatus",
    "createdAt",
  ];
  const rows = [header];
  let skippedRole = 0;
  let skippedNoEmail = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    const role = String(d.role ?? "");

    if (!matchesRoleFilter(role, opts.role)) {
      skippedRole++;
      continue;
    }

    const email = typeof d.email === "string" ? d.email.trim() : "";
    if (!email && !opts.includeNoEmail) {
      skippedNoEmail++;
      continue;
    }

    rows.push([
      doc.id,
      email,
      d.displayName ?? "",
      role,
      d.primaryAgencyId ?? "",
      d.emailVerified === true ? "true" : "false",
      d.subscriptionStatus ?? "",
      formatTimestamp(d.createdAt),
    ]);
  }

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const outPath = resolve(process.cwd(), opts.out);
  writeFileSync(outPath, csv, "utf8");

  console.log(`Wrote ${rows.length - 1} users → ${outPath}`);
  console.log(`  role filter: ${opts.role}`);
  if (skippedRole) console.log(`  skipped (role): ${skippedRole}`);
  if (skippedNoEmail) console.log(`  skipped (no email): ${skippedNoEmail}`);
}

main().catch((err) => {
  console.error(err);
  if (
    /Could not load the default credentials|ENOENT|UNAUTHENTICATED|PERMISSION_DENIED/i.test(
      String(err)
    )
  ) {
    console.error(`
Try:
  unset GOOGLE_APPLICATION_CREDENTIALS
  gcloud auth application-default login
  gcloud config set project verza-canvas
`);
  }
  process.exit(1);
});
