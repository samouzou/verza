import { execSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const staging = join(root, "release", "verza-optic-scout");
const zipPath = join(root, "release", "verza-optic-scout.zip");
const webDownloadDir = join(root, "..", "web", "public", "downloads");
const webZipPath = join(webDownloadDir, "verza-optic-scout.zip");

execSync("node scripts/build.mjs", { cwd: root, stdio: "inherit" });

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

for (const path of ["dist", "popup", "icons"]) {
  cpSync(join(root, path), join(staging, path), { recursive: true });
}
cpSync(join(root, "manifest.prod.json"), join(staging, "manifest.json"));

const manifest = JSON.parse(readFileSync(join(staging, "manifest.json"), "utf8"));
writeFileSync(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

rmSync(zipPath, { force: true });
execSync(`cd "${join(root, "release")}" && zip -r verza-optic-scout.zip verza-optic-scout`, {
  stdio: "inherit",
});

mkdirSync(webDownloadDir, { recursive: true });
cpSync(zipPath, webZipPath);

console.log(`[optic-extension] packaged → ${zipPath}`);
console.log(`[optic-extension] copied for web → ${webZipPath}`);
