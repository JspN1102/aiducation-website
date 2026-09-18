const pictureURL = new URL('./media/shishi/guide-still-20260918c.webp', import.meta.url).href;
const gestures = {
  wave: {url:new URL('./media/shishi/guide-wave-20260918c.webp', import.meta.url).href, duration:2000},
  book: {url:new URL('./media/shishi/guide-book-20260918c.webp', import.meta.url).href, duration:4000}
};
let instanceID = 0;

/** A small navigation companion. No model downloads, rendering loop or floating placement. */
export function mountShishi(container, options = {}) {
  if (!container) throw new TypeError('A Shishi guide container is required');
  let settings = {view: 'lesson', ...options};
  let dead = false, open = false, paused = false, slot = null, updateFrame = 0;
  let gestureID = 0, gestureTimer = 0, gesturePicture = null, gestureURL = null;
  const gestureBlobs = new Map();
  const events = new AbortController(), id = `shishi-guide-${++instanceID}`;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const guide = document.createElement('aside');
  guide.className = 'shishi-guide';
  guide.setAttribute('aria-label', '詩詩學習向導');
  guide.dataset.model = 'picture';
  guide.dataset.gesture = 'idle';
  guide.innerHTML = `<section class="shishi-bubble" id="${id}" aria-labelledby="${id}-title" hidden>
    <div class="shishi-bubble-heading"><h2 id="${id}-title"></h2><button type="button" class="shishi-dismiss" aria-label="關閉提示"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div>
    <p class="shishi-hint-text" role="status" aria-live="polite"></p><div class="shishi-poet-actions"><button type="button" class="shishi-find-poet">好呀，找詩人</button><button type="button" class="shishi-understood">先不去</button></div>
  </section><button type="button" class="shishi-guide-button" aria-label="點詩詩，找詩人" aria-controls="${id}" aria-expanded="false">
    <span class="shishi-poet-label">找詩人</span>
    <span class="shishi-guide-art" aria-hidden="true"><img src="${pictureURL}" width="56" height="56" alt="" decoding="async"><span class="shishi-guide-fallback" hidden>詩</span></span>
  </button>`;
  container.replaceChildren(guide);
  const q = selector => guide.querySelector(selector), button = q('.shishi-guide-button');
  const bubble = q('.shishi-bubble'), picture = q('img'), fallback = q('.shishi-guide-fallback');

  function stopGesture() {
    gestureID += 1;
    clearTimeout(gestureTimer); gestureTimer = 0;
    gesturePicture?.remove(); gesturePicture = null;
    if (gestureURL) URL.revokeObjectURL(gestureURL);
    gestureURL = null;
    picture.style.visibility = '';
    guide.dataset.gesture = 'idle';
  }
  async function playGesture(kind) {
    stopGesture();
    if (dead || guide.hidden || button.disabled || document.hidden || reducedMotion.matches) return;
    const token = gestureID, gesture = gestures[kind];
    try {
      // Fetch bytes only on a meaningful action. A fresh object URL restarts
      // the supplied WebP at frame one even after another play in this tab.
      if (!gestureBlobs.has(kind)) {
        gestureBlobs.set(kind, fetch(gesture.url, {signal:events.signal})
          .then(response => {if (!response.ok) throw new Error('Gesture unavailable'); return response.blob();})
          .catch(error => {gestureBlobs.delete(kind); throw error;}));
      }
      const blob = await gestureBlobs.get(kind);
      if (dead || token !== gestureID || guide.hidden || button.disabled || document.hidden || reducedMotion.matches) return;
      gestureURL = URL.createObjectURL(blob);
      const animated = new Image();
      animated.alt = ''; animated.width = 192; animated.height = 165;
      animated.className = 'shishi-gesture'; animated.decoding = 'async';
      animated.src = gestureURL;
      gesturePicture = animated;
      await animated.decode();
      if (dead || token !== gestureID) return;
      q('.shishi-guide-art').append(animated);
      picture.style.visibility = 'hidden';
      guide.dataset.gesture = kind;
      // Both source animations finish in their starting pose. Return to a
      // static asset after one run; there is never an idle animation loop.
      gestureTimer = setTimeout(() => {if (token === gestureID) stopGesture();}, gesture.duration);
    } catch {
      if (token === gestureID) stopGesture();
    }
  }

  function dock() {
    const bar = document.querySelector('.lesson-bar');
    if (!bar) {
      if (guide.parentElement !== container) container.append(guide);
      slot?.remove(); slot = null;
      return;
    }
    if (!slot?.isConnected || slot.parentElement !== bar) {
      slot?.remove();
      slot = document.createElement('div');
      slot.className = 'shishi-touch-slot';
      bar.append(slot);
    }
    if (guide.parentElement !== slot) slot.append(guide);
  }
  function placeBubble() {
    if (!open || guide.hidden) return;
    const r = button.getBoundingClientRect(), b = bubble.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
    bubble.style.left = `${Math.max(left + 10, Math.min(left + width - b.width - 10, r.right - b.width))}px`;
    bubble.style.top = `${Math.max(top + 10, Math.min(top + height - b.height - 10, r.bottom + 10))}px`;
  }
  function close(restoreFocus = false) {
    open = false;
    bubble.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus && !guide.hidden && !button.disabled && !dead) button.focus({preventScroll: true});
  }
  function refreshHint() {
    const author=settings.poem?.author || '詩人';
    const younger=settings.poem?.grade<=3;
    q('h2').textContent = settings.view==='chat' ? `正在和${author}聊天` : younger?`找${author}聊天，好嗎？`:'要不要找詩人聊聊天？';
    q('.shishi-hint-text').textContent = settings.view==='chat' ? '點下面的小問題，或打字聊一聊。' : younger?'我帶你去！點下面的按鈕就可以。':`我帶你去找${author}，聊聊古詩和你的新發現。`;
    q('.shishi-find-poet').hidden=settings.view==='chat';
    q('.shishi-understood').textContent=settings.view==='chat'?'繼續聊天':'先不去';
  }
  function updateVisibility() {
    updateFrame = 0;
    if (dead) return;
    dock();
    const active = document.activeElement;
    const editing = !!active?.matches('input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, [contenteditable="true"]');
    const keyboard = !!window.visualViewport && innerHeight - window.visualViewport.height > 140;
    const modal = !!document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]:not([hidden])');
    const expanded = !!document.querySelector('.explore.is-expanded');
    const hidden = !slot || settings.hidden === true || ['library','home'].includes(settings.view) || editing || keyboard || modal || expanded;
    if (guide.hidden !== hidden) guide.hidden = hidden;
    button.disabled = paused || settings.disabled === true;
    guide.dataset.motion = hidden || document.hidden ? 'hidden' : reducedMotion.matches ? 'reduced' : button.disabled ? 'paused' : 'idle';
    if (hidden || button.disabled) close();
    if (hidden || button.disabled || document.hidden || reducedMotion.matches) stopGesture();
    else placeBubble();
  }
  function scheduleUpdate() {
    if (!dead && !updateFrame) updateFrame = requestAnimationFrame(updateVisibility);
  }
  function checkPicture() {
    const missing = picture.complete && !picture.naturalWidth;
    picture.hidden = missing; fallback.hidden = !missing;
  }
  picture.addEventListener('load', checkPicture, {signal: events.signal});
  picture.addEventListener('error', checkPicture, {signal: events.signal});
  checkPicture();
  button.addEventListener('click', () => {
    if (dead || button.disabled || guide.hidden) return;
    void playGesture('wave');
    if (open) {close(); return;}
    try {if (typeof settings.onOpen === 'function' && settings.onOpen() === false) return;} catch {return;}
    document.querySelectorAll('.lesson-menu[open]').forEach(menu => {menu.open = false;});
    refreshHint(); open = true; bubble.hidden = false; placeBubble();
    button.setAttribute('aria-expanded', 'true');
    if (button.matches(':focus-visible')) q('.shishi-dismiss').focus({preventScroll: true});
  }, {signal: events.signal});
  q('.shishi-dismiss').addEventListener('click', () => close(true), {signal: events.signal});
  q('.shishi-understood').addEventListener('click', () => close(true), {signal: events.signal});
  q('.shishi-find-poet').addEventListener('click', () => {
    if(dead || button.disabled)return;
    close();settings.onFindPoet?.();
  }, {signal: events.signal});
  document.addEventListener('pointerdown', event => {if (open && !guide.contains(event.target)) close();}, {signal: events.signal});
  document.addEventListener('keydown', event => {if (event.key === 'Escape' && open) {event.preventDefault();close(true);}}, {signal: events.signal});
  document.addEventListener('focusin', scheduleUpdate, {signal: events.signal});
  document.addEventListener('focusout', scheduleUpdate, {signal: events.signal});
  document.addEventListener('visibilitychange', scheduleUpdate, {signal: events.signal});
  window.addEventListener('resize', scheduleUpdate, {signal: events.signal});
  window.addEventListener('scroll', () => {if (open) scheduleUpdate();}, {capture: true, passive: true, signal: events.signal});
  window.visualViewport?.addEventListener('resize', scheduleUpdate, {signal: events.signal});
  reducedMotion.addEventListener('change', scheduleUpdate, {signal: events.signal});
  const observer = new MutationObserver(records => {
    if (records.some(record => !guide.contains(record.target) && record.target !== slot)) scheduleUpdate();
  });
  observer.observe(document.body, {attributes:true,attributeFilter:['open','hidden','aria-modal'],childList:true,subtree:true});
  updateVisibility();
  if (settings.view === 'quiz') void playGesture('book');
  return {
    pause(value = true) {paused = !!value; updateVisibility();},
    update(next = {}) {
      const enteredPractice = next.view === 'quiz' && settings.view !== 'quiz';
      if ((next.view && next.view !== settings.view) || (next.poem && next.poem !== settings.poem)) close();
      if ((next.view && next.view !== settings.view) || (next.poem && next.poem !== settings.poem)) stopGesture();
      settings = {...settings, ...next};
      if (open) refreshHint();
      updateVisibility();
      if (enteredPractice) void playGesture('book');
    },
    destroy() {
      if (dead) return;
      dead = true; cancelAnimationFrame(updateFrame); stopGesture();
      events.abort(); observer.disconnect(); guide.remove(); slot?.remove();
    }
  };
}
