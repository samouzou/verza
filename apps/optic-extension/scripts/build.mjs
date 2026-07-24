import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");
mkdirSync("dist", { recursive: true });

const config = {
  bundle: true,
  format: "iife",
  target: "chrome120",
  logLevel: "info",
  entryPoints: {
    background: "src/background.ts",
    "verza-bridge": "src/content/verza-bridge.ts",
    popup: "src/popup/popup.ts",
    injected: "src/instagram/injected.ts",
  },
  outdir: "dist",
};

async function build() {
  if (watch) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
    console.log("[optic-extension] watching…");
  } else {
    await esbuild.build(config);
    console.log("[optic-extension] build complete");
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
