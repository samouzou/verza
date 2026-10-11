"""Builds vertical Verza creator-style ads from variants.json.

    python build.py                 # every variant
    python build.py 01-beach-walk   # only these ids
    python build.py variants-consult.json [ids]   # another variants file

Shots and music are cached in media/<id>/, so re-running after editing captions or the end line only
re-renders the overlays and the edit. Delete a variant's shot.mp4 / music.mp3 to regenerate them. Needs GEMINI_API_KEY; variants with
"engine": "veo" generate their shot with Veo on Vertex and also need an active `gcloud auth login`.
"""
import base64
import concurrent.futures as cf
import json
import pathlib
import re
import subprocess
import sys
import urllib.parse

from google import genai

ROOT = pathlib.Path(__file__).parent
REPO = ROOT.parents[1]
GEN = REPO / ".agents/skills/gemini-omni-flash-api/scripts/video/generate_video.py"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
MUSIC_MODEL = "lyria-3.5"
W, H, FPS = 1080, 1920, 30


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, text=True, capture_output=True, **kw).stdout


def ff(*args):
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args], check=True)


def duration(path):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]))


def omni(prompt, out, seconds, previous=None):
    cmd = [sys.executable, str(GEN), prompt, "--aspect-ratio", "9:16", "--resolution", "1080p",
           "--duration", str(seconds), "--output", str(out), "--timeout", "900"]
    if previous:
        cmd += ["--previous-interaction-id", previous]
    for attempt in range(3):
        try:
            log = run(cmd, cwd=ROOT, timeout=300)
            break
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
            if attempt == 2:
                raise
    m = re.search(r"Interaction ID: (\S+)", log)
    return m.group(1) if m else None


VEO_MODEL = "veo-3.1-generate-001"
VEO_PROJECT = "verza-canvas"


def veo(prompt, out, seconds=10):
    """8s Veo 3.1 shot on Vertex (the active gcloud login), eased into `seconds` of slow motion."""
    import time

    from google.genai import types
    from google.oauth2.credentials import Credentials

    creds = Credentials(run(["gcloud", "auth", "print-access-token"]).strip())
    client = genai.Client(vertexai=True, project=VEO_PROJECT, location="global", credentials=creds,
                          http_options={"timeout": 120_000})
    raw = out.with_name(out.stem + "-veo.mp4")
    if not raw.exists():
        op = client.models.generate_videos(
            model=VEO_MODEL, source=types.GenerateVideosSource(prompt=prompt),
            config=types.GenerateVideosConfig(aspect_ratio="9:16", resolution="1080p", duration_seconds=8,
                                              number_of_videos=1, generate_audio=True))
        start = time.time()
        while not op.done:
            if time.time() - start > 900:
                raise TimeoutError(f"Veo still running after 15 min: {out}")
            time.sleep(15)
            op = client.operations.get(op)
        if op.error or not op.response or not op.response.generated_videos:
            raise RuntimeError(f"Veo failed: {op.error or op.response}")
        raw.write_bytes(op.response.generated_videos[0].video.video_bytes)
    k = seconds / duration(raw)
    ff("-i", str(raw), "-filter_complex",
       f"[0:v]setpts={k:.4f}*PTS,minterpolate=fps={FPS}:mi_mode=blend[v];[0:a]atempo={1 / k:.4f}[a]",
       "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "15", "-pix_fmt", "yuv420p",
       "-c:a", "aac", "-b:a", "192k", str(out))


EXTEND_PREFIX = "Extend this video. The scene continues in the same continuous shot:"


def shot(v, d):
    """10s main shot plus a 5s closing shot of the same scene, joined with a short crossfade.

    A true continuation (previous_interaction_id) stalls under load, so the closer is a fresh generation;
    an existing shot-ext.mp4 from a continuation is still used if present.
    """
    base, ext, closer, joined = d / "shot.mp4", d / "shot-ext.mp4", d / "closer.mp4", d / "shot-joined.mp4"
    if ext.exists():
        return ext
    if v.get("engine") == "veo":
        if not base.exists():
            veo(v["shot"], base, v.get("seconds", 10))
        return base
    jobs = []
    with cf.ThreadPoolExecutor(2) as pool:
        if not base.exists():
            jobs.append(pool.submit(omni, v["shot"], base, v.get("seconds", 10)))
        if v.get("extend") and not closer.exists():
            action = v["extend"].replace(EXTEND_PREFIX, "").strip()
            scene, _, style = v["shot"].partition(" Filmed on a phone")
            prompt = f"{scene} Closing moment: {action} Filmed on a phone{style}"
            jobs.append(pool.submit(omni, prompt, closer, v.get("extend_seconds", 5)))
        for j in jobs:
            j.result()
    if not closer.exists():
        return base
    if not joined.exists():
        a = duration(base)
        ff("-i", str(base), "-i", str(closer), "-filter_complex",
           f"[0:v]scale={W}:{H},fps={FPS},setsar=1[a];[1:v]scale={W}:{H},fps={FPS},setsar=1[b];"
           f"[a][b]xfade=transition=fade:duration=0.5:offset={a - 0.5:.3f}[v];"
           f"[0:a][1:a]acrossfade=d=0.5[au]",
           "-map", "[v]", "-map", "[au]", "-c:v", "libx264", "-crf", "15", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", str(joined))
    return joined


def music(v, d, client):
    out = d / "music.mp3"
    for attempt in range(3):
        if out.exists():
            break
        try:
            r = client.interactions.create(
                model=MUSIC_MODEL,
                input=[{"type": "user_input", "content": [{"type": "text", "text": v["music"]}]}],
                response_format={"type": "audio"},
            )
            out.write_bytes(base64.b64decode(r.output_audio.data))
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
    return out


def png(d, name, query, size=(W, H)):
    out = d / f"{name}.png"
    url = f"file://{ROOT}/overlay.html?{urllib.parse.urlencode(query)}"
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                    "--default-background-color=00000000", f"--window-size={size[0]},{size[1]}", "--virtual-time-budget=1200",
                    f"--screenshot={out}", url], check=True, capture_output=True)
    return out


