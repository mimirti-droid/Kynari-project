/**
 * KYNARI MEDIA — utilidades compartidas de imagen, vídeo y Ghost (v2, 16 oct. 2026)
 *
 * Lo usan pipeline/kynari-publisher.mjs (v16) y las herramientas de tools/
 * (backfill de tráileres, Signal, limpieza y loops). Sin dependencias externas:
 * solo fetch y node:crypto. Las claves llegan por variables de entorno.
 *
 * Contrato con el tema v2 (theme/kynari):
 *  · Etiquetas internas: #video (cualquier vídeo), #trailer, #gameplay, #nara, #loop.
 *  · Datos del vídeo en codeinjection_head, dentro de
 *      <script type="application/json" id="kynari-media">{…}</script>
 *    con la forma { v:1, trailer:{yt,kind,title,source}, loop:{mp4,poster},
 *                   nara:{mp4,poster,duration,title,yt}, sources:[…] }.
 *  · En el cuerpo, el vídeo va como fachada: <div class="ky-video" data-yt="ID">…</div>.
 *    El tema crea el iframe (youtube-nocookie) solo al pulsar.
 */

import crypto from 'node:crypto';

export const GHOST_URL = (process.env.GHOST_URL || 'https://www.kynari.io').replace(/\/$/, '');
const UA = 'KynariBot/2.0 (+https://www.kynari.io; hello@kynari.io)';

// ---------------------------------------------------------------------------
// Ghost Admin API
// ---------------------------------------------------------------------------
export function ghostToken(adminKey = process.env.GHOST_ADMIN_KEY) {
  if (!adminKey || !adminKey.includes(':')) throw new Error('GHOST_ADMIN_KEY missing or malformed');
  const [id, secret] = adminKey.split(':');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'HS256', typ: 'JWT', kid: id })}.${b64({ iat: now, exp: now + 300, aud: '/admin/' })}`;
  const sig = crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(unsigned).digest('base64url');
  return `${unsigned}.${sig}`;
}

export async function ghost(method, path, body, { raw = false } = {}) {
  const res = await fetch(`${GHOST_URL}/ghost/api/admin${path}`, {
    method,
    headers: { Authorization: `Ghost ${ghostToken()}`, 'Accept-Version': 'v5.0', ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined
  });
  if (raw) return res;
  if (!res.ok) throw new Error(`Ghost ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

/** Todos los posts publicados (paginado). `fields` reduce el peso. */
export async function ghostAllPosts({ fields = 'id,title,slug,url,published_at,feature_image,updated_at', include = 'tags', filter = 'status:published' } = {}) {
  const out = [];
  for (let page = 1; ; page++) {
    const q = new URLSearchParams({ limit: '100', page: String(page), fields, include, filter, order: 'published_at desc' });
    const d = await ghost('GET', `/posts/?${q}`);
    out.push(...d.posts);
    if (page >= d.meta.pagination.pages) break;
  }
  return out;
}

export async function uploadToGhost(buffer, baseName, kind = 'image') {
  const fmt = kind === 'image' ? detectImageFormat(buffer) : { ext: 'mp4', mime: 'video/mp4' };
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: fmt.mime }), `${baseName}.${fmt.ext}`);
  if (kind === 'image') form.append('purpose', 'image');
  const d = await ghost('POST', kind === 'image' ? '/images/upload/' : '/media/upload/', form);
  return kind === 'image' ? d.images[0].url : d.media[0].url;
}

// ---------------------------------------------------------------------------
// Imágenes: formato y tamaño reales (para las tarjetas de imagen de Lexical)
// ---------------------------------------------------------------------------
export function detectImageFormat(buffer) {
  const fallback = { ext: 'png', mime: 'image/png' };
  if (!buffer || buffer.length < 12) return fallback;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return { ext: 'gif', mime: 'image/gif' };
  return fallback;
}

