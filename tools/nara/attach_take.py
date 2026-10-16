# -*- coding: utf-8 -*-
"""Sube un Nara's take a Ghost y lo engancha a su artículo (v2, 16 oct. 2026).

  python3 attach_take.py --post <id> --mp4 take.mp4|https://… --poster poster.jpg|https://… --title "..." [--duration 0:37] [--yt SHORTS_ID]

Sube el mp4 (/media/upload/) y el póster (/images/upload/), escribe `nara` en el JSON
kynari-media del post (codeinjection_head) y añade las etiquetas internas #nara y #video.
Desde la 2.0.9 sube también `card`: el fotograma sin subtítulos que usa la tarjeta de la portada.
La clave sale de GHOST_ADMIN_KEY.
"""
import argparse, json, os, re, subprocess, time

import jwt, requests

API = os.environ.get("GHOST_URL", "https://www.kynari.io").rstrip("/") + "/ghost/api/admin"
MEDIA_RE = re.compile(r'<script[^>]*id=["\']kynari-media["\'][^>]*>([\s\S]*?)</script>\s*', re.I)


def token():
    i, s = os.environ["GHOST_ADMIN_KEY"].split(":")
    iat = int(time.time())
    return jwt.encode({"iat": iat, "exp": iat + 300, "aud": "/admin/"}, bytes.fromhex(s), algorithm="HS256", headers={"kid": i})


def H(): return {"Authorization": f"Ghost {token()}", "Accept-Version": "v5.0"}


def upload(path, kind):
    url = f"{API}/{'media' if kind == 'video' else 'images'}/upload/"
    mime = "video/mp4" if kind == "video" else "image/jpeg"
    with open(path, "rb") as f:
        r = requests.post(url, headers=H(), files={"file": (os.path.basename(path), f, mime)}, data={} if kind == "video" else {"purpose": "image"}, timeout=300)
    r.raise_for_status()
    d = r.json()
    return d["media"][0]["url"] if kind == "video" else d["images"][0]["url"]


def with_media(head, patch):
    m = MEDIA_RE.search(head or "")
    prev = json.loads(m.group(1)) if m else {"v": 1}
    nxt = {**prev, **patch, "v": 1}
    block = '<script type="application/json" id="kynari-media">' + json.dumps(nxt).replace("<", "\\u003c") + "</script>\n"
    return block + MEDIA_RE.sub("", head or "")


def make_card(mp4, out="nara_card.jpg"):
    """Fotograma para la tarjeta de la portada sin los subtítulos quemados (2.0.9).

    Saca el fotograma del segundo 1 y difumina la franja de subtítulos (60–81 % de la altura),
    que en la tarjeta queda bajo el degradado del título. El póster del reproductor no cambia."""
    from PIL import Image, ImageDraw, ImageFilter
    raw = out + ".png"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", "1", "-i", mp4, "-frames:v", "1", raw], check=True, stdin=subprocess.DEVNULL)
    im = Image.open(raw).convert("RGB"); w, h = im.size
    blur = im.filter(ImageFilter.GaussianBlur(26)).filter(ImageFilter.GaussianBlur(26))
    mask = Image.new("L", (w, h), 0); ImageDraw.Draw(mask).rectangle((int(w * .06), int(h * .6), int(w * .94), int(h * .815)), fill=255)
    Image.composite(blur, im, mask.filter(ImageFilter.GaussianBlur(18))).save(out, quality=85)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--post", required=True); ap.add_argument("--mp4", required=True); ap.add_argument("--poster", required=True)
    ap.add_argument("--title", required=True); ap.add_argument("--duration"); ap.add_argument("--yt")
    a = ap.parse_args()
    if not a.duration:
        s = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", a.mp4], capture_output=True, text=True).stdout)
        a.duration = f"{int(s // 60)}:{round(s % 60):02d}"
    # Si el vídeo ya está en Ghost (p. ej. un gancho o un Legacy programado en Metricool),
    # se reutiliza su URL en vez de subirlo otra vez.
    mp4 = a.mp4 if a.mp4.startswith("http") else upload(a.mp4, "video")
    poster = a.poster if a.poster.startswith("http") else upload(a.poster, "image")
    p = requests.get(f"{API}/posts/{a.post}/?include=tags", headers=H(), timeout=60).json()["posts"][0]
    nara = {"mp4": mp4, "poster": poster, "duration": a.duration, "title": a.title}
    try:
        nara["card"] = upload(make_card(mp4), "image")
    except Exception as e:  # sin tarjeta limpia la portada usa el póster
        print(f"Aviso: no se pudo crear la tarjeta sin subtítulos: {e}")
    if a.yt: nara["yt"] = a.yt
    have = {t["name"].lower() for t in p["tags"]}
    tags = [{"id": t["id"]} for t in p["tags"]] + [{"name": n} for n in ("#nara", "#video") if n not in have]
    r = requests.put(f"{API}/posts/{a.post}/", headers=H(), timeout=60, json={"posts": [{
        "updated_at": p["updated_at"], "codeinjection_head": with_media(p.get("codeinjection_head"), {"nara": nara}), "tags": tags}]})
    r.raise_for_status()
    print(json.dumps({"post": p["url"], "nara": nara}, indent=1))


if __name__ == "__main__":
    main()
