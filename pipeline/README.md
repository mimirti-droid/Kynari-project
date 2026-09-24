# pipeline/

Publisher automático de artículos para Ghost.

| Archivo | Función |
| --- | --- |
| `kynari-publisher.mjs` | v13. Busca el tema trending, genera el artículo con Claude, obtiene imágenes (TMDB / IGDB / fal.ai) y publica en Ghost |
| `kynari-server.mjs` | v3. Servidor local en `http://localhost:4173` que sirve el panel y lanza el publisher |
| `kynari-panel.html` | Panel web: diario (5 categorías), Legacy semanal, tema a elección, últimos publicados y consola |
| `kynari-daily.example.bat` | Plantilla de lanzador para Windows (sin claves) |

## Uso

```bash
node kynari-publisher.mjs daily                      # 5 categorías, una vez al día
node kynari-publisher.mjs legacy                     # 1 ensayo Legacy por semana
node kynari-publisher.mjs custom --topic "..." --category Cinema --section Featured [--angle "..."] [--youtube URL]
node kynari-server.mjs                               # panel en http://localhost:4173
```

Requisitos: Node.js v24+. Todas las claves van en variables de entorno (ver `../.env.example`).

## Archivos de estado (no se suben)

`kynari-log.json`, `kynari-queue.json`, `kynari-last-daily.json`, `kynari-last-legacy.json` se generan en local al ejecutar.

## Notas técnicas

- JWT de la Admin API de Ghost: `aud: '/admin/'`, caducidad 300 s; la clave se separa por `:` en `[id, secret]` y el secret va en hex.
- La subida de imágenes a Ghost usa un multipart/form-data construido a mano.
- El hero prioriza imágenes verticales (póster TMDB, cover IGDB, fal.ai `portrait_4_3`) para no recortar mal en las tarjetas 3:4; los interiores van en horizontal.
