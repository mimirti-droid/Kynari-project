# 03 · Arquitectura web

## Estructura de la home

1. **Navbar sticky**: logo K + 5 categorías + CTA Legacy. Backdrop blur `rgba(8,8,8,0.85)` / `20px`.
2. **Hero**: tagline + subtítulo + 2 CTAs.
3. **Featured**: 3 cards con hover (hoy en formato carrusel).
4. **Enter the Realms**: las 5 categorías en layout vertical.
5. **Latest Articles**: hero card + lista con thumbnails.
6. **Kynari Legacy**: sección premium destacada.
7. **Social Feed**: grid de 6 posts + enlaces a Instagram, X y TikTok.
8. **Manifesto**: definición editorial de Kynari.
9. **Newsletter**: captura de emails.
10. **Footer**: logo, tagline, enlaces legales, hello@kynari.io.

## Layouts de cards para páginas de categoría

| Estilo | Descripción | Valoración |
| --- | --- | --- |
| A · Medium | Cards verticales, imagen arriba, mucho texto | Elegante pero frío |
| B · The Verge | Imagen dominante con overlay de texto | Muy impactante, exige imágenes de calidad |
| **C · Kynari (recomendado)** | Hero editorial grande a la izquierda + lista de artículos a la derecha | Equilibra elegancia y densidad. Para categorías, no para la portada |

## CMS

- **Actual:** Ghost CMS self-hosted en Railway, con el tema propio `kynari-theme` (carpeta [`/theme`](../theme)).
- **Histórico:** el plan inicial era Framer Pro + Notion vía plugin oficial. Se descartó.

## Prototipo de referencia

`kynari-home.html`: prototipo completo de la homepage con estructura visual, CSS y scroll reveal (Cinzel + Cormorant Garamond). Referencia visual; va en [`/tools`](../tools).
