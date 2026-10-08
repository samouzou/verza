import {getFirestore} from "firebase-admin/firestore";
import sharp from "sharp";

import {findProduct, type WorkerBrand} from "../brand";
import "../firebaseAdmin";
import type {ParsedCarouselSlide} from "./parseCarouselMarkdown";
import {prepareProductImage} from "./productImage";
import type {SlideKit, SlideLogo, SlideVisual} from "./renderSlideSvg";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PRODUCT_BYTES = 15 * 1024 * 1024;

/**
 * Downloads an image over https, or null on any failure.
 * @param {string} url Image URL.
 * @param {number} [maxBytes] Size limit.
 * @return {!Promise<?Buffer>} Bytes.
 */
export async function download(url: string, maxBytes = MAX_BYTES): Promise<Buffer | null> {
  if (!/^https:\/\//i.test(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), maxBytes > MAX_BYTES ? 12000 : 6000);
  try {
    const res = await fetch(url, {signal: ctrl.signal, redirect: "follow"});
    if (!res.ok || Number(res.headers.get("content-length") ?? 0) > maxBytes) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > maxBytes ? null : buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * PNG data URI.
 * @param {Buffer} png PNG bytes.
 * @return {string} Data URI.
 */
function dataUri(png: Buffer): string {
  return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * Prepares a logo for dark and light slides; single-color versions are used where the original would disappear.
 * @param {Buffer} buf Logo bytes (PNG, JPEG, SVG or WebP).
 * @return {!Promise<?SlideLogo>} Logo, or null when it can't be read.
 */
async function prepareLogo(buf: Buffer): Promise<SlideLogo | null> {
  try {
    const png = await sharp(buf, {density: 300}).trim().resize({height: 160, width: 960, fit: "inside"}).png().toBuffer();
    const {data, info} = await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    let weight = 0;
    let total = 0;
    let opaque = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]! / 255;
      if (a > 0.5) opaque++;
      total += a * (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255;
      weight += a;
    }
    if (opaque / (info.width * info.height) > 0.92) return null;
    const lightness = weight ? total / weight : 0.5;
    const mono = async (v: number) => {
      const out = Buffer.from(data);
      for (let i = 0; i < out.length; i += 4) out[i] = out[i + 1] = out[i + 2] = v;
      return dataUri(await sharp(out, {raw: {width: info.width, height: info.height, channels: 4}}).png().toBuffer());
    };
    return {
      onDark: lightness > 0.55 ? dataUri(png) : await mono(255),
      onLight: lightness < 0.55 ? dataUri(png) : await mono(15),
      aspect: info.width / info.height,
    };
  } catch {
    return null;
  }
}

/**
 * Square avatar as a data URI.
 * @param {string} url Avatar URL.
 * @return {!Promise<string | undefined>} Data URI.
 */
async function avatar(url: string): Promise<string | undefined> {
  const buf = url ? await download(url) : null;
  if (!buf) return undefined;
  try {
    return dataUri(await sharp(buf).resize(176, 176, {fit: "cover"}).png().toBuffer());
  } catch {
    return undefined;
  }
}

/**
 * Resolves the real image for each Product / Screenshot slide. A slide whose first line names a catalog item
 * uses that item; otherwise it falls back to the featured product and its first line becomes the headline.
 * Repeat slides of one product step through its images.
 * @param {!Array<ParsedCarouselSlide>} slides Slides.
 * @param {SlideKit} kit Kit with catalog and featured product.
 * @return {!Promise<!Array<?SlideVisual>>} Visual per slide (null for other layouts or when no image is available).
 */
export async function resolveSlideVisuals(slides: ParsedCarouselSlide[], kit: SlideKit): Promise<(SlideVisual | null)[]> {
  const catalog = kit.catalog ?? [];
  const featured = findProduct(catalog, kit.featuredId);
  const used = new Map<string, number>();
  const cache = new Map<string, Promise<Awaited<ReturnType<typeof prepareProductImage>>>>();
  const load = (url: string) => {
    if (!cache.has(url)) {
      cache.set(url, download(url, MAX_PRODUCT_BYTES).then((b) => (b ? prepareProductImage(b) : null)));
    }
    return cache.get(url)!;
  };
  return Promise.all(slides.map(async (slide) => {
    if (slide.layout !== "product" && slide.layout !== "screenshot") return null;
    const named = findProduct(catalog, slide.title);
    const p = named?.images.length ? named : featured?.images.length ? featured : null;
    if (!p) return null;
    const n = used.get(p.id) ?? 0;
    used.set(p.id, n + 1);
    const img = await load(p.images[n % p.images.length]!);
    if (!img) return null;
    const [headline, sub] = named ? [slide.bullets[0] ?? "", slide.bullets[1] ?? ""] : [slide.title, slide.bullets[0] ?? ""];
    return {...img, name: p.name, headline, sub};
  }));
}

/**
 * Builds the slide kit: theme, logo and the connected account that will post (for the byline).
 * A logo that's a full-bleed rectangle (no transparency) is skipped, since it would look pasted on.
 * @param {string} agencyId Agency id.
 * @param {WorkerBrand} brand Brand context.
 * @param {string} channel Channel the carousel is for.
 * @param {string} [featuredId] The post's featured product id or name.
 * @return {!Promise<SlideKit>} Kit.
 */
export async function loadSlideKit(
  agencyId: string,
  brand: WorkerBrand,
  channel: string,
  featuredId?: string
): Promise<SlideKit> {
  const [logoBuf, conn] = await Promise.all([
    brand.logoUrl ? download(brand.logoUrl) : Promise.resolve(null),
    getFirestore().collection("prism_connections").doc(agencyId).get().catch(() => null),
  ]);
  const accounts = (conn?.data()?.accounts ?? {}) as Record<string, {
    status?: string; displayName?: string; username?: string; avatarUrl?: string;
  }>;
  const account = [accounts[channel], accounts.linkedin, accounts.instagram]
    .find((a) => a?.status === "connected" && (a.displayName || a.username));
  const logo = logoBuf ? await prepareLogo(logoBuf) : null;
  const handle = account?.username ? (channel === "instagram" ? `@${account.username.replace(/^@/, "")}` : brand.brandName) : "";
  const featured = findProduct(brand.catalog, featuredId);
  return {
    theme: brand.theme,
    brandName: brand.brandName,
    catalog: brand.catalog,
    ...(featured ? {featuredId: featured.id} : {}),
    ...(logo ? {logo} : {}),
    ...(account ? {
      byline: {
        name: account.displayName || account.username || "",
        handle: handle && handle !== (account.displayName || "") ? handle : brand.theme.footer,
        avatar: await avatar(account.avatarUrl ?? ""),
      },
    } : {}),
  };
}
