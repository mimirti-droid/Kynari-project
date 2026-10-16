# -*- coding: utf-8 -*-
"""Nara's take — montaje del vídeo vertical (v2, 16 oct. 2026).

Un take es UNA locución (Paige Turner) partida en dos tramos:
  · gancho (≤ 8 s): Nara a cámara (Magnific video_speak, veed-fabric-1.0, 720p) con
    subtítulos del guion;
  · cuerpo (~25–35 s): tarjetas de marca con la misma voz en off. Fondo que se mueve
    despacio por debajo y tipografía fija encima (regla de Identidad en Movimiento §11).
  · cierre: tarjeta «Full analysis on kynari.io».
Celestial Tapestry: 0,26 bajo la cara, 0,52 bajo las tarjetas. Loudnorm −14 LUFS.

Uso:
  python3 nara_take.py split vo.mp3 --hook-sentences 2 --out work/
      → work/hook.mp3, work/body.mp3, work/split.json (frases y tiempos)
  python3 nara_take.py build take.json
      take.json = {"talk": "talk.mp4", "body": "work/body.mp3", "hook_text": "...",
                   "cards": [{"kicker": "...", "headline": "...", "sub": "..."}, ...],
                   "body_sentences": ["...", ...], "music": "music.mp3",
                   "category": "Games", "out": "take.mp4", "poster": "poster.jpg"}
Requiere: ffmpeg, faster-whisper, Pillow, fonts-ebgaramond.
"""
import argparse, difflib, json, os, random, re, subprocess, sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1080, 1920, 30
GOLD, GOLD_WM, WHITE, LILA, BG = (184, 152, 106), (193, 147, 58), (240, 237, 232), (167, 139, 250), (13, 13, 15)
REG = "/usr/share/fonts/opentype/ebgaramond/EBGaramond12-Regular.otf"
BOLD = "/usr/share/fonts/opentype/ebgaramond/EBGaramond12-Bold.otf"
ITA = "/usr/share/fonts/opentype/ebgaramond/EBGaramond12-Italic.otf"


def run(a): subprocess.run(a, check=True)
def dur(p): return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p], capture_output=True, text=True).stdout)
norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())


# ---------------------------------------------------------------- whisper
_model = None
def words(path):
    """Tiempos por palabra. El audio se pasa decodificado (PyAV falla con algunos mp3)."""
    global _model
    from faster_whisper import WhisperModel
    _model = _model or WhisperModel("base.en", compute_type="int8")
    a = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True).stdout
    a = np.frombuffer(a, np.int16).astype(np.float32) / 32768
    segs, _ = _model.transcribe(a, word_timestamps=True, language="en")
    real = dur(path)
    # whisper puede «alucinar» una repetición pasado el final real: se corta por ffprobe
    return [(w.start, min(w.end, real), w.word.strip()) for s in segs for w in s.words if w.start < real - 0.05]


def align(ws, display):
    """Tiempos de whisper sobre el texto del guion (el guion manda, whisper solo da tiempos)."""
    D = display.split(); a = [norm(w) for _, _, w in ws]; b = [norm(w) for w in D]
    out = [None] * len(D)
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1): out[j1 + k] = (ws[i1 + k][0], ws[i1 + k][1])
        elif j2 > j1:
            s = ws[i1][0] if i1 < len(ws) else ws[-1][1]; e = ws[i2 - 1][1] if i2 > i1 else s
            n = j2 - j1; st = (e - s) / n if n else 0
            for k in range(n): out[j1 + k] = (s + k * st, s + (k + 1) * st if st else s + 0.2)
    return list(zip(D, out)), sm.ratio()


def sentences(text):
    return [s.strip() for s in re.split(r"(?<=[.?!])\s+", text.strip()) if s.strip()]


