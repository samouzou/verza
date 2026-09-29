"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadCarouselAssets = uploadCarouselAssets;
const firebaseAdmin_1 = require("../firebaseAdmin");
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
async function uploadCarouselAssets(opts) {
    const bucket = (0, firebaseAdmin_1.getDefaultBucket)();
    const basePath = `linkedin_os_carousels/${opts.agencyId}/${opts.jobId}/${opts.outputId}`;
    const slides = [];
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
    let pdfStoragePath;
    if (opts.pdf) {
        pdfStoragePath = `${basePath}/carousel.pdf`;
        await bucket.file(pdfStoragePath).save(opts.pdf, {
            metadata: {
                contentType: "application/pdf",
                cacheControl: "public, max-age=31536000",
            },
        });
    }
    let zipStoragePath;
    if (opts.zip) {
        zipStoragePath = `${basePath}/carousel.zip`;
        await bucket.file(zipStoragePath).save(opts.zip, {
            metadata: {
                contentType: "application/zip",
                cacheControl: "public, max-age=31536000",
            },
        });
    }
    return { slides, pdfStoragePath, zipStoragePath };
}
