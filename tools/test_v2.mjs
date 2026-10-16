// Pruebas del publisher v16 y de pipeline/kynari-media.mjs (sin red ni claves).
// Uso: node tools/test_v2.mjs [carpeta-con-imagenes-de-prueba]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyTagHygiene, cleanTitle, buildBody, verifyLinks, extractYoutubeId } from '../pipeline/kynari-publisher.mjs';
import { videoFacadeHTML, withMediaJson, parseMediaJson, lexicalWithVideo, imageSize, mergeTags, htmlCard, lexicalDoc } from '../pipeline/kynari-media.mjs';

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`ok - ${name}`); };

await t('tags: public allowlist, internal with #, video tags stay internal', () => {
  const out = applyTagHygiene(['Games', 'Konami', 'featured', '#video', '#trailer', 'Signal', 'games']);
  assert.deepEqual(out, ['Games', '#Konami', 'featured', '#video', '#trailer', 'Signal']);
});

await t('title: markdown removed', () => {
  assert.equal(cleanTitle('*Street Fighter* Opens   Today'), 'Street Fighter Opens Today');
  assert.equal(cleanTitle('__Dune__ #2'), 'Dune 2');
});

await t('youtube id extraction', () => {
  assert.equal(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYoutubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYoutubeId('nope'), null);
});

await t('facade html: valid id only, escapes title', () => {
  const h = videoFacadeHTML({ yt: 'dQw4w9WgXcQ', kind: 'trailer', title: 'A "B" <C>', source: 'TMDB' });
  assert.match(h, /class="ky-video"/);
  assert.match(h, /data-yt="dQw4w9WgXcQ"/);
  assert.ok(!h.includes('<C>'));
  assert.ok(!h.includes('<iframe'), 'no iframe until click');
  assert.throws(() => videoFacadeHTML({ yt: 'bad"id' }));
});

await t('media json: round trip, merge and </script> safety', () => {
  const head1 = withMediaJson('<meta name="x">', { trailer: { yt: 'dQw4w9WgXcQ', kind: 'trailer' } });
  assert.match(head1, /^<script type="application\/json" id="kynari-media">/);
  assert.match(head1, /<meta name="x">/);
  const head2 = withMediaJson(head1, { nara: { mp4: 'https://x/y.mp4', title: '</script><b>' } });
  assert.equal((head2.match(/id="kynari-media"/g) || []).length, 1, 'only one block');
  assert.ok(!head2.includes('</script><b>'));
  const m = parseMediaJson(head2);
  assert.equal(m.trailer.yt, 'dQw4w9WgXcQ');
  assert.equal(m.nara.title, '</script><b>');
  const head3 = withMediaJson(head2, { nara: null });
  assert.equal(parseMediaJson(head3).nara, undefined);
});

await t('buildBody: video after first block, two image cards, all text kept', () => {
  const body = Array.from({ length: 9 }, (_, i) => `<p>P${i}</p>`).join('');
  const lex = JSON.parse(buildBody(body, { facade: '<div class="ky-video"></div>', interiors: [{ src: 'a.jpg', width: 10, height: 5, alt: 'a', caption: 'c' }, { src: 'b.jpg', alt: 'b' }] }));
  const kids = lex.root.children;
  assert.equal(kids[0].type, 'html'); assert.equal(kids[0].html, '<p>P0</p>');
  assert.match(kids[1].html, /ky-video/);
  assert.equal(kids.filter((k) => k.type === 'image').length, 2);
  const allText = kids.filter((k) => k.type === 'html').map((k) => k.html).join('');
  for (let i = 0; i < 9; i++) assert.ok(allText.includes(`<p>P${i}</p>`));
  assert.equal(kids.find((k) => k.type === 'image').alt, 'a');
});

await t('lexicalWithVideo: splits single html card, replaces old iframe', () => {
  const old = lexicalDoc([htmlCard('<p>One</p><p>Two</p>'), htmlCard('<div style="x"><iframe src="https://www.youtube-nocookie.com/embed/AAAAAAAAAAA"></iframe></div>')]);
  const out = JSON.parse(lexicalWithVideo(old, '<div class="ky-video" data-yt="dQw4w9WgXcQ"></div>')).root.children;
  assert.equal(out.filter((k) => /embed\/AAAA/.test(k.html || '')).length, 0, 'old iframe removed');
  assert.equal(out.filter((k) => /ky-video/.test(k.html || '')).length, 1);
  const single = JSON.parse(lexicalWithVideo(lexicalDoc([htmlCard('<p>One</p><p>Two</p>')]), '<div class="ky-video"></div>')).root.children;
  assert.deepEqual(single.map((k) => k.html), ['<p>One</p>', '<div class="ky-video"></div>', '<p>Two</p>']);
});

await t('mergeTags keeps ids and adds new names once', () => {
  assert.deepEqual(mergeTags([{ id: '1', name: 'Games' }, { id: '2', name: '#video' }], ['#video', '#trailer']), [{ id: '1' }, { id: '2' }, { name: '#trailer' }]);
});

await t('verifyLinks: dead links unwrapped, externals open in new tab', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: !String(url).includes('dead'), status: String(url).includes('dead') ? 404 : 200 });
  try {
    const r = await verifyLinks('<p><a href="https://good.com/a">good</a> and <a href="https://dead.com/x">dead</a> and <a href="https://www.kynari.io/y/">in</a></p>');
    assert.equal(r.dead.length, 1);
    assert.ok(r.html.includes('dead</') === false || !r.html.includes('dead.com'));
    assert.match(r.html, /href="https:\/\/good.com\/a" target="_blank" rel="noopener"/);
    assert.ok(!/kynari\.io\/y\/" target/.test(r.html), 'internal links stay in the same tab');
    assert.equal(r.external, 1); assert.equal(r.internal, 1);
  } finally { globalThis.fetch = realFetch; }
});

const dir = process.argv[2];
if (dir && fs.existsSync(dir)) {
  await t('imageSize reads jpeg/webp/png headers', () => {
    for (const f of fs.readdirSync(dir).filter((x) => /\.(jpe?g|webp|png)$/i.test(x)).slice(0, 6)) {
      const s = imageSize(fs.readFileSync(path.join(dir, f)));
      assert.ok(s && s.width > 0 && s.height > 0, `${f}: ${JSON.stringify(s)}`);
      console.log(`   ${f}: ${s.width}x${s.height}`);
    }
  });
}
console.log(`\n${n} tests passed`);
