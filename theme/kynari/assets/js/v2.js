/* ============================================
   KYNARI v2 — vídeo, Nara, motion (16 oct. 2026)
   Lee los datos de vídeo de cada post del bloque
   <script type="application/json" id="kynari-media">
   que el publisher deja en codeinjection_head.
   ============================================ */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  var $ = function (s, c) { return (c || doc).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };
  var reduce = function () { return root.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ytId = function (s) { return /^[A-Za-z0-9_-]{11}$/.test(s || '') ? s : null; };

  /* ---------- Content API (clave pública que ya publica Portal) ---------- */
  var portal = $('script[data-key][data-api]') || $('script[data-key][data-sodo-search]');
  var API = portal ? (portal.getAttribute('data-api') || (portal.getAttribute('data-sodo-search') + 'ghost/api/content/')) : null;
  var KEY = portal ? portal.getAttribute('data-key') : null;

  function parseMedia(html) {
    if (!html) return null;
    var m = /<script[^>]*id=["']kynari-media["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (e) { return null; }
  }
  function fetchMedia(ids) {
    if (!API || !KEY || !ids.length) return Promise.resolve({});
    var url = API + 'posts/?key=' + encodeURIComponent(KEY) + '&limit=all&fields=id,url,title,codeinjection_head&filter=' + encodeURIComponent('id:[' + ids.join(',') + ']');
    return fetch(url).then(function (r) { return r.ok ? r.json() : { posts: [] }; }).then(function (d) {
      var out = {};
      (d.posts || []).forEach(function (p) { out[p.id] = { url: p.url, title: p.title, media: parseMedia(p.codeinjection_head) }; });
      return out;
    }).catch(function () { return {}; });
  }

  /* ---------- Reveal: nunca dejar secciones ocultas ---------- */
  if (!('IntersectionObserver' in window) || navigator.webdriver) root.classList.add('reveal-fallback');
  window.addEventListener('beforeprint', function () { root.classList.add('reveal-fallback'); });

  /* ---------- Botón «Reduce motion» ---------- */
  $$('[data-motion-toggle]').forEach(function (b) {
    var sync = function () { b.setAttribute('aria-pressed', root.classList.contains('reduce-motion') ? 'true' : 'false'); b.textContent = root.classList.contains('reduce-motion') ? 'Motion: reduced' : 'Reduce motion'; };
    sync();
    b.addEventListener('click', function () {
      root.classList.toggle('reduce-motion');
      try { localStorage.setItem('ky-reduce-motion', root.classList.contains('reduce-motion') ? '1' : '0'); } catch (e) {}
      $$('video[data-loop]').forEach(function (v) { if (root.classList.contains('reduce-motion')) { v.pause(); v.classList.remove('on'); } });
      sync();
    });
  });

  /* ---------- Reproductor modal ---------- */
  var modal = $('#vmodal'), lastFocus = null;
  function openModal(opts) {
    if (!modal) return;
    var box = $('.vmodal__box', modal), media = $('.vmodal__media', modal), link = $('.vmodal__link', modal);
    box.classList.toggle('wide', !!opts.wide);
    if (opts.mp4) {
      media.innerHTML = '<video src="' + esc(opts.mp4) + '"' + (opts.poster ? ' poster="' + esc(opts.poster) + '"' : '') + ' controls autoplay playsinline></video>';
    } else if (ytId(opts.yt)) {
      media.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + opts.yt + '?autoplay=1&rel=0&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="' + esc(opts.title || 'Video') + '"></iframe>';
    } else return;
    if (opts.url) { link.href = opts.url; link.hidden = false; link.textContent = opts.linkText || 'Read the article →'; } else link.hidden = true;
    lastFocus = doc.activeElement;
    modal.hidden = false;
    $('.vmodal__close', modal).focus();
  }
  function closeModal() {
    if (!modal || modal.hidden) return;
    $('.vmodal__media', modal).innerHTML = '';
    modal.hidden = true;
    if (lastFocus) lastFocus.focus();
  }
  $$('[data-vmodal-close]').forEach(function (b) { b.addEventListener('click', closeModal); });
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  function naraCardHTML(n, title, cat) {
    return '<div class="nara-card" role="button" tabindex="0">' +
      ((n.card || n.poster) ? '<img src="' + esc(n.card || n.poster) + '" alt="" loading="lazy" decoding="async">' : '') +
      '<div class="nara-card__top">' + (n.duration ? '<span class="badge-dur">' + esc(n.duration) + '</span>' : '') + '</div>' +
      '<span class="nara-card__play" aria-hidden="true"></span>' +
      '<div class="nara-card__body">' + (cat ? '<span class="nara-card__name">' + esc(cat) + '</span>' : '') + '<div class="nara-card__title">' + esc(n.title || title) + '</div></div></div>';
  }
  function bindPlay(el, n, url, title) {
    var go = function (e) { if (e) e.preventDefault(); openModal({ mp4: n.mp4, yt: n.yt, poster: n.poster, url: url, title: n.title || title }); };
    el.addEventListener('click', go);
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') go(e); });
  }

  /* ---------- Portada: hero + Nara's Takes ---------- */
  /* 2.1 — Vista previa muda al pasar el ratón por una tarjeta de Nara (solo ratón, sin reduce-motion).
     El vídeo se crea la primera vez y se reutiliza; solo suena uno a la vez y sin audio. */
  var finePointer = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var previewing = null;
  function previewOnHover(card, n) {
    if (!finePointer) return;
    var v = null, timer = null;
    card.addEventListener('mouseenter', function () {
      if (reduce()) return;
      timer = setTimeout(function () {
        if (!v) { v = doc.createElement('video'); v.className = 'nara-card__preview'; v.muted = true; v.playsInline = true; v.loop = true; v.preload = 'auto'; v.setAttribute('aria-hidden', 'true'); v.src = n.mp4 + '#t=1'; var img = $('img', card); card.insertBefore(v, img ? img.nextSibling : card.firstChild); }
        if (previewing && previewing !== v) previewing.pause();
        previewing = v;
        v.play().then(function () { card.classList.add('is-previewing'); }).catch(function () {});
      }, 180);
    });
    card.addEventListener('mouseleave', function () { clearTimeout(timer); card.classList.remove('is-previewing'); if (v) v.pause(); });
  }

  var hero = $('.hero-v2');
  var naraCards = $$('[data-nara-post]');
  var ids = naraCards.map(function (c) { return c.getAttribute('data-nara-post'); });
  var heroId = hero && /hash-(nara|loop|video)/.test(hero.getAttribute('data-tags') || '') ? hero.getAttribute('data-post-id') : null;
  if (heroId && ids.indexOf(heroId) < 0) ids.push(heroId);
  if (ids.length) {
    fetchMedia(ids).then(function (map) {
      naraCards.forEach(function (card) {
        var p = map[card.getAttribute('data-nara-post')], n = p && p.media && p.media.nara;
        if (!n || (!n.mp4 && !ytId(n.yt))) return;
        // n.card: fotograma sin subtítulos para la tarjeta (2.0.9); n.poster sigue siendo el póster del reproductor
        if (n.card || n.poster) { var img = $('img', card); if (!img) { img = doc.createElement('img'); img.alt = ''; card.insertBefore(img, card.firstChild); } img.src = n.card || n.poster; img.removeAttribute('srcset'); }
        if (n.duration) { var d = $('.badge-dur', card); if (d) { d.textContent = n.duration; d.hidden = false; } }
        if (n.title) { var t = $('.nara-card__title', card); if (t) t.textContent = n.title; }
        bindPlay(card, n, p.url, p.title);
        if (n.mp4) previewOnHover(card, n);
      });
      if (heroId && map[heroId] && map[heroId].media) heroMedia(map[heroId]);
    });
  }
  function heroMedia(p) {
    var m = p.media, n = m.nara, side = $('[data-hero-side]', hero), btn = $('[data-hero-watch]', hero), pill = $('.pill--nara', hero);
    if (n && (n.mp4 || ytId(n.yt))) {
      side.innerHTML = naraCardHTML(n, p.title, 'Nara Vega');
      bindPlay($('.nara-card', side), n, null, p.title);
      btn.hidden = false; $('span', btn).textContent = "Watch Nara's take";
      bindPlay(btn, n, null, p.title);
      if (pill && n.duration) { pill.textContent = "Nara's take · " + n.duration; pill.hidden = false; }
    } else if (m.trailer && ytId(m.trailer.yt)) {
      btn.hidden = false; $('span', btn).textContent = 'Watch the ' + (m.trailer.kind === 'gameplay' ? 'gameplay' : 'trailer');
      btn.addEventListener('click', function () { openModal({ yt: m.trailer.yt, wide: true, title: m.trailer.title }); });
    }
    // Bucle mudo: solo escritorio, conexión rápida y sin «reduce motion»
    var conn = navigator.connection || {};
    var fast = !conn.saveData && !/(^|-)2g|3g/.test(conn.effectiveType || '');
    if (m.loop && m.loop.mp4 && fast && !reduce() && window.matchMedia('(min-width: 901px)').matches) {
      var v = doc.createElement('video');
      v.muted = true; v.loop = true; v.playsInline = true; v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('data-loop', '');
      v.preload = 'auto'; v.src = m.loop.mp4;
      v.addEventListener('canplay', function () { v.play().then(function () { v.classList.add('on'); }).catch(function () {}); }, { once: true });
      $('.hero-v2__media', hero).appendChild(v);
      doc.addEventListener('visibilitychange', function () { if (doc.hidden) v.pause(); else if (!reduce()) v.play().catch(function () {}); });
    }
  }

  /* ---------- Artículo ---------- */
  var art = $('.article-v2');
  if (art) {
    var body = $('.article-body', art);
    var media = parseMedia(($('#kynari-media') || {}).outerHTML || '');
    var ps = $$(':scope > p, :scope > .kg-card, :scope > h2', body);

    // 2.2 — Ficha de la obra: en el lateral; si el lateral no se ve (pantallas estrechas), tras el 2.º párrafo
    var wc = media && media.work && media.work.card, slot = $('[data-workcard]');
    if (wc && slot) {
      var row = function (r) { return '<div class="workcard__row"><dt>' + esc(r.label) + '</dt><dd>' + esc(r.value) + '</dd></div>'; };
      var html = (wc.poster ? '<img class="workcard__poster" src="' + esc(wc.poster) + '" alt="' + esc(wc.title) + '" loading="lazy" decoding="async">' : '') +
        '<div class="workcard__body"><span class="workcard__kind">' + esc({ movie: 'Film', tv: 'Series', game: 'Game' }[wc.kind] || '') + '</span>' +
        '<h4 class="workcard__title">' + esc(wc.title) + (wc.year ? ' <span>(' + esc(wc.year) + ')</span>' : '') + '</h4>' +
        '<dl>' + (wc.people || []).concat(wc.facts || []).map(row).join('') +
        (wc.watch && wc.watch.length ? '<div class="workcard__row"><dt>Watch' + (wc.region ? ' (' + esc(wc.region) + ')' : '') + '</dt><dd>' + esc(wc.watch.join(', ')) + '</dd></div>' : '') +
        (wc.rating ? '<div class="workcard__row"><dt>Rating</dt><dd>' + esc(wc.rating) + ' / 10</dd></div>' : '') + '</dl>' +
        '<div class="workcard__src">' + (wc.link ? '<a href="' + esc(wc.link) + '" target="_blank" rel="noopener">Data: ' + esc(wc.source) + '</a>' : 'Data: ' + esc(wc.source)) +
        (wc.source === 'TMDB' ? ' · not endorsed by TMDB' : '') + '</div></div>';
      slot.innerHTML = html; slot.hidden = false;
      var asideEl = slot.parentElement;
      if (asideEl && getComputedStyle(asideEl).display === 'none') {
        var paras = $$(':scope > p', body);
        var at = paras[1] || paras[0];
        if (at) { slot.classList.add('workcard--inline'); at.parentNode.insertBefore(slot, at.nextSibling); }
      }
    }

    // Fachadas de vídeo: el iframe solo se crea al pulsar
    $$('.ky-video[data-yt]', body).forEach(function (f) {
      var start = function () {
        if (f.classList.contains('playing')) return;
        var id = f.getAttribute('data-yt'); if (!ytId(id)) return;
        var ifr = doc.createElement('iframe');
        ifr.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1';
        ifr.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; ifr.allowFullscreen = true; ifr.title = f.getAttribute('data-title') || 'Video';
        f.appendChild(ifr); f.classList.add('playing');
      };
      f.setAttribute('role', 'button'); f.setAttribute('tabindex', '0');
      f.addEventListener('click', start);
      f.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); } });
    });
    var firstVideo = $('.ky-video, iframe[src*="youtube"], .kg-embed-card', body);
    if (firstVideo) {
      var anchor = firstVideo.closest('.ky-video, .kg-embed-card, div') || firstVideo;
      if (!$('#watch')) anchor.id = 'watch';
      $$('.meta-watch', art).forEach(function (el) { el.hidden = false; });
    }

    // Nara: columna lateral, bloque en el texto y barra fija en móvil
    var n = media && media.nara;
    if (n && (n.mp4 || ytId(n.yt))) {
      var title = ($('.article-header__title', art) || {}).textContent || '';
      var aside = $('[data-nara-aside]', art);
      if (aside) {
        aside.innerHTML = '<span class="aside__label">Nara\'s take' + (n.duration ? ' · ' + esc(n.duration) : '') + '</span>' + naraCardHTML(n, title, 'Nara Vega');
        aside.hidden = false; bindPlay($('.nara-card', aside), n, null, title);
      }
      var block = doc.createElement('div');
      block.className = 'inline-nara'; block.id = 'nara';
      block.innerHTML = naraCardHTML(n, title, '') +
        '<div><span class="aside__label">Nara\'s take' + (n.duration ? ' · ' + esc(n.duration) : '') + '</span><h4>' + esc(n.title || title) + '</h4>' +
        '<p>The sixty-second version of this piece.</p><button type="button" class="btn btn--outline btn--video"><i aria-hidden="true">▶</i> Watch</button></div>';
      var at = ps[Math.max(2, Math.floor(ps.length * 0.4))];
      if (at && at.parentNode === body) body.insertBefore(block, at); else body.appendChild(block);
      bindPlay($('.nara-card', block), n, null, title);
      bindPlay($('.btn', block), n, null, title);
      if (!$('#watch')) block.id = 'watch';
      $$('.meta-watch', art).forEach(function (el) { el.hidden = false; });

      var bar = $('[data-sticky-watch]');
      if (bar && window.matchMedia('(max-width: 600px)').matches) {
        bar.innerHTML = '<div class="av">' + (n.poster ? '<img src="' + esc(n.poster) + '" alt="">' : '') + '</div><div><b>Nara\'s take' + (n.duration ? ' · ' + esc(n.duration) : '') + '</b><span>' + esc(n.title || title) + '</span></div><div class="pl" aria-hidden="true"></div><button class="x" type="button" aria-label="Dismiss">×</button>';
        bar.hidden = false; bar.setAttribute('role', 'button');
        bindPlay(bar, n, null, title);
        $('.x', bar).addEventListener('click', function (e) { e.stopPropagation(); bar.remove(); });
        var shown = false;
        window.addEventListener('scroll', function () {
          var r = body.getBoundingClientRect(), past = -r.top / Math.max(1, r.height);
          var want = past > 0.25 && past < 0.92;
          if (want !== shown) { shown = want; bar.classList.toggle('show', want); }
        }, { passive: true });
      }
    }

    // Newsletter a mitad del texto (solo en artículos largos)
    var tpl = $('#inline-newsletter');
    if (tpl && tpl.content && tpl.content.firstElementChild && ps.length >= 9) {
      var spot = ps[Math.floor(ps.length * 0.65)];
      if (spot && spot.parentNode === body) body.insertBefore(tpl.content.cloneNode(true), spot);
    }

    // Barra de lectura
    var rb = $('.readbar i');
    if (rb) {
      var tick = false;
      var upd = function () {
        var r = body.getBoundingClientRect(), h = r.height - window.innerHeight * 0.6;
        var p = Math.min(1, Math.max(0, -r.top / Math.max(1, h)));
        rb.style.transform = 'scaleX(' + p.toFixed(4) + ')'; tick = false;
      };
      window.addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(upd); } }, { passive: true });
      upd();
    }
  }

  /* ---------- Página de Realm: fotogramas que rotan + filtro por formato ---------- */
  var frames = $$('.realm-hero__frame');
  if (frames.length > 1 && !reduce()) {
    var i = 0; frames[0].classList.add('on');
    setInterval(function () { if (doc.hidden) return; frames[i].classList.remove('on'); i = (i + 1) % frames.length; frames[i].classList.add('on'); }, 7000);
  }
  var grid = $('[data-filter-grid]');
  if (grid) {
    var empty = $('.filter-empty');
    $$('.filter-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        $$('.filter-tab').forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-selected', 'false'); });
        t.classList.add('on'); t.setAttribute('aria-selected', 'true');
        var f = t.getAttribute('data-filter');
        if (f === 'all') grid.removeAttribute('data-filter'); else grid.setAttribute('data-filter', f);
        var visible = $$(':scope > *', grid).filter(function (c) { return c.offsetParent !== null; }).length;
        if (empty) empty.hidden = visible > 0;
      });
    });
  }

  /* 2.2 — En foco: las obras (película, serie, anime, juego) de los últimos artículos, en orden de
     publicación y sin repetir. Cada chip lleva al artículo más reciente sobre esa obra. */
  var trend = $('[data-trend]');
  if (trend && API && KEY) {
    var turl = API + 'posts/?key=' + encodeURIComponent(KEY) + '&limit=30&order=published_at%20desc&fields=url,codeinjection_head&filter=' + encodeURIComponent('tag:-signal');
    fetch(turl).then(function (r) { return r.ok ? r.json() : { posts: [] }; }).then(function (d) {
      var seen = {}, chips = [];
      (d.posts || []).forEach(function (p) {
        var m = parseMedia(p.codeinjection_head), w = m && m.work && (m.work.card ? m.work.card.title : m.work.title);
        if (!w || seen[w.toLowerCase()] || chips.length >= 7) return;
        seen[w.toLowerCase()] = 1; chips.push({ t: w, u: p.url });
      });
      if (chips.length < 3) return;
      var box = $('.trend__chips', trend);
      chips.forEach(function (c) { var a = doc.createElement('a'); a.className = 'trend__chip'; a.href = c.u; a.textContent = c.t; box.appendChild(a); });
      trend.hidden = false;
    }).catch(function () {});
  }

  /* 2.2 — Enter the Realms: una obra emblemática por realm, distinta cada semana (cambia los lunes).
     La lista está en partials/realms-rotation.hbs (copia de tools/realms-rotation.json). */
  var rot = $('#realms-rotation');
  if (rot) {
    var R = {}; try { R = JSON.parse(rot.textContent); } catch (e) {}
    // Semanas desde el lunes 5 ene. 2026 (00:00 Madrid ≈ 23:00 UTC del domingo)
    var week = Math.floor((Date.now() - Date.UTC(2026, 0, 4, 23)) / (7 * 864e5));
    $$('.realm-card[data-realm]').forEach(function (card) {
      var list = R[card.getAttribute('data-realm')] || []; if (!list.length) return;
      var it = list[((week % list.length) + list.length) % list.length];
      var img = $('.realm-card__bg img', card), w = $('.realm-card__work', card);
      if (img && img.getAttribute('src').indexOf(it.img) < 0) {
        img.src = it.img; img.srcset = it.img.replace('/content/images/', '/content/images/size/w300/') + ' 300w, ' + it.img + ' 600w';
      }
      if (img) { img.alt = it.work; img.title = it.work + ' · ' + it.credit; }
      if (w) w.textContent = it.work;
    });
  }

  /* 2.0.9 — Sin repetidos en la portada: un artículo que ya ha salido más arriba no se repite
     en Legacy ni en On Screen. Cada bloque pide más posts de los que enseña y aquí se queda
     con los primeros N que no hayan aparecido antes. */
  if (doc.body.classList.contains('home-template')) {
    var path = function (a) { try { return new URL(a.href, location.href).pathname; } catch (e) { return a.getAttribute('href'); } };
    var seenBefore = function (el) {
      var p = path(el), found = false;
      // Solo cuentan las tarjetas de contenido (no la cinta de titulares ni el menú)
      $$('.hero-v2__title a, a.fcard, a.legacy-card, a.latest__hero-card, a.list-item, a.video-tile, a.video-row').some(function (a) { if (a === el) return true; if (path(a) === p) { found = true; return true; } return false; });
      return found;
    };
    // On Screen: si el vídeo grande ya ha salido, ocupa su sitio el primer vídeo pequeño que no haya salido
    var tile = $('[data-screen-dedupe] .video-tile--big');
    if (tile && seenBefore(tile)) {
      var alt = $$('[data-screen-dedupe] .video-row').filter(function (r) { return !seenBefore(r); })[0];
      if (alt) {
        tile.href = alt.href; tile.setAttribute('data-tags', alt.getAttribute('data-tags') || '');
        var ai = $('img', alt), ti = $('img', tile);
        if (ai && ti) ti.src = ai.src.replace(/\/size\/w\d+\//, '/size/w1000/');
        var at = $('.video-row__title', alt), tt = $('.video-tile__title', tile); if (at && tt) tt.textContent = at.textContent;
        var al = $('.label', alt), tm = $('.video-tile__meta', tile); if (al && tm) tm.textContent = al.firstChild ? al.firstChild.textContent : '';
        alt.remove();
      }
    }
    $$('[data-dedupe]').forEach(function (box) {
      // Primero los que no han salido; si no llegan a N, se completa con repetidos para no dejar huecos
      var max = +box.getAttribute('data-dedupe') || 3, items = $$(':scope > a', box);
      var fresh = items.filter(function (a) { return !seenBefore(a); });
      var keep = fresh.slice(0, max);
      items.forEach(function (a) { if (keep.length < max && keep.indexOf(a) < 0) keep.push(a); });
      items.forEach(function (a) { if (keep.indexOf(a) < 0) a.remove(); });
    });

    // Signal: punto «en directo» si la última entrada tiene menos de 6 horas
    var t = $('.signal-item time[datetime]'), dot = $('.live-dot');
    if (t && dot) { var age = Date.now() - new Date(t.getAttribute('datetime')).getTime(); if (age >= 0 && age < 6 * 3600e3) dot.hidden = false; }

    // Nara's Takes: tira horizontal con flechas en escritorio (antes, 8 vídeos en una rejilla de 6)
    var strip = $('.nara-strip');
    if (strip && strip.children.length > 6) {
      strip.classList.add('nara-strip--scroll');
      var nav = doc.createElement('div'); nav.className = 'strip-nav';
      nav.innerHTML = '<button type="button" class="strip-nav__btn" data-dir="-1" aria-label="Previous">‹</button><button type="button" class="strip-nav__btn" data-dir="1" aria-label="Next">›</button>';
      var head = $('#nara .section-header'); if (head) head.appendChild(nav);
      $$('.strip-nav__btn', nav).forEach(function (b) {
        b.addEventListener('click', function () { strip.scrollBy({ left: +b.getAttribute('data-dir') * strip.clientWidth * 0.84, behavior: reduce() ? 'auto' : 'smooth' }); });
      });
    }
  }
})();
