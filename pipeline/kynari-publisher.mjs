#!/usr/bin/env node
/**
 * KYNARI PUBLISHER v16 — Enlaces, tráiler oficial, imágenes reales y vídeo para el tema v2
 *
 * Historial de fixes:
 * - v1-v13: ver versiones anteriores (longitudes, TMDB/IGDB por año, hero vertical).
 * - v14: higiene de etiquetas (lista blanca; el resto nacen internas con '#').
 * - v15: claves fuera del código; formato real de imagen al subir a Ghost.
 * - v16 (16 oct. 2026, estudio de mejoras web y vídeo):
 *   · Enlaces: el cuerpo admite <a href>. Cada artículo trae `sources` (2–4 URLs
 *     reales encontradas con la búsqueda web) y 2 enlaces internos elegidos de una
 *     lista de artículos de Kynari que se le pasa. Las URLs se comprueban antes de
 *     publicar: un enlace muerto se quita (se deja el texto). Antes `<a>` estaba
 *     prohibido y los 15 últimos artículos salieron con 0 enlaces.
 *   · Investigación en el propio artículo: la generación lleva web_search, así que
 *     también los temas de la cola (sin fuentes previas) se escriben con datos buscados.
 *   · Tráiler oficial automático: TMDB /videos (cine, series, anime) e IGDB videos
 *     (juegos). Se inserta como fachada tras el primer bloque y el post se etiqueta
 *     #video + #trailer o #gameplay. Sustituye al --youtube manual (que sigue valiendo).
 *   · Imágenes reales antes que IA: TMDB → IGDB → Steam (juegos de PC) → Wikimedia
 *     Commons (personas, eventos, Culture) → fal.ai. Se registra la causa de cada
 *     caída. Crédito en el pie de la imagen principal y en los interiores.
 *   · Interiores como tarjetas de imagen de Lexical (alt, ancho y alto reales): Ghost
 *     genera los srcset. Antes era un <figure> crudo sin alt (fallo image-alt).
 *   · Títulos: sin markdown y con un máximo orientativo de 12 palabras.
 *   · Destacado: Legacy y Featured llevan la etiqueta `featured`; en el lote diario se
 *     marca uno (el que tenga tráiler o imagen real) para el hero de la portada.
 *   · Duplicados: además del log local, se comparan los 80 últimos títulos de Ghost.
 *   · Bloque JSON `kynari-media` en codeinjection_head (contrato con el tema v2).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GHOST_URL, ghost, uploadToGhost, imageSize, download, detectImageFormat,
  tmdbFind, tmdbImages, tmdbTrailer, igdbFind, igdbImageUrls, igdbTrailer, steamFind, commonsImage,
  urlAlive, videoFacadeHTML, withMediaJson, htmlCard, imageCard, lexicalDoc
} from './kynari-media.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_PATH = path.join(__dirname, 'kynari-queue.json');
const LOG_PATH = path.join(__dirname, 'kynari-log.json');

const FAL_API_KEY = process.env.FAL_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.KYNARI_MODEL || 'claude-sonnet-4-6';

const CATEGORIES = ['Cinema', 'Anime', 'Games', 'Culture', 'Comic'];

// ---------------------------------------------------------------------------
// Higiene de etiquetas (v14). Misma lista que ALLOWLIST en tools/tag_janitor.py.
// ---------------------------------------------------------------------------
const PUBLIC_TAG_ALLOWLIST = new Set([
  'cinema', 'anime', 'games', 'comic', 'culture',
  'featured', 'legacy', 'latest', 'kynari-legacy-2', 'signal',
  'marvel', 'marvel-comics', 'dc-comics', 'spider-man', 'mcu', 'streaming',
  'crunchyroll', 'nintendo', 'imax', 'television', 'box-office', 'industry',
  'gaming-industry', 'hollywood', 'pop-culture', 'animation', 'adaptation',
  'horror', 'music', 'christopher-nolan', 'the-odyssey', 'summer-2026',
  '2026'
]);

function tagSlug(name) {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function applyTagHygiene(tags) {
  const out = []; const seen = new Set();
  for (const raw of tags || []) {
    const internal = /^#/.test(String(raw || '').trim());
    const name = String(raw || '').trim().replace(/^#+\s*/, '');
    if (!name) continue;
    const slug = (internal ? 'hash-' : '') + tagSlug(name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(!internal && PUBLIC_TAG_ALLOWLIST.has(slug) ? name : `#${name}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Títulos: sin markdown, sin comillas tipográficas sueltas, longitud orientativa
// ---------------------------------------------------------------------------
function cleanTitle(t) {
  return String(t || '').replace(/[*_`#]+/g, '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Historial: log local + últimos títulos publicados en Ghost
// ---------------------------------------------------------------------------
async function loadRecentTitles(n = 30) {
  let local = [];
  try { local = JSON.parse(await fs.readFile(LOG_PATH, 'utf-8')).filter((e) => e.status === 'success' && e.title).slice(-n).map((e) => e.title); } catch {}
  let remote = [];
  try {
    const d = await ghost('GET', `/posts/?limit=80&fields=title&filter=status:published&order=published_at%20desc`);
    remote = d.posts.map((p) => p.title);
  } catch (e) { console.warn(`   Ghost history unavailable: ${e.message}`); }
  return [...new Set([...remote, ...local])];
}

/** Lista compacta de artículos de Kynari para que el modelo elija 2 enlaces internos. */
async function internalCandidates(category, topic) {
  try {
    const d = await ghost('GET', `/posts/?limit=300&fields=title,url&include=tags&filter=status:published&order=published_at%20desc`);
    const words = new Set(String(topic).toLowerCase().match(/[a-z0-9]{4,}/g) || []);
    const scored = d.posts.map((p) => {
      const t = p.title.toLowerCase();
      let s = [...words].reduce((a, w) => a + (t.includes(w) ? 2 : 0), 0);
      if ((p.tags || []).some((x) => x.name.toLowerCase() === category.toLowerCase())) s += 1;
      return { s, title: p.title, url: p.url };
    }).sort((a, b) => b.s - a.s);
    return scored.slice(0, 30).map((x) => `- ${x.title} — ${x.url}`).join('\n');
  } catch { return ''; }
}

// ---------------------------------------------------------------------------
// Claude — llamadas
// ---------------------------------------------------------------------------
async function claude(body) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, ...body })
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${(await res.text()).slice(0, 400)}`);
  return res.json();
}
const textOf = (d) => d.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');

async function getTrendingTopic(category, { recentTitles = [], todayTopics = [] } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const avoid = [];
  if (recentTitles.length) avoid.push(`TOPICS ALREADY PUBLISHED IN KYNARI — do NOT repeat, and do not cover the same news from another angle:\n${recentTitles.slice(0, 80).map((t, i) => `${i + 1}. ${t}`).join('\n')}`);
  if (todayTopics.length) avoid.push(`TOPICS ALREADY CHOSEN TODAY — do not overlap:\n${todayTopics.join('\n')}`);
  const d = await claude({
    max_tokens: 1500,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
    messages: [{ role: 'user', content: `Search the web for what is genuinely trending TODAY (${today}) in the "${category}" category of pop culture. It must be a real, verifiable event from the last 72 hours, reported by at least two reputable outlets.${avoid.length ? `\n\n${avoid.join('\n\n')}` : ''}\n\nRespond ONLY with these lines:\nTOPIC: <specific topic>\nANGLE: <editorial angle in one sentence, Kynari tone: analytical, no clickbait>\nSOURCE: <url of a reputable article reporting it>\nSOURCE: <url of a second, different outlet>` }]
  });
  const text = textOf(d);
  const topic = text.match(/TOPIC:\s*(.+)/i)?.[1]?.trim();
  if (!topic) throw new Error(`Could not extract trending topic:\n${text.slice(0, 400)}`);
  const sources = [...text.matchAll(/SOURCE:\s*(https?:\/\/\S+)/gi)].map((m) => m[1].replace(/[)>.,]+$/, ''));
  return { topic, angle: text.match(/ANGLE:\s*(.+)/i)?.[1]?.trim(), sources };
}

async function getTrendingLegacyTopic({ recentTitles = [] } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const d = await claude({
    max_tokens: 1500,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
    messages: [{ role: 'user', content: `Search the web for what anniversary, death, milestone or cultural event falls THIS WEEK (around ${today}) in cinema, anime, games, music or pop culture that deserves a deep "Kynari Legacy" essay (3000+ words, retrospective).${recentTitles.length ? `\n\nTOPICS ALREADY PUBLISHED IN KYNARI — do NOT repeat:\n${recentTitles.slice(0, 80).map((t, i) => `${i + 1}. ${t}`).join('\n')}` : ''}\n\nRespond ONLY with these lines:\nTOPIC: <specific topic>\nCATEGORY: <Cinema, Anime, Games, Culture or Comic>\nANGLE: <editorial angle in one sentence>\nSOURCE: <url>\nSOURCE: <url>` }]
  });
  const text = textOf(d);
  const topic = text.match(/TOPIC:\s*(.+)/i)?.[1]?.trim();
  if (!topic) throw new Error(`Could not extract Legacy topic:\n${text.slice(0, 400)}`);
  return {
    topic, category: text.match(/CATEGORY:\s*(\w+)/i)?.[1] || 'Culture', angle: text.match(/ANGLE:\s*(.+)/i)?.[1]?.trim(),
    sources: [...text.matchAll(/SOURCE:\s*(https?:\/\/\S+)/gi)].map((m) => m[1].replace(/[)>.,]+$/, ''))
  };
}

// ---------------------------------------------------------------------------
// Generación del artículo (tool-use + búsqueda web)
// ---------------------------------------------------------------------------
const ARTICLE_TOOL = {
  name: 'submit_article',
  description: 'Submits a complete Kynari editorial article, ready to publish.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Plain text, no markdown, ideally 12 words or fewer.' },
      subtitle: { type: 'string' },
      body_html: { type: 'string', description: 'Full article body in clean HTML: only <p>, <h2>, <h3>, <blockquote>, <em>, <strong> and <a href="https://...">. Link 2-4 external sources inline where the facts are stated, and 2 Kynari articles from the list provided where relevant. Must reach the target word count.' },
      sources: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } }, required: ['url'] }, description: '2-4 real URLs you actually found with web search that support the facts in the article.' },
      excerpt: { type: 'string', description: 'Maximum 300 characters.' },
      tags: { type: 'array', items: { type: 'string' } },
      meta_title: { type: 'string' }, slug: { type: 'string' }, meta_description: { type: 'string' },
      tmdb_search_title: { type: 'string', description: 'Exact English title of the film, series or anime on TMDB, if the article is about one specific work.' },
      tmdb_year: { type: 'string' },
      tmdb_media_type: { type: 'string', enum: ['movie', 'tv'] },
      igdb_search_title: { type: 'string', description: 'Exact English title of the video game, if the article is about one specific game.' },
      igdb_year: { type: 'string' },
      image_subject: { type: 'string', description: 'For people, events, places or artworks with no film/game: a short Wikimedia Commons search query for a real photograph (e.g. "Frieze London 2025", "Hideo Kojima").' },
      image_prompts: { type: 'array', items: { type: 'string' }, description: '3 prompts in English for fal.ai (last-resort fallback): [0] hero, vertical portrait composition; [1] and [2] interiors, landscape.' },
      image_captions: { type: 'array', items: { type: 'string' }, description: '2 short editorial captions for interior images. Source credit is added automatically.' }
    },
    required: ['title', 'subtitle', 'body_html', 'sources', 'excerpt', 'tags', 'meta_title', 'slug', 'meta_description', 'image_prompts', 'image_captions']
  }
};

async function generateArticle({ topic, category, section, angle, sources = [] }) {
  const wordCount = section === 'Kynari Legacy' ? '3000+' : section === 'Featured' ? '1200-2000' : '800-1200';
  const internal = await internalCandidates(category, topic);
  const system = `You are Nara Vega, editor-in-chief of Kynari (kynari.io), a premium English-language pop culture editorial platform. Voice: analytical, journalistic, cinematic, dark, no clickbait or filler, direct opening with no preamble. Anecdotes are evidence subordinate to analysis. Category: ${category}. Section: ${section}. Target length: ${wordCount} words — a hard target, do not cut short.
