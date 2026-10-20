"""Assembles the quantified Prism cut from the existing life shots and product cards.

    python edit-cost.py          -> out/prism-cost-16x9.mp4
    python edit-cost.py 9x16     -> out/prism-cost-9x16.mp4

The dollar figure is arithmetic shown on screen: $2,000 a day x 7 silent days.
It is not a measured average.
"""
import json
import pathlib
import subprocess
import sys

FORMATS = {
    "16x9": {"size": (1920, 1080), "card": (3840, 2160), "cards": "cards", "shots": "shots", "captions": False,
             "trim": {"c": 3.3, "f": 2.4, "g": 0.8}},
    "9x16": {"size": (1080, 1920), "card": (2160, 3840), "cards": "cards-9x16", "shots": "shots-9x16", "captions": True,
             "trim": {"c": 3.3, "f": 2.4, "g": 0.8}},
}
FMT_ID = sys.argv[1] if len(sys.argv) > 1 else "16x9"
FMT = FORMATS[FMT_ID]
W, H = FMT["size"]
CW, CH = FMT["card"]
TRIM = FMT["trim"]

ROOT = pathlib.Path(__file__).parent
M = ROOT / "media"
CARDS = M / FMT["cards"]
SHOTS = M / FMT["shots"]
AUDIO = M / "audio-cost"
SEG = M / f"segments-cost-{FMT_ID}"
OUT = ROOT / "out"
SEG.mkdir(parents=True, exist_ok=True)
OUT.mkdir(exist_ok=True)
FPS = 30
VENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", str(FPS)]


def ff(*args):
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args], check=True)


def life(name, src, start, dur, overlay=None):
    out = SEG / f"{name}.mp4"
    base = f"[0:v]trim=start={start}:duration={dur},setpts=PTS-STARTPTS,scale={W}:{H},fps={FPS}"
    if overlay:
        png, t_in = overlay
        fc = (f"{base}[v];[1:v]scale={W}:{H},format=rgba,fade=in:st={t_in}:d=0.45:alpha=1[o];"
              f"[v][o]overlay=0:0:shortest=1,format=yuv420p")
        ff("-i", str(SHOTS / src), "-loop", "1", "-t", str(dur), "-i", str(CARDS / png),
           "-filter_complex", fc, "-an", *VENC, str(out))
    else:
        ff("-i", str(SHOTS / src), "-vf", base, "-an", *VENC, str(out))
    return out


def insert(name, stages, zoom=0.045, xf=0.35):
    out = SEG / f"{name}.mp4"
    total = sum(d for _, d in stages) - xf * (len(stages) - 1)
    inputs, chain = [], []
    for i, (png, d) in enumerate(stages):
        inputs += ["-loop", "1", "-t", str(d), "-framerate", str(FPS), "-i", str(CARDS / png)]
        chain.append(f"[{i}:v]scale={CW}:{CH},format=yuv420p,setsar=1[s{i}]")
    last, offset = "s0", 0.0
    for i in range(1, len(stages)):
        offset += stages[i - 1][1] - xf
        chain.append(f"[{last}][s{i}]xfade=transition=fade:duration={xf}:offset={offset:.3f}[x{i}]")
        last = f"x{i}"
    chain.append(
        f"[{last}]scale=w='trunc({CW}*(1+{zoom}*t/{total:.3f})/2)*2':h=-2:eval=frame,"
        f"crop={CW}:{CH},scale={W}:{H}:flags=lanczos,fps={FPS},trim=duration={total:.3f}[v]"
    )
    ff(*inputs, "-filter_complex", ";".join(chain), "-map", "[v]", *VENC, str(out))
    return out


def still(name, png, dur, fade_in=0.35, color="white"):
    out = SEG / f"{name}.mp4"
    ff("-loop", "1", "-t", str(dur), "-framerate", str(FPS), "-i", str(CARDS / png),
       "-vf", f"scale={W}:{H}:flags=lanczos,fade=in:st=0:d={fade_in}:color={color}", *VENC, str(out))
    return out


