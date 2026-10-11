import {mkdir} from "node:fs/promises";
import {join} from "node:path";
import sharp from "sharp";
import {GoogleGenAI, Type} from "@google/genai";

import {prepareProductImage} from "../carousel/productImage";
import {duration, encodeFrames, frameAt, overlayClips} from "./ffmpeg";

const W = 1080;
const H = 1920;
/** Cards render at twice the video size so the zoom into a callout stays sharp. */
const S = 2;
const FPS = 24;
const SANS = "Inter, DejaVu Sans, Arial, sans-serif";
const CARD_CY = 860;
const LABEL_Y = 1560;

/** A real brand image cut into the video exactly as it is. */
export type InsertImage = {
  name: string;
  kind: "screenshot" | "photo";
  /** Downscaled data URI. */
  image: string;
  /** Width / height. */
  aspect: number;
  transparent: boolean;
};

/** One planned insert: which image, when, and what to point at. */
export type InsertBeat = {
  /** 1-based index into the insert images. */
  image: number;
  start: number;
  end: number;
  /** For screenshots, the part of the screen the line is about; "" for none. */
  focus: string;
  /** Short on-screen label, or "". */
  label: string;
};

type Rect = {x: number; y: number; w: number; h: number};
type Raw = {data: Buffer; info: {width: number; height: number; channels: 4}};

/**
 * Escapes text for SVG.
 * @param {string} s Text.
 * @return {string} Escaped.
 */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (p: number) => p * p * (3 - 2 * p);

/**
 * Downloads and prepares the images an insert can show.
 * @param {!Array<{name: string, url: string}>} items Catalog images with their product name.
 * @param {"screenshot"|"photo"} kind How to frame them.
 * @return {!Promise<!Array<InsertImage>>} Usable images.
 */