FACTS: use web_search to verify every concrete fact (dates, figures, names, quotes) before writing. Never invent quotes, numbers or events. If something cannot be verified, leave it out.
LINKS: put 2-4 inline links to the reputable sources you used (<a href="https://...">descriptive words</a>) and 2 links to related Kynari articles from the list given, when relevant. No bare URLs, no "click here".
TITLES OF WORKS: original English title in italics with the release year in parentheses the first time — e.g. <em>Ghostbusters</em> (1984).
ARTICLE TITLE: plain text, no asterisks or markdown, 12 words or fewer.
If the article is about a specific film, series or anime, include tmdb_search_title, tmdb_year and tmdb_media_type. If it is about a specific game, include igdb_search_title and igdb_year. Otherwise give image_subject for a real photograph.
When the research is done, call submit_article once with the complete article.`;
  const user = `Write a Kynari article. Target: ${wordCount} words.\n\nTOPIC: ${topic}\nCATEGORY: ${category}\nSECTION: ${section}${angle ? `\nEDITORIAL ANGLE: ${angle}` : ''}${sources.length ? `\nSTARTING SOURCES (check them, add others):\n${sources.map((s) => `- ${s}`).join('\n')}` : ''}${internal ? `\n\nKYNARI ARTICLES YOU MAY LINK TO (use 2 if relevant):\n${internal}` : ''}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const d = await claude({
      max_tokens: 20000, system,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }, ARTICLE_TOOL],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: attempt === 1 ? user : `${user}\n\nIMPORTANT: finish by calling submit_article.` }]
    });
    const use = d.content.find((b) => b.type === 'tool_use' && b.name === 'submit_article');
    if (use) return use.input;
    console.warn(`   No submit_article on attempt ${attempt} (stop_reason: ${d.stop_reason})`);
  }
  throw new Error('Claude did not submit the article');
}

