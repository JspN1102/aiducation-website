const pictureURL = new URL('./media/shishi/guide-v2.webp?v=20260915a', import.meta.url).href;
let instanceID = 0;
const HINTS = {
  lesson: ['一起出發吧', '先聽一聽、讀一讀，再看一看、找一找、練一練。'],
  record: ['一次讀好一句', '先按「聽示範」，再按「開始朗讀」讀這一句。'],
  write: ['一筆一筆來', '先看筆順，再在格子裡寫。寫錯一筆，可以撤回再試。'],
  quiz: ['先看這一題的提示', '聽清楚、看仔細，再動手試一試。不確定，可以再聽一次。'],
  report: ['挑一個地方練好', '先看看哪個字需要改進，點字聽一聽，再跟著讀一次。'],
  explore: ['找找詩中的線索', '先看畫面，找到線索後，再點你的答案。想換個角度，可以按「轉一轉」。'],
  chat: ['把好奇說出來', '可以選一個小問題，也可以打字，問詩人你想知道的事。']
};

/** A small navigation companion. No model downloads, rendering loop or floating placement. */
export function mountShishi(container, options = {}) {
  if (!container) throw new TypeError('A Shishi guide container is required');
  let settings = {view: 'lesson', ...options};
  let dead = false, open = false, paused = false, slot = null, updateFrame = 0, greeting = null;
  const events = new AbortController(), id = `shishi-guide-${++instanceID}`;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const guide = document.createElement('aside');
  guide.className = 'shishi-guide';
  guide.setAttribute('aria-label', '詩詩學習向導');
  guide.dataset.model = 'picture';
  guide.innerHTML = `<section class="shishi-bubble" id="${id}" aria-labelledby="${id}-title" hidden>
    <div class="shishi-bubble-heading"><h2 id="${id}-title"></h2><button type="button" class="shishi-dismiss" aria-label="關閉提示"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div>
    <p class="shishi-hint-text" role="status" aria-live="polite"></p><button type="button" class="shishi-understood">明白了</button>
  </section><button type="button" class="shishi-guide-button" aria-label="問詩詩：現在怎麼做" aria-controls="${id}" aria-expanded="false">
    <span class="shishi-guide-art" aria-hidden="true"><img src="${pictureURL}" width="56" height="56" alt="" decoding="async"><span class="shishi-guide-fallback" hidden>詩</span></span>
  </button>`;
  container.replaceChildren(guide);
  const q = selector => guide.querySelector(selector), button = q('.shishi-guide-button');
  const bubble = q('.shishi-bubble'), picture = q('img'), fallback = q('.shishi-guide-fallback');

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
    let hint;
    try {hint = typeof settings.getHint === 'function' ? settings.getHint() : null;} catch { /* View state can change while opening. */ }
    const standard = HINTS[settings.view] || HINTS.lesson;
    q('h2').textContent = String(hint?.title || standard[0]);
    q('.shishi-hint-text').textContent = String(hint?.text || standard[1]);
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
    if (open) {close(); return;}
    try {if (typeof settings.onOpen === 'function' && settings.onOpen() === false) return;} catch {return;}
    document.querySelectorAll('.lesson-menu[open]').forEach(menu => {menu.open = false;});
    refreshHint(); open = true; bubble.hidden = false; placeBubble();
    button.setAttribute('aria-expanded', 'true');
    if (!reducedMotion.matches) {
      greeting?.cancel();
      greeting = q('.shishi-guide-art').animate([
        {transform:'rotate(0) translateY(0)'},
        {transform:'rotate(-8deg) translateY(-3px)',offset:.3},
        {transform:'rotate(6deg) translateY(-2px)',offset:.65},
        {transform:'rotate(0) translateY(0)'}
      ], {duration:650,easing:'ease-in-out'});
    }
    if (button.matches(':focus-visible')) q('.shishi-dismiss').focus({preventScroll: true});
  }, {signal: events.signal});
  q('.shishi-dismiss').addEventListener('click', () => close(true), {signal: events.signal});
  q('.shishi-understood').addEventListener('click', () => close(true), {signal: events.signal});
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
  return {
    pause(value = true) {paused = !!value; updateVisibility();},
    update(next = {}) {
      if ((next.view && next.view !== settings.view) || (next.poem && next.poem !== settings.poem)) close();
      settings = {...settings, ...next};
      if (open) refreshHint();
      updateVisibility();
    },
    destroy() {
      if (dead) return;
      dead = true; cancelAnimationFrame(updateFrame); greeting?.cancel();
      events.abort(); observer.disconnect(); guide.remove(); slot?.remove();
    }
  };
}
