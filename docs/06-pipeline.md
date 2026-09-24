# 06 · Pipeline de artículos

Código en [`/pipeline`](../pipeline). Publica directamente en **Ghost** vía Admin API.

| Pieza | Función |
| --- | --- |
| `kynari-publisher.mjs` | Detecta temas trending, genera el artículo con Claude, busca imágenes y publica en Ghost |
| `kynari-server.mjs` | Servidor local que controla el publisher |
| `kynari-panel.html` | Panel web para lanzar y supervisar el pipeline |

## Características

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

## Principios

- **Semi-automático:** el pipeline genera y publica, pero bajo supervisión; la voz editorial manda sobre el volumen.
- **Sin vídeo automático:** coste, latencia y calidad irregular. Se deja prompt de vídeo para generación manual.

## Variables de entorno

Ver [`.env.example`](../.env.example). Nunca subir claves al repositorio.