// ---------------------------------------------------------------------------
// Enlaces: comprobar y limpiar los muertos
// ---------------------------------------------------------------------------
async function verifyLinks(html) {
  const hrefs = [...new Set([...html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>/gi)].map((m) => m[1]))];
  const dead = [];
  await Promise.all(hrefs.map(async (h) => {
    if (!/^https?:\/\//.test(h)) { dead.push(h); return; }
    if (!(await urlAlive(h))) dead.push(h);
  }));
  let out = html;
  for (const h of dead) {
    const re = new RegExp(`<a\\s[^>]*href="${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([\\s\\S]*?)<\\/a>`, 'gi');
    out = out.replace(re, '$1');
  }
  // Los externos se abren en otra pestaña
  out = out.replace(/<a\s+href="(https?:\/\/(?!www\.kynari\.io)[^"]+)"(?![^>]*target=)/gi, '<a href="$1" target="_blank" rel="noopener"');
  const kept = hrefs.filter((h) => !dead.includes(h));
  return { html: out, kept, dead, external: kept.filter((h) => !h.includes('kynari.io')).length, internal: kept.filter((h) => h.includes('kynari.io')).length };
}

// ---------------------------------------------------------------------------
// fal.ai — último recurso
// ---------------------------------------------------------------------------
async function generateImage(prompt, size = 'landscape_16_9') {
  if (!FAL_API_KEY) throw new Error('FAL_API_KEY missing');
  const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, image_size: size, num_images: 1 })
  });
  if (!res.ok) throw new Error(`fal.ai error ${res.status}: ${await res.text()}`);
  const url = (await res.json()).images?.[0]?.url;
  if (!url) throw new Error('fal.ai did not return an image url');
  return download(url);
}

