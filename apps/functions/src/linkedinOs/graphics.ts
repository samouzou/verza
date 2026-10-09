import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {googleAI} from "@genkit-ai/google-genai";
import {ai} from "../ai/genkit";
import {db} from "../config/firebase";
import * as params from "../config/params";
import {withPrismUsage} from "./billing";
import {isPrismChannel, loadPrismBrandStrategy, PRISM_CHANNEL_LABELS} from "./brandStrategy";
import {findCatalogItem, loadPrismCatalog, visualLayoutFor, type PrismCatalogItem} from "./products";
import {appendHistory, LOCKED_MESSAGE, loadPrismPost, prismCaller, prismEvent, withPublisher} from "./posts";
import type {PrismPost, PrismVariantAssets} from "./types";

const GRAPHIC_FORMATS = new Set(["ig_feed"]);
const VERZA_COLORS = ["#0B100E", "#0E7C5A", "#16C088"];
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;

type Graphic = {image: Buffer; contentType: string};

/**
 * Downloads a product image to pass to the image model, or null.
 * @param {string} url https image URL.
 * @return {!Promise<?{url: string, contentType: string}>} Data URI and type.
 */
async function referenceImage(url: string): Promise<{url: string; contentType: string} | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, {signal: ctrl.signal});
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!res.ok || !/^image\/(png|jpeg|webp)$/.test(contentType)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_REFERENCE_BYTES) return null;
    return {url: `data:${contentType};base64,${buf.toString("base64")}`, contentType};
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The on-image headline a Visual section asks for: its first quoted text, else the caption hook.
 * @param {string} visual Visual section.
 * @param {string} hook Caption hook.
 * @return {string} Headline (12 words max).
 */