export async function loadInsertImages(
  items: {name: string; url: string}[],
  kind: InsertImage["kind"]
): Promise<InsertImage[]> {
  const out: InsertImage[] = [];
  for (const it of items) {
    try {
      const res = await fetch(it.url, {signal: AbortSignal.timeout(10_000)});
      if (!res.ok) continue;
      const p = await prepareProductImage(Buffer.from(await res.arrayBuffer()));
      if (p) out.push({name: it.name, kind, image: p.image, aspect: p.aspect, transparent: p.transparent});
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * The card for one image, in video coordinates: a phone (tall screenshot), a browser window (wide screenshot), or a
 * framed photo. `shown` is where the full image lands (it can run past `clip` when a long screenshot is cropped).
 * @param {InsertImage} img Image.
 * @param {string} accent Accent color.
 * @param {string} host Domain shown in the browser bar.
 * @return {{svg: string, shown: Rect, clip: Rect}} Card.
 */
function card(img: InsertImage, accent: string, host: string): {svg: string; shown: Rect; clip: Rect} {
  const shadow = (r: Rect, rx: number) =>
    `<rect x="${r.x}" y="${r.y + 34}" width="${r.w}" height="${r.h}" rx="${rx}" fill="#000" opacity="0.5" filter="url(#soft)"/>`;
  const defs = `<defs><filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="34"/></filter>`;

  if (img.kind === "screenshot" && img.aspect < 0.85) {
    const sw = img.aspect < 0.4 ? 560 : Math.min(600, 1180 * img.aspect);
    const sh = Math.min(1180, sw / img.aspect);
    const clip = {x: (W - sw) / 2, y: CARD_CY - sh / 2, w: sw, h: sh};
    const b = 16;
    const body = {x: clip.x - b, y: clip.y - b, w: sw + b * 2, h: sh + b * 2};
    return {
      shown: {x: clip.x, y: clip.y, w: sw, h: sw / img.aspect},
      clip,
      svg: `${defs}<clipPath id="screen"><rect x="${clip.x}" y="${clip.y}" width="${sw}" height="${sh}" rx="54"/></clipPath></defs>
  ${shadow(body, 70)}
  <rect x="${body.x}" y="${body.y}" width="${body.w}" height="${body.h}" rx="70" fill="#0B0B0D"/>
  <image x="${clip.x}" y="${clip.y}" width="${sw}" height="${sh}" xlink:href="${img.image}" ` +
        `preserveAspectRatio="xMidYMin slice" clip-path="url(#screen)"/>
  <rect x="${W / 2 - 56}" y="${clip.y + 14}" width="112" height="32" rx="16" fill="#0B0B0D"/>`,
    };
  }

  if (img.kind === "screenshot") {
    const bw = 1000;
    const bar = 56;
    const ch = Math.min(1060, bw / img.aspect);
    const x = (W - bw) / 2;
    const y = CARD_CY - (bar + ch) / 2;
    const clip = {x, y: y + bar, w: bw, h: ch};
    return {
      shown: {x, y: y + bar, w: bw, h: bw / img.aspect},
      clip,
      svg: `${defs}<clipPath id="win"><rect x="${x}" y="${y}" width="${bw}" height="${bar + ch}" rx="26"/></clipPath></defs>
  ${shadow({x, y, w: bw, h: bar + ch}, 26)}
  <g clip-path="url(#win)">
    <rect x="${x}" y="${y}" width="${bw}" height="${bar + ch}" fill="#FFFFFF"/>
    <image x="${x}" y="${y + bar}" width="${bw}" height="${ch}" xlink:href="${img.image}" preserveAspectRatio="xMidYMin slice"/>
    <rect x="${x}" y="${y}" width="${bw}" height="${bar}" fill="#F1F2F4"/>
    <rect x="${x}" y="${y + bar - 1}" width="${bw}" height="1" fill="#DADCE0"/>
  </g>
  ${["#FF5F57", "#FEBC2E", "#28C840"].map((c, i) => `<circle cx="${x + 32 + i * 24}" cy="${y + bar / 2}" r="7.5" fill="${c}"/>`).join("")}
  ${host ? `<rect x="${W / 2 - 180}" y="${y + 13}" width="360" height="30" rx="15" fill="#FFFFFF"/>
  <text x="${W / 2}" y="${y + 34}" font-family="${SANS}" font-size="17" font-weight="500" fill="#5F6368" ` +
    `text-anchor="middle">${esc(host)}</text>` : ""}`,
    };
  }

  const pw = Math.min(880, 1100 * img.aspect);
  const ph = pw / img.aspect;
  const r = {x: (W - pw) / 2, y: CARD_CY - ph / 2, w: pw, h: ph};
  if (img.transparent) {
    return {
      shown: r,
      clip: r,
      svg: `${defs}<radialGradient id="glow"><stop offset="0" stop-color="${accent}" stop-opacity="0.55"/>` +
        `<stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient></defs>
  <ellipse cx="${W / 2}" cy="${CARD_CY}" rx="${pw * 0.7}" ry="${ph * 0.62}" fill="url(#glow)"/>
  <image x="${r.x}" y="${r.y}" width="${pw}" height="${ph}" xlink:href="${img.image}" preserveAspectRatio="xMidYMid meet"/>`,
    };
  }
  return {
    shown: r,
    clip: r,
    svg: `${defs}<clipPath id="photo"><rect x="${r.x}" y="${r.y}" width="${pw}" height="${ph}" rx="36"/></clipPath></defs>
  ${shadow(r, 36)}
  <image x="${r.x}" y="${r.y}" width="${pw}" height="${ph}" xlink:href="${img.image}" preserveAspectRatio="xMidYMid slice" ` +
      `clip-path="url(#photo)"/>`,
  };
}

/**
 * Asks Gemini where on a screenshot the line's subject is.
 * @param {InsertImage} img Screenshot.
 * @param {string} focus What to find, e.g. "the approval queue".
 * @return {!Promise<?Array<number>>} [ymin, xmin, ymax, xmax] in 0–1000, or null when it isn't confidently there.
 */
async function locate(img: InsertImage, focus: string): Promise<[number, number, number, number] | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const m = img.image.match(/^data:([^;]+);base64,(.+)$/);
  if (!apiKey || !focus || !m) return null;
  const ai = new GoogleGenAI({apiKey});
  const res = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash",
    contents: [{role: "user", parts: [
      {inlineData: {mimeType: m[1]!, data: m[2]!}},
      {text: `This is a screenshot of a software product. Find the one region that best shows: "${focus}".
Return box_2d as [ymin, xmin, ymax, xmax] normalized to 0-1000, tight around that region (a card, panel, list, button or
chart, never the whole screen). confidence is 0-1 that the region really shows it. If nothing matches, set found to false.`},
    ]}],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          found: {type: Type.BOOLEAN},
          confidence: {type: Type.NUMBER},
          box_2d: {type: Type.ARRAY, items: {type: Type.INTEGER}},
        },
        required: ["found", "confidence", "box_2d"],
      },
    },
  });
  const r = JSON.parse(res.text ?? "{}") as {found?: boolean; confidence?: number; box_2d?: number[]};
  const b = (r.box_2d ?? []).map(Number);
  if (!r.found || Number(r.confidence) < 0.6 || b.length !== 4 || b.some((v) => !Number.isFinite(v))) return null;
  const [y0, x0, y1, x1] = b.map((v) => clamp(v, 0, 1000)) as [number, number, number, number];
  const area = ((y1 - y0) * (x1 - x0)) / 1e6;
  if (y1 <= y0 || x1 <= x0 || area < 0.004 || area > 0.85) return null;
  return [y0, x0, y1, x1];
}

