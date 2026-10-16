#!/usr/bin/env node
/**
 * Limpieza semanal de vídeo (v2, 16 oct. 2026)
 *
 * Recorre los posts con #video y comprueba con oEmbed (sin cuota) que el vídeo de
 * YouTube sigue disponible y que los MP4 propios (bucle, Nara) responden.
 * Si un tráiler ha desaparecido: quita la fachada del cuerpo, las etiquetas
 * #video/#trailer/#gameplay y el dato del JSON. Si falla un MP4, quita ese dato
 * (y #loop o #nara). Deja un informe y nunca toca el texto del artículo.
 *
 *   node tools/kynari-video-sweeper.mjs [--dry-run]
 */
import { ghost, ghostAllPosts, youtubeAlive, urlAlive, parseMediaJson, withMediaJson } from '../pipeline/kynari-media.mjs';

const DRY = process.argv.includes('--dry-run');
const VIDEO_TAGS = new Set(['hash-video', 'hash-trailer', 'hash-gameplay']);

function stripFacade(lexicalStr, yt) {
  const doc = JSON.parse(lexicalStr);
  const before = doc.root.children.length;
  doc.root.children = doc.root.children.filter((k) => !(k.type === 'html' && (k.html || '').includes(`data-yt="${yt}"`) && (k.html || '').length < 3000));
  return { lexical: JSON.stringify(doc), removed: before - doc.root.children.length };
}

async function main() {
  const posts = await ghostAllPosts({ fields: 'id,slug,codeinjection_head', include: 'tags', filter: 'status:published+tag:hash-video' });
  const extra = await ghostAllPosts({ fields: 'id,slug,codeinjection_head', include: 'tags', filter: 'status:published+tag:[hash-nara,hash-loop]' });
  const all = [...new Map([...posts, ...extra].map((p) => [p.id, p])).values()];
  console.log(`${all.length} posts with video data`);
  let fixed = 0;
  for (const p of all) {
    const m = parseMediaJson(p.codeinjection_head) || {};
    const patch = {}; const dropTags = new Set(); let lexical = null;
    if (m.trailer?.yt && !(await youtubeAlive(m.trailer.yt))) {
      const full = (await ghost('GET', `/posts/${p.id}/?formats=lexical`)).posts[0];
      const r = stripFacade(full.lexical, m.trailer.yt);
      lexical = r.lexical; patch.trailer = null; VIDEO_TAGS.forEach((t) => dropTags.add(t));
      console.log(`  ✗ trailer gone: ${m.trailer.yt} — ${p.slug} (facades removed: ${r.removed})`);
    }
    if (m.loop?.mp4 && !(await urlAlive(m.loop.mp4))) { patch.loop = null; dropTags.add('hash-loop'); console.log(`  ✗ loop gone — ${p.slug}`); }
    if (m.nara?.mp4 && !(await urlAlive(m.nara.mp4)) && !m.nara.yt) { patch.nara = null; dropTags.add('hash-nara'); console.log(`  ✗ Nara video gone — ${p.slug}`); }
    if (!Object.keys(patch).length) continue;
    // Si queda otro vídeo (Nara o bucle), se mantiene #video
    const stillVideo = (m.nara && patch.nara !== null) || (m.loop && patch.loop !== null);
    if (stillVideo) dropTags.delete('hash-video');
    if (DRY) { fixed++; continue; }
    const cur = (await ghost('GET', `/posts/${p.id}/?include=tags`)).posts[0];
    await ghost('PUT', `/posts/${p.id}/`, {
      posts: [{
        updated_at: cur.updated_at,
        ...(lexical ? { lexical } : {}),
        codeinjection_head: withMediaJson(cur.codeinjection_head, patch),
        tags: cur.tags.filter((t) => !dropTags.has(t.slug)).map((t) => ({ id: t.id }))
      }]
    });
    fixed++;
  }
  console.log(`\n${fixed} posts ${DRY ? 'would be' : ''} cleaned.`);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
