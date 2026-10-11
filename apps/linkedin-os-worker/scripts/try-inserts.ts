/**
 * Local check of product inserts: plans a video from a script (Gemini), then lays the planned inserts over an existing
 * 9:16 video, without Firestore, Omni or credits.
 *
 *   GEMINI_API_KEY=… npx tsx scripts/try-inserts.ts <video.mp4> <out.mp4> <script.md> <image> [image…]
 *
 * KIND=photo frames the images as product photos instead of screenshots.
 */
import {copyFile, mkdtemp, readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";

import {prepareProductImage} from "../src/carousel/productImage";
import {duration} from "../src/video/ffmpeg";
import {addInserts, type InsertImage} from "../src/video/inserts";
import {planVideo} from "../src/video/plan";

async function main(): Promise<void> {
  const [video, out, scriptPath, ...paths] = process.argv.slice(2);
  if (!video || !out || !scriptPath || !paths.length) throw new Error("usage: <video> <out> <script.md> <image…>");
  const kind = process.env.KIND === "photo" ? "photo" : "screenshot";
  const images: InsertImage[] = [];
  for (const p of paths) {
    const prepared = await prepareProductImage(await readFile(p));
    if (prepared) images.push({name: basename(p).replace(/\.\w+$/, ""), kind, ...prepared});
  }
  const seconds = Math.round((await duration(video)) / 10) * 10;
  const plan = await planVideo({
    script: await readFile(scriptPath, "utf8"),
    platform: "Instagram Reel",
    seconds,
    brandBlock: process.env.BRAND_BLOCK ?? "BRAND: Prism (tryverza.com/prism)\n\nCATEGORY: SaaS / software.",
    bannedClaims: "",
    product: null,
    refCount: 0,
    images: images.map(({name, kind: k, aspect}) => ({name, kind: k, aspect})),
  });
  console.log(JSON.stringify(plan.inserts, null, 2));
  const dir = await mkdtemp(join(tmpdir(), "try-inserts-"));
  const result = await addInserts({video, beats: plan.inserts, images, accent: "#10B981", host: "tryverza.com", dir});
  await copyFile(result, out);
  console.log(`wrote ${out} (scratch: ${dir})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