function headlineFrom(visual: string, hook: string): string {
  const quoted = visual.match(/["“]([^"”]{2,90})["”]/)?.[1]?.trim();
  return (quoted || hook).split(/\s+/).slice(0, 12).join(" ").replace(/[#*]/g, "");
}

/**
 * Asks the worker for a framed-screenshot graphic, so the interface is real rather than redrawn by a model.
 * @param {string} agencyId Agency id.
 * @param {PrismCatalogItem} product Featured product.
 * @param {string} headline On-image headline.
 * @return {!Promise<Graphic>} PNG.
 */
async function screenshotGraphic(agencyId: string, product: PrismCatalogItem, headline: string): Promise<Graphic> {
  const workerUrl = params.LINKEDIN_OS_WORKER_URL.value().trim();
  const secret = params.LINKEDIN_OS_WORKER_SHARED_SECRET.value().trim();
  if (!workerUrl || !secret) throw new HttpsError("unavailable", "The graphic renderer isn't configured.");
  const res = await fetch(`${workerUrl.replace(/\/$/, "")}/internal/render-feed`, {
    method: "POST",
    headers: {"Content-Type": "application/json", "x-verza-linkedin-os-secret": secret},
    body: JSON.stringify({agencyId, productId: product.id, headline}),
  });
  const json = (await res.json().catch(() => ({}))) as {error?: string; png?: string};
  if (!res.ok || !json.png) {
    logger.error("[Prism] Screenshot graphic failed", {agencyId, status: res.status, error: json.error});
    throw new HttpsError(
      res.status === 400 ? "failed-precondition" : "internal",
      res.status === 400 && json.error ? json.error : "Could not make the graphic. Try again."
    );
  }
  return {image: Buffer.from(json.png, "base64"), contentType: "image/png"};
}

/**
 * A "## Heading" section of a sectioned draft.
 * @param {string} text Draft.
 * @param {string} heading Section name.
 * @return {string} Section body, or "".
 */
function section(text: string, heading: string): string {
  const m = text.match(new RegExp(`^##\\s*${heading}\\s*$([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, "im"));
  return m?.[1]?.trim() ?? "";
}

/**
 * Brand name and guide colors for the image prompt.
 * @param {string} agencyId Agency id.
 * @return {!Promise<{name: string, colors: !Array<string>}>} Brand look.
 */
async function brandLook(agencyId: string): Promise<{name: string; colors: string[]}> {
  const [brandSnap, kitSnap, agencySnap] = await Promise.all([
    db.collection("prism_brands").doc(agencyId).get(),
    db.collection("agencies").doc(agencyId).collection("private").doc("brandKit").get(),
    db.collection("agencies").doc(agencyId).get(),
  ]);
  const brand = brandSnap.data() ?? {};
  const name = String(brand.brandName ?? agencySnap.data()?.name ?? "").trim();
  if (/tryverza/i.test(String(brand.websiteUrl ?? ""))) return {name, colors: VERZA_COLORS};
  const guide = (kitSnap.data()?.brandGuide ?? agencySnap.data()?.brandGuide ?? {}) as Record<string, unknown>;
  const colors = [guide.primaryColor, guide.secondaryColor, guide.accentColor]
    .filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{3,6}$/i.test(c.trim()))
    .map((c) => c.trim());
  return {name, colors};
}

/**
 * Builds the image prompt from the post's Visual section.
 * @param {object} o Prompt inputs.
 * @param {string} o.visual Visual description.
 * @param {string} o.hook Caption hook, for context only.
 * @param {string} o.brand Brand name.
 * @param {!Array<string>} o.colors Brand hex colors.
 * @param {string} o.instruction Optional tweak from the team.
 * @param {string} [o.product] Name of the product shown in the attached reference photo.
 * @return {string} Prompt.
 */
function graphicPrompt(o: {
  visual: string;
  hook: string;
  brand: string;
  colors: string[];
  instruction: string;
  product?: string;
}): string {
  return [
    `Create one finished Instagram feed graphic${o.brand ? ` for the brand "${o.brand}"` : ""}, 4:5 portrait.`,
    o.product ? `THE PRODUCT: the attached image is the real "${o.product}". Feature this exact product as the hero. ` +
      "Keep its shape, colors, label, packaging and any printed text exactly as in the photo; don't redesign, " +
      "relabel or add variants. Re-light and place it naturally in the scene." : "",
    `WHAT TO SHOW:\n${o.visual}`,
    o.colors.length ? `PALETTE: build the graphic around these brand colors: ${o.colors.join(", ")}.` : "",
    o.hook ? `CONTEXT (the caption's first line; do not render it as text): ${o.hook}` : "",
    o.instruction ? `CHANGES REQUESTED BY THE TEAM: ${o.instruction}` : "",
    "RULES:",
    "- Only render on-image text that the description asks for, spelled exactly. If it asks for none, add no text.",
    "- Any text is large, high-contrast, and inside the central 80% so nothing is cropped.",
    "- No watermarks, fake app UI, made-up logos, or brand names other than the one above.",
    "- Clean, modern, scroll-stopping, and ready to post as is.",
  ].filter(Boolean).join("\n\n");
}

/**
 * Generates the single image for an Instagram feed post from its "## Visual" section and attaches it
 * to that channel's variant, replacing the previous one.
 * @return {!Promise<{ok: boolean}>} Result.
 */
export const generatePrismGraphic = onCall({timeoutSeconds: 120, memory: "1GiB"}, async (request) => {
  const c = await prismCaller(request.auth?.uid);
  const {ref, post, postId} = await loadPrismPost(c, request.data?.postId);
  const channel = request.data?.channel;
  if (!isPrismChannel(channel) || !post.channels.includes(channel)) {
    throw new HttpsError("invalid-argument", "Pick one of the post's channels.");
  }
  const variant = post.variants?.[channel];
  if (!variant || !GRAPHIC_FORMATS.has(variant.format)) {
    throw new HttpsError("failed-precondition", "Switch this channel to a feed post first.");
  }
  if (post.status === "posted") throw new HttpsError("failed-precondition", "This post is already marked posted.");
  if (withPublisher(post)) throw new HttpsError("failed-precondition", LOCKED_MESSAGE);
  const visual = section(variant.text, "Visual");
  if (!visual) throw new HttpsError("failed-precondition", "Add a \"## Visual\" section describing the image first.");
  const instruction = typeof request.data?.instruction === "string" ? request.data.instruction.trim().slice(0, 500) : "";

  const [look, catalog, strategy] = await Promise.all([
    brandLook(c.agencyId),
    loadPrismCatalog(c.agencyId),
    loadPrismBrandStrategy(c.agencyId),
  ]);
  const hook = section(variant.text, "Caption").split("\n").find((l) => l.trim())?.trim() ?? "";
  const found = findCatalogItem(catalog, post.productId);
  const featured = found?.images[0] ? {product: found, image: found.images[0]} : null;
  const screenshots = visualLayoutFor(catalog, strategy?.category ?? "") === "Screenshot";
  const mode = !featured ? "ai" : screenshots ? "screenshot" : "product";

  const assets = await withPrismUsage(c.agencyId, {slideRender: true, graphic: true}, async () => {
    let graphic: Graphic;
    if (featured && screenshots) {
      graphic = await screenshotGraphic(c.agencyId, featured.product, headlineFrom(visual, hook));
    } else {
      const reference = featured ? await referenceImage(featured.image) : null;
      const prompt = graphicPrompt({
        visual, hook, brand: look.name, colors: look.colors, instruction,
        ...(reference && featured ? {product: featured.product.name} : {}),
      });
      try {
        const {media} = await ai.generate({
          model: googleAI.model("gemini-2.5-flash-image"),
          prompt: reference ? [{media: reference}, {text: prompt}] : prompt,
          config: {responseModalities: ["TEXT", "IMAGE"], imageConfig: {aspectRatio: "4:5"}},
        });
        if (!media?.url) throw new Error("No image returned.");
        graphic = {
          contentType: media.contentType || media.url.match(/^data:([^;]+);/)?.[1] || "image/png",
          image: Buffer.from(media.url.slice(media.url.indexOf(",") + 1), "base64"),
        };
      } catch (e) {
        logger.error("[Prism] Graphic generation failed", {postId, channel, e: String(e)});
        throw new HttpsError("internal", "Could not make the graphic. Try again, or reword the Visual section.");
      }
    }
    const {image, contentType} = graphic;
    const ext = contentType.includes("jpeg") ? "jpg" : "png";
    const filename = `graphic.${ext}`;
    const storagePath = `linkedin_os_carousels/${c.agencyId}/posts/${postId}/${channel}-${Date.now()}/${filename}`;
    await admin.storage().bucket(params.APP_STORAGE_BUCKET.value()).file(storagePath).save(image, {
      contentType,
      metadata: {cacheControl: "public, max-age=31536000"},
    });
    const out: PrismVariantAssets = {
      slides: [{index: 1, storagePath, filename}],
      renderedAt: new Date().toISOString(),
      visual,
    };
    return out;
  });

  const previous = variant.assets?.slides?.[0]?.storagePath ?? "";
  await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data() as PrismPost | undefined;
    tx.update(ref, {
      [`variants.${channel}.assets`]: assets,
      history: appendHistory(fresh?.history ?? post.history, prismEvent(c, `made the ${PRISM_CHANNEL_LABELS[channel]} graphic`)),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: c.uid,
    });
  });

  const ownPrefix = `linkedin_os_carousels/${c.agencyId}/posts/${postId}/`;
  if (previous.startsWith(ownPrefix)) {
    const folder = previous.slice(0, previous.lastIndexOf("/") + 1);
    await admin.storage().bucket(params.APP_STORAGE_BUCKET.value()).deleteFiles({prefix: folder}).catch(() => undefined);
  }
  logger.info("[Prism] Graphic generated", {postId, channel, mode});
  return {ok: true};
});
