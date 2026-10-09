#!/usr/bin/env node
/**
 * AppSumo Prism Lifetime codes: generate a CSV for AppSumo, then import it into Firestore.
 *
 *   node scripts/appsumo-prism-codes.mjs generate --count 2500
 *     Writes .local/appsumo-prism-codes.csv (one code per line, no header). Refuses to overwrite.
 *
 *   cd apps/functions && node ../../scripts/appsumo-prism-codes.mjs import --project verza-canvas [--dry-run]
 *     Creates appsumo_prism_codes/{code} with status "unused". Skips codes that already exist.
 *
 *   cd apps/functions && node ../../scripts/appsumo-prism-codes.mjs revoke --project verza-canvas CODE [CODE…]
 *     For AppSumo refunds: marks the codes revoked and removes Prism Lifetime from the brand that used them.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const csvPath = path.join(root, ".local", "appsumo-prism-codes.csv");
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const COLLECTION = "appsumo_prism_codes";

const [command, ...args] = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const normalize = (code) => String(code).trim().toUpperCase().replace(/\s+/g, "");

function block(n) {
  const bytes = crypto.randomBytes(n);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

async function firestore() {
  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
  const projectId = flag("--project") || process.env.GCLOUD_PROJECT || "verza-canvas-dev";
  console.log(`Project: ${projectId}`);
  initializeApp({ credential: applicationDefault(), projectId });
  return { db: getFirestore(), FieldValue };
}

if (command === "generate") {
  const count = Number(flag("--count") ?? 2500);
  if (!Number.isInteger(count) || count < 1000 || count > 10000) {
    console.error("AppSumo accepts 1,000 to 10,000 codes per upload. Pass --count in that range.");
    process.exit(1);
  }
  if (fs.existsSync(csvPath)) {
    console.error(`Already exists, not overwriting: ${csvPath}`);
    process.exit(1);
  }
  const codes = new Set();
  while (codes.size < count) codes.add(`AS-PRSM-${block(5)}-${block(5)}`);
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  fs.writeFileSync(csvPath, `${[...codes].join("\n")}\n`, { mode: 0o600 });
  console.log(`Wrote ${codes.size} codes to ${csvPath}`);
} else if (command === "import") {
  if (!fs.existsSync(csvPath)) {
    console.error(`Missing ${csvPath}. Run "generate" first.`);
    process.exit(1);
  }
  const codes = [...new Set(fs.readFileSync(csvPath, "utf8").split(/\r?\n/).map(normalize).filter(Boolean))];
  console.log(`Codes in CSV: ${codes.length}`);
  if (args.includes("--dry-run")) process.exit(0);
  const { db, FieldValue } = await firestore();
  const col = db.collection(COLLECTION);
  let created = 0;
  let skipped = 0;
  for (let i = 0; i < codes.length; i += 400) {
    const refs = codes.slice(i, i + 400).map((c) => col.doc(c));
    const snaps = await db.getAll(...refs);
    const batch = db.batch();
    snaps.forEach((snap, j) => {
      if (snap.exists) {
        skipped++;
        return;
      }
      batch.set(refs[j], { status: "unused", createdAt: FieldValue.serverTimestamp(), source: "appsumo_prism_csv" });
      created++;
    });
    await batch.commit();
    console.log(`… ${Math.min(i + 400, codes.length)} / ${codes.length}`);
  }
  console.log(`Done. created=${created} skipped=${skipped}`);
} else if (command === "revoke") {
  const codes = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--project").map(normalize);
  if (!codes.length) {
    console.error("Pass one or more codes to revoke.");
    process.exit(1);
  }
  const { db, FieldValue } = await firestore();
  for (const code of codes) {
    const ref = db.collection(COLLECTION).doc(code);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return "not found";
      const { agencyId, status } = snap.data();
      if (status === "revoked") return "already revoked";
      const agencyRef = agencyId ? db.collection("agencies").doc(agencyId) : null;
      const agency = agencyRef ? (await tx.get(agencyRef)).data() : null;
      tx.update(ref, { status: "revoked", revokedAt: FieldValue.serverTimestamp() });
      if (agencyRef && agency?.prismLifetimeCode === code) {
        tx.update(agencyRef, {
          prismLifetime: false,
          prismLifetimeRevokedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return `revoked, Lifetime removed from ${agencyId}`;
      }
      return "revoked (not redeemed)";
    });
    console.log(`${code}: ${result}`);
  }
} else {
  console.error('Usage: appsumo-prism-codes.mjs generate|import|revoke (see the header of this file)');
  process.exit(1);
}