// ---------------------------------------------------------------------------
// Imágenes + tráiler: cadena de fuentes reales
// Devuelve { hero:{buf,credit}, interiors:[{buf,credit}], trailer, source, reasons }
// ---------------------------------------------------------------------------
async function gatherMedia(article, category) {
  const reasons = [];
  const out = { hero: null, interiors: [], trailer: null, source: null, work: null, reasons };
  const take = async (url, credit) => ({ buf: await download(url), credit });

  // 1) Juegos: IGDB (imágenes + vídeo) y Steam (capturas)
  if (article.igdb_search_title) {
    try {
      const g = await igdbFind(article.igdb_search_title, article.igdb_year);
      if (!process.env.IGDB_CLIENT_ID) reasons.push('IGDB: no credentials');
      else if (!g) reasons.push(`IGDB: no match for "${article.igdb_search_title}"`);
      else {
        console.log(`   IGDB: ✓ "${g.name}" — ID ${g.id}`);
        out.work = { type: 'game', title: g.name, year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null, igdb: g.id };
        out.trailer = igdbTrailer(g);
        const u = igdbImageUrls(g, 3);
        if (u.hero) out.hero = await take(u.hero, '© IGDB / Twitch');
        for (const i of u.interiors) out.interiors.push(await take(i, '© IGDB / Twitch'));
        out.source = 'IGDB';
      }
    } catch (e) { reasons.push(`IGDB error: ${e.message}`); }
    if (out.interiors.length < 2) {
      try {
        const s = await steamFind(article.igdb_search_title);
        if (s) {
          console.log(`   Steam: ✓ "${s.name}" (${s.appid})`);
          out.work = out.work || { type: 'game', title: s.name, year: null };
          out.work.steam = s.appid;
          for (const shot of s.screenshots.slice(0, 2 - out.interiors.length)) out.interiors.push(await take(shot, `© ${s.name} / Steam`));
          if (!out.hero && s.header) out.hero = await take(s.header, `© ${s.name} / Steam`);
          out.source = out.source || 'Steam';
        } else reasons.push('Steam: no match');
      } catch (e) { reasons.push(`Steam error: ${e.message}`); }
    }
  }

  // 2) Cine, series, anime: TMDB (imágenes + tráiler)
  if (!out.hero && article.tmdb_search_title) {
    try {
      if (!process.env.TMDB_API_KEY) reasons.push('TMDB: no TMDB_API_KEY');
      const item = await tmdbFind(article.tmdb_search_title, article.tmdb_year, article.tmdb_media_type);
      if (!item) reasons.push(`TMDB: no match for "${article.tmdb_search_title}"`);
      else {
        console.log(`   TMDB: ✓ "${item.title || item.name}" [${item.media_type}] — ID ${item.id}`);
        out.work = out.work || { type: item.media_type, title: item.title || item.name, year: Number((item.release_date || item.first_air_date || '').slice(0, 4)) || null, tmdb: item.id };
        out.trailer = out.trailer || await tmdbTrailer(item);
        const im = await tmdbImages(item, 3);
        const base = 'https://image.tmdb.org/t/p/original';
        if (im?.hero) out.hero = await take(base + im.hero, '© The Movie Database (TMDB)');
        for (const i of im?.interiors || []) out.interiors.push(await take(base + i, '© The Movie Database (TMDB)'));
        out.source = 'TMDB';
      }
    } catch (e) { reasons.push(`TMDB error: ${e.message}`); }
  }

  // 3) Personas, eventos, lugares: Wikimedia Commons
  if (!out.hero) {
    const q = article.image_subject || article.tmdb_search_title || article.igdb_search_title;
    if (q) {
      try {
        const c = await commonsImage(q);
        if (c) { out.hero = await take(c.url, c.credit); out.source = 'Wikimedia Commons'; console.log(`   Commons: ✓ ${c.page}`); }
        else reasons.push(`Commons: nothing reusable for "${q}"`);
      } catch (e) { reasons.push(`Commons error: ${e.message}`); }
    } else reasons.push('No work, game or subject to search');
  }

  // 4) fal.ai para lo que falte (siempre marcado como imagen IA)
  const ai = 'AI-generated image · Kynari';
  if (!out.hero) { out.hero = { buf: await generateImage(article.image_prompts[0], 'portrait_4_3'), credit: ai }; out.source = out.source || 'fal.ai'; }
  while (out.interiors.length < 2) {
    out.interiors.push({ buf: await generateImage(article.image_prompts[out.interiors.length + 1] || article.image_prompts[0], 'landscape_16_9'), credit: ai });
  }
  if (reasons.length) console.log(`   Image notes: ${reasons.join(' | ')}`);
  return out;
}

