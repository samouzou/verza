import sharp from "sharp";

import {findProduct, loadWorkerBrand} from "./brand";
import {renderSlideSvg} from "./carousel/renderSlideSvg";
import {loadSlideKit, resolveSlideVisuals} from "./carousel/slideKit";
import {RenderInputError} from "./renderPost";

/**
 * Renders a standalone Instagram feed graphic: the product's real screenshot in a device frame under a headline.
 * @param {object} o Inputs.
 * @param {string} o.agencyId Agency id.
 * @param {string} o.productId Brand kit product id.
 * @param {string} o.headline On-image headline.
 * @param {string} o.sub Optional line under the headline.
 * @return {!Promise<Buffer>} PNG (1080×1350).
 */
export async function renderFeedGraphic(o: {
  agencyId: string;
  productId: string;
  headline: string;
  sub: string;
}): Promise<Buffer> {
  const brand = await loadWorkerBrand(o.agencyId);
  const product = findProduct(brand.catalog, o.productId);
  if (!product?.images.length) throw new RenderInputError("That product has no screenshots yet.");
  const kit = await loadSlideKit(o.agencyId, brand, "instagram", product.id);
  const slide = {
    index: 1,
    label: "Screenshot",
    layout: "screenshot" as const,
    title: product.name,
    bullets: [o.headline, o.sub].filter(Boolean),
    isCta: false,
  };
  const [visual] = await resolveSlideVisuals([slide], kit);
  if (!visual) throw new RenderInputError("Couldn't load that product's screenshot. Re-upload it and try again.");
  const svg = renderSlideSvg(slide, 1, 1, kit, "accent", {...visual, headline: o.headline || product.name}, true);
  return sharp(Buffer.from(svg)).png().toBuffer();
}
