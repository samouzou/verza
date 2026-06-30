import {getDefaultBucket} from "../firebaseAdmin";
import type {RenderedSlide} from "./renderCarousel";

export type CarouselSlideAsset = {
  index: number;
  storagePath: string;
  filename: string;
};

export type CarouselAssets = {
  slides: CarouselSlideAsset[];
  pdfStoragePath?: string;
  zipStoragePath?: string;
};

/**
 * Uploads rendered carousel PNGs (and optional pdf/zip) to Firebase Storage.
 * @param {object} opts Upload options.
 * @param {string} opts.agencyId Agency id for path scoping.
 * @param {string} opts.jobId Job id.
 * @param {string} opts.outputId Output item id.
 * @param {!Array<RenderedSlide>} opts.slides Rendered PNG slides.
 * @param {Buffer=} opts.pdf Optional PDF buffer.
 * @param {Buffer=} opts.zip Optional zip buffer.
 * @return {!Promise<CarouselAssets>} Storage paths for uploaded assets.
 */
export async function uploadCarouselAssets(opts: {
  agencyId: string;
  jobId: string;
  outputId: string;
  slides: RenderedSlide[];
  pdf?: Buffer;
  zip?: Buffer;
}): Promise<CarouselAssets> {
  const bucket = getDefaultBucket();
  const basePath = `linkedin_os_carousels/${opts.agencyId}/${opts.jobId}/${opts.outputId}`;

  const slides: CarouselSlideAsset[] = [];

  for (const slide of opts.slides) {
    const storagePath = `${basePath}/${slide.filename}`;
    const file = bucket.file(storagePath);
    await file.save(slide.png, {
      metadata: {
        contentType: "image/png",
        cacheControl: "public, max-age=31536000",
      },
    });
    slides.push({
      index: slide.index,
      storagePath,
      filename: slide.filename,
    });
  }

  let pdfStoragePath: string | undefined;
  if (opts.pdf) {
    pdfStoragePath = `${basePath}/carousel.pdf`;
    await bucket.file(pdfStoragePath).save(opts.pdf, {
      metadata: {
        contentType: "application/pdf",
        cacheControl: "public, max-age=31536000",
      },
    });
  }

  let zipStoragePath: string | undefined;
  if (opts.zip) {
    zipStoragePath = `${basePath}/carousel.zip`;
    await bucket.file(zipStoragePath).save(opts.zip, {
      metadata: {
        contentType: "application/zip",
        cacheControl: "public, max-age=31536000",
      },
    });
  }

  return {slides, pdfStoragePath, zipStoragePath};
}
