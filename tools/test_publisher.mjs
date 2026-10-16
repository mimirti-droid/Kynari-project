import { applyTagHygiene, tagSlug, detectImageFormat, PUBLIC_TAG_ALLOWLIST } from '../pipeline/kynari-publisher.mjs';

let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log(`  PASA  ${name}`); }
  else { bad++; console.log(`  FALLA ${name}  ${extra}`); }
};

console.log('1) Lista blanca: 33 (v16 añade signal)');
check('tiene 33 slugs', PUBLIC_TAG_ALLOWLIST.size === 33, PUBLIC_TAG_ALLOWLIST.size);

console.log('\n2) tagSlug coincide con lo que genera Ghost');
const casos = [['Cinema','cinema'],['Marvel Comics','marvel-comics'],['DC Comics','dc-comics'],
  ['Spider-Man','spider-man'],['MCU','mcu'],['Box Office','box-office'],['Pop Culture','pop-culture'],
  ['Christopher Nolan','christopher-nolan'],['The Odyssey','the-odyssey'],['Summer 2026','summer-2026'],
  ['2026','2026'],['Gaming Industry','gaming-industry'],['Kynari Legacy 2','kynari-legacy-2']];
for (const [n, s] of casos) check(`"${n}" -> ${s}`, tagSlug(n) === s, `dio ${tagSlug(n)}`);

console.log('\n3) Las 32 de la lista blanca salen PUBLICAS (sin #)');
const nombres = ['Cinema','Anime','Games','Comic','Culture','Featured','Legacy','Latest',
  'Marvel','Marvel Comics','DC Comics','Spider-Man','MCU','Streaming','Crunchyroll','Nintendo',
  'IMAX','Television','Box Office','Industry','Gaming Industry','Hollywood','Pop Culture',
  'Animation','Adaptation','Horror','Music','Christopher Nolan','The Odyssey','Summer 2026','2026'];
const salida = applyTagHygiene(nombres);
check('ninguna lleva #', salida.every(t => !t.startsWith('#')), salida.filter(t=>t.startsWith('#')).join(', '));

console.log('\n4) Lo de fuera nace INTERNA (con #)');
const fuera = applyTagHygiene(['Cinema','Martin Scorsese','BookTok','Oscars','The Departed']);
check('Cinema sigue publica', fuera[0] === 'Cinema', fuera[0]);
check('las otras 4 llevan #', fuera.slice(1).every(t => t.startsWith('#')), fuera.join(' | '));
check('conserva el nombre tras el #', fuera.includes('#Martin Scorsese'), fuera.join(' | '));

console.log('\n5) Casos sucios');
check('quita vacias', applyTagHygiene(['Cinema','','   ',null,undefined]).length === 1);
check('deduplica por slug', applyTagHygiene(['Cinema','cinema','CINEMA']).length === 1);
check('no duplica el # si ya venia', applyTagHygiene(['#Oscars']).filter(t=>t==='##Oscars').length === 0);
check('# previo + lista blanca -> publica', applyTagHygiene(['#Cinema'])[0] === 'Cinema', applyTagHygiene(['#Cinema'])[0]);
check('acentos', applyTagHygiene(['Amélie'])[0] === '#Amélie', applyTagHygiene(['Amélie'])[0]);
check('array vacio', applyTagHygiene([]).length === 0);
check('undefined no revienta', applyTagHygiene(undefined).length === 0);

console.log('\n6) Siempre queda al menos una publica (la categoria)');
for (const cat of ['Cinema','Anime','Games','Culture','Comic','Legacy']) {
  const r = applyTagHygiene([cat, 'Nombre Propio Cualquiera']);
  check(`${cat} -> publica`, r[0] === cat && !r[0].startsWith('#'), r.join(' | '));
}

console.log('\n7) detectImageFormat por magic bytes');
const png  = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);
const jpg  = Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]), Buffer.alloc(8)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
const gif  = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(6)]);
check('PNG',  detectImageFormat(png).mime  === 'image/png');
check('JPEG', detectImageFormat(jpg).mime  === 'image/jpeg' && detectImageFormat(jpg).ext === 'jpg');
check('WebP', detectImageFormat(webp).mime === 'image/webp');
check('GIF',  detectImageFormat(gif).mime  === 'image/gif');
check('buffer corto -> png por defecto', detectImageFormat(Buffer.alloc(3)).mime === 'image/png');
check('null no revienta', detectImageFormat(null).mime === 'image/png');

console.log(`\n${ok} pasan, ${bad} fallan`);
process.exit(bad ? 1 : 0);
