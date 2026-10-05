"""Helpers de la Ghost Admin API de kynari.io.

La clave NUNCA va en el código: se lee de la variable de entorno
GHOST_ADMIN_KEY, en el formato habitual `id:secret`. En GitHub Actions
llega del secreto del repositorio con ese mismo nombre.

Misma convención que `pipeline/kynari-publisher.mjs` y `.env.example`.
"""
import os
import time

import jwt
import requests

API_URL = os.environ.get("GHOST_API_URL", "https://www.kynari.io")

RETRIES = 3


def admin_key():
    key = os.environ.get("GHOST_ADMIN_KEY", "")
    if not key or ":" not in key:
        raise RuntimeError(
            "GHOST_ADMIN_KEY no definida o con formato incorrecto. "
            "Se espera 'id:secret'."
        )
    return key


def make_token(key=None):
    """JWT HS256 para la Admin API. Caduca en 5 min, aud '/admin/'."""
    id_, secret = (key or admin_key()).split(":")
    iat = int(time.time())
    header = {"alg": "HS256", "typ": "JWT", "kid": id_}
    payload = {"iat": iat, "exp": iat + 5 * 60, "aud": "/admin/"}
    token = jwt.encode(
        payload, bytes.fromhex(secret), algorithm="HS256", headers=header
    )
    if isinstance(token, bytes):
        token = token.decode("utf-8")
    return token


def headers():
    return {
        "Authorization": f"Ghost {make_token()}",
        "Accept-Version": "v5.0",
        "Content-Type": "application/json",
    }


def request(method, path, retries=RETRIES, **kwargs):
    """Petición a la Admin API, con reintentos ante fallos de red y 5xx.

    El token se regenera en cada intento, así que un reintento lento no se
    encuentra con un JWT caducado.
    """
    url = f"{API_URL}{path}"
    last = None
    for attempt in range(retries):
        try:
            r = requests.request(
                method, url, headers=headers(), timeout=30, **kwargs
            )
            if r.status_code >= 500:
                last = RuntimeError(f"{r.status_code}: {r.text[:200]}")
                time.sleep(2 * (attempt + 1))
                continue
            return r
        except requests.RequestException as exc:
            last = exc
            time.sleep(2 * (attempt + 1))
    raise last


def get_all_tags():
    """Todas las etiquetas, paginadas, con el número de artículos de cada una."""
    tags = []
    page = 1
    while True:
        r = request(
            "GET",
            f"/ghost/api/admin/tags/?limit=100&page={page}&include=count.posts",
        )
        r.raise_for_status()
        data = r.json()
        tags.extend(data["tags"])
        nxt = data["meta"]["pagination"].get("next")
        if not nxt:
            break
        page = nxt
    return tags