// ---------------------------------------------------------------------------
// Publicar en Ghost
// ---------------------------------------------------------------------------
function extractYoutubeId(input) {
  if (!input) return null;
  const m = input.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : /^[a-zA-Z0-9_-]{11}$/.test(input) ? input : null;
}

/** Parte el HTML por párrafos e intercala las dos imágenes y la fachada de vídeo. */
function buildBody(bodyHtml, { interiors = [], facade = null }) {
  const blocks = bodyHtml.split(/(?<=<\/(?:p|h2|h3|blockquote)>)/i).map((s) => s.trim()).filter(Boolean);
  const n = blocks.length;
  const slots = new Map();
  if (facade) slots.set(1, [htmlCard(facade)]);
  const p1 = Math.max(2, Math.floor(n / 3)), p2 = Math.max(p1 + 1, Math.floor((2 * n) / 3));
  if (interiors[0]) slots.set(p1, [...(slots.get(p1) || []), imageCard(interiors[0])]);
  if (interiors[1]) slots.set(p2, [...(slots.get(p2) || []), imageCard(interiors[1])]);
  const children = []; let buf = '';
  blocks.forEach((b, i) => {
    if (slots.has(i)) { if (buf) children.push(htmlCard(buf)); buf = ''; children.push(...slots.get(i)); }
    buf += b;
  });
  if (buf) children.push(htmlCard(buf));
  for (const [i, cards] of slots) if (i >= n) children.push(...cards);
  return lexicalDoc(children);
}

