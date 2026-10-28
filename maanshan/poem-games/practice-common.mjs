import {createGameImageLoader} from './image-ready.mjs?v=20260922-school11';
import {imageAsset} from '../media-images.mjs?v=20261007-school46';
import {clipAudio} from '../practice-games-data.mjs?v=20261029-school74';

// Shared frame of 小老師找錯 and 讀音小偵探: a panel beside a picture of 小墨,
// whose pose follows the game. Audio is always a pre-recorded clip.
const art = name => new URL(imageAsset(`media/poem-games/practice/${name}`), import.meta.url).href;
export const SPEAKER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m10 5-5 4H2v6h3l5 4ZM14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
export const esc = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
export const hanOf = text => Array.from(text).filter(char => /\p{Script=Han}/u.test(char));
export const count = (value, max) => Number.isInteger(value) ? Math.max(0, Math.min(max, value)) : 0;

export function createPracticeFrame(holder, {kind, title, poses, alt, reducedMotion, onRetryAssets}) {
  const doc = holder.ownerDocument, view = doc.defaultView, abort = new view.AbortController(), timers = new Set();
  const loadImages = createGameImageLoader({signal: abort.signal});
  const root = doc.createElement('section');
  root.className = `practice-game pg-${kind}`;root.setAttribute('aria-label', title);
  if (reducedMotion) root.classList.add('is-reduced-motion');
  root.innerHTML = `<div class="pg-panel"><header class="pg-header"><div><span class="pg-eyebrow">${esc(title)}</span><h3></h3></div><span class="pg-progress"></span></header>
    <p class="pg-task"></p><div class="pg-work"></div>
    <div class="pg-actions"><button type="button" class="pg-listen" data-pg-listen>${SPEAKER}<span></span></button><button type="button" class="pg-next" data-pg-next hidden>下一題 <span aria-hidden="true">→</span></button></div>
    <p class="pg-feedback" role="status" aria-live="polite"></p></div>
    <div class="pg-stage" aria-busy="true">${Object.entries(poses).map(([pose, file]) => `<img class="pg-scene" data-pg-pose="${pose}" src="${art(file)}" width="1536" height="1024" alt="${esc(alt[pose] || '')}" draggable="false">`).join('')}
    <div class="pg-loading" role="status"><span>小墨正在準備…</span><button type="button" data-pg-retry hidden>再試一次</button></div></div>`;
  holder.append(root);
  const q = selector => root.querySelector(selector);
  let dead = false, loadGeneration = 0, audioGeneration = 0;
  const frame = {
    root, q, view, signal: abort.signal,
    get dead() {return dead;},
    tell(text) {if (!dead) q('.pg-feedback').textContent = text;},
    pose(name) {root.dataset.pose = name;root.querySelectorAll('[data-pg-pose]').forEach(img => img.classList.toggle('is-on', img.dataset.pgPose === name));},
    later(fn, ms) {const id = view.setTimeout(() => {timers.delete(id);if (!dead) fn();}, ms);timers.add(id);return id;},
    // true: played; false: could not play; null: interrupted by a newer clip or the game closing.
    async play(playAudio, id) {
      const token = ++audioGeneration, audio = clipAudio(id);
      if (!audio) return false;
      let ok = false, timer;
      try {ok = await Promise.race([Promise.resolve(playAudio?.(audio)), new Promise(resolve => {timer = view.setTimeout(() => resolve(false), 15000);})]);}
      catch {ok = false;} finally {view.clearTimeout(timer);}
      return dead || token !== audioGeneration ? null : ok === true ? true : ok === null ? null : false;
    },
    async load(research, onReady) {
      if (loadGeneration) research.retry('assets');
      const token = ++loadGeneration, loading = q('.pg-loading'), stage = q('.pg-stage');
      loading.hidden = false;loading.querySelector('span').textContent = '小墨正在準備…';q('[data-pg-retry]').hidden = true;stage.setAttribute('aria-busy', 'true');
      const unavailable = () => {if (dead || token !== loadGeneration) return;research.error('assets');loading.querySelector('span').textContent = '畫面還在載入，可以再試一次。';q('[data-pg-retry]').hidden = false;stage.setAttribute('aria-busy', 'false');};
      try {
        if (token > 1) root.querySelectorAll('img').forEach(img => {const url = new URL(img.src);url.searchParams.set('retry', String(token));img.src = url.href;});
        await loadImages(root.querySelectorAll('img'), {onTimeout: unavailable});
        if (dead || token !== loadGeneration) return;
        loading.hidden = true;stage.setAttribute('aria-busy', 'false');onReady();
      } catch {unavailable();}
    },
    destroy() {if (dead) return;dead = true;audioGeneration++;loadGeneration++;abort.abort();timers.forEach(id => view.clearTimeout(id));timers.clear();root.remove();}
  };
  root.addEventListener('click', event => {if (event.target.closest('[data-pg-retry]')) onRetryAssets?.();}, {signal: abort.signal});
  return frame;
}
