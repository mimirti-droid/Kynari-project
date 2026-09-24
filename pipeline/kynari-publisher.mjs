#!/usr/bin/env node
/**
 * KYNARI PUBLISHER v13 — Imagen hero vertical (evita recortes malos en tarjetas)
 *
 * Historial de fixes:
 * - v1-v11: ver versiones anteriores.
 * - v12:
 *   · Longitud aumentada: Latest 800-1200, Featured 1200-2000, Legacy 3000+
 *   · max_tokens subido a 16000 para soportar artículos más largos
 *   · TMDB/IGDB: Claude ahora devuelve año y tipo de obra para búsqueda precisa
 *   · TMDB filtra por media_type (movie/tv) y año para evitar obras homónimas
 *   · Consola muestra exactamente qué encontró TMDB/IGDB antes de descargar
 * - v13:
 *   · Hero/feature_image ahora prioriza imágenes verticales (TMDB posters, IGDB
 *     cover, fal.ai portrait_4_3) en vez de horizontales (backdrops/artworks 16:9).
 *     El hero se usa tanto en la cabecera del artículo como en las tarjetas
 *     verticales de Featured/Latest (aspect-ratio 3:4) — un backdrop panorámico
 *     recortado a 3:4 solía cortar el sujeto principal fuera de encuadre
 *     (detectado en el caso Tilly Norwood, sept 2026). Los interiores se quedan
 *     en horizontal (backdrops/artworks/screenshots), donde no da problemas.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_PATH = path.join(__dirname, 'kynari-queue.json');
const LOG_PATH = path.join(__dirname, 'kynari-log.json');

const GHOST_URL = 'https://ghost-production-ac7a.up.railway.app';
const GHOST_ADMIN_KEY = process.env.GHOST_ADMIN_KEY;
const FAL_API_KEY = process.env.FAL_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/original';

const IGDB_CLIENT_ID = process.env.IGDB_CLIENT_ID;
const IGDB_CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET;

const CATEGORIES = ['Cinema', 'Anime', 'Games', 'Culture', 'Comic'];

const IMAGE_SOURCE_CREDIT = {
  'TMDB': '© The Movie Database (TMDB)',
  'IGDB': '© IGDB / Twitch',
  'fal.ai': 'AI-generated image · Kynari'
};

// ---------------------------------------------------------------------------
// Ghost Admin JWT
// ---------------------------------------------------------------------------
function ghostToken() {
  const [id, secret] = GHOST_ADMIN_KEY.split(':');
  const header = { alg: 'HS256', typ: 'JWT', kid: id };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + 5 * 60, aud: '/admin/' };
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(payload)}`;
  const sig = crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(unsigned).digest('base64url');
  return `${unsigned}.${sig}`;
}

// ---------------------------------------------------------------------------
// IGDB — obtener token de acceso (Twitch OAuth)
// ---------------------------------------------------------------------------
async function getIGDBToken() {
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${IGDB_CLIENT_ID}&client_secret=${IGDB_CLIENT_SECRET}&grant_type=client_credentials`,
    { method: 'POST' }
  );
  if (!res.ok) throw new Error(`IGDB token error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Helper: seleccionar N imágenes únicas de un pool
// ---------------------------------------------------------------------------
function pickUnique(pool, n) {
  const seen = new Set();
  const result = [];
  for (const item of pool) {
    if (!seen.has(item) && item) {
      seen.add(item);
      result.push(item);
      if (result.length === n) break;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// IGDB — buscar imágenes reales de videojuegos
// FIX v12: filtra por año exacto si se proporciona para evitar homónimos
// ---------------------------------------------------------------------------
async function fetchIGDBImages(title, year) {
  try {
    const token = await getIGDBToken();

    // Construir query con filtro de año si está disponible
    let query = `search "${title}"; fields id,name,first_release_date,cover.*,artworks.*,screenshots.*; limit 10;`;

    const searchRes = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: { 'Client-ID': IGDB_CLIENT_ID, Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
      body: query
    });
    if (!searchRes.ok) throw new Error(`IGDB search error ${searchRes.status}`);
    const games = await searchRes.json();
    if (!games || games.length === 0) { console.log('   IGDB: no results, using fal.ai'); return null; }

    // FIX v12: si hay año, preferir el juego cuyo año de lanzamiento coincide
    let game = games[0];
    if (year) {
      const match = games.find(g => {
        if (!g.first_release_date) return false;
        const releaseYear = new Date(g.first_release_date * 1000).getFullYear();
        return releaseYear === parseInt(year);
      });
      if (match) game = match;
    }

    const releaseYear = game.first_release_date
      ? new Date(game.first_release_date * 1000).getFullYear()
      : 'unknown year';

    console.log(`   IGDB: ✓ "${game.name}" (${releaseYear}) — ID ${game.id}`);
    if (year && releaseYear !== parseInt(year)) {
      console.log(`   IGDB: ⚠ year mismatch — article says ${year}, found ${releaseYear}`);
    }

    const artworks = (game.artworks || []).map(a => a.image_id).filter(Boolean);
    const screenshots = (game.screenshots || []).map(s => s.image_id).filter(Boolean);
    const cover = game.cover?.image_id;

    // FIX v13: cover (portrait box art) primero — se usa como hero/feature_image,
    // que aparece tanto en tarjetas verticales (Featured/Latest) como en la cabecera
    // del artículo. artworks/screenshots (normalmente 16:9) quedan para las imágenes
    // interiores, donde el formato horizontal no da problemas de recorte.
    const pool = [cover, ...artworks, ...screenshots].filter(Boolean);
    if (pool.length === 0) { console.log('   IGDB: no images available, using fal.ai'); return null; }

    const uniqueIds = pickUnique(pool, 3);
    console.log(`   IGDB: ${uniqueIds.length}/3 unique images selected`);

    async function downloadIGDBImage(imageId) {
      const url = `https://images.igdb.com/igdb/image/upload/t_1080p/${imageId}.jpg`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`IGDB image download error ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    }

    const heroBuf = await downloadIGDBImage(uniqueIds[0]);
    const interior1Buf = uniqueIds[1] ? await downloadIGDBImage(uniqueIds[1]) : null;
    const interior2Buf = uniqueIds[2] ? await downloadIGDBImage(uniqueIds[2]) : null;

    return { heroBuf, interior1Buf, interior2Buf };
  } catch (err) {
    console.error(`   IGDB error: ${err.message} — using fal.ai`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// TMDB — buscar imágenes reales de películas/series/anime
// FIX v12: filtra por media_type y año para evitar obras homónimas
// ---------------------------------------------------------------------------
async function fetchTMDBImages(title, year, mediaType) {
  try {
    // Construir URL con año si está disponible
    let searchUrl = `${TMDB_BASE}/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=en-US&page=1`;
    if (year) searchUrl += `&year=${year}`;

    const res = await fetch(searchUrl);
    if (!res.ok) throw new Error(`TMDB search error ${res.status}`);
    const data = await res.json();

    let results = (data.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv');

    if (results.length === 0) { console.log('   TMDB: no results, using fal.ai'); return null; }

    // FIX v12: filtrar por media_type si se especifica (movie/tv/anime)
    if (mediaType) {
      const typeFilter = mediaType === 'movie' ? 'movie' : mediaType === 'tv' ? 'tv' : null;
      if (typeFilter) {
        const filtered = results.filter(r => r.media_type === typeFilter);
        if (filtered.length > 0) results = filtered;
      }
    }

    // FIX v12: si hay año, preferir el resultado cuyo año coincide
    let item = results[0];
    if (year) {
      const match = results.find(r => {
        const releaseDate = r.release_date || r.first_air_date || '';
        return releaseDate.startsWith(year.toString());
      });
      if (match) item = match;
    }

    const foundYear = (item.release_date || item.first_air_date || '').slice(0, 4);
    console.log(`   TMDB: ✓ "${item.title || item.name}" [${item.media_type}] (${foundYear || 'unknown year'}) — ID ${item.id}`);
    if (year && foundYear && foundYear !== year.toString()) {
      console.log(`   TMDB: ⚠ year mismatch — article says ${year}, found ${foundYear}`);
    }

    const imgRes = await fetch(`${TMDB_BASE}/${item.media_type}/${item.id}/images?api_key=${TMDB_API_KEY}`);
    if (!imgRes.ok) throw new Error(`TMDB images error ${imgRes.status}`);
    const imgData = await imgRes.json();

    const backdrops = (imgData.backdrops || [])
      .filter(b => b.file_path)
      .sort((a, b) => b.vote_average - a.vote_average)
      .map(b => b.file_path);

    const posters = (imgData.posters || [])
      .filter(p => p.file_path)
      .sort((a, b) => b.vote_average - a.vote_average)
      .map(p => p.file_path);

    // FIX v13: posters (verticales, 2:3) primero — el primer elemento del pool se usa
    // como hero/feature_image, que aparece en tarjetas verticales (Featured/Latest) y
    // en la cabecera del artículo. Con un backdrop (16:9) como hero, el recorte a 3:4
    // en las tarjetas caía a menudo fuera del sujeto principal de la imagen (ver caso
    // Tilly Norwood, sept 2026). Los backdrops quedan para imágenes interiores, donde
    // el formato horizontal no da problemas.
    const pool = [...posters, ...backdrops];
    if (pool.length === 0) { console.log('   TMDB: no images available, using fal.ai'); return null; }

    const uniquePaths = pickUnique(pool, 3);
    console.log(`   TMDB: ${uniquePaths.length}/3 unique images selected`);

    async function downloadTMDB(filePath) {
      const r = await fetch(`${TMDB_IMG}${filePath}`);
      if (!r.ok) throw new Error(`TMDB download error ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    }

    const heroBuf = await downloadTMDB(uniquePaths[0]);
    const interior1Buf = uniquePaths[1] ? await downloadTMDB(uniquePaths[1]) : null;
    const interior2Buf = uniquePaths[2] ? await downloadTMDB(uniquePaths[2]) : null;

    return { heroBuf, interior1Buf, interior2Buf };
  } catch (err) {
    console.error(`   TMDB error: ${err.message} — using fal.ai`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cargar historial reciente para evitar repeticiones
// ---------------------------------------------------------------------------
async function loadRecentTitles(n = 30) {
  try {
    const raw = await fs.readFile(LOG_PATH, 'utf-8');
    const log = JSON.parse(raw);
    return log.filter((e) => e.status === 'success' && e.title).slice(-n).map((e) => e.title);
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Claude + web search — trending del día
// ---------------------------------------------------------------------------
async function getTrendingTopic(category, { recentTitles = [], todayTopics = [] } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const avoidBlock = [];
  if (recentTitles.length > 0) avoidBlock.push(`TOPICS ALREADY PUBLISHED IN KYNARI (last 30 articles) — DO NOT repeat or cover from another angle if treated this week:\n${recentTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`);
  if (todayTopics.length > 0) avoidBlock.push(`TOPICS ALREADY CHOSEN TODAY IN THIS BATCH — do not overlap even if different category:\n${todayTopics.join('\n')}`);
  const avoidSection = avoidBlock.length > 0 ? `\n\n${avoidBlock.join('\n\n')}\n\nFind something DIFFERENT from all of the above.` : '';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6', max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: `Search the web for what is trending TODAY (${today}) in the "${category}" category of pop culture. I want something real and concrete from these days.${avoidSection}\n\nRespond ONLY with these two lines:\nTOPIC: <specific topic>\nANGLE: <editorial angle in one sentence, Kynari tone: analytical, no clickbait>` }]
    })
  });
  if (!res.ok) throw new Error(`Claude web search error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const topicMatch = text.match(/TOPIC:\s*(.+)/i);
  const angleMatch = text.match(/ANGLE:\s*(.+)/i);
  if (!topicMatch) throw new Error(`Could not extract trending topic:\n${text}`);
  return { topic: topicMatch[1].trim(), angle: angleMatch ? angleMatch[1].trim() : undefined };
}

// ---------------------------------------------------------------------------
// Claude + web search — Kynari Legacy
// ---------------------------------------------------------------------------
async function getTrendingLegacyTopic({ recentTitles = [] } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const avoidSection = recentTitles.length > 0 ? `\n\nTOPICS ALREADY PUBLISHED IN KYNARI — DO NOT repeat:\n${recentTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nFind something DIFFERENT.` : '';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6', max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: `Search the web for what anniversary, death, milestone or cultural event falls THIS WEEK (around ${today}) in cinema, anime, games, music or pop culture that deserves a deep essay in "Kynari Legacy" style (3000+ words, retrospective, not a news item).${avoidSection}\n\nRespond ONLY with these three lines:\nTOPIC: <specific topic>\nCATEGORY: <Cinema, Anime, Games, Culture or Comic>\nANGLE: <editorial angle in one sentence, Kynari tone: analytical, no clickbait>` }]
    })
  });
  if (!res.ok) throw new Error(`Claude web search error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const topicMatch = text.match(/TOPIC:\s*(.+)/i);
  const categoryMatch = text.match(/CATEGORY:\s*(.+)/i);
  const angleMatch = text.match(/ANGLE:\s*(.+)/i);
  if (!topicMatch) throw new Error(`Could not extract Legacy topic:\n${text}`);
  return { topic: topicMatch[1].trim(), category: categoryMatch ? categoryMatch[1].trim() : 'Culture', angle: angleMatch ? angleMatch[1].trim() : undefined };
}

// ---------------------------------------------------------------------------
// Claude API — generación de artículo vía tool-use
// FIX v12: longitudes aumentadas + campos año y tipo para TMDB/IGDB
// ---------------------------------------------------------------------------
const ARTICLE_TOOL = {
  name: 'submit_article',
  description: 'Submits a complete Kynari editorial article, ready to publish.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      subtitle: { type: 'string' },
      body_html: { type: 'string', description: 'Full article body in clean HTML (only <p>, <h2>, <h3>, <blockquote>, <em>, <strong>). Must reach the target word count — do not cut short.' },
      excerpt: { type: 'string', description: 'Maximum 300 characters.' },
      tags: { type: 'array', items: { type: 'string' } },
      meta_title: { type: 'string' },
      slug: { type: 'string' },
      meta_description: { type: 'string' },
      tmdb_search_title: { type: 'string', description: 'Exact English title of the film, series or anime to search on TMDB. Only if the article is about a specific Cinema, Anime or Culture work.' },
      tmdb_year: { type: 'string', description: 'Release year of the work (e.g. "2024"). Used to avoid finding a different work with the same title.' },
      tmdb_media_type: { type: 'string', enum: ['movie', 'tv'], description: 'Type of work: "movie" for films, "tv" for series and anime.' },
      igdb_search_title: { type: 'string', description: 'Exact English title of the video game to search on IGDB. Only if the article is about a specific game.' },
      igdb_year: { type: 'string', description: 'Release year of the game (e.g. "2022"). Used to avoid finding a different game with the same title.' },
      image_prompts: { type: 'array', items: { type: 'string' }, description: '3 prompts in English for fal.ai (fallback): [0] hero, vertical portrait composition (subject centered, not a wide panoramic scene — this image is used in vertical 3:4 cards as well as the article header), [1] interior 1, [2] interior 2 (landscape/16:9 is fine for these two).' },
      image_captions: { type: 'array', items: { type: 'string' }, description: '2 short editorial captions for interior images. Source credit is added automatically.' }
    },
    required: ['title', 'subtitle', 'body_html', 'excerpt', 'tags', 'meta_title', 'slug', 'meta_description', 'image_prompts', 'image_captions']
  }
};

async function generateArticle({ topic, category, section, angle }) {
  // FIX v12: longitudes aumentadas
  const wordCount =
    section === 'Kynari Legacy' ? '3000+' :
    section === 'Featured' ? '1200-2000' :
    '800-1200';

  const systemPrompt = `You are Nara Vega, editor-in-chief of Kynari (kynari.io), a premium English-language pop culture editorial platform. Voice: analytical, journalistic, cinematic, dark, no clickbait or filler, direct opening with no preamble. Anecdotes are evidence subordinate to analysis, never the protagonist. Category: ${category}. Section: ${section}. Target length: ${wordCount} words — this is a hard target, do not cut short. Write the full article, do not summarize or skip sections. The article is written in English. Film, series and game titles: always use the original English title in italics, followed by the release year in parentheses the first time it appears — e.g. <em>Ghostbusters</em> (1984). Never translate titles into Spanish. If the article is about a specific film, series or anime, always include tmdb_search_title, tmdb_year and tmdb_media_type. If it is about a specific game, always include igdb_search_title and igdb_year.`;

  const userPrompt = `Write a Kynari article. Target: ${wordCount} words — write the full article, do not stop early.\n\nTOPIC: ${topic}\nCATEGORY: ${category}\nSECTION: ${section}${angle ? `\nEDITORIAL ANGLE: ${angle}` : ''}\n\nSubmit the complete article using the submit_article tool.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000, // FIX v12: aumentado de 8000 a 16000
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      tools: [ARTICLE_TOOL],
      tool_choice: { type: 'tool', name: 'submit_article' }
    })
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const toolUse = data.content.find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return a tool_use block');
  return toolUse.input;
}

// ---------------------------------------------------------------------------
// fal.ai — generación de imágenes (fallback)
// ---------------------------------------------------------------------------
async function generateImage(prompt, size = 'landscape_16_9') {
  const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, image_size: size, num_images: 1 })
  });
  if (!res.ok) throw new Error(`fal.ai error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const url = data.images?.[0]?.url;
  if (!url) throw new Error('fal.ai did not return an image url');
  const imgRes = await fetch(url);
  return Buffer.from(await imgRes.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Ghost — subida de imágenes
// ---------------------------------------------------------------------------
async function uploadImageToGhost(buffer, filename) {
  const boundary = '----kynariB' + crypto.randomBytes(8).toString('hex');
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nimage\r\n--${boundary}--\r\n`)
  ]);
  const res = await fetch(`${GHOST_URL}/ghost/api/admin/images/upload/`, {
    method: 'POST',
    headers: { Authorization: `Ghost ${ghostToken()}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body
  });
  if (!res.ok) throw new Error(`Ghost image upload error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.images[0].url;
}

// ---------------------------------------------------------------------------
// Lexical — HTML card con iframe responsive para YouTube
// ---------------------------------------------------------------------------
function buildLexical(bodyHtml, youtubeId) {
  if (!youtubeId) {
    return JSON.stringify({
      root: { children: [{ type: 'html', version: 1, html: bodyHtml }], direction: null, format: '', indent: 0, type: 'root', version: 1 }
    });
  }
  const firstBlockMatch = bodyHtml.match(/<\/(?:p|h2|h3|blockquote)>/i);
  let introPart, restPart;
  if (!firstBlockMatch) { introPart = bodyHtml; restPart = ''; }
  else {
    const cutAt = firstBlockMatch.index + firstBlockMatch[0].length;
    introPart = bodyHtml.slice(0, cutAt);
    restPart = bodyHtml.slice(cutAt);
  }
  const youtubeCard = { type: 'html', version: 1, html: `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;margin:2rem 0;"><iframe style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" src="https://www.youtube.com/embed/${youtubeId}" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe></div>` };
  const children = [{ type: 'html', version: 1, html: introPart }, youtubeCard];
  if (restPart) children.push({ type: 'html', version: 1, html: restPart });
  return JSON.stringify({ root: { children, direction: null, format: '', indent: 0, type: 'root', version: 1 } });
}

// ---------------------------------------------------------------------------
// Publicar post en Ghost
// ---------------------------------------------------------------------------
function extractYoutubeId(input) {
  if (!input) return null;
  const match = input.match(/(?:youtu.be\/|v=|embed\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : /^[a-zA-Z0-9_-]{11}$/.test(input) ? input : null;
}

async function publishToGhost(article, imageUrls, youtubeId, imageSource) {
  const [heroUrl, interior1Url, interior2Url] = imageUrls;
  const captions = article.image_captions || [];
  const credit = IMAGE_SOURCE_CREDIT[imageSource] || IMAGE_SOURCE_CREDIT['fal.ai'];

  function buildCaption(editorialText) {
    if (editorialText && editorialText.trim()) return `${editorialText.trim()} · ${credit}`;
    return credit;
  }

  let body = article.body_html;
  const rawParagraphs = body.split('</p>');
  const paragraphs = rawParagraphs.map((p, i) => (i < rawParagraphs.length - 1 ? p + '</p>' : p));

  const img = (url, caption) =>
    `<figure style="width:100%;margin:2rem 0;"><img src="${url}" style="width:100%;display:block;" /><figcaption style="font-size:0.8em;opacity:0.6;text-align:center;margin-top:0.4rem;font-style:italic;">${caption}</figcaption></figure>`;

  const pos1 = Math.floor(paragraphs.length / 3);
  const pos2 = Math.floor((paragraphs.length * 2) / 3);
  paragraphs.splice(pos2, 0, img(interior2Url, buildCaption(captions[1])));
  paragraphs.splice(pos1, 0, img(interior1Url, buildCaption(captions[0])));
  body = paragraphs.join('');

  const lexical = buildLexical(body, youtubeId);

  const postPayload = {
    posts: [{
      title: article.title,
      custom_excerpt: (article.excerpt || '').slice(0, 300),
      lexical, feature_image: heroUrl, status: 'published',
      tags: article.tags.map((name) => ({ name })),
      meta_title: article.meta_title, meta_description: article.meta_description,
      slug: article.slug, og_image: heroUrl
    }]
  };

  const res = await fetch(`${GHOST_URL}/ghost/api/admin/posts/`, {
    method: 'POST',
    headers: { Authorization: `Ghost ${ghostToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(postPayload)
  });
  if (!res.ok) throw new Error(`Ghost publish error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  console.log(`   Tags: ${JSON.stringify((data.posts[0].tags || []).map((t) => t.name))}`);
  return data.posts[0];
}

// ---------------------------------------------------------------------------
// Cola de temas (fallback)
// ---------------------------------------------------------------------------
async function loadQueue() {
  try { return JSON.parse(await fs.readFile(QUEUE_PATH, 'utf-8')); }
  catch { return { Cinema: [], Anime: [], Games: [], Culture: [], Comic: [], Legacy: [] }; }
}
async function saveQueue(q) { await fs.writeFile(QUEUE_PATH, JSON.stringify(q, null, 2)); }

async function refillCategory(queue, category) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6', max_tokens: 1024,
      messages: [{ role: 'user', content: `Give me 5 distinct and non-generic article ideas for the "${category}" category of Kynari.io (premium pop culture platform, cinematic/dark/analytical tone). Return ONLY a JSON array of 5 short strings, nothing else.` }]
    })
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content.find((b) => b.type === 'text')?.text || '[]';
  const match = text.match(/\[[\s\S]*\]/);
  const topics = match ? JSON.parse(match[0]) : [];
  queue[category].push(...topics.map((t) => ({ topic: t, section: category === 'Legacy' ? 'Kynari Legacy' : 'Featured' })));
}

async function nextTopic(queue, category) {
  if (!queue[category] || queue[category].length === 0) await refillCategory(queue, category);
  return queue[category].shift();
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------
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
function todayStr() { return new Date().toISOString().slice(0, 10); }
async function alreadyRanToday() {
  try { const { date } = JSON.parse(await fs.readFile(DAILY_MARK_PATH, 'utf-8')); return date === todayStr(); } catch { return false; }
}
async function markRanToday() { await fs.writeFile(DAILY_MARK_PATH, JSON.stringify({ date: todayStr() })); }
function isoWeekStr(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
async function alreadyRanThisWeek() {
  try { const { date } = JSON.parse(await fs.readFile(LEGACY_MARK_PATH, 'utf-8')); return isoWeekStr(new Date(date)) === isoWeekStr(); } catch { return false; }
}
async function markRanThisWeek() { await fs.writeFile(LEGACY_MARK_PATH, JSON.stringify({ date: new Date().toISOString() })); }

// ---------------------------------------------------------------------------
// Pipeline completo
// ---------------------------------------------------------------------------
async function publishOne({ topic, category, section, angle, youtube }) {
  const youtubeId = extractYoutubeId(youtube);
  console.log(`\n-> Generating article: "${topic}" [${category} / ${section}]`);
  if (youtubeId) console.log(`   YouTube: ${youtubeId}`);

  const article = await generateArticle({ topic, category, section, angle });

  const primaryTag = section === 'Kynari Legacy' ? 'Legacy' : category;
  const isLegacy = section === 'Kynari Legacy';
  const restTags = (article.tags || []).filter((t) => {
    const lower = t.toLowerCase();
    if (lower === primaryTag.toLowerCase()) return false;
    if (isLegacy && CATEGORIES.some((c) => c.toLowerCase() === lower)) return false;
    return true;
  });
  article.tags = [primaryTag, ...restTags];
  console.log(`   Tags: ${JSON.stringify(article.tags)}`);

  let heroBuf, interior1Buf, interior2Buf;
  let imageSource = 'fal.ai';

  if (category === 'Games' && article.igdb_search_title) {
    console.log(`   Searching IGDB: "${article.igdb_search_title}" (${article.igdb_year || 'no year'})...`);
    const igdbImages = await fetchIGDBImages(article.igdb_search_title, article.igdb_year);
    if (igdbImages) {
      ({ heroBuf, interior1Buf, interior2Buf } = igdbImages);
      imageSource = 'IGDB';
    }
  } else if (['Cinema', 'Anime', 'Culture'].includes(category) && article.tmdb_search_title) {
    console.log(`   Searching TMDB: "${article.tmdb_search_title}" [${article.tmdb_media_type || 'any'}] (${article.tmdb_year || 'no year'})...`);
    const tmdbImages = await fetchTMDBImages(article.tmdb_search_title, article.tmdb_year, article.tmdb_media_type);
    if (tmdbImages) {
      ({ heroBuf, interior1Buf, interior2Buf } = tmdbImages);
      imageSource = 'TMDB';
    }
  }

  // Fallback a fal.ai para imágenes que faltan
  if (!heroBuf) {
    console.log('   Generating all images with fal.ai...');
    // FIX v13: hero en portrait_4_3 (vertical), no landscape_16_9 — es la imagen que
    // se usa como feature_image en tarjetas verticales (Featured/Latest) además de la
    // cabecera del artículo. Los interiores se quedan en horizontal para variedad visual.
    [heroBuf, interior1Buf, interior2Buf] = await Promise.all([
      generateImage(article.image_prompts[0], 'portrait_4_3'),
      generateImage(article.image_prompts[1], 'landscape_16_9'),
      generateImage(article.image_prompts[2], 'landscape_16_9')
    ]);
    imageSource = 'fal.ai';
  } else {
    if (!interior1Buf) {
      console.log('   interior1 missing — generating with fal.ai...');
      interior1Buf = await generateImage(article.image_prompts[1], 'landscape_16_9');
    }
    if (!interior2Buf) {
      console.log('   interior2 missing — generating with fal.ai...');
      interior2Buf = await generateImage(article.image_prompts[2], 'landscape_16_9');
    }
  }

  console.log('   Uploading images to Ghost...');
  const heroUrl = await uploadImageToGhost(heroBuf, 'hero.png');
  const interior1Url = await uploadImageToGhost(interior1Buf, 'interior1.png');
  const interior2Url = await uploadImageToGhost(interior2Buf, 'interior2.png');

  console.log('   Publishing to Ghost...');
  const post = await publishToGhost(article, [heroUrl, interior1Url, interior2Url], youtubeId, imageSource);

  console.log(`   OK -> ${post.url}`);
  console.log(`   Image source: ${imageSource}`);
  await appendLog({ title: article.title, topic, category, section, imageSource, url: post.url, status: 'success' });
  return post;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'daily';

  if (!GHOST_ADMIN_KEY || !FAL_API_KEY || !ANTHROPIC_API_KEY) {
    console.error('Missing env vars: GHOST_ADMIN_KEY, FAL_API_KEY, ANTHROPIC_API_KEY');
    process.exit(1);
  }

  if (mode === 'daily') {
    if (await alreadyRanToday()) { console.log('Daily batch already published today.'); return; }
    console.log('\n   Loading recent history to avoid repetitions...');
    const recentTitles = await loadRecentTitles(30);
    if (recentTitles.length > 0) console.log(`   ${recentTitles.length} articles in history.`);
    const queue = await loadQueue();
    let successCount = 0;
    const todayTopics = [];
    for (const category of CATEGORIES) {
      try {
        let topic, angle, section;
        try {
          console.log(`\n   Searching trending topic for ${category}...`);
          const trending = await getTrendingTopic(category, { recentTitles, todayTopics });
          topic = trending.topic; angle = trending.angle; section = 'Latest';
          console.log(`   Trending: "${topic}"`);
        } catch (searchErr) {
          console.error(`   Fallback queue for ${category}: ${searchErr.message}`);
          const item = await nextTopic(queue, category);
          topic = item.topic; section = item.section;
        }
        todayTopics.push(`[${category}] ${topic}`);
        await publishOne({ topic, category, section, angle });
        successCount++;
      } catch (err) {
        console.error(`   ERROR (${category}): ${err.message}`);
        await appendLog({ category, status: 'error', error: err.message });
      }
      await saveQueue(queue);
    }
    if (successCount > 0) { await markRanToday(); console.log(`\n${successCount}/${CATEGORIES.length} articles published today.`); }
    else { console.log('\nNo categories published — can retry.'); }

  } else if (mode === 'legacy') {
    if (await alreadyRanThisWeek()) { console.log('Legacy already published this week.'); return; }
    const recentTitles = await loadRecentTitles(30);
    const queue = await loadQueue();
    try {
      let topic, category, angle;
      try {
        console.log('\n   Searching anniversary/milestone for Legacy...');
        const trending = await getTrendingLegacyTopic({ recentTitles });
        topic = trending.topic; category = trending.category; angle = trending.angle;
        console.log(`   Found: "${topic}" [${category}]`);
      } catch (searchErr) {
        console.error(`   Fallback queue Legacy: ${searchErr.message}`);
        const item = await nextTopic(queue, 'Legacy');
        topic = item.topic; category = item.originalCategory || 'Culture';
      }
      await publishOne({ topic, category, section: 'Kynari Legacy', angle });
      await markRanThisWeek();
    } catch (err) {
      console.error(`   ERROR Legacy: ${err.message}`);
      await appendLog({ category: 'Legacy', status: 'error', error: err.message });
    }
    await saveQueue(queue);

  } else if (mode === 'custom') {
    const getArg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
    const topic = getArg('--topic');
    const category = getArg('--category') || 'Culture';
    const section = getArg('--section') || 'Featured';
    const angle = getArg('--angle');
    const youtube = getArg('--youtube');
    if (!topic) {
      console.error('Usage: node kynari-publisher.mjs custom --topic "..." --category "Cinema" --section "Featured" --angle "..." --youtube "URL"');
      process.exit(1);
    }
    await publishOne({ topic, category, section, angle, youtube });

  } else {
    console.error(`Unknown mode: ${mode}. Use: daily | legacy | custom`);
    process.exit(1);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