# ---------------------------------------------------------------- split
def cmd_split(a):
    os.makedirs(a.out, exist_ok=True)
    script = open(a.script).read().strip()
    sents = sentences(script)
    hook_txt = " ".join(sents[:a.hook_sentences])
    tw, ratio = align(words(a.vo), script)
    k = len(hook_txt.split())
    cut = (tw[k - 1][1][1] + tw[k][1][0]) / 2 if k < len(tw) else dur(a.vo)
    run(["ffmpeg", "-v", "error", "-y", "-i", a.vo, "-t", f"{cut + 0.15:.3f}", "-ar", "44100", "-b:a", "192k", f"{a.out}/hook.mp3"])
    run(["ffmpeg", "-v", "error", "-y", "-ss", f"{cut:.3f}", "-i", a.vo, "-ar", "44100", "-b:a", "192k", f"{a.out}/body.mp3"])
    info = {"cut": round(cut, 3), "match": round(ratio, 3), "hook_text": hook_txt, "body_sentences": sents[a.hook_sentences:],
            "hook_seconds": round(cut + 0.15, 2), "body_seconds": round(dur(f"{a.out}/body.mp3"), 2)}
    json.dump(info, open(f"{a.out}/split.json", "w"), indent=1)
    print(json.dumps(info, indent=1))
    if ratio < 0.85: sys.exit("ERROR: the voiceover does not match the script (match < 0.85)")


# ---------------------------------------------------------------- tarjetas
def tracked(d, text, font, tracking, features=None):
    return sum(d.textlength(c, font=font, features=features) for c in text) + tracking * max(0, len(text) - 1)


def draw_tracked(d, text, font, fill, cx, y, tracking=0, stroke=0, features=None):
    x = cx - tracked(d, text, font, tracking, features) / 2
    for ch in text:
        d.text((x, y), ch, font=font, fill=fill, stroke_width=stroke, stroke_fill=fill, features=features)
        x += d.textlength(ch, font=font, features=features) + tracking


def wrap(d, text, font, max_w, tracking, features=None):
    lines, cur = [], ""
    for wd in text.split():
        t = (cur + " " + wd).strip()
        if tracked(d, t, font, tracking, features) <= max_w or not cur: cur = t
        else: lines.append(cur); cur = wd
    return lines + ([cur] if cur else [])


def background(seed=7, scale=1.12):
    """Fondo de marca un 12 % más grande que el lienzo, para poder desplazarlo sin bordes."""
    bw, bh = int(W * scale), int(H * scale)
    rnd = random.Random(seed)
    img = Image.new("RGB", (bw, bh), BG)
    glow = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([-260, int(bh * 0.29), bw + 260, int(bh * 0.73)], fill=(150, 120, 80, 46))
    img = Image.alpha_composite(img.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(210))).convert("RGB")
    d = ImageDraw.Draw(img, "RGBA")
    for _ in range(380):
        x, y, r = rnd.uniform(0, bw), rnd.uniform(0, bh), rnd.uniform(0.6, 2.4)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(*GOLD, int(rnd.uniform(18, 92))))
    vig = Image.new("L", (bw, bh), 0)
    ImageDraw.Draw(vig).ellipse([-bw * 0.42, -bh * 0.16, bw * 1.42, bh * 1.16], fill=255)
    return Image.composite(img, Image.new("RGB", (bw, bh), (0, 0, 0)), vig.filter(ImageFilter.GaussianBlur(260)))


