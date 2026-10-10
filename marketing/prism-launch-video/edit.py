"""Assembles the Meet Prism film: life shots + animated card inserts + VO + music -> out/meet-prism-16x9.mp4."""
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).parent
M = ROOT / "media"
SEG = M / "segments"
OUT = ROOT / "out"
SEG.mkdir(parents=True, exist_ok=True)
OUT.mkdir(exist_ok=True)
FPS = 30
VENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", str(FPS)]


def ff(*args):
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args], check=True)


def life(name, src, start, dur, overlay=None):
    """Trim a generated shot to dur seconds, drop its audio, optionally composite a PNG overlay that fades in."""
    out = SEG / f"{name}.mp4"
    base = f"[0:v]trim=start={start}:duration={dur},setpts=PTS-STARTPTS,scale=1920:1080,fps={FPS}"
    if overlay:
        png, t_in = overlay
        fc = (f"{base}[v];[1:v]scale=1920:1080,format=rgba,fade=in:st={t_in}:d=0.6:alpha=1[o];"
              f"[v][o]overlay=0:0:shortest=1,format=yuv420p")
        ff("-i", str(M / "shots" / src), "-loop", "1", "-t", str(dur), "-i", str(M / "cards" / png),
           "-filter_complex", fc, "-an", *VENC, str(out))
    else:
        ff("-i", str(M / "shots" / src), "-vf", base, "-an", *VENC, str(out))
    return out


def insert(name, stages, zoom=0.05, xf=0.35):
    """Crossfade through card stages [(png, seconds)], with one slow push-in over the whole insert."""
    out = SEG / f"{name}.mp4"
    total = sum(d for _, d in stages) - xf * (len(stages) - 1)
    inputs, chain = [], []
    for i, (png, d) in enumerate(stages):
        inputs += ["-loop", "1", "-t", str(d), "-framerate", str(FPS), "-i", str(M / "cards" / png)]
        chain.append(f"[{i}:v]scale=3840:2160,format=yuv420p,setsar=1[s{i}]")
    last, offset = "s0", 0.0
    for i in range(1, len(stages)):
        offset += stages[i - 1][1] - xf
        chain.append(f"[{last}][s{i}]xfade=transition=fade:duration={xf}:offset={offset:.3f}[x{i}]")
        last = f"x{i}"
    chain.append(
        f"[{last}]scale=w='trunc(3840*(1+{zoom}*t/{total:.3f})/2)*2':h=-2:eval=frame,"
        f"crop=3840:2160,scale=1920:1080:flags=lanczos,fps={FPS},trim=duration={total:.3f}[v]"
    )
    ff(*inputs, "-filter_complex", ";".join(chain), "-map", "[v]", *VENC, str(out))
    return out


def still(name, png, dur, fade_in=0.5):
    out = SEG / f"{name}.mp4"
    ff("-loop", "1", "-t", str(dur), "-framerate", str(FPS), "-i", str(M / "cards" / png),
       "-vf", f"scale=1920:1080:flags=lanczos,fade=in:st=0:d={fade_in}:color=white", *VENC, str(out))
    return out


# Timeline (seconds): hook 8, prism 4, founder 7.5, café 7, skincare 7, agency 6.8, coach 5.7, montage 5, end 6.5
segments = [
    life("01-hook", "a-hook.mp4", 0, 8),
    life("02-prism", "b-prism.mp4", 0, 4, overlay=("title-overlay.png", 0.7)),
    life("03-founder", "c-founder.mp4", 3.3, 3.6),
    insert("04-setup-cal", [("01-setup-s1.png", 1.0), ("01-setup-s2.png", 1.2),
                            ("02-calendar-s1.png", 0.9), ("02-calendar-s2.png", 0.9), ("02-calendar-s3.png", 1.25)]),
    life("05-cafe", "d-cafe.mp4", 3.0, 3.5),
    insert("06-adapt", [("03-adapt-s1.png", 1.2), ("03-adapt-s2.png", 2.65)]),
    life("07-skincare", "e-skincare.mp4", 3.2, 3.0),
    insert("08-carousel", [("04-carousel.png", 2.0)], zoom=0.06),
    insert("09-reel", [("05-reel.png", 2.0)], zoom=0.06),
    life("10-agency", "f-agency.mp4", 2.4, 3.8),
    insert("11-approve", [("06-approve-s1.png", 1.5), ("06-approve-s2.png", 1.85)]),
    life("12-coach", "g-coach.mp4", 0.8, 3.0),
    insert("13-published", [("07-published-s1.png", 0.85), ("07-published-s2.png", 0.75),
                            ("07-published-s3.png", 0.75), ("07-published-s4.png", 1.4)], xf=0.25),
    life("14-montage", "h-montage.mp4", 0, 5),
    still("15-end", "end.png", 6.5),
]

concat = SEG / "list.txt"
concat.write_text("".join(f"file '{p.name}'\n" for p in segments))
picture = SEG / "picture.mp4"
ff("-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", str(picture))
length = float(subprocess.check_output(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(picture)]).decode())

# Voiceover cue times, adjusted to the cut; v8 tightened slightly so it clears the end-card line.
cues = {"v1": 0.6, "v2": 8.7, "v3": 12.3, "v4": 19.7, "v5": 26.6, "v6": 33.7, "v7": 40.4, "v8": 46.0, "v9": 51.3}
tempo = {"v8": 1.08}
inputs = ["-i", str(picture), "-i", str(M / "audio" / "music.mp3")]
fc = []
vo_labels = []
for n, (vid, t) in enumerate(cues.items(), start=2):
    inputs += ["-i", str(M / "audio" / f"{vid}.wav")]
    at = f"atempo={tempo[vid]}," if vid in tempo else ""
    fc.append(f"[{n}:a]{at}aresample=48000,aformat=channel_layouts=stereo,adelay={int(t * 1000)}|{int(t * 1000)},volume=1.6[{vid}]")
    vo_labels.append(f"[{vid}]")
fc.append(f"{''.join(vo_labels)}amix=inputs={len(vo_labels)}:normalize=0[vo]")
fc.append(f"[vo]apad=whole_dur={length:.2f},asplit=2[vo1][vo2]")
fc.append(f"[1:a]aresample=48000,atrim=0:{length:.2f},afade=t=out:st={length - 2.5:.2f}:d=2.5,volume=0.55[mus]")
fc.append("[mus][vo1]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck]")
fc.append("[duck][vo2]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]")

final = OUT / "meet-prism-16x9.mp4"
ff(*inputs, "-filter_complex", ";".join(fc), "-map", "0:v", "-map", "[a]",
   "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", str(final))
(OUT / "timeline.json").write_text(json.dumps({"length": length, "segments": [p.name for p in segments], "cues": cues}, indent=2))
print(final, f"{length:.2f}s")
