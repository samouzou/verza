import {getFirestore} from "firebase-admin/firestore";

import {loadWorkerBrand} from "./brand";
import {buildCarouselPdf, buildCarouselZip, renderCarouselPngs} from "./carousel/renderCarousel";
import {uploadCarouselAssets} from "./carousel/uploadCarousel";
import {getDefaultBucket} from "./firebaseAdmin";

const db = getFirestore();

const CAROUSEL_FORMATS = new Set(["carousel_outline", "ig_carousel"]);

export class RenderInputError extends Error {}

/**
 * Renders slides from a calendar post's current carousel copy and attaches them to that channel's variant.
 * Each render gets a fresh folder (slides are cached for a year); the post's previous re-render is deleted.
 * @param {string} postId prism_posts id.
 * @param {string} channel Channel whose variant to render.
 * @return {!Promise<{slides: number}>} Slide count.
 */
export async function renderPostSlides(postId: string, channel: string): Promise<{slides: number}> {
  const ref = db.collection("prism_posts").doc(postId);
  const snap = await ref.get();
  const post = snap.data();
  if (!post) throw new RenderInputError("Post not found.");
  const agencyId = String(post.agencyId ?? "");
  const variant = post.variants?.[channel] as {format?: string; text?: string; assets?: {slides?: {storagePath: string}[]}} | undefined;
  if (!variant || !CAROUSEL_FORMATS.has(String(variant.format))) {
    throw new RenderInputError("That channel isn't a carousel.");
  }
  const text = String(variant.text ?? "").trim();
  if (!text) throw new RenderInputError("Write the carousel outline first.");

  const brand = await loadWorkerBrand(agencyId);
  let pngSlides;
  try {
    pngSlides = await renderCarouselPngs(text, brand.theme);
  } catch {
    throw new RenderInputError("No slides found. Keep the \"## Slide 1 — label\" headings in the outline.");
  }
  const [pdf, zip] = await Promise.all([buildCarouselPdf(pngSlides), buildCarouselZip(pngSlides)]);
  const assets = await uploadCarouselAssets({
    agencyId,
    jobId: `posts/${postId}`,
    outputId: `${channel}-${Date.now()}`,
    slides: pngSlides,
    pdf,
    zip,
  });

  await ref.update({
    [`variants.${channel}.assets`]: {...assets, renderedAt: new Date().toISOString()},
  });

  const ownPrefix = `linkedin_os_carousels/${agencyId}/posts/${postId}/`;
  const previous = variant.assets?.slides?.[0]?.storagePath ?? "";
  if (previous.startsWith(ownPrefix)) {
    const folder = previous.slice(0, previous.lastIndexOf("/") + 1);
    await getDefaultBucket().deleteFiles({prefix: folder}).catch(() => undefined);
  }
  return {slides: pngSlides.length};
}
