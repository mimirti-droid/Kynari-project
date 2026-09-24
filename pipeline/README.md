# pipeline/

Publisher automático de artículos para Ghost.

Pendiente de subir desde la copia local:

- `kynari-publisher.mjs`: generación y publicación (v11)
- `kynari-server.mjs`: servidor local
- `kynari-panel.html`: panel de control

Requisitos: Node.js v24+. Configurar las claves en un `.env` a partir de `../.env.example`.

Notas técnicas:

- JWT de la Admin API de Ghost: `aud: '/admin/'`, caducidad 300 s; la clave se separa por `:` en `[id, secret]` y el secret va en hex.
- La subida de imágenes a Ghost necesita un multipart/form-data construido a mano como `Uint8Array`.
- Para extraer JSON de respuestas largas de Claude: `text.match(/\{[\s\S]*\}/)` como respaldo.
- fal.ai: `landscape_16_9` para la imagen destacada, `portrait_4_3` para las interiores.
