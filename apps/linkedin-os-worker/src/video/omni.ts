import {writeFile} from "node:fs/promises";
import {GoogleGenAI} from "@google/genai";

const MODEL = process.env.PRISM_VIDEO_MODEL?.trim() || "gemini-omni-1.1-flash";

export type RefImage = {data: string; mimeType: string};

/** Omni refused or returned nothing; the message is safe to show the team. */
export class OmniError extends Error {}

type Interaction = {
  output_video?: {uri?: string; data?: string};
  usage?: {total_output_tokens?: number};
};

type OmniClient = {
  interactions: {create: (args: Record<string, unknown>) => Promise<Interaction>};
  files: {
    upload: (args: {file: string; config: {mimeType: string}}) => Promise<{name?: string; uri?: string; state?: unknown}>;
    get: (args: {name: string}) => Promise<{name?: string; uri?: string; state?: unknown}>;
  };
};

/**
 * Gemini API key for Omni.
 * @return {string} Key.
 */
function apiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY is not set on the worker.");
  return key;
}

/**
 * Omni client with a long request timeout (a 1080p segment takes one to two minutes).
 * @return {OmniClient} Client.
 */
function client(): OmniClient {
  return new GoogleGenAI({apiKey: apiKey(), httpOptions: {timeout: 600_000}}) as unknown as OmniClient;
}

/**
 * The reference-tag header and image parts for the product photos.
 * @param {!Array<RefImage>} refs Product photos.
 * @return {{tags: string, parts: !Array<object>}} Prompt header and input parts.
 */
function references(refs: RefImage[]): {tags: string; parts: Record<string, unknown>[]} {
  if (!refs.length) return {tags: "", parts: []};
  return {
    tags: `[# References ${refs.map((_, i) => `<IMAGE_REF_${i}>@Image${i + 1}`).join(" ")}]`,
    parts: refs.map((r) => ({type: "image", data: r.data, mime_type: r.mimeType})),
  };
}

/**
 * Runs one Omni generation, retrying once on transient errors, and saves the clip.
 * @param {!Array<object>} input Interaction input parts.
 * @param {object} format response_format.
 * @param {string} dest Where to save the MP4.
 * @return {!Promise<number>} Output tokens billed.
 */
async function generate(input: Record<string, unknown>[], format: Record<string, unknown>, dest: string): Promise<number> {
  const c = client();
  let interaction: Interaction | undefined;
  for (let attempt = 0; attempt < 2 && !interaction; attempt++) {
    try {
      interaction = await c.interactions.create({model: MODEL, input, response_format: {...format, delivery: "uri"}});
    } catch (e) {
      const status = (e as {status?: number}).status ?? 0;
      const transient = status === 0 || status === 429 || status >= 500;
      if (attempt === 1 || !transient) {
        const msg = e instanceof Error ? e.message : String(e);
        throw status >= 400 && status < 500 ?
          new OmniError(`The video model rejected this request: ${msg.slice(0, 200)}`) :
          e;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  const out = interaction?.output_video;
  let bytes: Buffer;
  if (out?.uri) {
    const res = await fetch(out.uri, {headers: {"x-goog-api-key": apiKey()}});
    if (!res.ok) throw new Error(`Could not download the clip (${res.status}).`);
    bytes = Buffer.from(await res.arrayBuffer());
  } else if (out?.data) {
    bytes = Buffer.from(out.data, "base64");
  } else {
    throw new OmniError("The video model returned no video, likely its safety filters. Try rewording the script.");
  }
  await writeFile(dest, bytes);
  return interaction?.usage?.total_output_tokens ?? 0;
}

/**
 * First 10-second segment, 9:16 at 1080p, with the product photos as references.
 * @param {string} prompt Segment prompt.
 * @param {!Array<RefImage>} refs Product photos.
 * @param {string} dest Output path.
 * @return {!Promise<number>} Output tokens.
 */
export async function generateFirst(prompt: string, refs: RefImage[], dest: string): Promise<number> {
  const r = references(refs);
  const text = [r.tags, prompt, refs.length ? "Use the images as object references for the product, not as literal frames." : ""]
    .filter(Boolean).join(" ");
  return generate([...r.parts, {type: "text", text}], {type: "video", aspect_ratio: "9:16", resolution: "1080p"}, dest);
}

/**
 * Extends a clip by 10 seconds. Omni continues from the uploaded clip (10s max) and returns it plus the new part.
 * @param {string} tail Last 10 seconds of the video so far.
 * @param {string} prompt Extension prompt.
 * @param {!Array<RefImage>} refs Product photos.
 * @param {string} dest Output path (about 20 seconds).
 * @return {!Promise<number>} Output tokens.
 */
export async function extend(tail: string, prompt: string, refs: RefImage[], dest: string): Promise<number> {
  const c = client();
  let file = await c.files.upload({file: tail, config: {mimeType: "video/mp4"}});
  const started = Date.now();
  const state = (f: {state?: unknown}) => String((f.state as {name?: string} | undefined)?.name ?? f.state ?? "");
  while (state(file) === "PROCESSING" && file.name && Date.now() - started < 120_000) {
    await new Promise((r) => setTimeout(r, 3000));
    file = await c.files.get({name: file.name});
  }
  if (!file.uri || state(file) === "FAILED") throw new Error("Could not upload the clip to extend it.");
  const r = references(refs);
  const text = `[# Sources <VIDEO_0>@Video1] ${r.tags} ${prompt}`.replace(/\s+/g, " ").trim();
  return generate(
    [{type: "video", uri: file.uri, mime_type: "video/mp4"}, ...r.parts, {type: "text", text}],
    {type: "video", resolution: "1080p"},
    dest
  );
}
