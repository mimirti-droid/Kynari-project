# Tag janitor — puesta en marcha y salvaguardas

Mantiene limpias las etiquetas públicas de kynari.io (Ghost). Contexto completo
y el historial en el documento del proyecto
«Kynari - Higiene de Etiquetas e Indexacion».

## El problema que resuelve

El pipeline de Make.com que publica los artículos crea una **etiqueta pública
nueva por cada nombre propio** que aparece en el texto. Cada etiqueta pública
genera una página de archivo que entra en el sitemap. El 19 de septiembre de
2026 había 1.031 etiquetas públicas para 243 artículos, el sitemap tenía 1.229
URLs y Google solo indexaba 150 artículos: el presupuesto de rastreo se gastaba
en páginas de archivo con uno o dos textos dentro.

Se limpió (47 borradas, 952 pasadas a internas, 32 públicas) y el sitemap bajó
a 278 URLs. Este vigilante mantiene esa limpieza.

## Qué hace

| Cubo | Criterio | Acción |
| --- | --- | --- |
| Borrar | pública y con 0 artículos | `DELETE` |
| A internas | pública, fuera de `ALLOWLIST`, menos de `KEEP_MIN` artículos | `PUT visibility=internal` |
| Candidatas | pública, fuera de `ALLOWLIST`, `KEEP_MIN` artículos o más | se deja pública y se abre una incidencia |
| Intactas | en `ALLOWLIST` | nada |

Una etiqueta interna en Ghost es la que lleva almohadilla delante. Por API basta
`visibility: "internal"`; no hace falta renombrarla. Desaparece del sitemap y su
página pública pasa a 404 en segundos. **Es reversible** con un `PUT` a
`public`. Sigue asociada a sus artículos y sirve para filtrar en el panel.

El script es **idempotente**: si no hay nada que limpiar, no toca nada.

## Puesta en marcha

1. **Los archivos en `main`** — este directorio más
   `.github/workflows/tag-janitor.yml`.
2. **El secreto**: Settings → Secrets and variables → Actions → New repository
   secret. Nombre `GHOST_ADMIN_KEY`, valor la clave de la Ghost Admin API en
   formato `id:secret`. **Mientras no exista, el workflow avisa y no hace nada**
   — no falla a diario.
3. **Lanzarlo a mano una vez** desde la pestaña Actions con la casilla *dry run*
   marcada, y mirar el registro.
4. **Desactivar la tarea programada de Claude** «limpieza diaria de etiquetas»,
   para no tener dos vigilantes sobre las mismas etiquetas.

## Cuándo corre

A diario a las **05:00 UTC** (07:00 en Madrid en horario de verano, 06:00 en
invierno). También a mano desde la pestaña Actions, con la casilla *dry run*.

## Los parámetros que decide Marc

Al principio de `tag_janitor.py`:

- `ALLOWLIST` — las 32 etiquetas que se mantienen públicas pase lo que pase.
- `KEEP_MIN = 8` — mínimo de artículos para que una etiqueta de fuera de la
  lista sobreviva como pública. Por debajo, su página de archivo es demasiado
  pobre para que Google la indexe y solo gasta rastreo.
- `MAX_CHANGES = 400` — freno de seguridad.

Al cambiar `ALLOWLIST`, actualizar también la lista del documento del proyecto.

## Salvaguardas

- **Freno de seguridad.** Si un día se proponen más de `MAX_CHANGES` cambios,
  **para sin tocar nada** y sale con código 2, con lo que el workflow falla y
  GitHub avisa por correo. Un día así significa que el pipeline de Make.com ha
  cambiado de comportamiento.
- **Candidatas a lista blanca.** Cuando una etiqueta de fuera de la lista supera
  `KEEP_MIN`, se queda pública y se abre una incidencia para decidir si merece
  ser sección. No se abre otra si ya hay una abierta.
- **Copia de seguridad.** Antes de escribir, el estado completo de todas las
  etiquetas (id, nombre, slug, visibilidad, número de artículos) va a
  `backup_tags.json`, que el workflow guarda como artefacto 90 días. Para
  revertir, `PUT visibility=public` sobre los ids de ahí.
- **Reintentos** ante fallos de red y 5xx, tres por petición, regenerando el JWT
  en cada intento.
- **Banderas.** `--dry-run` informa sin escribir. `--no-delete` omite los
  borrados y solo pasa a internas, con lo que la ejecución entera es reversible.

## Códigos de salida

| Código | Significado |
| --- | --- |
| 0 | todo bien |
| 1 | errores al escribir en Ghost |
| 2 | freno de seguridad |

## La clave

**No está en el código ni debe estarlo.** `ghost_api.py` la lee de la variable
de entorno `GHOST_ADMIN_KEY`. Misma convención que
`pipeline/kynari-publisher.mjs` y `.env.example`.

## Probar en local

```bash
pip install -r tools/requirements.txt
export GHOST_ADMIN_KEY='id:secret'
cd tools && python tag_janitor.py --dry-run
```

## La solución de fondo

Este vigilante es un parche: limpia después del desastre. Lo que arregla el
origen es **el escenario de Make.com**, anteponiendo `#` al crear cualquier
etiqueta que no esté en la lista blanca, para que nazca ya interna. Mientras eso
no se toque, el vigilante hace falta a diario.
