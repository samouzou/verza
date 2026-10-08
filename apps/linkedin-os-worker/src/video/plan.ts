import {GoogleGenAI, Type} from "@google/genai";

export type VideoPlan = {
  /** One prompt per 10-second segment. */
  segments: string[];
  /** Words to speak over the video, or "" for music only. */
  voiceover: string;
  /** How the voice should sound, e.g. "warm, upbeat, conversational". */
  voiceStyle: string;
};

/** Spoken words that fit comfortably in one second of video. */
const WORDS_PER_SECOND = 2.4;

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
}): Promise<VideoPlan> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set on the worker.");
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
  const count = o.seconds / 10;
  const maxWords = Math.floor(o.seconds * WORDS_PER_SECOND);
  const refTags = Array.from({length: o.refCount}, (_, i) => `<IMAGE_REF_${i}>`).join(", ");

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
- On-screen text: at most one short phrase (6 words max) per segment, taken from the script's [on-screen text], in
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
- voiceStyle: a few words on delivery, e.g. "warm, upbeat, conversational".`;

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
        },
        required: ["segments", "voiceover", "voiceStyle"],
      },
    },
  });
  const parsed = JSON.parse(res.text ?? "{}") as Partial<VideoPlan>;
  const segments = (parsed.segments ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, count);
  if (segments.length !== count) throw new Error("Could not plan the video. Try again.");
  const words = String(parsed.voiceover ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    segments,
    voiceover: words.slice(0, maxWords + 5).join(" "),
    voiceStyle: String(parsed.voiceStyle ?? "").trim().slice(0, 120) || "warm, natural, conversational",
  };
}