/** Ancho y alto de PNG / JPEG / WebP / GIF leyendo la cabecera. null si no se reconoce. */
export function imageSize(b) {
  if (!b || b.length < 30) return null;
  const f = detectImageFormat(b).ext;
  try {
    if (f === 'png') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    if (f === 'gif') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    if (f === 'webp') {
      const chunk = b.toString('ascii', 12, 16);
      if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') { const n = b.readUInt32LE(21); return { width: (n & 0x3fff) + 1, height: ((n >> 14) & 0x3fff) + 1 }; }
      if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    }
    if (f === 'jpg') {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
  } catch { /* cabecera truncada */ }
  return null;
}

export async function download(url, headers = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  if (!r.ok) throw new Error(`download ${r.status} ${url.slice(0, 120)}`);
  return Buffer.from(await r.arrayBuffer());
}

// ---------------------------------------------------------------------------
// TMDB — obra, imágenes y tráiler oficial
// ---------------------------------------------------------------------------
const TMDB = 'https://api.themoviedb.org/3';
const tmdbKey = () => process.env.TMDB_API_KEY;

export async function tmdbFind(title, year, mediaType) {
  if (!tmdbKey() || !title) return null;
  const tries = [];
  if (mediaType === 'movie' || mediaType === 'tv') tries.push(`/search/${mediaType}?query=${encodeURIComponent(title)}${year ? `&${mediaType === 'movie' ? 'year' : 'first_air_date_year'}=${year}` : ''}`);
  tries.push(`/search/multi?query=${encodeURIComponent(title)}${year ? `&year=${year}` : ''}`);
  if (year) tries.push(`/search/multi?query=${encodeURIComponent(title)}`);
  for (const path of tries) {
    const r = await fetch(`${TMDB}${path}&api_key=${tmdbKey()}&language=en-US&page=1`);
    if (!r.ok) continue;
    const res = ((await r.json()).results || [])
      .map((x) => ({ ...x, media_type: x.media_type || mediaType }))
      .filter((x) => x.media_type === 'movie' || x.media_type === 'tv');
    if (!res.length) continue;
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const exact = res.filter((x) => norm(x.title || x.name) === norm(title));
    const pool = exact.length ? exact : res;
    const byYear = year ? pool.find((x) => (x.release_date || x.first_air_date || '').startsWith(String(year))) : null;
    return byYear || pool.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0];
  }
  return null;
}

export async function tmdbImages(item, n = 3) {
  const r = await fetch(`${TMDB}/${item.media_type}/${item.id}/images?api_key=${tmdbKey()}&include_image_language=en,null`);
  if (!r.ok) return null;
  const d = await r.json();
  const best = (arr) => (arr || []).filter((x) => x.file_path).sort((a, b) => (b.vote_average - a.vote_average) || (b.width - a.width)).map((x) => x.file_path);
  // Póster vertical para el hero (tarjetas 3:4); fotogramas horizontales para interiores
  return { hero: best(d.posters)[0] || null, interiors: best(d.backdrops).slice(0, Math.max(0, n - 1)) };
}

/** Mejor vídeo oficial de YouTube: tráiler > teaser > clip; lo más reciente primero. */
export async function tmdbTrailer(item) {
  if (!tmdbKey() || !item) return null;
  const r = await fetch(`${TMDB}/${item.media_type}/${item.id}/videos?api_key=${tmdbKey()}&language=en-US`);
  if (!r.ok) return null;
  const vids = ((await r.json()).results || []).filter((v) => v.site === 'YouTube' && /^[A-Za-z0-9_-]{11}$/.test(v.key));
  const rank = { Trailer: 0, Teaser: 1, Clip: 2, Featurette: 3 };
  const pick = vids
    .filter((v) => v.type in rank)
    .sort((a, b) => (Number(b.official) - Number(a.official)) || (rank[a.type] - rank[b.type]) || String(b.published_at).localeCompare(String(a.published_at)))[0];
  if (!pick) return null;
  return { yt: pick.key, kind: pick.type === 'Teaser' ? 'teaser' : pick.type === 'Trailer' ? 'trailer' : 'clip', title: pick.name, source: 'TMDB', official: !!pick.official };
}

