import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import sharp from "sharp";
import {FieldValue, getFirestore} from "firebase-admin/firestore";

import {findProduct, loadWorkerBrand} from "../brand";
import {getDefaultBucket} from "../firebaseAdmin";
import {concat, cover, cut, duration, finish} from "./ffmpeg";
import {extend, generateFirst, OmniError, type RefImage} from "./omni";
import {planVideo} from "./plan";
import {speak} from "./voiceover";

const db = getFirestore();
const VIDEO_FORMATS = new Set(["ig_reel", "tiktok_video"]);
const MAX_REFS = 3;
const SEGMENT_SECONDS = 10;
const LABELS: Record<string, string> = {instagram: "Instagram", tiktok: "TikTok"};

/** A failure whose message is fine to show the team. */
export class VideoInputError extends Error {}

/**
 * The script without its caption, which isn't part of the video.
 * @param {string} text Variant copy.
 * @return {string} Script.
 */
function scriptOnly(text: string): string {
  return text.replace(/^##\s*Caption\s*$[\s\S]*?(?=^##\s|$(?![\s\S]))/im, "").trim();
}

/**
 * Downloads up to three product photos as references, downscaled for upload.
 * @param {!Array<string>} urls https image URLs.
 * @return {!Promise<!Array<RefImage>>} References.
 */
async function loadRefs(urls: string[]): Promise<RefImage[]> {
  const out: RefImage[] = [];
  for (const url of urls.slice(0, MAX_REFS)) {
    try {
      const res = await fetch(url, {signal: AbortSignal.timeout(10_000)});
      if (!res.ok) continue;
      const jpeg = await sharp(Buffer.from(await res.arrayBuffer())).rotate()
        .resize({width: 1024, height: 1024, fit: "inside", withoutEnlargement: true})
        .flatten({background: "#ffffff"}).jpeg({quality: 90}).toBuffer();
      out.push({data: jpeg.toString("base64"), mimeType: "image/jpeg"});
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Renders a Reel or TikTok video for a prism_video_jobs doc: plans 10-second segments from the script, generates the
 * first with Omni, extends it 10 seconds at a time, adds a voiceover, and attaches the MP4 and cover to the post.
 * Credits were taken when the job was created; marking the job failed gives them back.
 * @param {string} jobId prism_video_jobs id.
 * @return {!Promise<void>}
 */
export async function renderPrismVideo(jobId: string): Promise<void> {
  const jobRef = db.collection("prism_video_jobs").doc(jobId);
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists || snap.get("status") !== "queued") return null;
    tx.update(jobRef, {status: "planning", stage: "Planning shots", updatedAt: FieldValue.serverTimestamp()});
    return snap.data() as {agencyId: string; postId: string; channel: string; seconds: number};
  });
  if (!claimed) return;
  const {agencyId, postId, channel, seconds} = claimed;
  const progress = (status: string, stage: string) =>
    jobRef.update({status, stage, updatedAt: FieldValue.serverTimestamp()});

  const dir = await mkdtemp(join(tmpdir(), `prism-video-${jobId}-`));
  try {
    const postRef = db.collection("prism_posts").doc(postId);
    const post = (await postRef.get()).data();
    const variant = post?.variants?.[channel] as {format?: string; text?: string} | undefined;
    if (!post || post.agencyId !== agencyId) throw new VideoInputError("The post was deleted.");
    if (!variant || !VIDEO_FORMATS.has(String(variant.format))) throw new VideoInputError("This channel isn't a video anymore.");
    const script = scriptOnly(String(variant.text ?? ""));
    if (!script) throw new VideoInputError("Write the script first.");

    const brand = await loadWorkerBrand(agencyId);
    const product = findProduct(brand.catalog, post.productId);
    const refs = product ? await loadRefs(product.images) : [];
    const plan = await planVideo({
      script,
      platform: channel === "tiktok" ? "TikTok" : "Instagram Reel",
      seconds,
      brandBlock: brand.setupBlock,
      bannedClaims: brand.bannedClaims,
      product: refs.length && product ? product.name : null,
      refCount: refs.length,
    });

    const total = plan.segments.length;
    let outputTokens = 0;
    await progress("generating", `Rendering part 1 of ${total}`);
    const pieces: string[] = [];
    const first = join(dir, "seg0.mp4");
    outputTokens += await generateFirst(plan.segments[0]!, refs, first);
    pieces.push(first);

    for (let i = 1; i < total; i++) {
      await progress("generating", `Rendering part ${i + 1} of ${total}`);
      const last = pieces.pop()!;
      const len = await duration(last);
      const tail = join(dir, `tail${i}.mp4`);
      await cut(last, tail, Math.max(0, len - SEGMENT_SECONDS), Math.min(SEGMENT_SECONDS, len));
      if (len > SEGMENT_SECONDS + 0.5) {
        const head = join(dir, `head${i}.mp4`);
        await cut(last, head, 0, len - SEGMENT_SECONDS);
        pieces.push(head);
      }
      const extended = join(dir, `seg${i}.mp4`);
      outputTokens += await extend(tail, plan.segments[i]!, refs, extended);
      pieces.push(extended);
    }

    await progress("assembling", plan.voiceover ? "Adding the voiceover" : "Finishing");
    const normalized: string[] = [];
    for (const [i, p] of pieces.entries()) {
      const n = join(dir, `n${i}.mp4`);
      await cut(p, n, 0, await duration(p));
      normalized.push(n);
    }
    let joined = normalized[0]!;
    if (normalized.length > 1) {
      joined = join(dir, "joined.mp4");
      await concat(normalized, joined);
    }
    let voice: string | null = null;
    if (plan.voiceover) {
      voice = join(dir, "voice.wav");
      await speak(plan.voiceover, plan.voiceStyle, voice);
    }
    const final = join(dir, "video.mp4");
    await finish({video: joined, voice, dest: final});
    const coverFile = join(dir, "cover.jpg");
    await cover(final, coverFile);

    const folder = `linkedin_os_carousels/${agencyId}/posts/${postId}/${channel}-video-${Date.now()}/`;
    const bucket = getDefaultBucket();
    const meta = {cacheControl: "public, max-age=31536000"};
    await Promise.all([
      bucket.file(`${folder}video.mp4`).save(await readFile(final), {contentType: "video/mp4", metadata: meta}),
      bucket.file(`${folder}cover.jpg`).save(await readFile(coverFile), {contentType: "image/jpeg", metadata: meta}),
    ]);
    const video = {
      storagePath: `${folder}video.mp4`,
      coverPath: `${folder}cover.jpg`,
      seconds: Math.round(await duration(final)),
      renderedAt: new Date().toISOString(),
      jobId,
    };

    const previous = await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(postRef)).data();
      const v = fresh?.variants?.[channel] as {format?: string; video?: {storagePath?: string}} | undefined;
      if (!fresh || !v || !VIDEO_FORMATS.has(String(v.format))) return null;
      const history = Array.isArray(fresh.history) ? fresh.history : [];
      tx.update(postRef, {
        [`variants.${channel}.video`]: video,
        history: [...history, {
          at: video.renderedAt, uid: "prism", name: "Prism", action: `made the ${LABELS[channel] ?? channel} video`,
        }].slice(-50),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return v.video?.storagePath ?? "";
    });
    await jobRef.update({
      status: "done",
      stage: "Ready",
      output: {storagePath: video.storagePath, coverPath: video.coverPath},
      outputTokens,
      updatedAt: FieldValue.serverTimestamp(),
      finishedAt: FieldValue.serverTimestamp(),
    });
    const ownPrefix = `linkedin_os_carousels/${agencyId}/posts/${postId}/`;
    if (previous && previous.startsWith(ownPrefix)) {
      await bucket.deleteFiles({prefix: previous.slice(0, previous.lastIndexOf("/") + 1)}).catch(() => undefined);
    }
    console.log("[prism-video] done", {jobId, seconds: video.seconds, outputTokens});
  } catch (e) {
    const shown = e instanceof VideoInputError || e instanceof OmniError ? e.message : "The video render failed. Try again.";
    console.error("[prism-video] failed", {jobId, error: e instanceof Error ? e.message : String(e)});
    await jobRef.update({
      status: "failed",
      stage: "Failed",
      error: shown.slice(0, 300),
      updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => undefined);
    throw e;
  } finally {
    await rm(dir, {recursive: true, force: true}).catch(() => undefined);
  }
}
