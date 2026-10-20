"""Voiceover and music for the quantified Prism cut. Writes media/audio-cost/, leaving the original film's audio alone.

    python audio-cost.py            # all lines + music
    python audio-cost.py v3 music   # regenerate just those
"""
import base64
import concurrent.futures as cf
import json
import pathlib
import sys
import wave

from google import genai

OUT = pathlib.Path(__file__).parent / "media" / "audio-cost"
OUT.mkdir(parents=True, exist_ok=True)

TTS_MODEL = "gemini-3.8-flash-tts"
MUSIC_MODEL = "lyria-3.5"
VOICE = "Kore"
PROBLEM = "Serious and close, like a founder naming a cost they already feel. Unhurried, no announcer energy. Say the numbers cleanly."
TURN = "Warm, confident, a little relieved. Conversational, like the problem just got smaller. A gentle smile in the voice."

# (id, style, line). Numbers are spoken as words so the voice doesn't stumble.
LINES = [
    ("v1", PROBLEM, "A week. Sometimes three days. Just deciding what to post."),
    ("v2", PROBLEM, "Meanwhile, the business is on fire."),
    ("v3", PROBLEM, "A quiet week, for a business doing two thousand dollars a day, is fourteen thousand dollars you never asked for."),
    ("v4", TURN, "Meet Prism."),
    ("v5", TURN, "Your entire month, set in thirty minutes. Across LinkedIn, X, Instagram, and TikTok."),
    ("v6", TURN, "Every post, written for its channel. Carousels and Reels, on brand."),
    ("v7", TURN, "Approvals, baked in. Your team says yes, in one place."),
    ("v8", TURN, "Then it publishes on schedule, so you can go put the fire out."),
    ("v9", TURN, "Thirty minutes. Not a week. Prism. Start free for seven days."),
]

MUSIC_PROMPT = (
    "A 52 second instrumental for a product film that opens on a cost and turns into relief. 100 BPM. "
    "0 to 15 seconds: sparse, tense, low felt-piano and a muted pulse, a little uneasy, no melody yet. "
    "At 15 seconds a warm shimmer lifts the mood as the product appears. "
    "15 to 44 seconds: an uplifting modern indie-electronic groove, plucked guitar, light claps, warm pads, gentle bass, hopeful and clean. "
    "44 to 52 seconds: resolve to one confident final chord that rings out. "
    "No vocals. Leave space for a voiceover. No lyrics."
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


def tts(client, line_id, style, text):
    interaction = client.interactions.create(
        model=TTS_MODEL,
        input=[{"type": "user_input", "content": [{
            "type": "text", "text": text,
            "annotations": [{"type": "speech_metadata", "style": style}],
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
        futures = {pool.submit(tts, client, i, style, t): i for i, style, t in LINES if not only or i in only}
        if not only or "music" in only:
            futures[pool.submit(music, client)] = "music"
        for f in cf.as_completed(futures):
            try:
                print("ok", futures[f], f.result())
            except Exception as e:  # noqa: BLE001
                print("fail", futures[f], repr(e))
    (OUT / "lines.json").write_text(json.dumps(
        [{"id": i, "text": t} for i, _, t in LINES], indent=2))


if __name__ == "__main__":
    main()
