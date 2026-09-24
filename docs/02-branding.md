# 02 · Branding

## Paleta de color

| Variable | Hex | Uso |
| --- | --- | --- |
| Primary BG | `#080808` | Fondo principal |
| Surface 1 | `#0D0D0F` | Superficies elevadas |
| Surface 2 | `#111115` | Cards y paneles |
| Surface 3 | `#16161C` | Elementos secundarios |
| Gold Accent | `#B8986A` | Acento dorado principal |
| Lila Hover | `#A78BFA` | Estado hover de navegación |
| Off-white | `#F0EDE8` | Texto secundario sobre fondos oscuros (redes) |

### Colores de acento por categoría (piezas sociales)

| Categoría | Acento |
| --- | --- |
| Cinema | `#B8986A` (dorado) |
| Culture | `#B8986A` (dorado) |
| Games | `#A78BFA` (lila) |
| Anime | `#DE8264` (coral) |
| Comic | `#C44646` (rojo apagado) |
| Legacy | Dorado + etiqueta "· KYNARI LEGACY" |

## Tipografía

Todas disponibles en Google Fonts.

| Fuente | Uso |
| --- | --- |
| Cinzel | Titulares principales (serif romana, mayúsculas elegantes) |
| Cormorant Garamond | Cuerpo editorial y subtítulos (serif clásica) |
| DM Sans / Josefin Sans | UI y badges (sans-serif limpia) |

## Logo

- Logo **K** en el navbar sticky, junto a las 5 categorías y el CTA Legacy.
- Wordmark **KYNARI** en dorado en las piezas sociales.

## Hover states

- Color de texto en hover: lila `#A78BFA`.
- Escala: `1.03`.
- Transición: `0.2s ease`.

## CSS de referencia

```css
:root {
  --bg: #080808;
  --surface-1: #0D0D0F;
  --surface-2: #111115;
  --surface-3: #16161C;
  --gold: #B8986A;
  --lila: #A78BFA;
  --font-display: 'Cinzel', serif;
  --font-body: 'Cormorant Garamond', serif;
  --font-ui: 'DM Sans', sans-serif;
}
```
