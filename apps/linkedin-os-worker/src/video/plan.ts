import {GoogleGenAI, Type} from "@google/genai";

import type {InsertBeat} from "./inserts";

export type VideoPlan = {
  /** One prompt per 10-second segment. */
  segments: string[];
  /** Words to speak over the video, or "" for music only. */
  voiceover: string;
  /** How the voice should sound, e.g. "warm, upbeat, conversational". */
  voiceStyle: string;
  /** Real brand images cut in over the footage. */
  inserts: InsertBeat[];
};

/** An image the plan can cut in, described for the planner. */
export type PlanImage = {name: string; kind: "screenshot" | "photo"; aspect: number};

/** Spoken words that fit comfortably in one second of video. */
const WORDS_PER_SECOND = 2.4;
const INSERT_MIN = 1.8;
const INSERT_MAX = 3.6;
/** Nothing covers the opening hook. */
const INSERT_EARLIEST = 2;

/**
 * Keeps the planner's inserts inside the rules: valid image, sane length, after the hook, no overlaps, a gap between
 * them, at most one per 10 seconds, and no more than a third of the video.
 * @param {unknown} raw Planner output.
 * @param {number} imageCount Images available.
 * @param {number} seconds Video length.
 * @return {!Array<InsertBeat>} Inserts in time order.
 */
function cleanInserts(raw: unknown, imageCount: number, seconds: number): InsertBeat[] {
  if (!Array.isArray(raw) || !imageCount) return [];
  const beats = (raw as Record<string, unknown>[])
    .map((b) => {
      const start = Math.max(INSERT_EARLIEST, Number(b?.start));
      const end = Math.min(seconds - 0.3, Number(b?.end), start + INSERT_MAX);
      return {
        image: Math.round(Number(b?.image)),
        start,
        end,
        focus: String(b?.focus ?? "").trim().slice(0, 80),
        label: String(b?.label ?? "").trim().replace(/^["“]|["”]$/g, "").split(/\s+/).slice(0, 6).join(" ").slice(0, 40),
      };
    })
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end - b.start >= INSERT_MIN &&
      b.image >= 1 && b.image <= imageCount)
    .sort((a, b) => a.start - b.start);
  const out: InsertBeat[] = [];
  let covered = 0;
  for (const b of beats) {
    const prev = out[out.length - 1];
    if (prev && b.start < prev.end + 1.5) continue;
    if (out.length >= Math.max(1, Math.floor(seconds / 10)) || covered + (b.end - b.start) > seconds / 3) break;
    out.push(b);
    covered += b.end - b.start;
  }
  return out;
}

/**
 * Turns a Reel or TikTok script into Omni segment prompts and a voiceover that fits the length.
 * @param {object} o Inputs.
 * @param {string} o.script Script markdown.
 * @param {string} o.platform "Instagram Reel" or "TikTok".
 * @param {number} o.seconds Total length (multiple of 10).
 * @param {string} o.brandBlock Brand setup for context.
 * @param {string} o.bannedClaims Claims the brand never makes.
 * @param {?string} o.product Featured product name, when photos are attached as references.
 * @param {number} o.refCount How many product photos are attached.
 * @param {!Array<PlanImage>} o.images Real images that can be cut in over the footage.
 * @return {!Promise<VideoPlan>} Plan.
 */
