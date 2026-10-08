import archiver from "archiver";
import {PDFDocument} from "pdf-lib";
import sharp from "sharp";
import {PassThrough} from "stream";

import {parseCarouselMarkdown} from "./parseCarouselMarkdown";
import {CAROUSEL_SLIDE_SIZE, renderSlideSvg, slideSurfaces, type SlideKit} from "./renderSlideSvg";
import {resolveSlideVisuals} from "./slideKit";

export type RenderedSlide = {
  index: number;
  filename: string;
  png: Buffer;
};

/**
 * Renders carousel markdown into PNG slide buffers.
 * @param {string} markdown Carousel outline markdown.
 * @param {SlideKit} kit Brand theme, logo and byline.
 * @return {!Promise<!Array<RenderedSlide>>} PNG buffers per slide.
 */
export async function renderCarouselPngs(markdown: string, kit: SlideKit): Promise<RenderedSlide[]> {
  const slides = parseCarouselMarkdown(markdown);
  if (slides.length === 0) {
    throw new Error("Could not parse carousel slides from markdown.");
  }

  const total = slides.length;
  const visuals = await resolveSlideVisuals(slides, kit);
  const kinds = slideSurfaces(slides.map((s, i) =>
    (s.layout === "product" || s.layout === "screenshot") && !visuals[i] ? {...s, layout: "list" as const} : s));
  const rendered: RenderedSlide[] = [];

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i]!;
    const slideNum = i + 1;
    const svg = renderSlideSvg(slide, slideNum, total, kit, kinds[i]!, visuals[i]);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    rendered.push({
      index: slide.index,
      filename: `slide-${String(slideNum).padStart(2, "0")}.png`,
      png,
    });
  }

  return rendered;
}

/**
 * Builds a multi-page PDF (one page per slide) for LinkedIn document upload.
 * @param {!Array<RenderedSlide>} slides Rendered slides.
 * @return {!Promise<Buffer>} PDF file buffer.
 */
export async function buildCarouselPdf(slides: RenderedSlide[]): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();

  for (const slide of slides) {
    const {width, height} = CAROUSEL_SLIDE_SIZE;
    const page = pdfDoc.addPage([width, height]);
    const image = await pdfDoc.embedPng(slide.png);
    page.drawImage(image, {x: 0, y: 0, width, height});
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

/**
 * Builds a zip archive containing all slide PNGs.
 * @param {!Array<RenderedSlide>} slides Rendered slides.
 * @return {!Promise<Buffer>} Zip file buffer.
 */
export function buildCarouselZip(slides: RenderedSlide[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", {zlib: {level: 9}});
    const stream = new PassThrough();
    const chunks: Buffer[] = [];

    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    archive.on("error", reject);

    archive.pipe(stream);
    for (const slide of slides) {
      archive.append(slide.png, {name: slide.filename});
    }
    void archive.finalize();
  });
}