async function publishToGhost({ article, tags, heroUrl, heroCredit, interiors, trailer, sources, featured, work }) {
  const facade = trailer ? videoFacadeHTML(trailer) : null;
  const lexical = buildBody(article.body_html, { interiors, facade });
  const media = { trailer: trailer || null, work: work || null, sources: sources.length ? sources : null };
  const res = await ghost('POST', '/posts/', {
    posts: [{
      title: article.title, custom_excerpt: (article.excerpt || '').slice(0, 300), lexical, status: 'published',
      feature_image: heroUrl, feature_image_alt: article.title.slice(0, 190), feature_image_caption: heroCredit,
      tags: [...tags, ...(featured ? ['featured'] : [])].map((name) => ({ name })),
      meta_title: article.meta_title, meta_description: article.meta_description, slug: article.slug, og_image: heroUrl,
      codeinjection_head: withMediaJson('', media)
    }]
  });
  const post = res.posts[0];
  console.log(`   Tags: ${JSON.stringify((post.tags || []).map((t) => t.name))}`);
  return post;
}

// ---------------------------------------------------------------------------
// Cola de temas (fallback) y log
// ---------------------------------------------------------------------------
async function loadQueue() {
  try { return JSON.parse(await fs.readFile(QUEUE_PATH, 'utf-8')); }
  catch { return { Cinema: [], Anime: [], Games: [], Culture: [], Comic: [], Legacy: [] }; }
}
async function saveQueue(q) { await fs.writeFile(QUEUE_PATH, JSON.stringify(q, null, 2)); }

async function refillCategory(queue, category) {
  const d = await claude({ max_tokens: 1024, messages: [{ role: 'user', content: `Give me 5 distinct, non-generic article ideas for the "${category}" category of Kynari.io (premium pop culture platform, cinematic/dark/analytical tone). They must be about real works or events. Return ONLY a JSON array of 5 short strings.` }] });
  const m = (textOf(d) || '[]').match(/\[[\s\S]*\]/);
  queue[category].push(...(m ? JSON.parse(m[0]) : []).map((t) => ({ topic: t, section: category === 'Legacy' ? 'Kynari Legacy' : 'Featured' })));
}
async function nextTopic(queue, category) {
  if (!queue[category] || queue[category].length === 0) await refillCategory(queue, category);
  return queue[category].shift();
}

async function appendLog(entry) {
  let log = [];
  try { log = JSON.parse(await fs.readFile(LOG_PATH, 'utf-8')); } catch {}
  log.push({ ...entry, timestamp: new Date().toISOString() });
  await fs.writeFile(LOG_PATH, JSON.stringify(log, null, 2));
}

// ---------------------------------------------------------------------------
// Guardas
// ---------------------------------------------------------------------------
const DAILY_MARK_PATH = path.join(__dirname, 'kynari-last-daily.json');
const LEGACY_MARK_PATH = path.join(__dirname, 'kynari-last-legacy.json');
const todayStr = () => new Date().toISOString().slice(0, 10);
async function alreadyRanToday() { try { return JSON.parse(await fs.readFile(DAILY_MARK_PATH, 'utf-8')).date === todayStr(); } catch { return false; } }
async function markRanToday() { await fs.writeFile(DAILY_MARK_PATH, JSON.stringify({ date: todayStr() })); }
function isoWeekStr(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return `${date.getUTCFullYear()}-W${String(Math.ceil((((date - yearStart) / 86400000) + 1) / 7)).padStart(2, '0')}`;
}
async function alreadyRanThisWeek() { try { return isoWeekStr(new Date(JSON.parse(await fs.readFile(LEGACY_MARK_PATH, 'utf-8')).date)) === isoWeekStr(); } catch { return false; } }
async function markRanThisWeek() { await fs.writeFile(LEGACY_MARK_PATH, JSON.stringify({ date: new Date().toISOString() })); }