// ---------------------------------------------------------------------------
// IGDB — juego, imágenes y vídeos (Twitch OAuth con token en caché)
// ---------------------------------------------------------------------------
let igdbTokenCache = null;
async function igdbToken() {
  if (igdbTokenCache && igdbTokenCache.exp > Date.now()) return igdbTokenCache.token;
  const { IGDB_CLIENT_ID: id, IGDB_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) return null;
  const r = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`, { method: 'POST' });
  if (!r.ok) throw new Error(`IGDB token ${r.status}`);
  const d = await r.json();
  igdbTokenCache = { token: d.access_token, exp: Date.now() + (d.expires_in - 300) * 1000 };
  return igdbTokenCache.token;
}

export async function igdbFind(title, year) {
  const token = await igdbToken();
  if (!token || !title) return null;
  const r = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: { 'Client-ID': process.env.IGDB_CLIENT_ID, Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    body: `search "${String(title).replace(/"/g, '')}"; fields id,name,first_release_date,cover.image_id,artworks.image_id,screenshots.image_id,videos.video_id,videos.name; limit 10;`
  });
  if (!r.ok) return null;
  const games = await r.json();
  if (!games.length) return null;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const exact = games.filter((g) => norm(g.name) === norm(title));
  const pool = exact.length ? exact : games;
  const byYear = year ? pool.find((g) => g.first_release_date && new Date(g.first_release_date * 1000).getFullYear() === Number(year)) : null;
  return byYear || pool[0];
}

export function igdbImageUrls(game, n = 3) {
  const u = (id) => `https://images.igdb.com/igdb/image/upload/t_1080p/${id}.jpg`;
  const inter = [...(game.artworks || []), ...(game.screenshots || [])].map((x) => x.image_id).filter(Boolean);
  return { hero: game.cover?.image_id ? u(game.cover.image_id) : null, interiors: inter.slice(0, Math.max(0, n - 1)).map(u) };
}

export function igdbTrailer(game) {
  const vids = (game?.videos || []).filter((v) => /^[A-Za-z0-9_-]{11}$/.test(v.video_id || ''));
  if (!vids.length) return null;
  const score = (v) => {
    const n = (v.name || '').toLowerCase();
    return (/launch|release/.test(n) ? 0 : /gameplay/.test(n) ? 1 : /trailer|reveal|announce/.test(n) ? 2 : 3);
  };
  const pick = [...vids].sort((a, b) => score(a) - score(b))[0];
  const kind = /gameplay/i.test(pick.name || '') ? 'gameplay' : 'trailer';
  return { yt: pick.video_id, kind, title: `${game.name} — ${pick.name || 'Trailer'}`, source: 'IGDB', official: true };
}

// ---------------------------------------------------------------------------
// Steam — capturas y tráileres oficiales (HLS) para juegos de PC
// ---------------------------------------------------------------------------
export async function steamFind(title) {
  const r = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=english&cc=US`, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  const items = (await r.json()).items || [];
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const hit = items.find((i) => norm(i.name) === norm(title)) || items.find((i) => norm(i.name).startsWith(norm(title)));
  if (!hit) return null;
  const d = await fetch(`https://store.steampowered.com/api/appdetails?appids=${hit.id}&filters=basic,movies,screenshots`, { headers: { 'User-Agent': UA } }).then((x) => x.json()).catch(() => null);
  const data = d?.[hit.id]?.data;
  if (!data) return null;
  return {
    appid: hit.id, name: data.name || hit.name,
    header: data.header_image || null,
    screenshots: (data.screenshots || []).map((s) => s.path_full).filter(Boolean),
    // El primer «highlight» suele ser el tráiler de lanzamiento. HLS: ffmpeg lo lee directamente.
    movies: (data.movies || []).map((m) => ({ name: m.name, hls: m.hls_h264, thumb: m.thumbnail, highlight: !!m.highlight })).filter((m) => m.hls)
  };
}

