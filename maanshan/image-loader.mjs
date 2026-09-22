import {COMPAT_IMAGES} from './image-compat.mjs?v=20260920-art2';
import {IMAGE_ASSETS, publicImagesReady} from './media-images.mjs?v=20260922-school16';
import {preferPublicImages} from './image-policy.mjs?v=20260922-school16';

const canonical = new Map([
  ...Object.entries(IMAGE_ASSETS).map(([path, url]) => [url, path]),
  ...Object.entries(COMPAT_IMAGES).map(([path, url]) => [url, path])
]);
export function imageCandidates(source) {
  const url = new URL(source, import.meta.url);
  const key = canonical.get(url.href.split('?')[0]) || (url.origin === new URL(import.meta.url).origin ? canonical.get(url.pathname) || url.pathname : '');
  if (!COMPAT_IMAGES[key]) return [url.href];
  const local = COMPAT_IMAGES[key], remote = IMAGE_ASSETS[key];
  // The public copy goes first only while the session probe says it is reachable and decodable.
  const order = preferPublicImages() && remote ? [remote, local] : [local, remote || key];
  return [...new Set(order.map(value => new URL(value, import.meta.url).href))];
}

export async function loadTeachingImage(source, {timeout = 6000, reload = false} = {}) {
  await publicImagesReady;
  for (const candidate of imageCandidates(source)) {
    try {
      return await new Promise((resolve, reject) => {
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
    } catch { /* Try the independent public copy. */ }
  }
  throw new Error('Image unavailable');
}

// Recover artwork inserted by older activity modules as well. The attempt set
// belongs to the element and resets when that element is used for new artwork.
export function installImageRecovery(root = document) {
  const states = new WeakMap();
  const resource = url => url.split('?')[0].split('#')[0];
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
    state.tried.add(resource(next));state.current = next;
    delete image.dataset.loaded;image.src = next;
    schedule(image, state);
  }
  function watch(image) {
    if (!image.src || /^(data:|blob:)/.test(image.src)) return;
    const prior = states.get(image);
    if (prior?.current === image.src) return;
    clearTimeout(prior?.timer);
    const urls = imageCandidates(image.src);
    const state = {urls, tried: new Set(), current: image.src, timer: null};
    states.set(image, state);
    // Do not replace an already decoded retry URL with its cached original.
    if (image.complete && image.naturalWidth) {state.tried.add(resource(image.src));return;}
    delete image.dataset.loaded;
    // Prefer the current first candidate: the public copy while it is known to
    // work, otherwise the same-origin full-resolution image (older tablets).
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
    if (event.target.tagName !== 'IMG' || !event.target.complete || !event.target.naturalWidth) return;
    clearTimeout(states.get(event.target)?.timer);
    event.target.dataset.loaded = 'true';event.target.classList.remove('challenge-image-error');
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
