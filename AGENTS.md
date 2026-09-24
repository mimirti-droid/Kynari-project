# AGENTS.md — Reglas para agentes (ChatGPT / Codex)

Este repositorio lo coordina **Claude** en nombre de Marc (propietario). Los encargos para ChatGPT/Codex llegan como **issues con la etiqueta `encargo-chatgpt`**, redactados por Claude.

## Flujo

1. Lee la issue completa: objetivo, archivos permitidos y criterios de aceptación.
2. Trabaja en una rama nueva: `codex/<numero-issue>-<descripcion-corta>`.
3. Abre un **pull request contra `main`** que incluya `Closes #<numero>` en la descripción.
4. **Nunca** hagas push directo a `main` ni merges tu propio PR. Claude revisa y Marc decide.
5. Si algo del encargo no está claro, pregunta en un comentario de la issue en vez de suponer.

## Límites

- Toca **solo** los archivos que la issue autoriza. Si necesitas otro, pregunta antes.
- **Nunca** escribas claves, tokens ni contraseñas en el código. Todo va por variables de entorno (ver `.env.example`).
- No subas archivos `.bat` ni los JSON de estado de `pipeline/` (están en `.gitignore`).
- No cambies de stack: la web es **Ghost CMS** (self-hosted en Railway). No propongas Framer, WordPress ni Notion como CMS.

## Contexto del proyecto

- Kynari (kynari.io): plataforma editorial premium de cultura pop en inglés. Categorías: Cinema, Anime, Games, Culture, Comic. Secciones: Featured, Latest, Kynari Legacy.
- Documentación en `docs/` (empieza por `docs/00-estado-actual.md`).
- Pipeline en `pipeline/`: Node.js v24+, ES modules (`.mjs`), sin dependencias externas: usa solo APIs nativas de Node (`fetch`, `node:crypto`, `node:fs`).
- Estilo de código: el existente. Comentarios en español, mensajes de consola del publisher en inglés.

## Comprobaciones antes de abrir el PR

- `node --check` en cada `.mjs` modificado.
- Ninguna clave en el diff.
- Descripción del PR en español: qué cambia, por qué y cómo probarlo.
