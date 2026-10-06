/* AIDUCATION homepage - Direction A "Luminous minimal" */
(function () {
  'use strict';
  var doc = document, win = window, root = doc.documentElement;
  var reduce = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, c) { return (c || doc).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

  /* ---------------- nav ---------------- */
  var nav = $('#nav'), toggle = $('.nav__toggle'), menu = $('#nav-menu');
  function closeMenu() { nav.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-label', '開啟選單'); }
  toggle.addEventListener('click', function () {
    var open = !nav.classList.contains('is-open');
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '關閉選單' : '開啟選單');
  });
  $$('a', menu).forEach(function (a) { a.addEventListener('click', closeMenu); });
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

  var navTargets = ['team', 'platform', 'film', 'village', 'partners', 'contact'].map(function (id) {
    return { el: doc.getElementById(id), link: $('a[href="#' + id + '"]', menu) };
  });

  /* ---------------- reveal ---------------- */
  var revealEls = $$('[data-reveal]');
  if ('IntersectionObserver' in win && !reduce) {
    var rio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); rio.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    revealEls.forEach(function (el, i) {
      var sib = el.parentNode ? $$(':scope > [data-reveal]', el.parentNode) : [];
      var k = sib.indexOf(el);
      if (k > 0) el.style.transitionDelay = Math.min(k, 6) * 70 + 'ms';
      rio.observe(el);
    });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------------- scroll-linked bits ---------------- */
  var scrubSpans = $$('[data-scrub] span');
  var ticking = false;

  /* village reel: pinned horizontal scroll on wide screens (html.reel-on), native swipe strip otherwise */
  var reel = $('#reel'), track = reel && $('.reel-track', reel), rbar = reel && $('.reel-bar span', reel), dist = 0;
  function layoutReel() {
    if (!reel) return;
    var on = !reduce && win.innerWidth >= 900 && win.innerHeight >= 560;
    root.classList.toggle('reel-on', on);
    track.style.transform = '';
    dist = 0;
    if (on) {
      var last = track.lastElementChild, pr = parseFloat(win.getComputedStyle(track).paddingRight) || 0;
      dist = Math.max(0, Math.round(last.offsetLeft + last.offsetWidth + pr - track.clientWidth));
      reel.style.height = (win.innerHeight + dist) + 'px';
    } else {
      reel.style.height = '';
      if (rbar) rbar.style.transform = '';
    }
  }
  function updateReel(vh) {
    if (!dist) return;
    var r = reel.getBoundingClientRect(), span = reel.offsetHeight - vh;
    var p = span > 0 ? clamp(-r.top / span, 0, 1) : 0;
    track.style.transform = 'translate3d(' + (-p * dist).toFixed(1) + 'px,0,0)';
    if (rbar) rbar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
  }
  function onScroll() {
    var vh = win.innerHeight, y = win.pageYOffset;
    nav.classList.toggle('is-scrolled', y > 8);
    // statement highlight
    if (!reduce) {
      scrubSpans.forEach(function (s) {
        s.classList.toggle('is-on', s.getBoundingClientRect().top < vh * 0.72);
      });
    }
    updateReel(vh);
    // active nav
    var line = vh * 0.4, cur = null;
    navTargets.forEach(function (t) {
      if (!t.el) return;
      var b = t.el.getBoundingClientRect();
      if (b.top <= line && b.bottom > line) cur = t;
    });
    navTargets.forEach(function (t) { if (t.link) t.link.setAttribute('aria-current', t === cur ? 'true' : 'false'); });
    ticking = false;
  }
  win.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  var reelT = 0, reelW = win.innerWidth, reelH = win.innerHeight;
  win.addEventListener('resize', function () {
    clearTimeout(reelT);
    reelT = setTimeout(function () {
      // ignore pure mobile URL-bar height jitter; recompute on real size changes
      if (win.innerWidth === reelW && Math.abs(win.innerHeight - reelH) < 90 && !root.classList.contains('reel-on')) return;
      reelW = win.innerWidth; reelH = win.innerHeight;
      layoutReel(); onScroll();
    }, 120);
  });
  if (reduce) scrubSpans.forEach(function (s) { s.classList.add('is-on'); });
  layoutReel();
  onScroll();

  /* ---------------- stats count-up ---------------- */
  var nums = $$('[data-count]');
  if ('IntersectionObserver' in win && !reduce) {
    var fmt = function (n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
    var cio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        cio.unobserve(e.target);
        var el = e.target, to = +el.getAttribute('data-count'), suf = el.getAttribute('data-suffix') || '';
        var t0 = performance.now(), dur = 1400;
        (function step(t) {
          var p = clamp((t - t0) / dur, 0, 1), q = 1 - Math.pow(1 - p, 4);
          el.textContent = fmt(Math.round(to * q)) + (p === 1 ? suf : '');
          if (p < 1) requestAnimationFrame(step);
        })(t0);
      });
    }, { threshold: 0.6 });
    nums.forEach(function (n) { cio.observe(n); });
  }

  /* ---------------- sticky feature scroller ---------------- */
  var steps = $$('.step'), shots = $$('.feat__stage .device__screen img'), dots = $$('.feat__dots i');
  function setStep(i) {
    steps.forEach(function (s, k) { s.classList.toggle('is-on', k === i); });
    shots.forEach(function (s, k) { s.classList.toggle('is-on', k === i); });
    dots.forEach(function (s, k) { s.classList.toggle('is-on', k === i); });
  }
  if ('IntersectionObserver' in win) {
    var sio = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) setStep(steps.indexOf(e.target)); });
    }, { rootMargin: '-46% 0px -46% 0px' });
    steps.forEach(function (s) { sio.observe(s); });
  }

  /* ---------------- promo film ---------------- */
  var film = $('.film'), video = film && $('video', film), playBtn = film && $('.film__play', film);
  if (playBtn) {
    playBtn.addEventListener('click', function () {
      if (!video.getAttribute('src')) video.src = video.getAttribute('data-src');
      video.controls = true;
      film.classList.add('is-playing');
      var p = video.play();
      if (p && p.catch) p.catch(function () {});
      video.focus({ preventScroll: true });
    });
    video.addEventListener('ended', function () { film.classList.remove('is-playing'); video.controls = false; playBtn.focus({ preventScroll: true }); });
  }

  /* ---------------- 詩詩 (platform 2D art + gesture animations) ---------------- */
  var bubble = $('.bubble'), shishiBtn = $('.shishi__btn'), art = $('.shishi__art'), shStill = art && $('.shishi__still', art);
  if (bubble && shishiBtn && art && shStill) {
    // Gesture WebPs play once (loop=1). A fresh URL per play restarts them: object URLs over http(s),
    // a cache-busted file URL when opened from disk (fetch() cannot read file://).
    var G = { wave: { src: art.getAttribute('data-wave'), ms: 2000 }, book: { src: art.getAttribute('data-book'), ms: 4000 } };
    var useBlob = /^https?:$/.test(location.protocol) && !!win.fetch && !!(win.URL && URL.createObjectURL);
    var blobs = {}, seq = 0, token = 0, cur = null, endT = 0, autoT = 0, autoN = 0, near = false, inView = false;
    var lines = bubble.getAttribute('data-lines').split('|'), li = 0, lineT = 0;
    var getBlob = function (kind) {
      if (!useBlob) return Promise.resolve(null);
      if (!blobs[kind]) {
        blobs[kind] = fetch(G[kind].src).then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob(); })
          .catch(function () { useBlob = false; blobs[kind] = null; return null; });
      }
      return blobs[kind];
    };
    var preload = function () { getBlob('wave'); getBlob('book'); };
    var stopG = function () {
      token++; clearTimeout(endT);
      if (cur) { if (cur.img.parentNode) cur.img.parentNode.removeChild(cur.img); if (cur.url) URL.revokeObjectURL(cur.url); cur = null; }
      shStill.style.visibility = ''; art.removeAttribute('data-g');
    };
    var play = function (kind) {
      if (reduce || doc.hidden) return;
      stopG();
      var my = token;
      getBlob(kind).then(function (blob) {
        if (my !== token) return;
        var url = blob ? URL.createObjectURL(blob) : null;
        var img = new Image(256, 376);
        img.alt = ''; img.className = 'shishi__g'; img.decoding = 'async';
        img.src = url || (G[kind].src + '?play=' + (++seq));
        cur = { img: img, url: url };
        var show = function () {
          if (my !== token) return;
          art.appendChild(img); shStill.style.visibility = 'hidden'; art.setAttribute('data-g', kind);
          endT = setTimeout(function () { if (my === token) stopG(); }, G[kind].ms);
        };
        (img.decode ? img.decode() : Promise.resolve()).then(show, function () { if (my === token) stopG(); });
      });
    };
    var schedule = function (first) {
      clearTimeout(autoT);
      if (reduce || !inView) return;
      autoT = setTimeout(function () {
        if (inView && !doc.hidden && !art.hasAttribute('data-g')) { autoN++; play(autoN % 3 === 0 ? 'book' : 'wave'); }
        schedule(false);
      }, first ? 700 : 6500);
    };
    var nextLine = function () {
      li = (li + 1) % lines.length;
      bubble.classList.add('is-swap');
      setTimeout(function () { bubble.textContent = lines[li]; bubble.classList.remove('is-swap'); }, reduce ? 0 : 260);
    };
    var lineLoop = function () {
      clearInterval(lineT);
      if (!reduce && inView) lineT = setInterval(nextLine, 4200);
    };
    shishiBtn.addEventListener('click', function () {
      bubble.setAttribute('aria-live', 'polite');
      nextLine(); lineLoop();
      play('book'); schedule(false);
    });
    doc.addEventListener('visibilitychange', function () { if (doc.hidden) stopG(); });
    if ('IntersectionObserver' in win) {
      new IntersectionObserver(function (es) {
        if (es[0].isIntersecting && !near) { near = true; if (!reduce) preload(); }
      }, { rootMargin: '600px 0px' }).observe(shishiBtn);
      new IntersectionObserver(function (es) {
        var was = inView; inView = es[0].isIntersecting;
        if (inView && !was) schedule(true);
        if (!inView) { clearTimeout(autoT); stopG(); }
        lineLoop();
      }, { threshold: 0.35 }).observe(shishiBtn);
    }
  }

  /* ---------------- hero particles ---------------- */
  var hero = $('.hero'), canvas = $('.hero__canvas'), stage = $('.hero__stage');
  if (!hero || !canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var gnav = $('.glyph-nav'), gBtns = $$('button', gnav);
  var capIdx = $('.glyph-ui__idx'), capPy = $('.glyph-ui__py'), capZh = $('.glyph-ui__zh');
  var HOLD = 5200;
  gnav.style.setProperty('--hold', HOLD + 'ms');

  var PALETTE = ['#2F6BFF', '#3E66FF', '#5562FF', '#6A5FFF', '#7B61FF', '#9A5FEA', '#BE5FD0', '#E05FB8', '#FF5FA2'];
  var NB = PALETTE.length;
  var W = 0, H = 0, dpr = 1, P = [], nGlyph = 0, glyphIdx = 0, targetsCache = {};
  var box = { x: 0, y: 0, s: 0 };
  var pointer = { x: -9999, y: -9999, active: false };
  var running = false, visible = true, raf = 0, lastSwitch = 0, scrollP = 0;
  var fontFamily = '"AIDU Sans", system-ui, "PingFang TC", "Microsoft JhengHei", sans-serif';

  function counts() {
    var small = win.innerWidth < 760;
    return small ? { g: 1500, d: 140 } : { g: 2700, d: 320 };
  }

  function measure() {
    var hr = hero.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    W = Math.round(hr.width); H = Math.round(hr.height);
    dpr = Math.min(win.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    var s = Math.min(sr.width, sr.height);
    box.s = s; box.x = sr.left - hr.left + (sr.width - s) / 2; box.y = sr.top - hr.top + (sr.height - s) / 2;
    targetsCache = {};
  }

  function sampleGlyph(ch, n) {
    if (targetsCache[ch]) return targetsCache[ch];
    var S = Math.max(160, Math.round(box.s));
    var off = doc.createElement('canvas'); off.width = S; off.height = S;
    var o = off.getContext('2d');
    var latin = /^[A-Za-z]+$/.test(ch);
    var fs = latin ? S * 0.62 : S * 0.86;
    o.font = (latin ? '700 ' : '650 ') + fs + 'px ' + fontFamily;
    o.textAlign = 'center'; o.textBaseline = 'alphabetic'; o.fillStyle = '#000';
    var m = o.measureText(ch);
    var asc = m.actualBoundingBoxAscent || fs * 0.8, desc = m.actualBoundingBoxDescent || 0;
    var l = m.actualBoundingBoxLeft || m.width / 2, r = m.actualBoundingBoxRight || m.width / 2;
    o.fillText(ch, S / 2 + (l - r) / 2, S / 2 + (asc - desc) / 2);
    var data = o.getImageData(0, 0, S, S).data, pts = [], area = 0, i;
    for (i = 3; i < data.length; i += 8) if (data[i] > 140) area++;
    area *= 2;
    // even, slightly staggered lattice sized so that it yields ~n points
    var g = Math.max(1.6, Math.sqrt(area / n / 0.866)), row = 0;
    for (var y = g / 2; y < S; y += g * 0.866, row++) {
      for (var x = (row & 1 ? g / 2 : 0) + g / 4; x < S; x += g) {
        var xi = x | 0, yi = y | 0;
        if (data[(yi * S + xi) * 4 + 3] > 140) pts.push(x + (Math.random() - 0.5) * g * 0.22, y + (Math.random() - 0.5) * g * 0.22);
      }
    }
    var out = new Float32Array(n * 2), cnt = pts.length / 2;
    if (!cnt) { for (var q = 0; q < n * 2; q++) out[q] = Math.random() * S; }
    else {
      var idx = new Uint32Array(cnt);
      for (i = 0; i < cnt; i++) idx[i] = i;
      for (i = cnt - 1; i > 0; i--) { var j = (Math.random() * (i + 1)) | 0, t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
      for (i = 0; i < n; i++) {
        var k = idx[i % cnt], extra = i >= cnt;
        out[i * 2] = pts[k * 2] + (extra ? (Math.random() - 0.5) * g * 0.5 : 0);
        out[i * 2 + 1] = pts[k * 2 + 1] + (extra ? (Math.random() - 0.5) * g * 0.5 : 0);
      }
    }
    // sort-free: map to local [0..1]
    for (i = 0; i < n * 2; i++) out[i] /= S;
    targetsCache[ch] = out;
    return out;
  }

  function build() {
    var c = counts();
    nGlyph = c.g;
    var total = c.g + c.d;
    var keep = P.length === total;
    if (!keep) P = [];
    for (var i = 0; i < total; i++) {
      var p = keep ? P[i] : {
        x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0, tx: 0, ty: 0,
        k: 0.018 + Math.random() * 0.04, sz: 1.5 + Math.random() * 1.1,
        ox: Math.random() * 2 - 1, oy: Math.random() * 2 - 1, ph: Math.random() * 6.283,
        dust: i >= c.g, b: 0, a: 1
      };
      if (p.dust) { p.hx = Math.random(); p.hy = Math.random(); p.sz = 0.8 + Math.random() * 1.1; p.a = 0.18 + Math.random() * 0.25; p.b = (Math.random() * NB) | 0; }
      if (!keep) P.push(p);
    }
    applyGlyph(glyphIdx, false);
  }

  function applyGlyph(i, kick) {
    glyphIdx = i;
    var btn = gBtns[i], ch = btn.getAttribute('data-ch');
    var t = sampleGlyph(ch, nGlyph);
    for (var n = 0; n < nGlyph; n++) {
      var p = P[n], lx = t[n * 2], ly = t[n * 2 + 1];
      p.tx = box.x + lx * box.s; p.ty = box.y + ly * box.s;
      p.b = clamp(Math.round((lx * 0.75 + ly * 0.25) * (NB - 1)), 0, NB - 1);
      if (kick) { var a = Math.random() * 6.283, f = 1 + Math.random() * 4.5; p.vx += Math.cos(a) * f; p.vy += Math.sin(a) * f; }
    }
    gBtns.forEach(function (b, k) { b.setAttribute('aria-pressed', k === i ? 'true' : 'false'); });
    capIdx.textContent = '0' + (i + 1) + ' / 0' + gBtns.length;
    capPy.textContent = btn.getAttribute('data-py');
    capZh.textContent = btn.getAttribute('data-zh');
    // restart the progress bar animation
    gnav.classList.remove('is-cycling'); void gnav.offsetWidth;
    if (!reduce) gnav.classList.add('is-cycling');
    lastSwitch = performance.now();
  }

  var buckets = []; for (var bi = 0; bi < NB; bi++) buckets.push({ dots: [], lines: [] });

  function frame(now) {
    raf = 0;
    if (!reduce && now - lastSwitch > HOLD) applyGlyph((glyphIdx + 1) % gBtns.length, true);
    var px = pointer.x, py = pointer.y, R = Math.max(70, box.s * 0.17), R2 = R * R;
    var tt = now * 0.001;
    for (var b = 0; b < NB; b++) { buckets[b].dots.length = 0; buckets[b].lines.length = 0; }
    var sp = scrollP, spread = sp * sp * Math.max(W, H) * 0.55;
    for (var i = 0; i < P.length; i++) {
      var p = P[i], tx, ty;
      if (p.dust) {
        tx = p.hx * W + Math.sin(tt * 0.3 + p.ph) * 40;
        ty = p.hy * H + Math.cos(tt * 0.25 + p.ph) * 30;
      } else {
        tx = p.tx + Math.sin(tt * 1.3 + p.ph) * 0.8;
        ty = p.ty + Math.cos(tt * 1.1 + p.ph) * 0.8;
      }
      if (!reduce) {
        p.vx += (tx - p.x) * p.k; p.vy += (ty - p.y) * p.k;
        var dx = p.x - px, dy = p.y - py, d2 = dx * dx + dy * dy;
        if (d2 < R2 && d2 > 0.01) {
          var d = Math.sqrt(d2), f = (1 - d / R); f = f * f * 5.2;
          p.vx += (dx / d) * f - (dy / d) * f * 0.45;
          p.vy += (dy / d) * f + (dx / d) * f * 0.45;
        }
        p.vx *= 0.86; p.vy *= 0.86;
        p.x += p.vx; p.y += p.vy;
      } else { p.x = tx; p.y = ty; p.vx = p.vy = 0; }
      var x = p.x + p.ox * spread, y = p.y + p.oy * spread - sp * 60;
      var v2 = p.vx * p.vx + p.vy * p.vy;
      var bk = buckets[p.b];
      if (v2 > 6 && !p.dust) bk.lines.push(x, y, x - p.vx * 1.7, y - p.vy * 1.7, p.sz);
      else bk.dots.push(x, y, p.dust ? p.sz : p.sz, p.dust ? p.a : 1);
    }
    draw(1 - clamp(sp * 1.25, 0, 1));
    if (running) raf = requestAnimationFrame(frame);
  }

  function draw(alpha) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (alpha <= 0.01) return;
    for (var b = 0; b < NB; b++) {
      var bk = buckets[b], col = PALETTE[b];
      ctx.fillStyle = col; ctx.strokeStyle = col;
      // dust (faint)
      ctx.globalAlpha = 0.32 * alpha;
      ctx.beginPath();
      var d = bk.dots, i;
      for (i = 0; i < d.length; i += 4) if (d[i + 3] < 1) ctx.rect(d[i], d[i + 1], d[i + 2], d[i + 2]);
      ctx.fill();
      ctx.globalAlpha = 0.92 * alpha;
      ctx.beginPath();
      for (i = 0; i < d.length; i += 4) if (d[i + 3] === 1) ctx.rect(d[i] - d[i + 2] / 2, d[i + 1] - d[i + 2] / 2, d[i + 2], d[i + 2]);
      ctx.fill();
      var l = bk.lines;
      if (l.length) {
        ctx.globalAlpha = 0.75 * alpha; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
        ctx.beginPath();
        for (i = 0; i < l.length; i += 5) { ctx.moveTo(l[i], l[i + 1]); ctx.lineTo(l[i + 2], l[i + 3]); }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function start() { if (!running && visible && !doc.hidden && !reduce) { running = true; raf = requestAnimationFrame(frame); } }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  function still() { frame(performance.now()); }

  function init() {
    measure(); build();
    if (reduce) { still(); return; }
    start();
  }

  gBtns.forEach(function (b, i) {
    b.addEventListener('click', function () { applyGlyph(i, true); if (reduce) still(); });
  });

  hero.addEventListener('pointermove', function (e) {
    var r = hero.getBoundingClientRect();
    pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top;
  }, { passive: true });
  hero.addEventListener('pointerleave', function () { pointer.x = pointer.y = -9999; });
  hero.addEventListener('pointerdown', function (e) {
    if (reduce || e.target.closest('a,button')) return;
    var r = hero.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
    for (var i = 0; i < nGlyph; i++) {
      var p = P[i], dx = p.x - cx, dy = p.y - cy, d = Math.sqrt(dx * dx + dy * dy) + 1;
      if (d < box.s * 0.6) { var f = (1 - d / (box.s * 0.6)) * 22; p.vx += dx / d * f; p.vy += dy / d * f; }
    }
  }, { passive: true });

  if ('IntersectionObserver' in win) {
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; visible ? start() : stop(); }, { threshold: 0 }).observe(hero);
  }
  doc.addEventListener('visibilitychange', function () { doc.hidden ? stop() : start(); });
  win.addEventListener('scroll', function () {
    scrollP = clamp(win.pageYOffset / (hero.offsetHeight * 0.8), 0, 1);
    if (reduce) { canvas.style.opacity = String(1 - scrollP); }
  }, { passive: true });

  var rt = 0, lastW = win.innerWidth;
  win.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      if (Math.abs(win.innerWidth - lastW) < 2 && Math.abs(hero.offsetHeight - H) < 120) return; // ignore mobile URL-bar jitter
      lastW = win.innerWidth;
      var oldW = W || 1, oldH = H || 1;
      measure();
      P.forEach(function (p) { p.x *= W / oldW; p.y *= H / oldH; });
      build();
      if (reduce) still();
    }, 160);
  });

  var go = function () { if (!W) init(); };
  if (doc.fonts && doc.fonts.load) {
    Promise.race([
      doc.fonts.load('650 100px "AIDU Sans"', '詩聲境AI'),
      new Promise(function (r) { setTimeout(r, 1800); })
    ]).then(go, go);
  } else go();
})();
