// ============ KYNARI JS ============

// Scroll reveal
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry, i) => {
    if (entry.isIntersecting) {
      setTimeout(() => {
        entry.target.classList.add('visible');
      }, i * 80);
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

// Navbar scroll effect
const nav = document.querySelector('.nav');
if (nav) {
  window.addEventListener('scroll', () => {
    nav.style.borderBottomColor = window.scrollY > 60
      ? 'rgba(184,152,106,0.2)'
      : 'rgba(184,152,106,0.12)';
  }, { passive: true });
}

// Smooth anchor scroll
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// ============ CAROUSEL ============
const track = document.getElementById('carouselTrack');
if (track) {
  const cardWidth = 316;
  let scrollInterval = null;

  function startScroll(direction) {
    stopScroll();
    scrollInterval = setInterval(() => {
      track.scrollLeft += direction * 4;
    }, 16);
  }

  function stopScroll() {
    if (scrollInterval) {
      clearInterval(scrollInterval);
      scrollInterval = null;
    }
  }

  // Hover to scroll (desktop/mouse only - touch devices fire mouseenter without a matching mouseleave, which used to leave the auto-scroll running forever and blocking the tap-to-jump)
    const prevBtn = document.querySelector('.carousel-btn--prev');
    const nextBtn = document.querySelector('.carousel-btn--next');
    const supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    if (supportsHover) {
          prevBtn?.addEventListener('mouseenter', () => startScroll(-1));
          prevBtn?.addEventListener('mouseleave', stopScroll);
          nextBtn?.addEventListener('mouseenter', () => startScroll(1));
          nextBtn?.addEventListener('mouseleave', stopScroll);
    }

    // Safety net: always cancel any auto-scroll interval on touch end/cancel
    prevBtn?.addEventListener('touchend', stopScroll);
    prevBtn?.addEventListener('touchcancel', stopScroll);
    nextBtn?.addEventListener('touchend', stopScroll);
    nextBtn?.addEventListener('touchcancel', stopScroll);

    // Click/tap to jump
    prevBtn?.addEventListener('click', () => { stopScroll(); track.scrollBy({ left: -cardWidth * 2, behavior: 'smooth' }); });
    nextBtn?.addEventListener('click', () => { stopScroll(); track.scrollBy({ left: cardWidth * 2, behavior: 'smooth' }); });
    
  // Drag to scroll
  let isDown = false, startX, scrollLeft;

  track.addEventListener('mousedown', e => {
    isDown = true;
    track.style.cursor = 'grabbing';
    startX = e.pageX - track.offsetLeft;
    scrollLeft = track.scrollLeft;
  });

  track.addEventListener('mouseleave', () => { isDown = false; track.style.cursor = 'grab'; });
  track.addEventListener('mouseup', () => { isDown = false; track.style.cursor = 'grab'; });
  track.addEventListener('mousemove', e => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - track.offsetLeft;
    track.scrollLeft = scrollLeft - (x - startX) * 1.5;
  });

  // Re-align the carousel to a card boundary after zoom/resize (zooming fires
  // a resize event; since the track is relative width but cards are fixed
  // pixels, the browser can clamp scrollLeft on zoom-out, which looked like
  // the carousel jumping left).
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const index = Math.round(track.scrollLeft / cardWidth);
      track.scrollTo({ left: index * cardWidth, behavior: 'auto' });
    }, 150);
  });
}


// ============ MOBILE MENU ============
const hamburger = document.getElementById('navHamburger');
const mobileMenu = document.getElementById('mobileMenu');

function closeMobileMenu() {
  mobileMenu.classList.remove('open');
  hamburger.classList.remove('active');
  hamburger.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}

function openMobileMenu() {
  mobileMenu.classList.add('open');
  hamburger.classList.add('active');
  hamburger.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
}

if (hamburger && mobileMenu) {
  hamburger.addEventListener('click', () => {
    if (mobileMenu.classList.contains('open')) {closeMobileMenu();} else {openMobileMenu();}
  });

  mobileMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', closeMobileMenu);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && mobileMenu.classList.contains('open')) closeMobileMenu();
  });
}

// ============ SHARE (v1.1) ============
document.querySelectorAll('[data-share-copy]').forEach(btn => {
  btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(btn.dataset.shareCopy); const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => btn.textContent = o, 1800); } catch (e) {}
  });
});
document.querySelectorAll('[data-share-native]').forEach(btn => {
  if (navigator.share) {
    btn.hidden = false;
    btn.addEventListener('click', () => navigator.share({ title: btn.dataset.title, url: btn.dataset.url }).catch(() => {}));
  }
});
