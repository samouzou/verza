import {writeFile} from "node:fs/promises";
import {GoogleGenAI} from "@google/genai";

const TTS_MODEL = process.env.PRISM_TTS_MODEL?.trim() || "gemini-3.8-flash-tts";
const VOICE = process.env.PRISM_TTS_VOICE?.trim() || "Kore";

/**
 * Speaks the voiceover with Gemini TTS and saves it as WAV.
 * @param {string} text Words to speak.
 * @param {string} style Delivery, e.g. "warm, upbeat".
 * @param {string} dest WAV path.
 * @return {!Promise<void>}
 */
export async function speak(text: string, style: string, dest: string): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set on the worker.");
  const ai = new GoogleGenAI({apiKey}) as unknown as {
    interactions: {create: (a: Record<string, unknown>) => Promise<{output_audio?: {data?: string}}>};
  };
  const res = await ai.interactions.create({
    model: TTS_MODEL,
    input: [{
      type: "user_input",
      content: [{type: "text", text, annotations: [{type: "speech_metadata", style}]}],
    }],
    response_format: {type: "audio"},
    generation_config: {speech_config: [{voice: VOICE}]},
  });
  const data = res.output_audio?.data;
  if (!data) throw new Error("Could not record the voiceover.");
  await writeFile(dest, Buffer.from(data, "base64"));
}