// ---------------------------------------------------------------------------
// Wikimedia Commons — fotografías libres (personas, eventos, lugares) para Culture
// ---------------------------------------------------------------------------
// Antes se buscaba texto libre en Commons y salían cosas como el cuadro «Madonna» de Munch para
// un artículo sobre la cantante, o un gráfico de ventas para «Nevermind» (16 oct. 2026). Ahora se usa
// la imagen oficial de la entidad en Wikidata (propiedad P18), que es la foto que lleva su artículo
// de Wikipedia. Si la entidad no tiene imagen, no hay foto: mejor nada que una equivocada.
export async function commonsImage(query) {
  if (!query) return null;
  const file = await wikidataImage(query);
  if (!file) return null;
  const q = new URLSearchParams({
    action: 'query', format: 'json', titles: `File:${file}`,
    prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '1600', origin: '*'
  });
  const r = await fetch(`https://commons.wikimedia.org/w/api.php?${q}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  const pages = Object.values((await r.json()).query?.pages || {});
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii || !/jpeg|png|webp/.test(ii.mime || '') || (ii.width || 0) < 900) continue;
    if (looksFlat(ii)) continue;
    const md = ii.extmetadata || {};
    const lic = (md.LicenseShortName?.value || '').trim();
    if (!/^(CC BY|CC0|Public domain|PD)/i.test(lic)) continue;   // solo licencias reutilizables
    const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const author = strip(md.Artist?.value).slice(0, 80) || 'Wikimedia Commons';
    return { url: ii.thumburl || ii.url, page: ii.descriptionurl, credit: `${author} · ${lic} · Wikimedia Commons`, width: ii.thumbwidth || ii.width, height: ii.thumbheight || ii.height };
  }
  return null;
}

/**
 * Descarta logotipos y gráficos como imagen de un artículo (tema 2.2): el logo de Batman sobre
 * negro o el de Tyla con fondo transparente hacían un agujero en la portada. Sin decodificar la
 * imagen: un PNG casi nunca es una foto, y una foto JPEG pesa bastante más por píxel que un
 * dibujo plano (fondo negro, pocos colores). Umbral: 0,06 bytes por píxel en el original.
 */
export function looksFlat(ii) {
  if (/png|gif|svg/.test(ii.mime || '')) return true;
  const px = (ii.width || 0) * (ii.height || 0);
  return px > 0 && ii.size > 0 && ii.size / px < 0.06;
}

/** Nombre del archivo de la imagen oficial (P18) de la entidad de Wikidata cuyo nombre coincide con la búsqueda. */
export async function wikidataImage(query) {
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const s = await fetch(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbsearchentities', search: query, language: 'en', type: 'item', limit: '5', format: 'json', origin: '*' })}`, { headers: { 'User-Agent': UA } });
  if (!s.ok) return null;
  // Solo entidades cuyo nombre o alias coincide exactamente: «Madonna» no puede acabar en un cuadro
  const hits = ((await s.json()).search || []).filter((h) => norm(h.label) === norm(query) || norm(h.match?.text) === norm(query));
  for (const h of hits.slice(0, 3)) {
    const e = await fetch(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbgetclaims', entity: h.id, property: 'P18', format: 'json', origin: '*' })}`, { headers: { 'User-Agent': UA } });
    if (!e.ok) continue;
    const file = (await e.json()).claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (file) return file;
  }
  return null;
}

// ---------------------------------------------------------------------------
// YouTube — comprobar que un vídeo sigue disponible (oEmbed, sin cuota)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Ficha de la obra (tema 2.2): datos para la tarjeta lateral del artículo
// ---------------------------------------------------------------------------
/**
 * Devuelve { kind, title, year, poster, people[], facts[], watch[], rating, link, source } o null.
 * `work` es el del JSON kynari-media: { type: movie|tv|game, title, year, tmdb?, igdb? }.
 * El póster se sube a Ghost para no depender de TMDB/IGDB al servir la página.
 */
export async function workCard(work, { upload = true } = {}) {
  if (!work || !work.title) return null;
  try {
    if (work.type === 'game') return await igdbCard(work, upload);
    if (work.type === 'movie' || work.type === 'tv') return await tmdbCard(work, upload);
  } catch (e) { console.error(`   workCard: ${e.message}`); }
  return null;
}

async function tmdbCard(work, upload) {
  if (!tmdbKey()) return null;
  let id = work.tmdb, type = work.type;
  if (!id) { const it = await tmdbFind(work.title, work.year, type); if (!it) return null; id = it.id; type = it.media_type || type; }
  const r = await fetch(`${TMDB}/${type}/${id}?api_key=${tmdbKey()}&language=en-US&append_to_response=credits,watch/providers`);
  if (!r.ok) return null;
  const d = await r.json();
  const year = Number((d.release_date || d.first_air_date || '').slice(0, 4)) || work.year || null;
  if (work.year && year && Math.abs(year - Number(work.year)) > 1) return null;   // otra obra con el mismo título
  const crew = d.credits?.crew || [];
  const names = (arr, n = 2) => (arr || []).slice(0, n).map((x) => x.name).filter(Boolean).join(', ');
  const people = [];
  if (type === 'movie') {
    const dir = names(crew.filter((c) => c.job === 'Director'));
    if (dir) people.push({ label: 'Director', value: dir });
  } else {
    const by = names(d.created_by); if (by) people.push({ label: 'Created by', value: by });
  }
  const isAnim = (d.genres || []).some((g) => g.id === 16);
  const studio = names(d.production_companies, isAnim ? 2 : 1);
  if (studio) people.push({ label: isAnim ? 'Studio' : 'Production', value: studio });
  const cast = names(d.credits?.cast, 3); if (cast && !isAnim) people.push({ label: 'Starring', value: cast });
  const facts = [];
  if (type === 'movie' && d.release_date) facts.push({ label: 'Release', value: d.release_date });
  if (type === 'tv' && d.first_air_date) facts.push({ label: 'First aired', value: d.first_air_date });
  if (type === 'movie' && d.runtime) facts.push({ label: 'Runtime', value: `${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m` });
  if (type === 'tv' && d.number_of_seasons) facts.push({ label: 'Seasons', value: String(d.number_of_seasons) });
  if (type === 'tv' && d.networks?.length) facts.push({ label: 'Network', value: names(d.networks, 2) });
  if (d.genres?.length) facts.push({ label: 'Genre', value: d.genres.slice(0, 3).map((g) => g.name).join(', ') });
  // Dónde verla: España primero (la audiencia de Marc), si no EE. UU.
  const prov = d['watch/providers']?.results || {};
  const region = prov.ES?.flatrate?.length ? 'ES' : prov.US?.flatrate?.length ? 'US' : null;
  // Sin duplicados del mismo servicio («Netflix Standard with Ads», «Crunchyroll Amazon Channel»…)
  const watch = [];
  for (const p of region ? prov[region].flatrate : []) {
    const name = String(p.provider_name || '').replace(/\s+(Amazon Channel|Apple TV Channel|Roku Premium Channel|Standard with Ads|with Ads|Basic with Ads|Premium Plus|Premium)$/i, '').trim();
    if (name && !watch.some((w) => w.toLowerCase() === name.toLowerCase()) && watch.length < 4) watch.push(name);
  }
  let poster = d.poster_path ? `https://image.tmdb.org/t/p/w342${d.poster_path}` : null;
  if (poster && upload) { try { poster = await uploadToGhost(await download(poster), `work-${type}-${id}`); } catch { /* se queda la URL de TMDB */ } }
  return {
    kind: type, title: d.title || d.name, year, poster, people, facts, watch, region,
    rating: d.vote_count >= 50 && d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
    link: `https://www.themoviedb.org/${type}/${id}`, source: 'TMDB'
  };
}

async function igdbCard(work, upload) {
  const token = await igdbToken(); if (!token) return null;
  const where = work.igdb ? `where id = ${Number(work.igdb)};` : `search "${String(work.title).replace(/"/g, '')}";`;
  const r = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: { 'Client-ID': process.env.IGDB_CLIENT_ID, Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    body: `${where} fields name,first_release_date,platforms.abbreviation,platforms.name,genres.name,cover.image_id,total_rating,total_rating_count,url,involved_companies.developer,involved_companies.publisher,involved_companies.company.name; limit 5;`
  });
  if (!r.ok) return null;
  const games = await r.json();
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const g = work.igdb ? games[0] : games.find((x) => norm(x.name) === norm(work.title));
  if (!g) return null;
  const year = g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : work.year || null;
  if (work.year && year && Math.abs(year - Number(work.year)) > 1) return null;
  const comp = (flag) => (g.involved_companies || []).filter((c) => c[flag]).map((c) => c.company?.name).filter(Boolean).slice(0, 2).join(', ');
  const people = [];
  if (comp('developer')) people.push({ label: 'Developer', value: comp('developer') });
  if (comp('publisher') && comp('publisher') !== comp('developer')) people.push({ label: 'Publisher', value: comp('publisher') });
  const facts = [];
  if (g.first_release_date) facts.push({ label: 'Release', value: new Date(g.first_release_date * 1000).toISOString().slice(0, 10) });
  if (g.platforms?.length) facts.push({ label: 'Platforms', value: g.platforms.slice(0, 6).map((p) => p.abbreviation || p.name).join(', ') });
  if (g.genres?.length) facts.push({ label: 'Genre', value: g.genres.slice(0, 3).map((x) => x.name).join(', ') });
  let poster = g.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg` : null;
  if (poster && upload) { try { poster = await uploadToGhost(await download(poster), `work-game-${g.id}`); } catch { /* URL de IGDB */ } }
  return {
    kind: 'game', title: g.name, year, poster, people, facts, watch: [], region: null,
    rating: g.total_rating_count >= 5 && g.total_rating ? Math.round(g.total_rating) / 10 : null,
    link: g.url || null, source: 'IGDB'
  };
}

export async function youtubeAlive(id) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) return false;
  const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, { headers: { 'User-Agent': UA } });
  if (r.status === 429 || r.status >= 500) return true;   // en duda, no se quita
  return r.ok;
}

// ---------------------------------------------------------------------------
// Enlaces: ¿responde la URL?
// ---------------------------------------------------------------------------
export async function urlAlive(url, timeoutMs = 12000) {
  try {
    const ctl = AbortSignal.timeout(timeoutMs);
    let r = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': UA }, signal: ctl });
    if (r.status === 405 || r.status === 403 || r.status === 400) r = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
    // 401/403/429 de webs con protección antibots: el enlace existe aunque no nos deje pasar
    return r.ok || [401, 403, 429].includes(r.status);
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// HTML del vídeo (fachada) y bloque JSON de medios
// ---------------------------------------------------------------------------
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function videoFacadeHTML({ yt, kind = 'trailer', title = '', source = '' }) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(yt || '')) throw new Error(`bad YouTube id: ${yt}`);
  const label = { trailer: 'Official trailer', teaser: 'Official teaser', pv: 'Official PV', gameplay: 'Gameplay', clip: 'Official clip' }[kind] || 'Video';
  return `<div class="ky-video" id="watch" data-yt="${yt}" data-kind="${escHtml(kind)}" data-title="${escHtml(title)}">` +
    `<img src="https://i.ytimg.com/vi/${yt}/hqdefault.jpg" alt="${escHtml(title || label)}" loading="lazy" decoding="async">` +
    `<span class="ky-video__badge">${label}</span><span class="nara-card__play" aria-hidden="true"></span>` +
    `<div class="ky-video__cap"><div><div class="t">${escHtml(title || label)}</div><div class="s">${escHtml(source ? `${source} · ` : '')}YouTube · loads on click</div></div></div>` +
    `<noscript><a href="https://www.youtube.com/watch?v=${yt}">Watch on YouTube</a></noscript></div>`;
}

const MEDIA_RE = /<script[^>]*id=["']kynari-media["'][^>]*>([\s\S]*?)<\/script>\s*/i;

export function parseMediaJson(codeinjectionHead) {
  const m = MEDIA_RE.exec(codeinjectionHead || '');
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** Fusiona `patch` con el JSON que ya tenga el post y devuelve el codeinjection_head completo. */
export function withMediaJson(codeinjectionHead, patch) {
  const prev = parseMediaJson(codeinjectionHead) || { v: 1 };
  const next = { ...prev, ...patch, v: 1 };
  for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
  // «<» escapado para que el JSON no pueda cerrar el <script>
  const block = `<script type="application/json" id="kynari-media">${JSON.stringify(next).replace(/</g, '\\u003c')}</script>\n`;
  const rest = String(codeinjectionHead || '').replace(MEDIA_RE, '');
  return block + rest;
}

// ---------------------------------------------------------------------------
// Lexical: tarjetas HTML e imagen (las de imagen generan srcset en Ghost)
// ---------------------------------------------------------------------------
export const htmlCard = (html) => ({ type: 'html', version: 1, html });
export const imageCard = ({ src, width, height, alt = '', caption = '' }) => ({
  type: 'image', version: 1, src, width: width || null, height: height || null, title: '', alt, caption, cardWidth: 'regular', href: ''
});
export const lexicalDoc = (children) => JSON.stringify({ root: { children, direction: null, format: '', indent: 0, type: 'root', version: 1 } });

/** Añade (o sustituye) la fachada de vídeo tras el primer bloque de un lexical existente. */
export function lexicalWithVideo(lexicalStr, facadeHtml) {
  const doc = JSON.parse(lexicalStr);
  const kids = doc.root.children;
  // Quita fachadas o iframes de YouTube previos en tarjetas HTML propias
  for (let i = kids.length - 1; i >= 0; i--) {
    const k = kids[i];
    if (k.type === 'html' && /class="ky-video"|youtube(-nocookie)?\.com\/embed\//.test(k.html || '') && (k.html || '').length < 2500) kids.splice(i, 1);
    else if (k.type === 'embed' && /youtube/.test(k.url || '')) kids.splice(i, 1);
  }
  // Si el cuerpo es una sola tarjeta HTML (artículos del publisher), se parte tras el primer bloque
  if (kids.length === 1 && kids[0].type === 'html') {
    const html = kids[0].html;
    const m = html.match(/<\/(?:p|h2|h3|blockquote)>/i);
    if (m) {
      const cut = m.index + m[0].length;
      kids.splice(0, 1, htmlCard(html.slice(0, cut)), htmlCard(facadeHtml), htmlCard(html.slice(cut)));
      return JSON.stringify(doc);
    }
  }
  const firstText = kids.findIndex((k) => k.type === 'paragraph' || k.type === 'html' || k.type === 'extended-text');
  kids.splice(firstText >= 0 ? firstText + 1 : 0, 0, htmlCard(facadeHtml));
  return JSON.stringify(doc);
}

/** Etiquetas para Ghost conservando las existentes (por id) y añadiendo nuevas por nombre. */
export function mergeTags(existing, addNames = []) {
  const have = new Set((existing || []).map((t) => (t.name || '').toLowerCase()));
  return [...(existing || []).map((t) => ({ id: t.id })), ...addNames.filter((n) => !have.has(n.toLowerCase())).map((name) => ({ name }))];
}

// ---------------------------------------------------------------------------
// Claude (Messages API) para las herramientas de tools/
// ---------------------------------------------------------------------------
export async function claude(body, model = process.env.KYNARI_MODEL || 'claude-sonnet-4-6') {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, ...body })
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
export const claudeText = (d) => d.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
export const claudeTool = (d, name) => d.content.find((b) => b.type === 'tool_use' && b.name === name)?.input || null;

// ---------------------------------------------------------------------------
// YouTube RSS (sin cuota): últimos 15 vídeos de un canal
// ---------------------------------------------------------------------------
export async function youtubeFeed(channelId) {
  const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`feed ${r.status}`);
  const xml = await r.text();
  const pick = (s, tag) => (s.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)) || [])[1] || '';
  const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    yt: pick(e, 'yt:videoId'), title: unesc(pick(e, 'title')), published: pick(e, 'published'),
    channel: unesc(pick(xml, 'name')), description: unesc(pick(e, 'media:description')).slice(0, 800),
    views: Number((e.match(/<media:statistics views="(\d+)"/) || [])[1] || 0)
  })).filter((x) => /^[A-Za-z0-9_-]{11}$/.test(x.yt));
}
