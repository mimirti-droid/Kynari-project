#!/usr/bin/env node
/**
 * Añade texto alternativo a las imágenes de los artículos que no lo tienen (16 oct. 2026).
 *
 * Origen del texto, por orden: el pie de foto de la misma <figure> (sin la parte de créditos
 * después de « · »), y si no hay, el título del artículo. Solo toca imágenes sin `alt`, dentro
 * de tarjetas HTML del lexical y en tarjetas de imagen con alt vacío.
 *
 *   node tools/fix_img_alt.mjs plan            → recuento y ejemplos, no escribe
 *   node tools/fix_img_alt.mjs apply [--max N] → escribe; guarda alt-backup-*.json antes
 *   node tools/fix_img_alt.mjs restore --in alt-backup-….json
 * Variable: GHOST_ADMIN_KEY.
 */
import fs from 'node:fs/promises';
import { ghost } from '../pipeline/kynari-media.mjs';

const mode = process.argv[2];
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&rsquo;|&lsquo;/g, "'").replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ');
const clean = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function captionAlt(cap) {
  let t = clean(cap);
  // «Descripción · © Estudio · via TMDB» → «Descripción»; si solo hay crédito, no sirve
  const parts = t.split(/\s+·\s+/);
  t = parts[0];
  if (/^(©|\(c\)|via |courtesy|photo:|image:|credit)/i.test(t) || /wikimedia|tmdb|igdb|getty|ai-generated|generated/i.test(t) && parts.length === 1) return '';
  return t.length > 140 ? t.slice(0, 137).replace(/\s+\S*$/, '') + '…' : t;
}

/** Devuelve [html nuevo, nº de imágenes arregladas]. */
function fixHtml(html, title) {
  let n = 0;
  const fixImg = (img, alt) => { n++; return img.replace(/<img\b/i, `<img alt="${attr(alt)}"`); };
  // 1) Imágenes dentro de <figure> con <figcaption>
  html = html.replace(/<figure\b[\s\S]*?<\/figure>/gi, (fig) => {
    const cap = (fig.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i) || [])[1];
    const alt = (cap && captionAlt(cap)) || title;
    return fig.replace(/<img\b(?![^>]*\balt=)[^>]*>/gi, (img) => fixImg(img, alt));
  });
  // 2) Imágenes sueltas
  html = html.replace(/<img\b(?![^>]*\balt=)[^>]*>/gi, (img) => fixImg(img, title));
  return [html, n];
}

function fixLexical(lex, title) {
  const doc = JSON.parse(lex); let n = 0; const samples = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'html' && typeof node.html === 'string') {
      const [h, k] = fixHtml(node.html, title);
      if (k) { node.html = h; n += k; const m = h.match(/<img alt="([^"]*)"/); if (m) samples.push(m[1]); }
    }
    if (node.type === 'image' && !node.alt) { node.alt = clean(node.caption) ? captionAlt(node.caption) || title : title; n++; samples.push(node.alt); }
    (node.children || []).forEach(walk);
  };
  walk(doc.root);
  return [JSON.stringify(doc), n, samples];
}

async function allPosts() {
  const out = []; let page = 1;
  for (;;) {
    const d = await ghost('GET', `/posts/?limit=50&page=${page}&formats=lexical&fields=id,slug,title,lexical,updated_at&filter=status:published`);
    out.push(...d.posts);
    if (!d.meta.pagination.next) return out;
    page++;
  }
}

async function plan() {
  const posts = await allPosts(); let total = 0, touched = 0; const fromTitle = { cap: 0, title: 0 };
  for (const p of posts) {
    if (!p.lexical) continue;
    const [, n, samples] = fixLexical(p.lexical, p.title);
    if (n) { touched++; total += n; samples.forEach((s) => (s === p.title ? fromTitle.title++ : fromTitle.cap++)); if (touched <= 8) console.log(`  ${p.slug}: ${n} → «${samples[0]}»`); }
  }
  console.log(`\n${posts.length} posts; ${touched} con imágenes sin alt; ${total} imágenes. Ejemplos de alt: ${fromTitle.cap} desde pie de foto, ${fromTitle.title} desde el título.`);
}

async function apply() {
  const max = Number(arg('--max', 10000));
  const posts = await allPosts(); const backup = []; let ok = 0, imgs = 0;
  const file = `alt-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  for (const p of posts) {
    if (ok >= max || !p.lexical) continue;
    const [lex, n] = fixLexical(p.lexical, p.title);
    if (!n) continue;
    backup.push({ id: p.id, lexical: p.lexical });
    await fs.writeFile(file, JSON.stringify(backup));
    try {
      const cur = (await ghost('GET', `/posts/${p.id}/?fields=updated_at`)).posts[0];
      await ghost('PUT', `/posts/${p.id}/`, { posts: [{ updated_at: cur.updated_at, lexical: lex }] });
      ok++; imgs += n;
      if (ok % 25 === 0) console.log(`  ${ok} posts…`);
    } catch (e) { console.error(`  ✗ ${p.slug}: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`\nArreglados ${ok} posts (${imgs} imágenes). Copia: ${file}`);
}

async function restore() {
  const items = JSON.parse(await fs.readFile(arg('--in'), 'utf-8'));
  for (const b of items) {
    const cur = (await ghost('GET', `/posts/${b.id}/?fields=updated_at`)).posts[0];
    await ghost('PUT', `/posts/${b.id}/`, { posts: [{ updated_at: cur.updated_at, lexical: b.lexical }] });
  }
  console.log(`Restaurados ${items.length}`);
}

const run = { plan, apply, restore }[mode];
if (!run) { console.error('Uso: fix_img_alt.mjs plan|apply|restore'); process.exit(1); }
run().catch((e) => { console.error(e); process.exit(1); });
