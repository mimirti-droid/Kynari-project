#!/usr/bin/env node
/**
 * Bucle del hero (v2, 16 oct. 2026)
 *
 * Para el artículo destacado más reciente que sea de un juego, recorta 5 s del
 * tráiler oficial de Steam (HLS) con ffmpeg: sin audio, 1280 px, ≤ 2,5 MB.
 * Lo sube a Ghost (media), lo guarda en el JSON kynari-media (loop.mp4) y añade #loop.
 * El tema lo reproduce mudo y en bucle solo en escritorio, con conexión rápida y si
 * el lector no ha pedido menos movimiento.
 *
 * Solo Steam: es el único origen que publica el vídeo oficial como archivo. Los
 * tráileres de YouTube no se descargan (condiciones de YouTube); para esos el hero
 * usa la imagen y el botón «Watch the trailer».
 *
 *   node tools/kynari-hero-loop.mjs [--post <id>] [--start 18] [--dry-run]
 * Requiere ffmpeg en el PATH.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ghost, steamFind, uploadToGhost, parseMediaJson, withMediaJson, mergeTags } from '../pipeline/kynari-media.mjs';

const args = process.argv.slice(2);
const arg = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry-run');

async function pickPost() {
  if (arg('--post')) return (await ghost('GET', `/posts/${arg('--post')}/?include=tags`)).posts[0];
  const d = await ghost('GET', `/posts/?limit=5&include=tags&filter=${encodeURIComponent('status:published+tag:featured')}&order=published_at%20desc`);
  return d.posts[0];
}

/**
 * Steam sirve el tráiler como HLS con segmentos fMP4 de 3 s. ffmpeg no lee bien la
 * lista maestra (sin el token de cada segmento), así que se baja la variante de 720p,
 * el segmento de inicio y solo los segmentos que cubren [start, start+5] y se recorta.
 */
async function fetchSegments(hls, start) {
  const base = hls.slice(0, hls.lastIndexOf('/') + 1);
  const q = hls.includes('?') ? hls.slice(hls.indexOf('?')) : '';
  const master = await (await fetch(hls)).text();
  const variants = master.split('\n').filter((l) => l && !l.startsWith('#'));
  const variant = variants[1] || variants[0];
  const pl = await (await fetch(base + variant + q)).text();
  const init = (pl.match(/#EXT-X-MAP:URI="([^"]+)"/) || [])[1];
  const segs = []; let t = 0; let dur = 0;
  for (const line of pl.split('\n')) {
    if (line.startsWith('#EXTINF:')) dur = parseFloat(line.slice(8));
    else if (line && !line.startsWith('#')) { if (t + dur > start && t < start + 6) segs.push({ uri: line, t }); t += dur; }
  }
  if (!init || !segs.length) throw new Error('could not read the HLS playlist');
  const bufs = [Buffer.from(await (await fetch(base + init + q)).arrayBuffer())];
  for (const s of segs) bufs.push(Buffer.from(await (await fetch(base + s.uri + q)).arrayBuffer()));
  return { file: Buffer.concat(bufs), offset: start - segs[0].t };
}

function encode(input, offset, out, crf) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(offset), '-i', input, '-t', '5', '-an',
    '-vf', 'scale=1280:-2:flags=lanczos,fps=24', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: 'inherit', timeout: 180000 });
  return fs.statSync(out).size;
}

async function main() {
  const p = await pickPost();
  if (!p) { console.log('No featured post.'); return; }
  const m = parseMediaJson(p.codeinjection_head) || {};
  console.log(`Hero: ${p.title}`);
  if (m.loop?.mp4) { console.log('Already has a loop.'); return; }
  const isGame = (p.tags || []).some((t) => t.slug === 'games') || m.work?.type === 'game';
  if (!isGame) { console.log('Not a game article: hero keeps the still image.'); return; }
  const title = m.work?.title || m.trailer?.title?.split(' — ')[0];
  if (!title) { console.log('No work title in kynari-media; skip.'); return; }
  const s = await steamFind(title);
  const movie = s?.movies.find((x) => x.highlight) || s?.movies[0];
  if (!movie) { console.log(`No Steam trailer for "${title}".`); return; }
  console.log(`Steam: ${s.name} — ${movie.name}`);
  if (DRY) return;

  const out = path.join(os.tmpdir(), `loop-${p.id}.mp4`);
  const src = path.join(os.tmpdir(), `loop-src-${p.id}.mp4`);
  const { file, offset } = await fetchSegments(movie.hls, Number(arg('--start', 18)));
  fs.writeFileSync(src, file);
  let size = encode(src, offset, out, 26);
  if (size > 2.5e6) size = encode(src, offset, out, 31);
  console.log(`Loop: ${(size / 1e6).toFixed(2)} MB`);
  const url = await uploadToGhost(fs.readFileSync(out), `loop-${p.slug.slice(0, 40)}`, 'video');
  const cur = (await ghost('GET', `/posts/${p.id}/?include=tags`)).posts[0];
  await ghost('PUT', `/posts/${p.id}/`, {
    posts: [{ updated_at: cur.updated_at, codeinjection_head: withMediaJson(cur.codeinjection_head, { loop: { mp4: url, source: `Steam · ${movie.name}` } }), tags: mergeTags(cur.tags, ['#loop']) }]
  });
  console.log(`✓ ${url}`);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
