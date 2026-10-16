#!/usr/bin/env node
/**
 * Cambia las imágenes generadas con IA por imágenes reales (16 oct. 2026).
 *
 * Candidatos: tools/reimage-candidates.json (portadas de fal.ai o sin crédito, e interiores
 * con pie «AI-generated»). Para cada artículo, Claude identifica la obra o el tema y se buscan
 * imágenes reales: IGDB + Steam (juegos), TMDB (cine, series, anime), Wikimedia Commons
 * (personas, eventos, lugares). Nunca genera imágenes: si no hay nada real, el artículo se queda
 * como está. Si aparece el tráiler oficial y el artículo no tiene vídeo, lo añade como fachada.
 *
 *   node tools/kynari-reimage.mjs plan  [--max 200] [--out reimage-plan.json]
 *   node tools/kynari-reimage.mjs apply [--in reimage-plan.json] [--max 200]
 *   node tools/kynari-reimage.mjs restore --in reimage-backup-….json
 * Variables: GHOST_ADMIN_KEY, ANTHROPIC_API_KEY, TMDB_API_KEY, IGDB_CLIENT_ID, IGDB_CLIENT_SECRET.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ghost, download, uploadToGhost, tmdbFind, tmdbImages, tmdbTrailer, igdbFind, igdbImageUrls, igdbTrailer,
  steamFind, commonsImage, youtubeAlive, videoFacadeHTML, withMediaJson, parseMediaJson, lexicalWithVideo,
  mergeTags, claude, claudeTool
} from '../pipeline/kynari-media.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const mode = args[0];
const arg = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const FAST = process.env.KYNARI_FAST_MODEL || 'claude-haiku-4-5';
const AI_RE = /ai[- ]generated|fal\.ai|generated with/i;
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const clean = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const ID_TOOL = {
  name: 'submit_subjects',
  description: 'For each article, what real image source to search.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            kind: { type: 'string', enum: ['game', 'movie', 'tv', 'subject', 'none'], description: 'game/movie/tv = the article is mainly about ONE specific work (tv includes anime series). subject = a real person, event, place, building or artwork that has photos on Wikimedia Commons. none = abstract topic, comic issue, several works equally, or unsure.' },
            title: { type: 'string', description: 'For game/movie/tv: the official English title as on IGDB/TMDB.' },
            year: { type: 'string', description: 'Release or first-air year of that work, if known.' },
            subject: { type: 'string', description: 'For subject: a short Wikimedia Commons search query for a real photo (e.g. "Hideo Kojima", "Lucas Museum of Narrative Art").' }
          },
          required: ['id', 'kind']
        }
      }
    },
    required: ['items']
  }
};

async function identify(batch) {
  const list = batch.map((p) => `${p.id} | ${p.primary_tag?.name || ''} | ${p.title} | ${(p.custom_excerpt || '').slice(0, 200)}`).join('\n');
  const body = {
    max_tokens: 4000, tools: [ID_TOOL], tool_choice: { type: 'tool', name: 'submit_subjects' },
    messages: [{ role: 'user', content: `Articles from Kynari, a pop culture site (id | category | title | excerpt). We want to replace AI-generated illustrations with REAL images. For each article say what to search. Be strict: only name a work if it is clearly the main subject; never guess.\n\n${list}` }]
  };
  try { return claudeTool(await claude(body, FAST), 'submit_subjects')?.items || []; }
  catch { return claudeTool(await claude(body), 'submit_subjects')?.items || []; }
}

/** Año del artículo frente al de la obra encontrada: si se conocen los dos, deben coincidir (±1). */
function yearOk(want, got) {
  const w = Number(want);
  if (!w) return true;
  return !!got && Math.abs(Number(got) - w) <= 1;
}

