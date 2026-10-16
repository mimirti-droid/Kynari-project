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
      (n.poster ? '<img src="' + esc(n.poster) + '" alt="" loading="lazy" decoding="async">' : '') +
      '<div class="nara-card__top"><span class="vb vb--nara">Nara\'s take</span>' + (n.duration ? '<span class="badge-dur">' + esc(n.duration) + '</span>' : '') + '</div>' +
      '<span class="nara-card__play" aria-hidden="true"></span>' +
      '<div class="nara-card__body">' + (cat ? '<span class="nara-card__name">' + esc(cat) + '</span>' : '') + '<div class="nara-card__title">' + esc(n.title || title) + '</div></div></div>';
  }
  function bindPlay(el, n, url, title) {
    var go = function (e) { if (e) e.preventDefault(); openModal({ mp4: n.mp4, yt: n.yt, poster: n.poster, url: url, title: n.title || title }); };
    el.addEventListener('click', go);
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') go(e); });
  }

  /* ---------- Portada: hero + Nara's Takes ---------- */
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
        if (n.poster) { var img = $('img', card); if (!img) { img = doc.createElement('img'); img.alt = ''; card.insertBefore(img, card.firstChild); } img.src = n.poster; img.removeAttribute('srcset'); }
        if (n.duration) { var d = $('.badge-dur', card); if (d) { d.textContent = n.duration; d.hidden = false; } }
        if (n.title) { var t = $('.nara-card__title', card); if (t) t.textContent = n.title; }
        bindPlay(card, n, p.url, p.title);
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
})();