/**
 * The located region in video coordinates, or null when the crop hides most of it.
 * @param {!Array<number>} box [ymin, xmin, ymax, xmax] in 0–1000 of the image.
 * @param {Rect} shown Where the full image lands.
 * @param {Rect} clip Visible part.
 * @return {?Rect} Region.
 */
function onCard(box: [number, number, number, number], shown: Rect, clip: Rect): Rect | null {
  const [y0, x0, y1, x1] = box;
  const r = {x: shown.x + (x0 / 1000) * shown.w, y: shown.y + (y0 / 1000) * shown.h,
    w: ((x1 - x0) / 1000) * shown.w, h: ((y1 - y0) / 1000) * shown.h};
  const ix = Math.max(0, Math.min(r.x + r.w, clip.x + clip.w) - Math.max(r.x, clip.x));
  const iy = Math.max(0, Math.min(r.y + r.h, clip.y + clip.h) - Math.max(r.y, clip.y));
  if ((ix * iy) / (r.w * r.h) < 0.6) return null;
  const x = Math.max(r.x, clip.x);
  const y = Math.max(r.y, clip.y);
  return {x, y, w: ix, h: iy};
}

/**
 * Renders SVG markup (video coordinates) to a raw RGBA buffer at `scale`.
 * @param {string} inner SVG body.
 * @param {number} scale Render scale.
 * @return {!Promise<Raw>} Pixels.
 */
async function raster(inner: string, scale: number): Promise<Raw> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${W * scale}" height="${H * scale}" viewBox="0 0 ${W} ${H}">${inner}</svg>`;
  return await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({resolveWithObject: true}) as Raw;
}

/**
 * The on-screen label as a pill, sized to its text.
 * @param {string} text Label.
 * @return {!Promise<{raw: Raw, w: number, h: number}>} Pill pixels.
 */
