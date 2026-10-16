#!/usr/bin/env node
/**
 * Backfill de tráileres (v2, 16 oct. 2026)
 *
 * Añade el tráiler oficial a los artículos ya publicados que no tienen vídeo:
 *  1. Si el artículo ya llevaba un iframe de YouTube (el antiguo --youtube), se
 *     conserva ese vídeo y se convierte en fachada (carga al pulsar).
 *  2. Si no, Claude identifica la obra concreta (película, serie, anime o juego)
 *     a partir del título y el extracto; TMDB / IGDB dan el tráiler oficial.
 *     Solo se acepta si el título de la obra coincide exactamente y el vídeo existe.
 *
 * Dos pasos, para poder revisar antes de tocar nada:
 *   node tools/kynari-video-backfill.mjs plan  [--limit 400] [--out backfill-plan.json]
 *   node tools/kynari-video-backfill.mjs apply [--in backfill-plan.json] [--max 400]
 * `apply` guarda una copia de cada post antes de cambiarlo (backfill-backup-*.json)
 * y `restore --in backfill-backup-*.json` lo deshace.
 *
 * Variables: GHOST_ADMIN_KEY, ANTHROPIC_API_KEY, TMDB_API_KEY, IGDB_CLIENT_ID, IGDB_CLIENT_SECRET.
 */
import fs from 'node:fs/promises';
import {
  ghost, ghostAllPosts, tmdbFind, tmdbTrailer, igdbFind, igdbTrailer, youtubeAlive,
  videoFacadeHTML, withMediaJson, parseMediaJson, lexicalWithVideo, mergeTags, claude, claudeTool
} from '../pipeline/kynari-media.mjs';

const args = process.argv.slice(2);
const mode = args[0];
const arg = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const FAST = process.env.KYNARI_FAST_MODEL || 'claude-haiku-4-5';

const WORKS_TOOL = {
  name: 'submit_works',
  description: 'For each article, the single specific work it is mainly about, or none.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            kind: { type: 'string', enum: ['movie', 'tv', 'game', 'none'], description: 'tv = series or anime series. none = the article is about a company, a person, an industry trend, an event, a comic book, or several works equally.' },
            title: { type: 'string', description: 'Official English title of the work as listed on TMDB or IGDB.' },
            year: { type: 'string', description: 'Release year (or first-air year) of that specific work, if known.' }
          },
          required: ['id', 'kind']
        }
      }
    },
    required: ['items']
  }
};

async function identify(batch) {
  const list = batch.map((p) => `${p.id} | ${(p.tags || [])[0]?.name || ''} | ${p.title} | ${(p.custom_excerpt || '').slice(0, 220)}`).join('\n');
  const body = {
    max_tokens: 4000,
    tools: [WORKS_TOOL], tool_choice: { type: 'tool', name: 'submit_works' },
    messages: [{ role: 'user', content: `These are articles from Kynari, a pop culture site (id | category | title | excerpt). For each one, say which single film, series/anime or video game it is mainly about, so we can embed that work's official trailer. Be strict: if it is mainly about a studio, a person, a business story, a comic book issue, an award or several works, answer kind "none". Never guess a title that is not clearly the subject.\n\n${list}` }]
  };
  try { return claudeTool(await claude(body, FAST), 'submit_works')?.items || []; }
  catch (e) { console.warn(`   fast model failed (${e.message.slice(0, 80)}), retrying with default`); return claudeTool(await claude(body), 'submit_works')?.items || []; }
}

