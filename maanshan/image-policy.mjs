// Decides which copy of each teaching image is requested first: the public
// COS copy in Guangzhou or the deployed copy on the page's own origin. Both
// hold the same WebP files; browsers that cannot decode WebP get the
// same-origin JPEG/PNG copies instead. One small probe settles whether the
// public host answers, per browser session, and the shared media-route memory
// (whichever host last served an animation, model, font or image after the
// other failed) overrides it. An inline script in index.html starts the same
// checks before any module arrives. Nothing about the pupil is sent or stored.
const STORAGE_KEY = 'maanshan:public-images';
const WEBP_KEY = 'maanshan:webp';
const ROUTE_KEY = 'maanshan:media-route';
const WEBP_PROBE = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
let preferred = remembered(STORAGE_KEY) === '1';
let webp = remembered(WEBP_KEY);
let probe = null, webpCheck = null;

function remembered(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function remember(key, value) {
  try { sessionStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

function early(name) {
  const value = globalThis.schoolMediaProbe?.[name];
  return value && typeof value.then === 'function' ? value : null;
}

function loadImage(url, timeout, check) {
  return new Promise(resolve => {
    if (typeof Image !== 'function') { resolve(null); return; }
    const image = new Image();
    let done = false;
    const timer = setTimeout(() => finish(false), timeout);
    function finish(ok) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      image.onload = image.onerror = null;
      resolve(ok);
    }
    image.onload = () => finish(check(image));
    image.onerror = () => finish(false);
    image.decoding = 'async';
    image.src = url;
  });
}

export function preferPublicImages() {
  const route = remembered(ROUTE_KEY);
  if (route === 'public') return true;
  if (route === 'local') return false;
  return preferred;
}

// Unknown counts as supported: every current browser decodes WebP, and the
// recovery path still reaches the compatible copy if a decode fails.
export function webpSupported() {
  return webp !== '0';
}

export function checkWebpSupport() {
  if (webpCheck) return webpCheck;
  const settle = ok => { webp = ok ? '1' : '0'; remember(WEBP_KEY, webp); return ok; };
  if (webp !== null) webpCheck = Promise.resolve(webp === '1');
  else if (early('webp')) webpCheck = early('webp').then(ok => settle(!!ok), () => settle(true));
  else webpCheck = loadImage(WEBP_PROBE, 3000, image => image.naturalWidth === 1).then(ok => ok === null ? true : settle(ok));
  return webpCheck;
}

export function probePublicImages(url, {timeout = 3500} = {}) {
  if (probe) return probe;
  const settle = ok => { preferred = ok; remember(STORAGE_KEY, ok ? '1' : '0'); return ok; };
  let reachable;
  if (early('publicImages')) reachable = early('publicImages').then(ok => settle(!!ok), () => settle(false));
  else if (typeof url !== 'string' || !/^https:\/\//.test(url) || remembered(ROUTE_KEY) === 'local') reachable = Promise.resolve(settle(false));
  else reachable = loadImage(url, timeout, image => image.naturalWidth > 0).then(ok => settle(!!ok));
  probe = Promise.all([checkWebpSupport(), reachable]).then(([, ok]) => ok);
  return probe;
}

// Ordered URLs for one image: the two WebP copies in the preferred order,
// then the compatible JPEG/PNG copy when one exists. A browser that cannot
// decode WebP goes straight to the compatible copy.
export function imageRoutes(path, remote, compat) {
  if (!webpSupported() && compat) return [compat];
  const pair = !remote ? [path] : preferPublicImages() ? [remote, path] : [path, remote];
  return compat ? [...pair, compat] : pair;
}