async function pill(text: string): Promise<{raw: Raw; w: number; h: number}> {
  const size = text.length > 26 ? 40 : 46;
  const w = Math.min(980, Math.round(text.length * size * 0.56 + 96));
  const h = Math.round(size * 2.1);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h + 30}">
  <defs><filter id="s" x="-20%" y="-40%" width="140%" height="200%"><feGaussianBlur stdDeviation="10"/></filter></defs>
  <rect x="12" y="18" width="${w - 24}" height="${h - 8}" rx="${(h - 8) / 2}" fill="#000" opacity="0.35" filter="url(#s)"/>
  <rect x="0" y="0" width="${w}" height="${h}" rx="${h / 2}" fill="#FFFFFF"/>
  <text x="${w / 2}" y="${h / 2 + size * 0.35}" font-family="${SANS}" font-size="${size}" font-weight="600" ` +
    `fill="#111214" text-anchor="middle">${esc(text)}</text></svg>`;
  const raw = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({resolveWithObject: true}) as Raw;
  return {raw, w: raw.info.width, h: raw.info.height};
}

/**
 * Scales a layer's alpha.
 * @param {Raw} layer Pixels.
 * @param {number} opacity 0–1.
 * @return {!Promise<Buffer>} Raw pixels with the alpha scaled.
 */
async function fadeLayer(layer: Raw, opacity: number): Promise<Buffer> {
  return await sharp(layer.data, {raw: layer.info}).linear([1, 1, 1, opacity], [0, 0, 0, 0]).raw().toBuffer();
}

/**
 * Renders one insert clip: the real image on a card over a blurred still of the footage beneath it, easing in to the
 * located region with a highlight ring for screenshots, or a slow push-in otherwise, plus an optional label.
 * @param {object} o Inputs.
 * @param {string} o.video Video the insert sits on.
 * @param {InsertBeat} o.beat Beat.
 * @param {InsertImage} o.img Image.
 * @param {string} o.accent Accent color.
 * @param {string} o.host Domain for the browser bar.
 * @param {string} o.dir Scratch folder for this insert.
 * @return {!Promise<string>} Clip path.
 */
async function renderInsert(o: {
  video: string; beat: InsertBeat; img: InsertImage; accent: string; host: string; dir: string;
}): Promise<string> {
  const {beat, img} = o;
  const len = beat.end - beat.start;
  await mkdir(o.dir, {recursive: true});

  const still = join(o.dir, "under.png");
  await frameAt(o.video, beat.start + len / 2, still);
  const bg = await sharp(still).resize(W, H, {fit: "cover"}).blur(40).modulate({brightness: 0.5})
    .removeAlpha().raw().toBuffer();

  const c = card(img, o.accent, o.host);
  const box = img.kind === "screenshot" && beat.focus ? await locate(img, beat.focus).catch(() => null) : null;
  const focus = box ? onCard(box, c.shown, c.clip) : null;
  const cardPx = await raster(c.svg, S);
  const ringPx = focus ? await raster(
    `<rect x="${focus.x - 16}" y="${focus.y - 16}" width="${focus.w + 32}" height="${focus.h + 32}" rx="22" fill="none" ` +
      `stroke="${o.accent}" stroke-opacity="0.45" stroke-width="12"/>` +
    `<rect x="${focus.x - 16}" y="${focus.y - 16}" width="${focus.w + 32}" height="${focus.h + 32}" rx="22" fill="none" ` +
      `stroke="#FFFFFF" stroke-width="6"/>`, S) : null;
  const label = beat.label ? await pill(beat.label) : null;

  const wide = img.kind === "screenshot" && img.aspect >= 0.85;
  const zoom = focus ? clamp(Math.min((W * 0.82) / focus.w, (H * 0.42) / focus.h), wide ? 1.6 : 1.25, 2.6) :
    wide ? 1.45 : 1;
  const fx = focus ? focus.x + focus.w / 2 : wide ? c.clip.x + c.clip.w / 2 : W / 2;
  const fy = focus ? focus.y + focus.h / 2 : wide ? c.clip.y + c.clip.h * 0.4 : H / 2;
  const move = Math.max(0.7, len * 0.4);
  console.log("[prism-video] insert", {image: beat.image, focus: beat.focus, found: Boolean(focus), zoom: +zoom.toFixed(2)});
  const frames = Math.max(1, Math.round(len * FPS));
  const frameDir = join(o.dir, "frames");
  await mkdir(frameDir, {recursive: true});

  for (let i = 0; i < frames; i++) {
    const t = i / FPS;
    const e = smooth(clamp((t - 0.3) / move, 0, 1));
    const z = (1 + (zoom - 1) * e) * (1 + (focus ? 0.03 : 0.07) * (t / len));
    const cw = W / z;
    const ch = H / z;
    const x = clamp(W / 2 + (fx - W / 2) * e - cw / 2, 0, W - cw);
    const y = clamp(H / 2 + (fy - H / 2) * e - ch / 2, 0, H - ch);
    const region = {
      left: Math.round(x * S), top: Math.round(y * S),
      width: Math.min(W * S - Math.round(x * S), Math.round(cw * S)),
      height: Math.min(H * S - Math.round(y * S), Math.round(ch * S)),
    };
    const view = async (layer: Raw) => ({
      data: await sharp(layer.data, {raw: layer.info}).extract(region).resize(W, H).raw().toBuffer(),
      info: {width: W, height: H, channels: 4 as const},
    });
    const layers: sharp.OverlayOptions[] = [];
    const cardView = await view(cardPx);
    layers.push({input: cardView.data, raw: cardView.info});
    const ringOpacity = clamp((t - 0.3 - move) / 0.35, 0, 1);
    if (ringPx && ringOpacity > 0) {
      const ringView = await view(ringPx);
      layers.push({input: await fadeLayer(ringView, ringOpacity), raw: ringView.info});
    }
    const labelOpacity = clamp((t - 0.45) / 0.35, 0, 1);
    if (label && labelOpacity > 0) {
      layers.push({
        input: await fadeLayer(label.raw, labelOpacity), raw: label.raw.info,
        left: Math.round((W - label.w) / 2), top: Math.round(LABEL_Y + (1 - labelOpacity) * 24),
      });
    }
    await sharp(bg, {raw: {width: W, height: H, channels: 3}}).composite(layers).jpeg({quality: 90})
      .toFile(join(frameDir, `frame-${String(i).padStart(4, "0")}.jpg`));
  }

  const clip = join(o.dir, "insert.mp4");
  await encodeFrames(frameDir, FPS, clip);
  return clip;
}

/**
 * Lays the planned inserts over the video. An insert that fails to render is skipped rather than failing the video.
 * @param {object} o Inputs.
 * @param {string} o.video Joined video.
 * @param {!Array<InsertBeat>} o.beats Planned inserts.
 * @param {!Array<InsertImage>} o.images Images the beats point at.
 * @param {string} o.accent Accent color for the highlight ring.
 * @param {string} o.host Domain for the browser bar.
 * @param {string} o.dir Scratch folder.
 * @return {!Promise<string>} The video with inserts, or the input when none rendered.
 */
export async function addInserts(o: {
  video: string; beats: InsertBeat[]; images: InsertImage[]; accent: string; host: string; dir: string;
}): Promise<string> {
  const total = await duration(o.video);
  const clips: {file: string; start: number}[] = [];
  for (const [i, beat] of o.beats.entries()) {
    const img = o.images[beat.image - 1];
    const end = Math.min(beat.end, total - 0.2);
    if (!img || end - beat.start < 1.2) continue;
    try {
      const file = await renderInsert({
        video: o.video, beat: {...beat, end}, img, accent: o.accent, host: o.host, dir: join(o.dir, `insert${i}`),
      });
      clips.push({file, start: beat.start});
    } catch (e) {
      console.warn("[prism-video] insert skipped", {i, error: e instanceof Error ? e.message : String(e)});
    }
  }
  if (!clips.length) return o.video;
  const dest = join(o.dir, "with-inserts.mp4");
  await overlayClips(o.video, clips, dest);
  return dest;
}