def stills(v, d, video):
    """4:5 feed images: a frame from the footage (cropped from 9:16) with one statement and the brand mark."""
    outdir = ROOT / "out" / "stills"
    outdir.mkdir(parents=True, exist_ok=True)
    made = []
    for i, s in enumerate(v.get("stills", [])):
        frame = d / f"still-frame-{i}.png"
        y = s.get("y", (H - 1350) // 2)
        ff("-ss", str(s["t"]), "-i", str(video), "-frames:v", "1", "-vf", f"scale={W}:{H},crop={W}:1350:0:{y}", str(frame))
        img = png(d, f"still-{i}", {"kind": "still", "bg": frame.as_uri(), "layout": s.get("layout", "headline"),
                                    "text": s["text"]}, size=(W, 1350))
        dest = outdir / f"{v['id']}-{i + 1}.png"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(img.read_bytes())
        made.append(dest)
    return made


def compose(v, d, video, track):
    length = duration(video)
    overlays = []
    for i, c in enumerate(v["captions"]):
        q = {"text": c["text"], "style": c.get("style", v.get("caption_style", "")), "pos": c.get("pos", "")}
        overlays.append((png(d, f"cap-{i}", q), c["t"][0], c["t"][1]))
    e = v["end"]
    overlays.append((png(d, "end", {"kind": "end", "headline": e["headline"], "sub": e.get("sub", ""),
                                    "url": e.get("url", "tryverza.com")}), e["t"], length + 1))

    inputs = ["-i", str(video), "-i", str(track)]
    chain = [f"[0:v]scale={W}:{H},fps={FPS},setsar=1[v0]"]
    last = "v0"
    for n, (p, start, end) in enumerate(overlays, start=2):
        dur = min(end, length) - start
        inputs += ["-loop", "1", "-t", f"{dur:.2f}", "-i", str(p)]
        fade_out = f",fade=out:st={dur - 0.3:.2f}:d=0.3:alpha=1" if end < length else ""
        chain.append(f"[{n}:v]format=rgba,fade=in:st=0:d=0.35:alpha=1{fade_out},setpts=PTS+{start}/TB[o{n}]")
        chain.append(f"[{last}][o{n}]overlay=0:0:eof_action=pass[v{n}]")
        last = f"v{n}"
    has_audio = bool(run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
                          "-of", "csv=p=0", str(video)]).strip())
    mus = f"[1:a]aresample=48000,atrim=0:{length:.2f},afade=t=in:d=0.6,afade=t=out:st={length - 1.8:.2f}:d=1.8,volume={v.get('music_volume', 0.5)}[m]"
    chain.append(mus)
    if has_audio:
        chain.append(f"[0:a]aresample=48000,volume={v.get('ambience_volume', 0.9)}[amb]")
        chain.append("[amb][m]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5[a]")
    else:
        chain.append("[m]loudnorm=I=-14:TP=-1.5[a]")
    out = ROOT / "out" / f"{v['id']}.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    ff(*inputs, "-filter_complex", ";".join(chain), "-map", f"[{last}]", "-map", "[a]", "-t", f"{length:.2f}",
       "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-r", str(FPS),
       "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out))
    return out, length


def build(v, client):
    d = ROOT / "media" / v["id"]
    d.mkdir(parents=True, exist_ok=True)
    with cf.ThreadPoolExecutor(2) as pool:
        fv = pool.submit(shot, v, d)
        fm = pool.submit(music, v, d, client)
        video, track = fv.result(), fm.result()
    stills(v, d, video)
    return compose(v, d, video, track)


def main():
    args = sys.argv[1:]
    source = "variants.json"
    if args and args[0].endswith(".json"):
        source, args = args[0], args[1:]
    variants = [v for v in json.loads((ROOT / source).read_text()) if not args or v["id"] in args]
    client = genai.Client(http_options={"timeout": 180_000})
    with cf.ThreadPoolExecutor(2) as pool:
        futures = {pool.submit(build, v, client): v["id"] for v in variants}
        for f in cf.as_completed(futures):
            try:
                out, length = f.result()
                print(f"ok {futures[f]} {out} {length:.1f}s")
            except subprocess.CalledProcessError as e:
                print(f"fail {futures[f]} {e.cmd[:3]} {(e.stderr or e.stdout or '')[-600:]}")
            except Exception as e:  # noqa: BLE001
                print(f"fail {futures[f]} {e!r}")


if __name__ == "__main__":
    main()