// ---------------------------------------------------------------------------
// Pipeline completo
// ---------------------------------------------------------------------------
async function publishOne({ topic, category, section, angle, youtube, sources = [], featured = false }) {
  console.log(`\n-> Generating article: "${topic}" [${category} / ${section}]`);
  const article = await generateArticle({ topic, category, section, angle, sources });
  article.title = cleanTitle(article.title);
  if (article.title.split(/\s+/).length > 14) console.warn(`   ⚠ Long title (${article.title.split(/\s+/).length} words)`);

  // Enlaces comprobados
  const links = await verifyLinks(article.body_html);
  article.body_html = links.html;
  console.log(`   Links: ${links.external} external, ${links.internal} internal${links.dead.length ? `, ${links.dead.length} dead removed` : ''}`);
  if (links.external < 2) console.warn('   ⚠ Fewer than 2 external links');
  const okSources = [];
  for (const s of article.sources || []) if (s?.url && await urlAlive(s.url)) okSources.push({ title: s.title || '', url: s.url });

  // Imágenes y vídeo
  const media = await gatherMedia(article, category);
  const manualYt = extractYoutubeId(youtube);
  const trailer = manualYt ? { yt: manualYt, kind: 'trailer', title: article.title, source: 'YouTube' } : media.trailer;
  if (trailer) console.log(`   Video: ${trailer.kind} ${trailer.yt} (${trailer.source}) — ${trailer.title}`);

  // Etiquetas
  const isLegacy = section === 'Kynari Legacy';
  const primaryTag = isLegacy ? 'Legacy' : category;
  const rest = (article.tags || []).filter((t) => {
    const l = t.toLowerCase();
    return l !== primaryTag.toLowerCase() && l !== 'featured' && !(isLegacy && CATEGORIES.some((c) => c.toLowerCase() === l));
  });
  const videoTags = trailer ? ['#video', trailer.kind === 'gameplay' ? '#gameplay' : '#trailer'] : [];
  const tags = applyTagHygiene([primaryTag, ...rest, ...videoTags]);

  console.log('   Uploading images to Ghost...');
  const heroUrl = await uploadToGhost(media.hero.buf, 'hero');
  const captions = article.image_captions || [];
  const interiors = [];
  for (const [i, im] of media.interiors.slice(0, 2).entries()) {
    const size = imageSize(im.buf) || {};
    const url = await uploadToGhost(im.buf, `interior${i + 1}`);
    const cap = captions[i]?.trim();
    interiors.push({ src: url, width: size.width, height: size.height, alt: cap || article.title, caption: cap ? `${cap} · ${im.credit}` : im.credit });
  }

  const post = await publishToGhost({
    article, tags, heroUrl, heroCredit: media.hero.credit, interiors, trailer, sources: okSources, work: media.work,
    featured: featured || isLegacy || section === 'Featured'
  });
  console.log(`   OK -> ${post.url}`);
  await appendLog({ title: article.title, topic, category, section, imageSource: media.source, video: trailer?.yt || null, links: links.kept.length, url: post.url, id: post.id, status: 'success' });
  return { post, hasTrailer: !!trailer, realImage: media.source !== 'fal.ai' };
}

