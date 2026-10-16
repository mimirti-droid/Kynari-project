#!/usr/bin/env node
/**
 * Ficha de la obra para los artículos ya publicados (tema 2.2, 16 oct. 2026).
 *
 * Para cada artículo publicado (sin Signal) que trate de UNA obra concreta (película, serie,
 * anime o juego), guarda en el JSON kynari-media `work.card` con póster, director/estudio/
 * desarrolladora, estreno, duración o temporadas, género, plataformas y dónde verla.
 * El tema la pinta en el lateral del artículo.
 *
 * Si el post ya tiene `work` (lo pone el publisher desde la v17), se usa tal cual. Si no,
 * Claude Haiku identifica la obra a partir del título y el extracto; solo se acepta si TMDB o
 * IGDB devuelven el mismo título y el año coincide (±1). Nunca toca el texto del artículo.
 *
 *   node tools/kynari-workcard.mjs plan  [--max 400] [--out workcard-plan.json]
 *   node tools/kynari-workcard.mjs apply [--in workcard-plan.json]
 *   node tools/kynari-workcard.mjs restore --in workcard-backup-….json
 * Variables: GHOST_ADMIN_KEY, ANTHROPIC_API_KEY, TMDB_API_KEY, IGDB_CLIENT_ID, IGDB_CLIENT_SECRET.
 */
import fs from 'node:fs/promises';
import { ghost, workCard, withMediaJson, parseMediaJson, claude, claudeTool } from '../pipeline/kynari-media.mjs';

const args = process.argv.slice(2);
const mode = args[0];
const arg = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const FAST = process.env.KYNARI_FAST_MODEL || 'claude-haiku-4-5';
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

const ID_TOOL = {
  name: 'submit_works',
  description: 'For each article, the single work it is mainly about.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: ['movie', 'tv', 'game', 'none'], description: 'movie / tv (includes anime series) / game = the article is mainly about ONE specific work. none = person, event, industry topic, comic issue, several works, or unsure.' },
            title: { type: 'string', description: 'Official English title as listed on TMDB (movie/tv) or IGDB (game).' },
            year: { type: 'string', description: 'Release or first-air year of THAT version of the work (remakes have their own year).' }
          },
          required: ['id', 'type']
        }
      }
    },
    required: ['items']
  }
};

async function identify(batch) {
  const list = batch.map((p) => `${p.id} | ${p.primary_tag?.name || ''} | ${p.title} | ${(p.custom_excerpt || '').slice(0, 220)}`).join('\n');
  const body = {
    max_tokens: 4000, tools: [ID_TOOL], tool_choice: { type: 'tool', name: 'submit_works' },
    messages: [{ role: 'user', content: `Articles from Kynari, a pop culture site (id | category | title | excerpt). For each, name the ONE film, series, anime or video game it is mainly about, so we can show a fact box. Be strict: if it is about a person, an event, a franchise in general or several works, answer none. Never guess.\n\n${list}` }]
  };
  try { return claudeTool(await claude(body, FAST), 'submit_works')?.items || []; }
  catch { return claudeTool(await claude(body), 'submit_works')?.items || []; }
}

async function allPosts() {
  const out = []; let page = 1;
  for (;;) {
    const d = await ghost('GET', `/posts/?limit=100&page=${page}&include=tags&fields=id,slug,title,custom_excerpt,codeinjection_head&filter=status:published%2Btag:-signal`);
    out.push(...d.posts);
    if (!d.meta.pagination.next) return out;
    page++;
  }
}

