#!/usr/bin/env node
/**
 * Precalienta las imágenes redimensionadas de Ghost (16 oct. 2026).
 *
 * Ghost genera cada tamaño/formato (p. ej. /size/w1600/format/avif/…) la primera vez que alguien
 * lo pide, y eso tarda ~6 s. Este script abre la portada y los artículos publicados en las
 * últimas --hours horas y pide todas sus variantes, para que el primer lector no espere.
 *
 *   node tools/warm_images.mjs [--hours 26] [--max 30]
 * Sin claves: usa solo páginas públicas y el sitemap.
 */
const SITE = (process.env.GHOST_URL || 'https://www.kynari.io').replace(/\/$/, '');
const hours = Number((process.argv[process.argv.indexOf('--hours') + 1]) || 26);
const since = Date.now() - hours * 3600e3;
const MAX = Number((process.argv[process.argv.indexOf('--max') + 1]) || 30);

const get = async (u) => { try { const r = await fetch(u, { headers: { 'User-Agent': 'KynariWarm/1.0' }, signal: AbortSignal.timeout(30000) }); return r.ok ? r.text() : ''; } catch { return ''; } };

async function recentPostUrls() {
  const xml = await get(`${SITE}/sitemap-posts.xml`);
  const out = [];
  for (const m of xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) {
    if (Date.parse(m[2]) >= since) out.push([m[1], Date.parse(m[2])]);
  }
  return out.sort((a, b) => b[1] - a[1]).slice(0, MAX).map((x) => x[0]);
}

const pages = [`${SITE}/`, `${SITE}/watch/`, ...(await recentPostUrls())];
const imgs = new Set();
for (const p of pages) {
  const html = await get(p);
  for (const m of html.matchAll(/(?:https?:\/\/[^"'\s,]*)?\/content\/images\/size\/w\d+\/[^"'\s,)]+/g)) {
    imgs.add(m[0].startsWith('http') ? m[0] : SITE + m[0]);
  }
}
let ok = 0, slow = 0;
const list = [...imgs];
for (let i = 0; i < list.length; i += 6) {
  await Promise.all(list.slice(i, i + 6).map(async (u) => {
    const t = Date.now();
    try { const r = await fetch(u, { signal: AbortSignal.timeout(60000) }); await r.arrayBuffer(); if (r.ok) ok++; if (Date.now() - t > 2000) slow++; } catch {}
  }));
}
console.log(`${pages.length} páginas, ${list.length} variantes de imagen: ${ok} listas (${slow} se generaron ahora).`);
