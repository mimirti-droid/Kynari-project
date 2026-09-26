# theme/

Tema de Ghost de Kynari. Versión activa en kynari.io: **1.1.0** (subido como `kynari-v1-1`, 26 sep 2026).

Anterior: `kynari_project_fixed_2` (1.0.0), sigue instalado en Ghost para volver atrás desde Settings → Design → Change theme.

## Cambios de la 1.1

- `author.hbs`: página de autor propia (antes /author/nara/ mostraba la portada).
- `page.hbs`: páginas sin firma ni "More Like This" (About, Privacy, Cookies).
- Portada: las páginas 2+ son un archivo de artículos en vez de repetir la portada; botón "More articles".
- Imágenes en WebP con `img_url ... format="webp"` (reinos: de ~1 MB a ~70 KB) y logo a 150 px.
- Fuentes con `preconnect` y `<link>` en el head en vez de `@import`.
- Artículo: firma enlazada al autor, fecha en `<time>`, botones de compartir (X, Threads, Bluesky, WhatsApp, copiar, nativo) y caja de autor.
- Pie: About, Privacy, Cookies, RSS.
- Accesibilidad: gris a #8A8A99, encabezados en orden, foco visible, "reducir movimiento", aparición sin JS.
- Móvil: cabecera de artículo corregida y hero más bajo (62svh).

## Notas técnicas

- Condicionales por categoría en `tag.hbs` con `{{#match tag.slug "valor"}}`.
- Posts relacionados con `{{#get "posts" filter="tag:{{primary_tag.slug}}+id:-{{id}}"}}`.
- Validar con `npx gscan theme/` antes de subir.
