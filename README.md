# KYNARI

*Crafted with obsession for those who see deeper.*

Plataforma editorial de cultura pop con enfoque cinematográfico, oscuro y analítico. Cubre **Cinema, Anime, Games, Culture y Comic**. Publicación premium, no un blog generalista.

- Web: [kynari.io](https://kynari.io)
- Contacto: hello@kynari.io

## Documentación

La documentación parte de **Kynari Documentación 2026** (base) y **Kynari Project Bible** (complemento), ambas de junio de 2026. El estado real del proyecto ha evolucionado desde entonces; empieza por el documento de estado actual.

| Documento | Contenido |
| --- | --- |
| [00 · Estado actual](docs/00-estado-actual.md) | Qué ha cambiado respecto a la documentación de junio (Framer → Ghost, etc.) |
| [01 · Identidad](docs/01-identidad.md) | Qué es Kynari, propósito, categorías y secciones |
| [02 · Branding](docs/02-branding.md) | Paleta, tipografía, logo, hover states, colores por categoría |
| [03 · Arquitectura web](docs/03-arquitectura-web.md) | Estructura de la home, layouts de cards, CMS |
| [04 · Guía editorial](docs/04-guia-editorial.md) | Voz, tono, reglas de títulos, longitudes |
| [05 · SEO](docs/05-seo.md) | Bloque SEO/Meta por artículo |
| [06 · Pipeline](docs/06-pipeline.md) | Automatización de artículos: diseño original y sistema actual |
| [07 · Roadmap](docs/07-roadmap.md) | Completado, pendiente y checklist de lanzamiento |

## Estructura del repositorio

```
docs/       Documentación del proyecto
theme/      Tema de Ghost (kynari-theme)
pipeline/   Publisher de artículos, servidor y panel
tools/      Herramientas auxiliares (Article Generator, prototipos)
```

> Las claves de API nunca se suben al repo: van en un `.env` local (ver `.env.example`).
