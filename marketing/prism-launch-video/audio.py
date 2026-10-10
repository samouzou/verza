"""Generates the voiceover lines (Gemini TTS) and the music bed (Lyria) into media/audio/."""
import base64
import concurrent.futures as cf
import json
import pathlib
import sys
import wave

from google import genai

OUT = pathlib.Path(__file__).parent / "media" / "audio"
OUT.mkdir(parents=True, exist_ok=True)

TTS_MODEL = "gemini-3.8-flash-tts"
MUSIC_MODEL = "lyria-3.5"
VOICE = "Kore"
STYLE = "Warm, confident and conversational, like a founder talking to a friend. Natural pace, a gentle smile in the voice."

# (id, start seconds in the edit, line)
LINES = [
    ("v1", 0.6, "You started a business. Somehow, you also became its content team."),
    ("v2", 8.6, "Meet Prism."),
    ("v3", 12.3, "Prism learns your brand and your voice, then plans your month across LinkedIn, X, Instagram and TikTok."),
    ("v4", 19.6, "Every post is written for its channel. Not copied everywhere."),
    ("v5", 26.5, "It designs on-brand carousels, and turns ideas into Reels and TikToks."),
    ("v6", 33.6, "Your team reviews and approves, in one place."),
    ("v7", 40.3, "Then Prism publishes on schedule, so you can get back to the work only you can do."),
    ("v8", 46.4, "Founders, shop owners, brands and agencies. All humming."),
    ("v9", 50.6, "Prism. Keep your social humming. Start free for seven days."),
]

MUSIC_PROMPT = (
    "A 58 second instrumental for a warm, optimistic tech product launch film. 104 BPM. "
    "Opens sparse and a little tense with soft felt piano and a muted pulse (0-8s), "
    "a bright shimmering lift at 8s as the product is revealed, then an uplifting, modern indie-electronic groove "
    "with plucked guitar, light claps, warm synth pads and gentle bass (8-46s), building to a joyful peak in a "
    "short montage (46-50s), then resolving to a clean, confident final chord that rings out (50-58s). "
    "No vocals. Leaves space for a voiceover."
)


def save_wav(path, pcm_or_wav: bytes, rate=24000):
    if pcm_or_wav[:4] == b"RIFF":
        path.write_bytes(pcm_or_wav)
        return
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm_or_wav)


def tts(client, line_id, text):
    interaction = client.interactions.create(
        model=TTS_MODEL,
        input=[{"type": "user_input", "content": [{
            "type": "text", "text": text,
            "annotations": [{"type": "speech_metadata", "style": STYLE}],
        }]}],
        response_format={"type": "audio"},
        generation_config={"speech_config": [{"voice": VOICE}]},
    )
    path = OUT / f"{line_id}.wav"
    save_wav(path, base64.b64decode(interaction.output_audio.data))
    return path


def music(client):
    interaction = client.interactions.create(
        model=MUSIC_MODEL,
        input=[{"type": "user_input", "content": [{"type": "text", "text": MUSIC_PROMPT}]}],
        response_format={"type": "audio"},
    )
    path = OUT / "music.mp3"
    path.write_bytes(base64.b64decode(interaction.output_audio.data))
    return path


def main():
    only = set(sys.argv[1:])
    client = genai.Client()
    with cf.ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(tts, client, i, t): i for i, _, t in LINES if not only or i in only}
        if not only or "music" in only:
            futures[pool.submit(music, client)] = "music"
        for f in cf.as_completed(futures):
            try:
                print("ok", futures[f], f.result())
            except Exception as e:  # noqa: BLE001
                print("fail", futures[f], repr(e))
    (OUT / "cues.json").write_text(json.dumps([{"id": i, "start": s} for i, s, _ in LINES], indent=2))


if __name__ == "__main__":
    main()
