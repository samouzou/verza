import {spawn} from "node:child_process";

const FFMPEG = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH?.trim() || "ffprobe";

/** Output settings for every clip, so pieces join without re-timing. */
const VIDEO_OUT = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "24"];
const AUDIO_OUT = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"];

/**
 * Runs a binary and resolves with stdout; rejects with the tail of stderr.
 * @param {string} bin Binary.
 * @param {!Array<string>} args Arguments.
 * @return {!Promise<string>} stdout.
 */
function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, {stdio: ["ignore", "pipe", "pipe"]});
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${bin} exited ${code}: ${err.slice(-800)}`))));
  });
}

/**
 * Duration in seconds.
 * @param {string} file Media file.
 * @return {!Promise<number>} Seconds.
 */
export async function duration(file: string): Promise<number> {
  const out = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const s = Number.parseFloat(out.trim());
  if (!Number.isFinite(s) || s <= 0) throw new Error("Could not read the clip length.");
  return s;
}

/**
 * Whether the file has an audio stream.
 * @param {string} file Media file.
 * @return {!Promise<boolean>} True when it has audio.
 */
async function hasAudio(file: string): Promise<boolean> {
  const out = await run(FFPROBE, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file]);
  return out.trim().length > 0;
}

/**
 * Cuts [start, start + length) into a normalized 1080x1920 clip with a stereo track (silent if the source has none).
 * @param {string} src Source.
 * @param {string} dest Output.
 * @param {number} start Start second.
 * @param {number} length Length in seconds.
 * @return {!Promise<void>}
 */
export async function cut(src: string, dest: string, start: number, length: number): Promise<void> {
  const audio = await hasAudio(src);
  await run(FFMPEG, [
    "-y", "-v", "error",
    "-ss", start.toFixed(3), "-t", length.toFixed(3), "-i", src,
    ...(audio ? [] : ["-f", "lavfi", "-t", length.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo"]),
    "-map", "0:v:0", "-map", audio ? "0:a:0" : "1:a:0",
    "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1",
    ...VIDEO_OUT, ...AUDIO_OUT, "-shortest", dest,
  ]);
}

/**
 * Joins normalized clips end to end.
 * @param {!Array<string>} clips Clips in order.
 * @param {string} dest Output.
 * @return {!Promise<void>}
 */
export async function concat(clips: string[], dest: string): Promise<void> {
  const inputs = clips.flatMap((c) => ["-i", c]);
  const streams = clips.map((_, i) => `[${i}:v][${i}:a]`).join("");
  await run(FFMPEG, [
    "-y", "-v", "error", ...inputs,
    "-filter_complex", `${streams}concat=n=${clips.length}:v=1:a=1[v][a]`,
    "-map", "[v]", "-map", "[a]", ...VIDEO_OUT, ...AUDIO_OUT, dest,
  ]);
}

/**
 * Final encode: lays an optional voiceover over the clip's own audio (ducked to a music bed), fits the voice to the
 * video by speeding it up a little if needed, and writes a web-ready MP4.
 * @param {object} o Inputs.
 * @param {string} o.video Joined video.
 * @param {?string} o.voice Voiceover audio, or null to keep the clip's audio as is.
 * @param {string} o.dest Output.
 * @return {!Promise<void>}
 */
export async function finish(o: {video: string; voice: string | null; dest: string}): Promise<void> {
  const total = await duration(o.video);
  const faststart = ["-movflags", "+faststart"];
  if (!o.voice) {
    await run(FFMPEG, ["-y", "-v", "error", "-i", o.video, "-c:v", "copy", ...AUDIO_OUT, ...faststart, o.dest]);
    return;
  }
  const voiceLen = await duration(o.voice);
  const room = Math.max(1, total - 0.8);
  const tempo = Math.min(1.2, Math.max(1, voiceLen / room));
  const filter = [
    `[1:a]atempo=${tempo.toFixed(3)},adelay=300|300,apad,atrim=0:${total.toFixed(3)},volume=1.0[vo]`,
    "[0:a]volume=0.22[bed]",
    "[bed][vo]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]",
  ].join(";");
  await run(FFMPEG, [
    "-y", "-v", "error", "-i", o.video, "-i", o.voice,
    "-filter_complex", filter, "-map", "0:v:0", "-map", "[a]",
    "-c:v", "copy", ...AUDIO_OUT, ...faststart, o.dest,
  ]);
}

/**
 * Grabs one frame as a JPEG cover.
 * @param {string} video Video.
 * @param {string} dest JPEG path.
 * @return {!Promise<void>}
 */
export async function cover(video: string, dest: string): Promise<void> {
  const at = Math.min(1.5, (await duration(video)) / 2);
  await run(FFMPEG, ["-y", "-v", "error", "-ss", at.toFixed(2), "-i", video, "-frames:v", "1", "-q:v", "3", dest]);
}
