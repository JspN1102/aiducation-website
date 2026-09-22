import {COMPAT_IMAGES} from './image-compat.mjs?v=20260920-art2';
import {IMAGE_ASSETS, publicImagesReady} from './media-images.mjs?v=20260923-school23';
import {imageRoutes} from './image-policy.mjs?v=20260923-school23';
import {rememberRoute} from './media-route.mjs?v=20260923-school23';

const origin = new URL(import.meta.url).origin;
const canonical = new Map([
  ...Object.entries(IMAGE_ASSETS).map(([path, url]) => [url, path]),
  ...Object.entries(COMPAT_IMAGES).map(([path, url]) => [url, path])
]);
const resource = url => url.split('?')[0].split('#')[0];

// The page path ("/maanshan/media/<poem>/scene-1.webp") behind any of its
// copies, or '' for artwork without a published copy.
export function canonicalImage(source) {
  const url = new URL(source, import.meta.url);
  const key = canonical.get(resource(url.href)) || (url.origin === origin ? canonical.get(url.pathname) || url.pathname : '');
  return IMAGE_ASSETS[key] || COMPAT_IMAGES[key] ? key : '';
}

// Which host a candidate belongs to: 'public' for the COS copy of the page
// path, 'local' for the deployed WebP, null for the compatible copy.
export function imageRoute(key, url) {
  if (!key) return null;
  const clean = resource(url);
  if (clean === IMAGE_ASSETS[key]) return 'public';
  if (clean === new URL(key, import.meta.url).href) return 'local';
  return null;
}

export function imageCandidates(source) {
  const url = new URL(source, import.meta.url), key = canonicalImage(source);
  if (!key) return [url.href];
  return [...new Set(imageRoutes(key, IMAGE_ASSETS[key], COMPAT_IMAGES[key]).map(value => new URL(value, import.meta.url).href))];
}

export async function loadTeachingImage(source, {timeout = 6000, reload = false} = {}) {
  await publicImagesReady;
  const key = canonicalImage(source);
  let failures = 0;
  for (const candidate of imageCandidates(source)) {
    try {
      const image = await new Promise((resolve, reject) => {
        const image = new Image();image.decoding = 'async';image.fetchPriority = 'high';
        const url = new URL(candidate);
        if (reload) url.searchParams.set('retry', String(Date.now()));
        const timer = setTimeout(() => finish(new Error('Image loading timed out')), timeout);
        function finish(error) {
          clearTimeout(timer);image.onload = image.onerror = null;
          if (error) {image.removeAttribute('src');reject(error);} else resolve(image);
        }
        image.onload = () => finish(image.naturalWidth ? null : new Error('Image has no pixels'));
        image.onerror = () => finish(new Error('Image unavailable'));
        image.src = url.href;
      });
      if (failures) rememberRoute(imageRoute(key, candidate));
      return image;
    } catch { failures++; /* Try the independent copy. */ }
  }
  throw new Error('Image unavailable');
}

// Fetch artwork bytes (sprites, textures, painting sources) from whichever
// copy answers first: the preferred copy starts alone; the next copy also
// starts when it fails or has not answered within hedgeMs. The first good
// response wins and the others are cancelled.
export function fetchImage(source, {signal, hedgeMs = 4000, cache = 'default', fetchImpl = (url, init) => fetch(url, init)} = {}) {
  return new Promise((resolve, reject) => {
    const key = canonicalImage(source), candidates = imageCandidates(source), attempts = [];
    let started = 0, failed = 0, settled = false, timer = null, firstError = null;
    function finish(callback, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortAll);
      for (const attempt of attempts) attempt.abort();
      callback(value);
    }
    function abortAll() { finish(reject, new DOMException('Aborted', 'AbortError')); }
    function startNext() {
      clearTimeout(timer);
      timer = null;
      if (settled || started >= candidates.length) return;
      const index = started++, controller = new AbortController();
      attempts.push(controller);
      if (started < candidates.length) timer = setTimeout(startNext, hedgeMs);
      const route = imageRoute(key, candidates[index]);
      fetchImpl(candidates[index], {signal: controller.signal, credentials: 'same-origin', mode: 'cors', cache: route === 'public' ? 'default' : cache}).then(async response => {
        if (!response.ok) throw new Error('Image unavailable');
        const blob = await response.blob();
        if (settled) return;
        if (index > 0 || failed) rememberRoute(route);
        finish(resolve, blob);
      }).catch(error => {
        if (settled) return;
        failed++;
        firstError ??= error;
        if (started < candidates.length) startNext();
        else if (failed >= candidates.length) finish(reject, firstError);
      });
    }
    if (signal?.aborted) { abortAll(); return; }
    signal?.addEventListener('abort', abortAll, {once: true});
    startNext();
  });
}

