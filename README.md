# KYNARI

*Crafted with obsession for those who see deeper.*

Plataforma editorial de cultura pop con enfoque cinematográfico, oscuro y analítico. Cubre **Cinema, Anime, Games, Culture y Comic**. Publicación premium, no un blog generalista.

- Web: [kynari.io](https://kynari.io), sobre **Ghost CMS**
- Contacto: hello@kynari.io

## Documentación

Basada en **Kynari Documentación 2026** (base) y **Kynari Project Bible** (complemento), actualizada al stack real del proyecto.

| Documento | Contenido |
| --- | --- |
| [00 · Estado actual](docs/00-estado-actual.md) | Stack, secciones y distribución hoy |
| [01 · Identidad](docs/01-identidad.md) | Qué es Kynari, propósito, categorías y secciones |
| [02 · Branding](docs/02-branding.md) | Paleta, tipografía, logo, hover states, colores por categoría |
| [03 · Arquitectura web](docs/03-arquitectura-web.md) | Estructura de la home, layouts de cards, Ghost |
| [04 · Guía editorial](docs/04-guia-editorial.md) | Voz, tono, reglas de títulos, longitudes |
| [05 · SEO](docs/05-seo.md) | Bloque SEO/Meta por artículo |
| [06 · Pipeline](docs/06-pipeline.md) | Publisher automático de artículos para Ghost |
| [07 · Roadmap](docs/07-roadmap.md) | Completado, pendiente y checklist de lanzamiento |

## Estructura del repositorio

```
docs/       Documentación del proyecto
theme/      Tema de Ghost (kynari-theme)
pipeline/   Publisher de artículos, servidor y panel
tools/      Herramientas auxiliares (Article Generator, prototipos)
```

> Las claves de API nunca se suben al repo: van en un `.env` local (ver `.env.example`).