function existingYoutube(lexical) {
  const m = String(lexical || '').match(/(?:youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/|data-yt=\\?")([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function plan() {
  const limit = Number(arg('--limit', 1000));
  const posts = (await ghostAllPosts({ fields: 'id,title,slug,custom_excerpt,lexical,codeinjection_head', include: 'tags' })).slice(0, limit);
  const todo = posts.filter((p) => !(p.tags || []).some((t) => t.slug === 'hash-video') && !(p.tags || []).some((t) => t.slug === 'signal'));
  console.log(`${posts.length} posts, ${todo.length} without video`);
  const out = [];
  const needId = [];
  for (const p of todo) {
    const yt = existingYoutube(p.lexical);
    if (yt) out.push({ id: p.id, slug: p.slug, title: p.title, action: 'reuse', yt, kind: 'clip', source: 'YouTube (existing embed)' });
    else needId.push(p);
  }
  console.log(`${out.length} with an existing YouTube embed (converted to facade)`);
  for (let i = 0; i < needId.length; i += 30) {
    const batch = needId.slice(i, i + 30);
    const works = await identify(batch);
    for (const w of works) {
      const p = batch.find((x) => x.id === w.id);
      if (!p || w.kind === 'none' || !w.title) continue;
      let trailer = null; let matched = null;
      try {
        if (w.kind === 'game') {
          const g = await igdbFind(w.title, w.year);
          if (g && norm(g.name) === norm(w.title)) { matched = g.name; trailer = igdbTrailer(g); }
        } else {
          const item = await tmdbFind(w.title, w.year, w.kind);
          if (item && norm(item.title || item.name) === norm(w.title)) { matched = item.title || item.name; trailer = await tmdbTrailer(item); }
        }
      } catch (e) { console.warn(`   lookup error for "${w.title}": ${e.message}`); }
      if (trailer && await youtubeAlive(trailer.yt)) {
        out.push({ id: p.id, slug: p.slug, title: p.title, action: 'add', work: { type: w.kind, title: matched, year: w.year || null }, ...trailer });
      }
    }
    console.log(`   identified ${Math.min(i + 30, needId.length)}/${needId.length} — ${out.length} planned so far`);
  }
  const file = arg('--out', 'backfill-plan.json');
  await fs.writeFile(file, JSON.stringify(out, null, 2));
  console.log(`\nPlan: ${out.length} posts → ${file}`);
  for (const x of out.slice(0, 40)) console.log(`  ${x.action.padEnd(6)} ${x.yt} ${x.kind.padEnd(8)} ${x.title.slice(0, 70)}${x.work ? `  ⇐ ${x.work.title}` : ''}`);
}

async function apply() {
  const items = JSON.parse(await fs.readFile(arg('--in', 'backfill-plan.json'), 'utf-8')).slice(0, Number(arg('--max', 1000)));
  const backup = []; let ok = 0;
  const backupFile = `backfill-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  for (const it of items) {
    try {
      const p = (await ghost('GET', `/posts/${it.id}/?include=tags&formats=lexical`)).posts[0];
      if ((p.tags || []).some((t) => t.slug === 'hash-video')) { console.log(`  skip (already has video) ${p.slug}`); continue; }
      backup.push({ id: p.id, lexical: p.lexical, codeinjection_head: p.codeinjection_head, tags: (p.tags || []).map((t) => ({ id: t.id })) });
      await fs.writeFile(backupFile, JSON.stringify(backup));
      // «reuse»: el artículo ya tiene sus vídeos en el cuerpo (a veces varios). No se toca el
      // texto: solo se etiqueta #video y se guarda el primero en el JSON para portada y hero.
      const reuse = it.action === 'reuse';
      const trailer = { yt: it.yt, kind: it.kind, title: it.work?.title || p.title, source: it.source };
      const body = { updated_at: p.updated_at, codeinjection_head: withMediaJson(p.codeinjection_head, { trailer, work: it.work || parseMediaJson(p.codeinjection_head)?.work || null }) };
      if (reuse) body.tags = mergeTags(p.tags, ['#video']);
      else {
        const facade = videoFacadeHTML({ yt: it.yt, kind: it.kind, title: it.work ? `${it.work.title} — ${it.kind === 'gameplay' ? 'gameplay' : 'official trailer'}` : p.title, source: it.source });
        body.lexical = lexicalWithVideo(p.lexical, facade);
        body.tags = mergeTags(p.tags, ['#video', it.kind === 'gameplay' ? '#gameplay' : '#trailer']);
      }
      await ghost('PUT', `/posts/${p.id}/`, { posts: [body] });
      ok++; console.log(`  ✓ ${it.yt} ${p.slug}`);
      await new Promise((r) => setTimeout(r, 400));
    } catch (e) { console.error(`  ✗ ${it.slug}: ${e.message}`); }
  }
  console.log(`\nApplied ${ok}/${items.length}. Backup: ${backupFile}`);
}

async function restore() {
  const items = JSON.parse(await fs.readFile(arg('--in'), 'utf-8'));
  for (const b of items) {
    const p = (await ghost('GET', `/posts/${b.id}/`)).posts[0];
    await ghost('PUT', `/posts/${b.id}/`, { posts: [{ updated_at: p.updated_at, lexical: b.lexical, codeinjection_head: b.codeinjection_head, tags: b.tags }] });
    console.log(`  restored ${p.slug}`);
  }
}

const run = { plan, apply, restore }[mode];
if (!run) { console.error('Usage: kynari-video-backfill.mjs plan|apply|restore [...]'); process.exit(1); }
run().catch((e) => { console.error('Fatal:', e); process.exit(1); });
