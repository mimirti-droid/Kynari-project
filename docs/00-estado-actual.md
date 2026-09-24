# 00 · Estado actual del proyecto

La documentación base (Documentación 2026 y Project Bible, junio de 2026) describe el plan inicial. Desde entonces el proyecto ha cambiado en varios puntos clave. Este documento recoge esas diferencias; donde haya conflicto, **manda lo que dice aquí**.

## Cambios respecto a la documentación de junio

| Tema | Documentación de junio | Estado actual (sept. 2026) |
| --- | --- | --- |
| CMS / web | Framer Pro + Notion vía plugin | **Framer abandonado.** Ghost CMS self-hosted en Railway |
| Tema visual | Implementación en Framer | Tema propio de Ghost `kynari-theme v1.0.0`, hecho desde cero con el design system de Kynari |
| Idioma | Bilingüe ES/EN | Publicación en **inglés** |
| Títulos de obras | Título oficial en español (Título original, año) | Títulos en inglés con año de estreno entre paréntesis |
| Autoría | Voz de Marc Martí Gimeno (DocPastor) | Persona autora: **Nara Vega**, con la voz analítica heredada de DocPastor |
| Pipeline | Make.com → Claude → fal.ai → Notion → Framer (pendiente) | Sistema principal: `kynari-publisher.mjs` + `kynari-server.mjs` + `kynari-panel.html`, publicando directo en Ghost. Make.com queda como sistema paralelo/anterior |
| Imágenes | fal.ai (Flux) | TMDB (Cinema/Anime/Culture), IGDB (Games), fal.ai como respaldo; créditos de imagen automáticos |
| Dominio | kynari.io | Registrado en Namecheap; conexión a Railway pendiente |

## Estructura de secciones (actual)

- **Featured**: carrusel.
- **Latest**: hero card + lista.
- **Kynari Legacy**: ensayos retrospectivos de largo aliento. Los artículos Legacy llevan solo la etiqueta `legacy`, no etiqueta de categoría.

## Distribución social

Kynari tiene presencia en Instagram, X (`@kynariverse`), TikTok y Pinterest, con plantillas propias por red. El detalle está en los documentos de trabajo del proyecto de Claude (estrategia de redes, pipeline social, pipeline de vídeo vertical).
