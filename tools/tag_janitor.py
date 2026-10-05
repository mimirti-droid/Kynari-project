#!/usr/bin/env python3
"""tag_janitor.py — mantiene limpias las etiquetas públicas de kynari.io.

El pipeline de Make.com crea una etiqueta pública nueva por cada nombre propio
que aparece en un artículo. Cada etiqueta pública genera una página de archivo
que entra en el sitemap y se come presupuesto de rastreo. Este vigilante:

  - BORRA las etiquetas públicas que no tienen ningún artículo.
  - PASA A INTERNAS las que están fuera de la lista blanca y no llegan a
    KEEP_MIN artículos. Siguen asociadas a sus artículos y sirven para filtrar
    en el panel de Ghost, pero no generan página pública ni entran en el
    sitemap. Es reversible con un PUT a visibility=public.
  - DEJA EN PAZ las de la lista blanca.
  - AVISA (abriendo una incidencia) de las que están fuera de la lista pero ya
    superan KEEP_MIN artículos: puede que merezcan ser sección pública, y eso
    lo decide Marc.

Es idempotente: si no hay nada que limpiar, no toca nada.

Contexto completo en el documento del proyecto
«Kynari - Higiene de Etiquetas e Indexacion».

Uso:
    export GHOST_ADMIN_KEY='id:secret'
    python tag_janitor.py --dry-run     # informa, no escribe
    python tag_janitor.py               # aplica
    python tag_janitor.py --no-delete   # solo pasa a internas (reversible)

Códigos de salida:
    0  todo bien
    1  errores al escribir en Ghost
    2  freno de seguridad (más de MAX_CHANGES cambios propuestos)
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

import requests

import ghost_api

# --------------------------------------------------------------------------
# Parámetros que decide Marc
# --------------------------------------------------------------------------

#: Las etiquetas que se mantienen públicas pase lo que pase.
ALLOWLIST = {
    # Categorías
    "cinema", "anime", "games", "comic", "culture",
    # Marcadores
    "featured", "legacy", "latest", "kynari-legacy-2",
    # Resto (tenían 8 artículos o más en la limpieza del 19 sept. 2026)
    "marvel", "marvel-comics", "dc-comics", "spider-man", "mcu", "streaming",
    "crunchyroll", "nintendo", "imax", "television", "box-office", "industry",
    "gaming-industry", "hollywood", "pop-culture", "animation", "adaptation",
    "horror", "music", "christopher-nolan", "the-odyssey", "summer-2026",
    "2026",
}

#: Una etiqueta fuera de la lista blanca solo sobrevive como pública si reúne
#: este número de artículos. Por debajo, su página de archivo es demasiado
#: pobre para que Google la indexe y solo gasta rastreo.
KEEP_MIN = 8

#: Freno de seguridad. Si un día se proponen más cambios que esto, el script
#: para sin tocar nada: significa que el pipeline ha cambiado de comportamiento.
MAX_CHANGES = 400


# --------------------------------------------------------------------------

def classify(tags):
    """Reparte las etiquetas públicas en los cuatro cubos."""
    buckets = {"delete": [], "internal": [], "candidates": [], "keep": []}
    for tag in tags:
        if tag.get("visibility") != "public":
            continue
        slug = tag["slug"]
        count = (tag.get("count") or {}).get("posts", 0)
        if slug in ALLOWLIST:
            buckets["keep"].append(tag)
        elif count == 0:
            buckets["delete"].append(tag)
        elif count >= KEEP_MIN:
            buckets["candidates"].append(tag)
        else:
            buckets["internal"].append(tag)
    return buckets


def posts_of(tag):
    return (tag.get("count") or {}).get("posts", 0)


def write_backup(tags, path):
    """Copia de seguridad del estado anterior, por si hay que revertir."""
    snapshot = [
        {
            "id": t["id"],
            "name": t["name"],
            "slug": t["slug"],
            "visibility": t.get("visibility"),
            "posts": posts_of(t),
        }
        for t in tags
    ]
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(
            {
                "taken_at": datetime.now(timezone.utc).isoformat(),
                "tags": snapshot,
            },
            fh,
            ensure_ascii=False,
            indent=2,
        )
    return path


def make_internal(tag):
    """PUT visibility=internal. Reversible con un PUT a public."""
    body = {"tags": [{"id": tag["id"], "visibility": "internal"}]}
    r = ghost_api.request(
        "PUT", f"/ghost/api/admin/tags/{tag['id']}/", json=body
    )
    if r.status_code >= 300:
        raise RuntimeError(f"{r.status_code}: {r.text[:200]}")


def remove_tag(tag):
    """DELETE. Solo se llama con etiquetas de 0 artículos."""
    r = ghost_api.request("DELETE", f"/ghost/api/admin/tags/{tag['id']}/")
    if r.status_code >= 300 and r.status_code != 404:
        raise RuntimeError(f"{r.status_code}: {r.text[:200]}")


# --------------------------------------------------------------------------
# Candidatas a lista blanca: abrir incidencia en GitHub
# --------------------------------------------------------------------------

ISSUE_TITLE = "Candidatas a lista blanca de etiquetas públicas"


def report_candidates(candidates):
    """Abre una incidencia con las candidatas. No abre otra si ya hay una."""
    token = os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        print(
            "  (sin GITHUB_TOKEN/GITHUB_REPOSITORY: no se abre incidencia, "
            "las candidatas quedan solo en este informe)"
        )
        return
    api = f"https://api.github.com/repos/{repo}/issues"
    hdrs = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
    }
    try:
        existing = requests.get(
            api, headers=hdrs, params={"state": "open"}, timeout=30
        )
        existing.raise_for_status()
        if any(i["title"] == ISSUE_TITLE for i in existing.json()):
            print("  (ya hay una incidencia abierta, no se abre otra)")
            return
        lines = [
            f"Etiquetas públicas fuera de `ALLOWLIST` que ya superan "
            f"`KEEP_MIN = {KEEP_MIN}` artículos. El vigilante las ha dejado "
            "públicas.",
            "",
            "| Etiqueta | Artículos |",
            "| --- | --- |",
        ]
        for tag in sorted(candidates, key=posts_of, reverse=True):
            lines.append(f"| `{tag['slug']}` | {posts_of(tag)} |")
        lines += [
            "",
            "Si tiene sentido como sección, añadirla a `ALLOWLIST` en "
            "`tools/tag_janitor.py` y al documento del proyecto. Si no, "
            "pasarla a interna a mano desde el panel de Ghost.",
        ]
        r = requests.post(
            api,
            headers=hdrs,
            json={"title": ISSUE_TITLE, "body": "\n".join(lines)},
            timeout=30,
        )
        r.raise_for_status()
        print(f"  Incidencia abierta: {r.json()['html_url']}")
    except requests.RequestException as exc:
        print(f"  (no se pudo abrir la incidencia: {exc})")


# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="informa de lo que haría, sin escribir nada",
    )
    ap.add_argument(
        "--no-delete",
        action="store_true",
        help="omite los borrados: solo pasa a internas (todo reversible)",
    )
    ap.add_argument(
        "--backup",
        default="backup_tags.json",
        help="dónde guardar la copia del estado anterior",
    )
    args = ap.parse_args()

    tags = ghost_api.get_all_tags()
    buckets = classify(tags)
    public = sum(1 for t in tags if t.get("visibility") == "public")

    print(f"Etiquetas totales: {len(tags)}")
    print(f"Públicas: {public}")
    print(f"En lista blanca: {len(buckets['keep'])} de {len(ALLOWLIST)}")

    missing = sorted(ALLOWLIST - {t["slug"] for t in buckets["keep"]})
    if missing:
        print(f"  De la lista blanca NO públicas: {', '.join(missing)}")

    to_delete = [] if args.no_delete else buckets["delete"]
    to_internal = buckets["internal"]
    total = len(to_delete) + len(to_internal)

    print(f"\nA BORRAR (públicas con 0 artículos): {len(to_delete)}")
    for t in sorted(to_delete, key=lambda x: x["slug"]):
        print(f"  {t['slug']}")
    if args.no_delete and buckets["delete"]:
        print(
            f"  (--no-delete: se omiten {len(buckets['delete'])} borrados)"
        )

    print(
        f"\nA INTERNAS (fuera de lista, < {KEEP_MIN} artículos): "
        f"{len(to_internal)}"
    )
    for t in sorted(to_internal, key=lambda x: x["slug"]):
        print(f"  {t['slug']} ({posts_of(t)})")

    print(
        f"\nCANDIDATAS A LISTA BLANCA (fuera de lista, >= {KEEP_MIN}): "
        f"{len(buckets['candidates'])}"
    )
    for t in sorted(buckets["candidates"], key=posts_of, reverse=True):
        print(f"  {t['slug']} ({posts_of(t)})")

    print(f"\nTOTAL DE CAMBIOS: {total} (freno en {MAX_CHANGES})")

    if total > MAX_CHANGES:
        print(
            "\nFRENO DE SEGURIDAD: por encima del límite. No se toca nada.\n"
            "Algo ha cambiado en el pipeline de Make.com. Revisar antes de "
            "volver a ejecutar."
        )
        return 2

    if total == 0:
        print("\nNada que limpiar.")
        if buckets["candidates"]:
            report_candidates(buckets["candidates"])
        return 0

    if args.dry_run:
        print("\n--dry-run: no se ha escrito nada.")
        return 0

    print(f"\nCopia de seguridad en {write_backup(tags, args.backup)}")

    errors = 0
    deleted = 0
    internalised = 0

    for tag in to_delete:
        try:
            remove_tag(tag)
            deleted += 1
        except Exception as exc:          # noqa: BLE001
            errors += 1
            print(f"  ERROR al borrar {tag['slug']}: {exc}")

    for tag in to_internal:
        try:
            make_internal(tag)
            internalised += 1
        except Exception as exc:          # noqa: BLE001
            errors += 1
            print(f"  ERROR al pasar a interna {tag['slug']}: {exc}")

    print(f"\nBorradas: {deleted}")
    print(f"Pasadas a internas: {internalised}")
    print(
        f"Públicas que quedan: "
        f"{len(buckets['keep']) + len(buckets['candidates'])}"
    )

    if buckets["candidates"]:
        report_candidates(buckets["candidates"])

    if errors:
        print(f"\n{errors} errores al escribir en Ghost.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