/** Marca como destacado el mejor artículo del lote diario (tráiler > imagen real > el primero). */
async function featureBest(results) {
  const best = results.find((r) => r.hasTrailer && r.realImage) || results.find((r) => r.realImage) || results[0];
  if (!best) return;
  const p = (await ghost('GET', `/posts/${best.post.id}/?include=tags`)).posts[0];
  if ((p.tags || []).some((t) => t.slug === 'featured')) return;
  await ghost('PUT', `/posts/${p.id}/`, { posts: [{ updated_at: p.updated_at, tags: [...p.tags.map((t) => ({ id: t.id })), { name: 'featured' }] }] });
  console.log(`   Featured: ${p.title}`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'daily';

  if (!process.env.GHOST_ADMIN_KEY || !ANTHROPIC_API_KEY) {
    console.error('Missing env vars: GHOST_ADMIN_KEY, ANTHROPIC_API_KEY');
    process.exit(1);
  }
  const optional = [];
  if (!process.env.TMDB_API_KEY) optional.push('TMDB_API_KEY');
  if (!process.env.IGDB_CLIENT_ID || !process.env.IGDB_CLIENT_SECRET) optional.push('IGDB_CLIENT_ID/IGDB_CLIENT_SECRET');
  if (!FAL_API_KEY) optional.push('FAL_API_KEY');
  if (optional.length) console.warn(`Warning: missing ${optional.join(', ')} — those sources are skipped.`);

  if (mode === 'daily') {
    if (await alreadyRanToday()) { console.log('Daily batch already published today.'); return; }
    const recentTitles = await loadRecentTitles(30);
    console.log(`\n   ${recentTitles.length} recent titles loaded to avoid repetitions.`);
    const queue = await loadQueue();
    const results = []; const todayTopics = [];
    for (const category of CATEGORIES) {
      try {
        let t;
        try {
          console.log(`\n   Searching trending topic for ${category}...`);
          t = { ...(await getTrendingTopic(category, { recentTitles, todayTopics })), section: 'Latest' };
          console.log(`   Trending: "${t.topic}" (${t.sources.length} sources)`);
        } catch (e) {
          console.error(`   Fallback queue for ${category}: ${e.message}`);
          const item = await nextTopic(queue, category);
          t = { topic: item.topic, section: item.section, sources: [] };
        }
        todayTopics.push(`[${category}] ${t.topic}`);
        results.push(await publishOne({ ...t, category }));
      } catch (err) {
        console.error(`   ERROR (${category}): ${err.message}`);
        await appendLog({ category, status: 'error', error: err.message });
      }
      await saveQueue(queue);
    }
    if (results.length) {
      try { await featureBest(results); } catch (e) { console.warn(`   Featured step failed: ${e.message}`); }
      await markRanToday(); console.log(`\n${results.length}/${CATEGORIES.length} articles published today.`);
    } else console.log('\nNo categories published — can retry.');

  } else if (mode === 'legacy') {
    if (await alreadyRanThisWeek()) { console.log('Legacy already published this week.'); return; }
    const recentTitles = await loadRecentTitles(30);
    const queue = await loadQueue();
    try {
      let t;
      try { t = await getTrendingLegacyTopic({ recentTitles }); console.log(`   Found: "${t.topic}" [${t.category}]`); }
      catch (e) { console.error(`   Fallback queue Legacy: ${e.message}`); const item = await nextTopic(queue, 'Legacy'); t = { topic: item.topic, category: item.originalCategory || 'Culture', sources: [] }; }
      await publishOne({ ...t, section: 'Kynari Legacy' });
      await markRanThisWeek();
    } catch (err) {
      console.error(`   ERROR Legacy: ${err.message}`);
      await appendLog({ category: 'Legacy', status: 'error', error: err.message });
    }
    await saveQueue(queue);

  } else if (mode === 'custom') {
    const getArg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
    const topic = getArg('--topic');
    if (!topic) {
      console.error('Usage: node kynari-publisher.mjs custom --topic "..." --category "Cinema" --section "Featured" --angle "..." --youtube "URL" [--featured]');
      process.exit(1);
    }
    await publishOne({ topic, category: getArg('--category') || 'Culture', section: getArg('--section') || 'Featured', angle: getArg('--angle'), youtube: getArg('--youtube'), featured: args.includes('--featured') });

  } else {
    console.error(`Unknown mode: ${mode}. Use: daily | legacy | custom`);
    process.exit(1);
  }
  console.log('\nDone.');
}

// Exportado para las pruebas (tools/test_publisher.mjs).
export { applyTagHygiene, tagSlug, detectImageFormat, cleanTitle, buildBody, verifyLinks, extractYoutubeId, PUBLIC_TAG_ALLOWLIST, GHOST_URL };

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => { console.error('Fatal error:', err); process.exit(1); });