/** Busca imágenes reales. Devuelve { hero:{url,credit}, interiors:[{url,credit}], trailer, work } o null. */
async function findReal(s) {
  const out = { hero: null, interiors: [], trailer: null, work: null, source: null };
  if (/^(unknown|untitled|n\/?a)$/i.test(String(s.title || '').trim())) return null;
  if (s.kind === 'game' && s.title) {
    try {
      const g = await igdbFind(s.title, s.year);
      const gy = g?.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null;
      if (g && norm(g.name) === norm(s.title) && yearOk(s.year, gy)) {
        const u = igdbImageUrls(g, 3);
        if (u.hero) out.hero = { url: u.hero, credit: '© IGDB / Twitch' };
        out.interiors = (u.interiors || []).map((url) => ({ url, credit: '© IGDB / Twitch' }));
        out.trailer = igdbTrailer(g); out.work = { type: 'game', title: g.name, year: gy }; out.source = 'IGDB';
      }
    } catch {}
    if (!out.hero || out.interiors.length < 2) {
      try {
        const st = await steamFind(s.title);
        if (st && norm(st.name) === norm(s.title)) {
          if (!out.hero && st.header) out.hero = { url: st.header, credit: `© ${st.name} / Steam` };
          for (const sh of st.screenshots) if (out.interiors.length < 2) out.interiors.push({ url: sh, credit: `© ${st.name} / Steam` });
          out.work = out.work || { type: 'game', title: st.name }; out.source = out.source || 'Steam';
        }
      } catch {}
    }
  }
  if (!out.hero && (s.kind === 'movie' || s.kind === 'tv') && s.title) {
    try {
      const item = await tmdbFind(s.title, s.year, s.kind);
      const ty = Number((item?.release_date || item?.first_air_date || '').slice(0, 4)) || null;
      // Con año conocido, exige que coincida (±1): evita el póster de la versión de 1995 en un artículo del remake de 2026
      if (item && norm(item.title || item.name) === norm(s.title) && yearOk(s.year, ty)) {
        const im = await tmdbImages(item, 3); const base = 'https://image.tmdb.org/t/p/original';
        if (im?.hero) out.hero = { url: base + im.hero, credit: '© The Movie Database (TMDB)' };
        out.interiors = (im?.interiors || []).map((i) => ({ url: base + i, credit: '© The Movie Database (TMDB)' }));
        out.trailer = await tmdbTrailer(item); out.work = { type: s.kind, title: item.title || item.name, year: ty }; out.source = 'TMDB';
      }
    } catch {}
  }
  if (!out.hero && s.kind === 'subject' && s.subject) {
    try { const c = await commonsImage(s.subject); if (c) { out.hero = { url: c.url, credit: c.credit }; out.source = 'Wikimedia Commons'; } } catch {}
  }
  if (out.trailer && !(await youtubeAlive(out.trailer.yt))) out.trailer = null;
  return out.hero ? out : null;
}

/** Sustituye imágenes con pie de IA dentro del lexical. Devuelve [lexical, nº cambiadas]. */
function replaceAiInteriors(lexStr, interiors, title) {
  const doc = JSON.parse(lexStr); let i = 0;
  const next = () => interiors[i++];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'image' && AI_RE.test(clean(node.caption)) && i < interiors.length) {
      const r = next(); node.src = r.uploaded; node.caption = esc(r.credit); node.alt = node.alt || title; node.width = null; node.height = null;
    }
    if (node.type === 'html' && typeof node.html === 'string') {
      node.html = node.html.replace(/<figure\b[\s\S]*?<\/figure>/gi, (fig) => {
        const cap = (fig.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i) || [])[1];
        if (!cap || !AI_RE.test(clean(cap)) || i >= interiors.length) return fig;
        const r = next();
        return fig.replace(/(<img\b[^>]*\bsrc=")[^"]*(")/i, `$1${r.uploaded}$2`).replace(/(<figcaption[^>]*>)[\s\S]*?(<\/figcaption>)/i, `$1${esc(r.credit)}$2`);
      });
    }
    (node.children || []).forEach(walk);
  };
  walk(doc.root);
  return [JSON.stringify(doc), i];
}

async function plan() {
  const cands = JSON.parse(await fs.readFile(path.join(__dirname, 'reimage-candidates.json'), 'utf-8')).slice(0, Number(arg('--max', 1000)));
  // Artículos descartados tras revisar el ensayo (fragmentos del título, sin distinguir mayúsculas): se quedan como están
  let skip = [];
  try { skip = JSON.parse(await fs.readFile(path.join(__dirname, 'reimage-skip.json'), 'utf-8')).map((s) => s.toLowerCase()); } catch {}
  const posts = [];
  for (const c of cands) {
    try {
      const p = (await ghost('GET', `/posts/${c.id}/?include=tags&fields=id,title,custom_excerpt,slug,feature_image`)).posts[0];
      if (skip.some((s) => p.title.toLowerCase().includes(s))) continue;
      if (/\/real-[^/]+$/.test(p.feature_image || '')) continue;   // ya cambiado en una pasada anterior
      delete p.feature_image;
      posts.push({ ...c, ...p });
    } catch {}
  }
  const out = [];
  for (let k = 0; k < posts.length; k += 25) {
    const batch = posts.slice(k, k + 25);
    const subs = await identify(batch);
    for (const s of subs) {
      const p = batch.find((x) => x.id === s.id);
      if (!p || s.kind === 'none') continue;
      const r = await findReal(s);
      if (r) out.push({ id: p.id, slug: p.slug, title: p.title, hero: p.hero, body: p.body, subject: s, ...r });
    }
    console.log(`  ${Math.min(k + 25, posts.length)}/${posts.length} revisados — ${out.length} con imagen real`);
  }
  const file = arg('--out', 'reimage-plan.json');
  await fs.writeFile(file, JSON.stringify(out, null, 1));
  const by = out.reduce((a, x) => ((a[x.source] = (a[x.source] || 0) + 1), a), {});
  console.log(`\nPlan: ${out.length} de ${posts.length} artículos con imagen real (${JSON.stringify(by)}); ${out.filter((x) => x.trailer).length} con tráiler. → ${file}`);
  const what = (x) => (x.work ? `${x.work.title}${x.work.year ? ` (${x.work.year})` : ''}` : x.subject.subject);
  for (const x of out) console.log(`  ${x.source.padEnd(17)} ${x.title.slice(0, 70)}  ⇐ ${what(x)}`);
  // Tabla completa en el resumen de la ejecución de GitHub, para revisarla antes de aplicar
  if (process.env.GITHUB_STEP_SUMMARY) {
    const cell = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\*/g, '');
    const rows = out.map((x) => `| ${cell(x.title.slice(0, 80))} | ${x.source} | ${cell(what(x))} | ${x.trailer ? 'sí' : ''} |`);
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `## Imágenes reales: ${out.length} de ${posts.length}\n\n${JSON.stringify(by)} · ${out.filter((x) => x.trailer).length} con tráiler\n\n| Artículo | Fuente | Imagen de | Tráiler |\n|---|---|---|---|\n${rows.join('\n')}\n`);
  }
}

