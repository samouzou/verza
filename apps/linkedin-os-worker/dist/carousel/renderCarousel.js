"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderCarouselPngs = renderCarouselPngs;
exports.buildCarouselPdf = buildCarouselPdf;
exports.buildCarouselZip = buildCarouselZip;
const archiver_1 = __importDefault(require("archiver"));
const pdf_lib_1 = require("pdf-lib");
const sharp_1 = __importDefault(require("sharp"));
const stream_1 = require("stream");
const parseCarouselMarkdown_1 = require("./parseCarouselMarkdown");
const renderSlideSvg_1 = require("./renderSlideSvg");
/**
 * Renders carousel markdown into PNG slide buffers.
 * @param {string} markdown Carousel outline markdown.
 * @return {!Promise<!Array<RenderedSlide>>} PNG buffers per slide.
 */
async function renderCarouselPngs(markdown) {
    const slides = (0, parseCarouselMarkdown_1.parseCarouselMarkdown)(markdown);
    if (slides.length === 0) {
        throw new Error("Could not parse carousel slides from markdown.");
    }
    const total = slides.length;
    const rendered = [];
    for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        const slideNum = i + 1;
        const svg = (0, renderSlideSvg_1.renderSlideSvg)(slide, slideNum, total);
        const png = await (0, sharp_1.default)(Buffer.from(svg)).png().toBuffer();
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
async function buildCarouselPdf(slides) {
    const pdfDoc = await pdf_lib_1.PDFDocument.create();
    for (const slide of slides) {
        const page = pdfDoc.addPage([1080, 1080]);
        const image = await pdfDoc.embedPng(slide.png);
        page.drawImage(image, { x: 0, y: 0, width: 1080, height: 1080 });
    }
    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
}
/**
 * Builds a zip archive containing all slide PNGs.
 * @param {!Array<RenderedSlide>} slides Rendered slides.
 * @return {!Promise<Buffer>} Zip file buffer.
 */
function buildCarouselZip(slides) {
    return new Promise((resolve, reject) => {
        const archive = (0, archiver_1.default)("zip", { zlib: { level: 9 } });
        const stream = new stream_1.PassThrough();
        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", reject);
        archive.on("error", reject);
        archive.pipe(stream);
        for (const slide of slides) {
            archive.append(slide.png, { name: slide.filename });
        }
        void archive.finalize();
    });
}
