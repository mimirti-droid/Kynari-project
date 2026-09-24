# 06 · Pipeline de artículos

## Sistema actual: Ghost publisher

Código en [`/pipeline`](../pipeline).

| Pieza | Función |
| --- | --- |
| `kynari-publisher.mjs` | Detecta temas trending, genera el artículo con Claude, busca imágenes y publica en Ghost |
| `kynari-server.mjs` | Servidor local que controla el publisher |
| `kynari-panel.html` | Panel web para lanzar y supervisar el pipeline |

**Características:**

- Anti-repetición: los últimos 30 títulos publicados se pasan a Claude antes de buscar temas.
- Deduplicación de temas en el mismo día entre las cinco categorías.
- Imágenes: TMDB (Cinema/Anime/Culture), IGDB vía Twitch OAuth (Games), fal.ai como respaldo.
- Imagen hero + dos interiores siempre distintas, con créditos automáticos en el pie.
- Embeds de YouTube como HTML card.
- Ejecución manual: la generación de artículos no está programada todavía.

## Estructura del artículo generado

- Título
- Sección (Featured / Latest / Kynari Legacy)
- Subtítulo
- Cuerpo
- Extracto
- Prompts de imagen
- Tags
- SEO: meta title, slug, meta description, excerpt social

## Diseño original (junio 2026)

Lista de temas en Notion → Make.com detecta un tema nuevo → Claude API genera el artículo estructurado → fal.ai genera 2–4 imágenes → todo aterriza en Notion → plugin oficial sincroniza con Framer.

**Modalidad:** semi-automática. El pipeline deja el artículo listo para revisión y no publica sin supervisión.

**Descartado:**

- Vídeo automático: coste, latencia y calidad irregular. Se deja prompt de vídeo para generación manual.
- Full-auto con trending automático: riesgo de diluir la voz editorial.

El escenario de Make.com (Notion → Claude → JSON → Notion) sigue existiendo como sistema paralelo.

## Variables de entorno

Ver [`.env.example`](../.env.example). Nunca subir claves al repositorio.