export async function planVideo(o: {
  script: string;
  platform: string;
  seconds: number;
  brandBlock: string;
  bannedClaims: string;
  product: string | null;
  refCount: number;
  images: PlanImage[];
}): Promise<VideoPlan> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set on the worker.");
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
  const count = o.seconds / 10;
  const maxWords = Math.floor(o.seconds * WORDS_PER_SECOND);
  const refTags = Array.from({length: o.refCount}, (_, i) => `<IMAGE_REF_${i}>`).join(", ");
  const screens = o.images.some((i) => i.kind === "screenshot");
  const maxInserts = Math.max(1, Math.floor(o.seconds / 10));
  const imageLines = o.images.map((img, i) =>
    `  ${i + 1}. "${img.name}": ${img.kind}, ${img.aspect < 0.85 ? "tall (phone)" : "wide"}`).join("\n");

  const prompt = `You are directing a ${o.seconds}-second vertical ${o.platform} made with an AI video model that
generates 10-second segments. Turn the script below into exactly ${count} segment prompt(s) and a voiceover.

${o.brandBlock}
${o.bannedClaims ? `\nNEVER CLAIM: ${o.bannedClaims}\n` : ""}
SCRIPT:
${o.script}

SEGMENT PROMPTS
- Each prompt covers 10 seconds with timecodes that start at 0s, e.g. "[0-3s] … [3-7s] … [7-10s] …". 2–4 shots each.
- Follow the script's hook and beats in order across the segments. Open with the hook's visual in the first 2 seconds.
- Describe concrete visuals: subject, action, setting, camera move, lighting. Vertical framing, subject centred.
- ${o.product && o.refCount ?
    `The featured product "${o.product}" is attached as reference image(s) ${refTags}. Refer to it by tag every ` +
      "time it appears, and end each prompt with: \"Keep the product's shape, colors, label and packaging exactly " +
      "as in the reference.\"" :
    "No product photos are attached: don't show a branded product up close or invent packaging or logos."}
${screens ? `- Phone and laptop screens in the footage stay soft and out of focus, never readable UI: the real screenshots
  are cut in separately.\n` : ""}- On-screen text: at most one short phrase (6 words max) per segment, taken from the script's [on-screen text], in
  double quotes, e.g. Text on screen: "3 drops, every night". Otherwise write "No text on screen."
- No one speaks on camera. People can react, demonstrate or use the product, but no lip-synced dialogue.
- Audio: describe only background music and natural sound effects${o.seconds > 10 ? " that carry across segments" : ""}.
  End every prompt with "No dialogue, no voices."
${count > 1 ? `- Segments 2–${count} continue the previous one: start each with "Extend this video." and keep the same
  people, setting, product and music. 0s means the start of the new part.` : ""}
- The last segment ends on a clean, steady shot of the product or the brand moment, held for the final 2 seconds.

VOICEOVER
- The spoken lines from the script, tightened to ${maxWords} words or fewer so they fit ${o.seconds} seconds.
- Plain spoken words only: no stage directions, timestamps, emojis or hashtags. Keep the brand's voice.
- Use "" if the script has no spoken lines.
- voiceStyle: a few words on delivery, e.g. "warm, upbeat, conversational".
${o.images.length ? `
INSERTS
Real brand images we cut in over the footage exactly as they are, while the voiceover and music keep going:
${imageLines}
- Pick 1–${maxInserts} insert(s), each ${INSERT_MIN}–${INSERT_MAX} seconds, timed (in seconds from the start of the whole
  video) to where the voiceover or script talks about what that image shows. Never before ${INSERT_EARLIEST}s, at least
  2 seconds apart, at most a third of the video in total. Use [] if no image fits the script.
- image: the number from the list above.
- focus: for a screenshot, the specific part of the screen the line is about, as it would look on screen (e.g. "the
  weekly calendar grid", "the Approve button"); "" for photos or when the whole screen is the point.
- label: an optional on-screen label, 2–5 words lifted from the script or voiceover for that moment; never a claim
  the script doesn't make. "" for none.` : ""}`;

  const ai = new GoogleGenAI({apiKey});
  const res = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          segments: {type: Type.ARRAY, items: {type: Type.STRING}},
          voiceover: {type: Type.STRING},
          voiceStyle: {type: Type.STRING},
          inserts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                image: {type: Type.INTEGER},
                start: {type: Type.NUMBER},
                end: {type: Type.NUMBER},
                focus: {type: Type.STRING},
                label: {type: Type.STRING},
              },
              required: ["image", "start", "end", "focus", "label"],
            },
          },
        },
        required: ["segments", "voiceover", "voiceStyle", "inserts"],
      },
    },
  });
  const parsed = JSON.parse(res.text ?? "{}") as Partial<Omit<VideoPlan, "inserts">> & {inserts?: unknown};
  const segments = (parsed.segments ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, count);
  if (segments.length !== count) throw new Error("Could not plan the video. Try again.");
  const words = String(parsed.voiceover ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    segments,
    voiceover: words.slice(0, maxWords + 5).join(" "),
    voiceStyle: String(parsed.voiceStyle ?? "").trim().slice(0, 120) || "warm, natural, conversational",
    inserts: cleanInserts(parsed.inserts, o.images.length, o.seconds),
  };
}