// Recover artwork inserted by older activity modules as well. The attempt set
// belongs to the element and resets when that element is used for new artwork.
export function installImageRecovery(root = document) {
  const states = new WeakMap();
  function schedule(image, state) {
    const source = state.current;
    state.timer = setTimeout(() => {
      if (states.get(image) !== state || state.current !== source || image.src !== source) return;
      if (!image.complete || !image.naturalWidth) fail(image, state);
    }, 6500);
  }
  function fail(image, state = states.get(image)) {
    if (!state || states.get(image) !== state || state.current !== image.src || !image.isConnected) return;
    clearTimeout(state.timer);
    if (image.complete && image.naturalWidth) return;
    const next = state.urls.find(url => !state.tried.has(resource(url)));
    if (!next) return;
    state.tried.add(resource(next));state.current = next;state.switched = true;
    delete image.dataset.loaded;image.src = next;
    schedule(image, state);
  }
  function watch(image) {
    if (!image.src || /^(data:|blob:)/.test(image.src)) return;
    const prior = states.get(image);
    if (prior?.current === image.src) return;
    clearTimeout(prior?.timer);
    const urls = imageCandidates(image.src);
    const state = {urls, tried: new Set(), current: image.src, timer: null, switched: false, key: canonicalImage(image.src)};
    states.set(image, state);
    // Do not replace an already decoded retry URL with its cached original.
    if (image.complete && image.naturalWidth) {state.tried.add(resource(image.src));return;}
    delete image.dataset.loaded;
    // Prefer the current first candidate: the copy the session knows to work,
    // otherwise the same-origin full-resolution image (older tablets).
    if (resource(urls[0]) !== resource(image.src)) fail(image, state);
    else {
      state.tried.add(resource(image.src));
      if (image.complete && !image.naturalWidth) fail(image, state);
      else if (!image.complete) schedule(image, state);
    }
  }
  root.addEventListener('error', event => {
    const image = event.target;if (image.tagName !== 'IMG') return;
    const failedSource = image.src;
    watch(image);
    // watch() may already have started the next source. The old error must
    // not skip that newly started independent copy.
    if (image.src === failedSource && image.complete && !image.naturalWidth) fail(image);
  }, true);
  root.addEventListener('load', event => {
    const image = event.target;
    if (image.tagName !== 'IMG' || !image.complete || !image.naturalWidth) return;
    const state = states.get(image);
    clearTimeout(state?.timer);
    // A copy that loaded after the other copy failed or stalled is the best
    // evidence of which host works right now.
    if (state?.switched && state.current === image.src) { state.switched = false; rememberRoute(imageRoute(state.key, image.src)); }
    image.dataset.loaded = 'true';image.classList.remove('challenge-image-error');
  }, true);
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') watch(record.target);
      else for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'IMG') watch(node);
        node.querySelectorAll('img').forEach(watch);
      }
    }
  });
  observer.observe(root, {subtree: true, childList: true, attributes: true, attributeFilter: ['src']});
  root.querySelectorAll('img').forEach(watch);
}