async function plan() {
  const max = Number(arg('--max', 400));
  // Artículos descartados tras revisar el ensayo (fragmentos del título): no llevan ficha
  let skip = [];
  try { skip = JSON.parse(await fs.readFile(new URL('./workcard-skip.json', import.meta.url), 'utf-8')).map((s) => s.toLowerCase()); } catch {}
  const posts = (await allPosts())
    .filter((p) => !parseMediaJson(p.codeinjection_head || '')?.work?.card)
    .filter((p) => !skip.some((s) => p.title.toLowerCase().includes(s)))
    .slice(0, max);
  const known = [], unknown = [];
  for (const p of posts) { const w = parseMediaJson(p.codeinjection_head || '')?.work; (w?.title ? known : unknown).push({ ...p, work: w }); }
  // Los que no tienen obra: Haiku la identifica en lotes de 25
  for (let k = 0; k < unknown.length; k += 25) {
    const batch = unknown.slice(k, k + 25);
    for (const s of await identify(batch)) {
      const p = batch.find((x) => x.id === s.id);
      if (p && s.type !== 'none' && s.title) p.work = { type: s.type, title: s.title, year: Number(s.year) || null };
    }
    console.log(`  identificados ${Math.min(k + 25, unknown.length)}/${unknown.length}`);
  }
  const out = [];
  for (const p of [...known, ...unknown]) {
    if (!p.work?.title) continue;
    const card = await workCard(p.work, { upload: false });
    if (!card || norm(card.title) !== norm(p.work.title)) continue;
    out.push({ id: p.id, slug: p.slug, title: p.title, work: { type: p.work.type, title: card.title, year: card.year, ...(p.work.tmdb ? { tmdb: p.work.tmdb } : {}), ...(p.work.igdb ? { igdb: p.work.igdb } : {}) }, card });
  }
  const file = arg('--out', 'workcard-plan.json');
  await fs.writeFile(file, JSON.stringify(out, null, 1));
  const by = out.reduce((a, x) => ((a[x.card.kind] = (a[x.card.kind] || 0) + 1), a), {});
  console.log(`\nPlan: ${out.length} de ${posts.length} artículos con ficha (${JSON.stringify(by)}) → ${file}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const cell = (s) => String(s ?? '').replace(/\|/g, '\\|');
    const rows = out.map((x) => `| ${cell(x.title.slice(0, 70))} | ${cell(x.card.title)} (${x.card.year || '?'}) | ${cell((x.card.people[0] || {}).value || '')} | ${cell(x.card.watch.join(', '))} |`);
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `## Fichas de obra: ${out.length} de ${posts.length}\n\n${JSON.stringify(by)}\n\n| Artículo | Obra | Director / estudio / desarrolladora | Dónde verla |\n|---|---|---|---|\n${rows.join('\n')}\n`);
  }
}

async function apply() {
  const items = JSON.parse(await fs.readFile(arg('--in', 'workcard-plan.json'), 'utf-8'));
  const file = `workcard-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const backup = []; let ok = 0;
  for (const it of items) {
    try {
      const p = (await ghost('GET', `/posts/${it.id}/?fields=id,updated_at,codeinjection_head`)).posts[0];
      backup.push({ id: p.id, codeinjection_head: p.codeinjection_head });
      await fs.writeFile(file, JSON.stringify(backup));
      // Ahora sí sube el póster a Ghost
      const card = (await workCard(it.work)) || it.card;
      const prev = parseMediaJson(p.codeinjection_head || '') || {};
      const head = withMediaJson(p.codeinjection_head || '', { work: { ...(prev.work || {}), ...it.work, card } });
      await ghost('PUT', `/posts/${p.id}/`, { posts: [{ updated_at: p.updated_at, codeinjection_head: head }] });
      ok++;
      if (ok % 20 === 0) console.log(`  ${ok}/${items.length}…`);
    } catch (e) { console.error(`  ✗ ${it.slug}: ${e.message}`); }
  }
  console.log(`\nFichas guardadas: ${ok}/${items.length}. Copia: ${file}`);
}

async function restore() {
  const items = JSON.parse(await fs.readFile(arg('--in'), 'utf-8'));
  for (const b of items) {
    const cur = (await ghost('GET', `/posts/${b.id}/?fields=updated_at`)).posts[0];
    await ghost('PUT', `/posts/${b.id}/`, { posts: [{ updated_at: cur.updated_at, codeinjection_head: b.codeinjection_head }] });
  }
  console.log(`Restaurados ${items.length}`);
}

const run = { plan, apply, restore }[mode];
if (!run) { console.error('Uso: kynari-workcard.mjs plan|apply|restore'); process.exit(1); }
run().catch((e) => { console.error(e); process.exit(1); });
