import sharp from "sharp";

import type {SlideVisual} from "./renderSlideSvg";

/**
 * Downscales a product photo or screenshot and reads its edges: transparent, a uniform color, or busy.
 * @param {Buffer} buf Image bytes.
 * @return {!Promise<?object>} Image data URI, aspect, backdrop and transparency; null when unreadable.
 */
export async function prepareProductImage(
  buf: Buffer
): Promise<Pick<SlideVisual, "image" | "aspect" | "backdrop" | "transparent"> | null> {
  try {
    const base = sharp(buf, {density: 200}).rotate().resize({width: 1600, height: 1600, fit: "inside", withoutEnlargement: true});
    const {data, info} = await base.clone().ensureAlpha().raw().toBuffer({resolveWithObject: true});
    const px = (x: number, y: number) => {
      const i = (Math.min(info.height - 1, y) * info.width + Math.min(info.width - 1, x)) * 4;
      return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
    };
    const m = 4;
    const corners = [px(m, m), px(info.width - m, m), px(m, info.height - m), px(info.width - m, info.height - m)];
    const transparent = corners.some((c) => c[3]! < 128);
    let backdrop: string | null = null;
    if (!transparent) {
      const avg = [0, 1, 2].map((k) => Math.round(corners.reduce((n, c) => n + c[k]!, 0) / corners.length));
      const spread = Math.max(...corners.map((c) => Math.max(...[0, 1, 2].map((k) => Math.abs(c[k]! - avg[k]!)))));
      if (spread < 18) backdrop = `#${avg.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    }
    const out = transparent ?
      `data:image/png;base64,${(await base.clone().png().toBuffer()).toString("base64")}` :
      `data:image/jpeg;base64,${(await base.clone().flatten({background: "#ffffff"}).jpeg({quality: 88}).toBuffer())
        .toString("base64")}`;
    return {image: out, aspect: info.width / info.height, backdrop, transparent};
  } catch {
    return null;
  }
}