def card_png(path, kicker, headline, sub=None, head_size=96):
    """Titular en Regular + lnum/case + perfilado 1 px (las cifras de Bold no son de caja alta)."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    feats = ["lnum", "case"]
    f_head = ImageFont.truetype(REG, head_size, layout_engine=ImageFont.Layout.RAQM)
    lines = wrap(d, headline.upper(), f_head, 880, 2, feats)
    while len(lines) > 5 and head_size > 70:
        head_size -= 8; f_head = ImageFont.truetype(REG, head_size, layout_engine=ImageFont.Layout.RAQM); lines = wrap(d, headline.upper(), f_head, 880, 2, feats)
    lh = int(head_size * 1.08)
    f_sub = ImageFont.truetype(ITA, 46, layout_engine=ImageFont.Layout.RAQM) if sub else None
    sub_lines = wrap(d, sub, f_sub, 760, 0, feats) if sub else []
    block = len(lines) * lh + (len(sub_lines) * 62 + 46 if sub_lines else 0)
    y = (H - block) / 2 - 80
    if kicker:
        draw_tracked(d, kicker.upper(), ImageFont.truetype(REG, 34), LILA, W / 2, y - 110, tracking=4)
    for ln in lines:
        draw_tracked(d, ln, f_head, GOLD, W / 2, y, tracking=2, stroke=1, features=feats); y += lh
    if sub_lines:
        y += 46
        for ln in sub_lines:
            draw_tracked(d, ln, f_sub, WHITE, W / 2, y, features=feats); y += 62
    d.line([(W / 2 - 140, 1500), (W / 2 + 140, 1500)], fill=(*LILA, 210), width=3)
    draw_tracked(d, "KYNARI", ImageFont.truetype(BOLD, 52), GOLD_WM, W / 2, 1554, tracking=6)
    layer.save(path)


def sub_png(text, path):
    """Subtítulo del gancho: bloque con máscara negra, por encima de la zona segura."""
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    f = ImageFont.truetype(REG, 64, layout_engine=ImageFont.Layout.RAQM)
    lines, cur = [], ""
    for w in text.upper().split():
        if cur and len(cur) + 1 + len(w) > 22: lines.append(cur); cur = w
        else: cur = (cur + " " + w).strip()
    lines.append(cur)
    ws = [d.textlength(l, font=f, features=["lnum", "case"]) for l in lines]
    bw, bh = max(ws) + 72, 78 * len(lines) + 24
    y0, x0 = 1396 - bh, (W - bw) / 2
    d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], radius=14, fill=(0, 0, 0, 184))
    for i, l in enumerate(lines):
        d.text(((W - ws[i]) / 2, y0 + 12 + i * 78), l, font=f, fill=(243, 241, 237, 255), features=["lnum", "case"], stroke_width=2, stroke_fill=(0, 0, 0, 235))
    im.save(path)


def hook_blocks(tw):
    """Bloques de subtítulo: frase entera si cabe en 2 líneas; si no, se parte por la mitad."""
    sents, cur = [], []
    for w, ab in tw:
        cur.append((w, ab))
        if w[-1] in ".?!": sents.append(cur); cur = []
    if cur: sents.append(cur)
    bl = []
    for s in sents:
        if len(" ".join(w for w, _ in s)) <= 44: bl.append(s); continue
        k = len(s) // 2
        bl += [s[:k], s[k:]]
    res = [(c[0][1][0], c[-1][1][1], " ".join(w for w, _ in c)) for c in bl]
    return [(a, (res[i + 1][0] - 0.02) if i + 1 < len(res) else b + 0.45, t) for i, (a, b, t) in enumerate(res)]


# ---------------------------------------------------------------- build
def cmd_build(a):
    cfg = json.load(open(a.config))
    tmp = os.path.splitext(cfg["out"])[0] + "_work"; os.makedirs(tmp, exist_ok=True)

    # 1) Gancho: reescalar a 1080×1920 y subtitular con el texto del guion
    run(["ffmpeg", "-v", "error", "-y", "-i", cfg["talk"], "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30",
         "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", f"{tmp}/talk.mp4"])
    T1 = dur(f"{tmp}/talk.mp4")
    tw, ratio = align(words(f"{tmp}/talk.mp4"), cfg["hook_text"])
    ins, fc, prev = ["-i", f"{tmp}/talk.mp4"], [], "0:v"
    for i, (s, e, t) in enumerate(hook_blocks(tw)):
        p = f"{tmp}/sub{i}.png"; sub_png(t, p); ins += ["-i", p]
        fc.append(f"[{prev}][{i + 1}:v]overlay=0:0:enable='between(t,{s:.3f},{min(e, T1):.3f})'[h{i}]"); prev = f"h{i}"
    fc.append(f"[{prev}]null[hv]")
    run(["ffmpeg", "-v", "error", "-y", *ins, "-filter_complex", ";".join(fc), "-map", "[hv]", "-map", "0:a", "-c:v", "libx264", "-crf", "18", "-preset", "medium",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", f"{tmp}/hook.mp4"])
    print(f"hook {T1:.2f}s, subtitle match {ratio:.3f}")

    # 2) Cuerpo: una tarjeta por frase, cortes en el punto medio entre frases (whisper)
    body_txt = " ".join(cfg["body_sentences"])
    T2 = dur(cfg["body"])
    btw, bratio = align(words(cfg["body"]), body_txt)
    starts, k = [], 0
    for snt in cfg["body_sentences"]:
        starts.append(btw[k][1][0] if btw[k][1] else 0); k += len(snt.split())
    cuts = [0.0] + [(starts[i] + (btw[sum(len(s.split()) for s in cfg["body_sentences"][:i]) - 1][1][1])) / 2 for i in range(1, len(starts))] + [T2 + 0.6]
    bg = background(); bg.save(f"{tmp}/bg.jpg", quality=95)
    cards = cfg["cards"]
    if len(cards) != len(cfg["body_sentences"]): sys.exit("ERROR: one card per body sentence")
    end = {"kicker": cfg.get("category", ""), "headline": "Full analysis on kynari.io", "sub": None}
    seq = cards + [end]
    lens = [cuts[i + 1] - cuts[i] for i in range(len(cards))] + [2.4]
    XF = 0.45
    ins, fc = [], []
    for i, (c, L) in enumerate(zip(seq, lens)):
        p = f"{tmp}/card{i}.png"; card_png(p, c.get("kicker", ""), c["headline"], c.get("sub"))
        ins += ["-loop", "1", "-framerate", str(FPS), "-t", f"{L + XF:.3f}", "-i", p]
    total = sum(lens)
    ins += ["-loop", "1", "-framerate", str(FPS), "-t", f"{total + 1:.3f}", "-i", f"{tmp}/bg.jpg"]
    nbg = len(seq)
    # Fondo: deriva lenta y continua (crop que avanza), sin zoom: la tipografía nunca vibra
    fc.append(f"[{nbg}:v]crop={W}:{H}:x='(iw-{W})*(0.5+0.45*sin(t/9))':y='(ih-{H})*(0.5+0.45*cos(t/11))',setsar=1,format=yuv420p[bg]")
    prev, acc = "c0", lens[0]
    fc.append(f"[0:v]format=rgba[c0]")
    for i in range(1, len(seq)):
        fc.append(f"[{i}:v]format=rgba[c{i}]")
        fc.append(f"[{prev}][c{i}]xfade=transition=fade:duration={XF}:offset={acc:.3f}[x{i}]"); prev = f"x{i}"; acc += lens[i]
    fc.append(f"[bg][{prev}]overlay=0:0:shortest=1,fade=t=out:st={total - 0.5:.3f}:d=0.5,format=yuv420p[bv]")
    fc.append(f"[{nbg + 1}:a]apad=pad_dur=3,atrim=0:{total:.3f}[ba]")
    run(["ffmpeg", "-v", "error", "-y", *ins, "-i", cfg["body"], "-filter_complex", ";".join(fc), "-map", "[bv]", "-map", "[ba]", "-t", f"{total:.3f}",
         "-c:v", "libx264", "-crf", "19", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", f"{tmp}/body.mp4"])
    print(f"body {total:.2f}s ({len(cards)} cards), match {bratio:.3f}")

    # 3) Unir, música de marca por debajo (0,26 cara / 0,52 tarjetas) y −14 LUFS
    run(["ffmpeg", "-v", "error", "-y", "-i", f"{tmp}/hook.mp4", "-i", f"{tmp}/body.mp4", "-filter_complex",
         "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]", "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "19", "-preset", "medium",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", f"{tmp}/joined.mp4"])
    TT = dur(f"{tmp}/joined.mp4")
    vol = f"volume='if(lt(t,{T1:.3f}),0.26,0.52)':eval=frame"
    run(["ffmpeg", "-v", "error", "-y", "-i", f"{tmp}/joined.mp4", "-i", cfg["music"], "-filter_complex",
         f"[1:a]atrim=0:{TT:.3f},asetpts=PTS-STARTPTS,{vol},equalizer=f=700:t=q:w=1:g=-4,equalizer=f=2400:t=q:w=1:g=-5,afade=t=in:d=0.6,afade=t=out:st={TT - 1.6:.3f}:d=1.6[m];"
         f"[0:a][m]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]",
         "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", cfg["out"]])
    run(["ffmpeg", "-v", "error", "-y", "-ss", "1.2", "-i", cfg["out"], "-frames:v", "1", "-q:v", "3", cfg.get("poster", os.path.splitext(cfg["out"])[0] + "_poster.jpg")])
    m, s = divmod(round(dur(cfg["out"])), 60)
    print(json.dumps({"out": cfg["out"], "seconds": round(dur(cfg["out"]), 2), "duration": f"{m}:{s:02d}", "kb": os.path.getsize(cfg["out"]) // 1024}))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); sp = ap.add_subparsers(dest="cmd", required=True)
    s1 = sp.add_parser("split"); s1.add_argument("vo"); s1.add_argument("--script", required=True); s1.add_argument("--hook-sentences", type=int, default=2); s1.add_argument("--out", default="work")
    s2 = sp.add_parser("build"); s2.add_argument("config")
    a = ap.parse_args()
    {"split": cmd_split, "build": cmd_build}[a.cmd](a)
