#!/usr/bin/env node
/**
 * Signal (v2, 16 oct. 2026) — tráileres oficiales del día como entradas cortas.
 *
 * Lee el RSS de los canales oficiales de tools/signal-channels.json (sin cuota de
 * YouTube), se queda con los tráileres, teasers, PV y gameplay de las últimas
 * --hours horas y publica una entrada de 120–200 palabras por vídeo:
 * fachada del vídeo + dos o tres párrafos con contexto verificado (búsqueda web)
 * + enlace a la fuente y, si existe, a artículos de Kynari sobre la misma obra.
 *
 * Etiquetas: <Categoría>, Signal, #video, #trailer|#gameplay.
 * Topes: --max por ejecución (2) y SIGNAL_DAILY_MAX al día (6). Sin duplicados:
 * se comparan los ids de YouTube de los posts con #video de los últimos días.
 *
 *   node tools/kynari-signal.mjs [--hours 3] [--max 2] [--dry-run]
 * SIGNAL_STATUS=draft deja las entradas como borrador.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ghost, youtubeFeed, youtubeAlive, download, uploadToGhost, videoFacadeHTML, withMediaJson, parseMediaJson,
  htmlCard, lexicalDoc, urlAlive, claude, claudeTool
} from '../pipeline/kynari-media.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const HOURS = Number(arg('--hours', 3));
const MAX = Number(arg('--max', 2));
const DRY = args.includes('--dry-run');
const DAILY_MAX = Number(process.env.SIGNAL_DAILY_MAX || 6);
const STATUS = process.env.SIGNAL_STATUS === 'draft' ? 'draft' : 'published';

const WANT = /\b(official\s+)?(trailer|teaser)\b|\bPV\b|\bgameplay\b|\breveal\b|\bopening\b.*\b(movie|anime)\b/i;
const SKIP = /\b(reaction|live ?stream|livestream|\blive\b|podcast|interview|behind the scenes|featurette|recap|review|#shorts|shorts|clip compilation|asmr|ost|soundtrack|lyric|commercial|\bad\b|sizzle|tomorrow|countdown|coming soon)\b/i;

const SIGNAL_TOOL = {
  name: 'submit_signal',
  description: 'A short Kynari Signal post about an official video.',
  input_schema: {
    type: 'object',
    properties: {
      skip: { type: 'boolean', description: 'true if the video is not a real trailer/teaser/PV/gameplay for a film, series, anime or game (e.g. ads, recaps, shorts), or if you cannot verify what it is.' },
      title: { type: 'string', description: 'Plain text, 12 words or fewer, names the work. No clickbait.' },
      intro_html: { type: 'string', description: 'One <p> (35-60 words): what was released and why it matters.' },
      body_html: { type: 'string', description: 'One or two <p> (70-140 words in total): verified context — release date, platform, studio, what the footage shows. Use <em> for titles of works with the year in parentheses the first time. Inline link 1-2 reputable sources with <a href="https://...">.' },
      excerpt: { type: 'string', description: 'Max 200 characters.' },
      kind: { type: 'string', enum: ['trailer', 'teaser', 'pv', 'gameplay'] },
      work_title: { type: 'string' },
      work_type: { type: 'string', enum: ['movie', 'tv', 'game'] },
      year: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' }, description: '2-4 topic tags (franchise, studio, platform).' },
      sources: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, title: { type: 'string' } }, required: ['url'] } }
    },
    required: ['skip']
  }
};

async function recentVideoIds(days = 10) {
  const since = new Date(Date.now() - days * 86400e3).toISOString();
  const d = await ghost('GET', `/posts/?limit=200&fields=id,codeinjection_head,published_at&filter=${encodeURIComponent(`tag:hash-video+published_at:>'${since}'`)}`);
  return new Set(d.posts.map((p) => parseMediaJson(p.codeinjection_head)?.trailer?.yt).filter(Boolean));
}
async function signalsToday() {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const d = await ghost('GET', `/posts/?limit=50&fields=id&filter=${encodeURIComponent(`tag:signal+published_at:>'${start.toISOString()}'`)}`);
  return d.posts.length;
}
async function relatedKynari(workTitle) {
  if (!workTitle) return [];
  const words = (workTitle.toLowerCase().match(/[a-z0-9]{4,}/g) || []).slice(0, 4);
  if (!words.length) return [];
  const d = await ghost('GET', `/posts/?limit=200&fields=title,url&filter=${encodeURIComponent('status:published+tag:-signal')}&order=published_at%20desc`);
  return d.posts.filter((p) => words.every((w) => p.title.toLowerCase().includes(w))).slice(0, 2);
}

async function main() {
  const { channels } = JSON.parse(await fs.readFile(path.join(__dirname, 'signal-channels.json'), 'utf-8'));
  const since = Date.now() - HOURS * 3600e3;
  const seen = DRY ? new Set() : await recentVideoIds();
  let budget = Math.min(MAX, DRY ? MAX : DAILY_MAX - await signalsToday());
  if (budget <= 0) { console.log('Daily Signal cap reached.'); return; }

  const candidates = [];
  await Promise.all(Object.entries(channels).map(async ([id, ch]) => {
    try {
      for (const v of await youtubeFeed(id)) {
        if (Date.parse(v.published) < since || seen.has(v.yt)) continue;
        if (!WANT.test(v.title) || SKIP.test(v.title)) continue;
        candidates.push({ ...v, category: ch.category, channelName: ch.name });
      }
    } catch (e) { console.warn(`   feed ${ch.name}: ${e.message}`); }
  }));
  candidates.sort((a, b) => (b.views - a.views) || Date.parse(b.published) - Date.parse(a.published));
  console.log(`${candidates.length} candidates in the last ${HOURS} h; budget ${budget}`);

  for (const v of candidates) {
    if (budget <= 0) break;
    console.log(`\n-> ${v.channelName}: ${v.title} (${v.yt}, ${v.views} views)`);
    if (!(await youtubeAlive(v.yt))) { console.log('   not embeddable, skip'); continue; }
    const d = await claude({
      max_tokens: 3000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }, SIGNAL_TOOL],
      tool_choice: { type: 'auto' },
      system: 'You are Nara Vega, editor of Kynari (kynari.io). Voice: analytical, concise, cinematic, no hype words, no clickbait. Verify every fact with web_search; never invent dates, platforms or names. If unsure what the video is, set skip=true. Finish by calling submit_signal once.',
      messages: [{ role: 'user', content: `New official video on YouTube.\nChannel: ${v.channelName}\nTitle: ${v.title}\nPublished: ${v.published}\nDescription: ${v.description}\nURL: https://www.youtube.com/watch?v=${v.yt}\n\nWrite a Kynari Signal post (120-200 words total) about it.` }]
    });
    const s = claudeTool(d, 'submit_signal');
    if (!s || s.skip || !s.title || !s.intro_html) { console.log('   model skipped it'); continue; }

    const srcs = [];
    for (const x of s.sources || []) if (x?.url && await urlAlive(x.url)) srcs.push(x);
    if (!srcs.length) { console.log('   no verifiable source, skip'); continue; }
    const related = await relatedKynari(s.work_title);
    const relHtml = related.length ? `<p>Read more on Kynari: ${related.map((r) => `<a href="${r.url}">${r.title.replace(/</g, '&lt;')}</a>`).join(' · ')}</p>` : '';
    const kind = s.kind === 'pv' ? 'pv' : s.kind === 'gameplay' ? 'gameplay' : s.kind === 'teaser' ? 'teaser' : 'trailer';
    const trailer = { yt: v.yt, kind, title: v.title, source: v.channelName };
    const title = s.title.replace(/[*_`#]+/g, '').trim();
    if (DRY) { console.log(`   DRY: "${title}" [${v.category}] sources=${srcs.length} related=${related.length}`); budget--; continue; }

    let thumb;
    try { thumb = await download(`https://i.ytimg.com/vi/${v.yt}/maxresdefault.jpg`); } catch { thumb = await download(`https://i.ytimg.com/vi/${v.yt}/hqdefault.jpg`); }
    const image = await uploadToGhost(thumb, `signal-${v.yt}`);
    const body = `${s.body_html || ''}${relHtml}`.replace(/<a\s+href="(https?:\/\/(?!www\.kynari\.io)[^"]+)"(?![^>]*target=)/gi, '<a href="$1" target="_blank" rel="noopener"');
    const tags = [v.category, 'Signal', ...(s.tags || []).slice(0, 4).map((t) => `#${String(t).replace(/^#+/, '')}`), '#video', kind === 'gameplay' ? '#gameplay' : '#trailer'];
    const res = await ghost('POST', '/posts/', {
      posts: [{
        title, status: STATUS, custom_excerpt: (s.excerpt || '').slice(0, 300),
        lexical: lexicalDoc([htmlCard(s.intro_html), htmlCard(videoFacadeHTML(trailer)), htmlCard(body)]),
        feature_image: image, feature_image_alt: title, feature_image_caption: `© ${v.channelName} · YouTube`, og_image: image,
        tags: tags.map((name) => ({ name })),
        codeinjection_head: withMediaJson('', { trailer, work: s.work_title ? { type: s.work_type, title: s.work_title, year: s.year || null } : null, sources: srcs })
      }]
    });
    console.log(`   ✓ ${STATUS}: ${res.posts[0].url}`);
    budget--;
  }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