async function apply() {
  const items = JSON.parse(await fs.readFile(arg('--in', 'reimage-plan.json'), 'utf-8')).slice(0, Number(arg('--max', 1000)));
  const backupFile = `reimage-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const backup = []; let ok = 0, heroes = 0, inner = 0, trailers = 0;
  for (const it of items) {
    try {
      const p = (await ghost('GET', `/posts/${it.id}/?include=tags&formats=lexical`)).posts[0];
      backup.push({ id: p.id, lexical: p.lexical, feature_image: p.feature_image, feature_image_caption: p.feature_image_caption, feature_image_alt: p.feature_image_alt, og_image: p.og_image, codeinjection_head: p.codeinjection_head, tags: (p.tags || []).map((t) => ({ id: t.id })) });
      await fs.writeFile(backupFile, JSON.stringify(backup));
      const body = { updated_at: p.updated_at };
      if (it.hero) {
        const url = await uploadToGhost(await download(it.hero.url), `real-${p.slug}`.slice(0, 60));
        Object.assign(body, { feature_image: url, feature_image_caption: esc(it.hero.credit), feature_image_alt: p.feature_image_alt || p.title });
        if (!p.og_image || p.og_image === p.feature_image) body.og_image = url;
        heroes++;
      }
      let lex = p.lexical;
      if (it.body && it.interiors?.length) {
        const ups = [];
        for (const r of it.interiors.slice(0, 2)) ups.push({ ...r, uploaded: await uploadToGhost(await download(r.url), `real-int-${p.slug}`.slice(0, 60)) });
        const [l2, n] = replaceAiInteriors(lex, ups, p.title); if (n) { lex = l2; inner += n; }
      }
      const hasVideo = (p.tags || []).some((t) => t.slug === 'hash-video');
      if (it.trailer && !hasVideo) {
        const tr = { yt: it.trailer.yt, kind: it.trailer.kind || 'trailer', title: it.work?.title || p.title, source: it.source };
        lex = lexicalWithVideo(lex, videoFacadeHTML({ ...tr, title: `${tr.title} — ${tr.kind === 'gameplay' ? 'gameplay' : 'official trailer'}` }));
        body.codeinjection_head = withMediaJson(p.codeinjection_head, { trailer: tr, work: it.work || parseMediaJson(p.codeinjection_head)?.work || null });
        body.tags = mergeTags(p.tags, ['#video', tr.kind === 'gameplay' ? '#gameplay' : '#trailer']);
        trailers++;
      }
      if (lex !== p.lexical) body.lexical = lex;
      await ghost('PUT', `/posts/${p.id}/`, { posts: [body] });
      ok++; console.log(`  ✓ ${it.source} ${p.slug}`);
      await new Promise((r) => setTimeout(r, 300));
    } catch (e) { console.error(`  ✗ ${it.slug}: ${e.message}`); }
  }
  console.log(`\nArtículos: ${ok}/${items.length}. Portadas: ${heroes}. Interiores: ${inner}. Tráileres añadidos: ${trailers}. Copia: ${backupFile}`);
}

async function restore() {
  const items = JSON.parse(await fs.readFile(arg('--in'), 'utf-8'));
  for (const b of items) {
    const cur = (await ghost('GET', `/posts/${b.id}/?fields=updated_at`)).posts[0];
    const { id, ...rest } = b;
    await ghost('PUT', `/posts/${id}/`, { posts: [{ updated_at: cur.updated_at, ...rest }] });
  }
  console.log(`Restaurados ${items.length}`);
}

const run = { plan, apply, restore }[mode];
if (!run) { console.error('Uso: kynari-reimage.mjs plan|apply|restore'); process.exit(1); }
run().catch((e) => { console.error('Fatal:', e); process.exit(1); });
