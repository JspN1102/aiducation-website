// The two full Chinese fonts (about a megabyte together) come from whichever
// host answers first: the deployed copy on the page's own origin or the
// public content-addressed COS copy in Guangzhou. The preferred route starts
// first; the other route also starts when the first fails or has not finished
// within hedgeMs; the first complete font wins, the other download is
// cancelled, and a route that won after the other failed is remembered for
// the session. The small variant subsets stay in the stylesheet. Text shows in
// the system font until a copy arrives, exactly as font-display: swap did.
// Characters the platform's files do not use (AI replies, speech-to-text,
// names) come from the on-demand extension (font-extension.mjs), whose small
// slices download only when a page shows one of their characters.
// Nothing about the pupil is sent or stored.
import {FONT_ASSETS} from './media-fonts.mjs?v=20261007-school46';
import {orderRoutes, rememberRoute, rememberedRoute} from './media-route.mjs?v=20260923-school23';
import {publicImagesReady} from './media-images.mjs?v=20261007-school46';

export const HEDGE_MS = 3000;
export const FONTS = Object.freeze([
  {family: 'Noto Serif HK', path: '/maanshan/vendor/fonts/noto-serif-hk.woff2', version: '96a12cf65f'},
  {family: 'Noto Sans HK', path: '/maanshan/vendor/fonts/noto-sans-hk.woff2', version: '069357c0c5'}
]);

// Ordered routes for one font file. The local copy keeps the cache-busting
// query the stylesheet used, so a browser that already holds it reuses it.
export function fontCandidates(font, {preferPublic, memory} = {}) {
  const local = new URL(font.path, import.meta.url);
  local.searchParams.set('v', font.version);
  return orderRoutes(local.href, FONT_ASSETS[font.path], {preferPublic, memory});
}

export function fetchFont(font, {signal, hedgeMs = HEDGE_MS, candidates = fontCandidates(font), fetchImpl = (url, init) => fetch(url, init)} = {}) {
  return new Promise((resolve, reject) => {
    const attempts = [];
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
      const candidate = candidates[started++], controller = new AbortController();
      attempts.push(controller);
      if (started < candidates.length) timer = setTimeout(startNext, hedgeMs);
      fetchImpl(candidate.url, {signal: controller.signal, credentials: 'same-origin', mode: 'cors'}).then(async response => {
        if (!response.ok) throw new Error('font-unavailable');
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength < 8 || new DataView(buffer).getUint32(0) !== 0x774f4632) throw new Error('font-invalid');
        if (settled) return;
        if (failed) rememberRoute(candidate.route);
        finish(resolve, {buffer, route: candidate.route});
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

// Install both fonts and the extension. A font that cannot be fetched from
// either host leaves the page on the system font; nothing else depends on it.
export async function installFonts({fonts = FONTS, doc = globalThis.document, extension = true} = {}) {
  if (!doc?.fonts?.add || typeof FontFace !== 'function') return [];
  // Without session memory, the reachability probe decides the first route.
  if (!rememberedRoute()) await publicImagesReady.catch(() => false);
  // The extension's faces are added at once but load nothing until needed;
  // its ranges leave out every character of the main fonts.
  if (extension) {
    import('./font-extension.mjs?v=20261007-school46')
      .then(module => module.installFontExtension({doc, remote: FONT_ASSETS}))
      .catch(() => { /* the system font covers what the extension would */ });
  }
  return Promise.all(fonts.map(async font => {
    try {
      const {buffer, route} = await fetchFont(font);
      const face = new FontFace(font.family, buffer, {weight: '400 700', style: 'normal', display: 'swap'});
      doc.fonts.add(face);
      return {family: font.family, route};
    } catch { return {family: font.family, route: null}; }
  }));
}