# Picture is timed to the voiceover in media/audio-cost/.
segments = [
    life("01-hook", "a-hook.mp4", 0, 7.9),
    still("02-cost", "cost.png", 11.3, color="black"),
    life("03-prism", "b-prism.mp4", 0, 2.8, overlay=("title-overlay.png", 0.25)),
    life("04-founder", "c-founder.mp4", TRIM["c"], 3.6),
    insert("05-calendar", [("02-calendar-s2.png", 1.9), ("02-calendar-s3.png", 2.55)]),
    insert("06-adapt", [("03-adapt-s2.png", 3.6)], zoom=0.04),
    insert("07-make", [("04-carousel.png", 2.0), ("05-reel.png", 2.0)], zoom=0.05, xf=0.3),
    life("08-agency", "f-agency.mp4", TRIM["f"], 3.0),
    insert("09-approve", [("06-approve-s1.png", 1.4), ("06-approve-s2.png", 2.1)], xf=0.3),
    life("10-coach", "g-coach.mp4", TRIM["g"], 2.4),
    insert("11-published", [
        ("07-published-s1.png", 0.85), ("07-published-s2.png", 0.8),
        ("07-published-s3.png", 0.8), ("07-published-s4.png", 1.55),
    ], xf=0.25),
    still("12-thirty", "thirty.png", 3.6),
    still("13-end", "end.png", 5.2, fade_in=0.45),
]

concat = SEG / "list.txt"
concat.write_text("".join(f"file '{p.name}'\n" for p in segments))
picture = SEG / "picture.mp4"
ff("-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", str(picture))
length = float(subprocess.check_output(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(picture)]).decode())

if FMT["captions"]:
    rows = [line.split("\t") for line in (ROOT / "captions-cost.tsv").read_text().splitlines() if line.strip()]
    inputs, chain, last = ["-i", str(picture)], [], "0:v"
    for n, (cid, start, end, _) in enumerate(rows, start=1):
        inputs += ["-loop", "1", "-t", f"{length:.2f}", "-i", str(CARDS / f"subc-{cid}.png")]
        chain.append(f"[{n}:v]scale={W}:{H},format=rgba[c{n}]")
        chain.append(f"[{last}][c{n}]overlay=0:0:shortest=1:enable='between(t,{start},{end})'[o{n}]")
        last = f"o{n}"
    captioned = SEG / "picture-captioned.mp4"
    ff(*inputs, "-filter_complex", ";".join(chain), "-map", f"[{last}]", *VENC, str(captioned))
    picture = captioned

# Cue times match captions-cost.tsv and the measured line lengths.
cues = {
    "v1": 0.25, "v2": 5.90, "v3": 9.55, "v4": 19.40, "v5": 22.20,
    "v6": 29.90, "v7": 37.15, "v8": 43.40, "v9": 48.95,
}
inputs = ["-i", str(picture), "-i", str(AUDIO / "music.mp3")]
fc, vo_labels = [], []
for n, (vid, t) in enumerate(cues.items(), start=2):
    inputs += ["-i", str(AUDIO / f"{vid}.wav")]
    fc.append(f"[{n}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={int(t * 1000)}|{int(t * 1000)},volume=1.6[{vid}]")
    vo_labels.append(f"[{vid}]")
fc.append(f"{''.join(vo_labels)}amix=inputs={len(vo_labels)}:normalize=0[vo]")
fc.append(f"[vo]apad=whole_dur={length:.2f},asplit=2[vo1][vo2]")
fc.append(f"[1:a]aresample=48000,atrim=0:{length:.2f},afade=t=out:st={max(0, length - 2.2):.2f}:d=2.2,volume=0.5[mus]")
fc.append("[mus][vo1]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck]")
fc.append("[duck][vo2]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]")

final = OUT / f"prism-cost-{FMT_ID}.mp4"
ff(*inputs, "-filter_complex", ";".join(fc), "-map", "0:v", "-map", "[a]",
   "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", str(final))
(OUT / f"timeline-cost-{FMT_ID}.json").write_text(
    json.dumps({"length": length, "segments": [p.name for p in segments], "cues": cues}, indent=2))
print(final, f"{length:.2f}s")
