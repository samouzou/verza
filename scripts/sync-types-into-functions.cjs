/**
 * Copies packages/types into apps/functions so Cloud Build (Firebase Functions)
 * can resolve @verza/types via file: without the monorepo root.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "packages", "types");
const dest = path.join(root, "apps", "functions", "packages-local", "types");

function rmrf(p) {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

if (!fs.existsSync(src)) {
  console.error("Missing source:", src);
  process.exit(1);
}

rmrf(dest);
copyDir(src, dest);

// Cloud Functions load this package from CommonJS. The source entry is ESM
// TypeScript, so point the runtime entry at an empty CJS stub and leave the
// .ts file for the typechecker.
fs.writeFileSync(path.join(dest, "runtime.cjs"), "module.exports = {};\n");
const pkgPath = path.join(dest, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.main = "./runtime.cjs";
pkg.types = "./src/index.ts";
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log("Synced packages/types -> apps/functions/packages-local/types");
