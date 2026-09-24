# theme/

Tema de Ghost **kynari-theme** (v1.0.0), hecho desde cero con el design system de Kynari.

Pendiente de subir desde la copia local. Estructura esperada:

```
theme/
  package.json
  default.hbs
  index.hbs
  post.hbs
  tag.hbs
  partials/
  assets/css/
  assets/js/
```

Notas técnicas:

- Condicionales por categoría en `tag.hbs` con `{{#match tag.slug "valor"}}`.
- Posts relacionados con `{{#get "posts" filter="tag:{{slug}}+id:-{{@root.id}}"}}` dentro de `{{#primary_tag}}`.
