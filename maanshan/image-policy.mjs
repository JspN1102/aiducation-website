// Decides whether the public COS copies of teaching images are requested
// first. The same-origin JPEG copies stay as the fallback and remain the first
// choice for browsers that cannot decode WebP or cannot reach the public host.
// One small probe image settles this per browser session; nothing about the
// pupil is sent or stored.
const STORAGE_KEY = 'maanshan:public-images';
let preferred = remembered();
let probe = null;

function remembered() {
  try { return sessionStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

function remember(value) {
  try { sessionStorage.setItem(STORAGE_KEY, value ? '1' : '0'); } catch { /* storage unavailable */ }
}

export function preferPublicImages() {
  return preferred;
}

export function probePublicImages(url, {timeout = 3500} = {}) {
  if (probe) return probe;
  probe = new Promise(resolve => {
    if (typeof Image !== 'function' || typeof url !== 'string' || !/^https:\/\//.test(url)) {
      preferred = false;
      resolve(false);
      return;
    }
    const image = new Image();
    let done = false;
    const timer = setTimeout(() => finish(false), timeout);
    function finish(ok) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      image.onload = image.onerror = null;
      preferred = ok;
      remember(ok);
      resolve(ok);
    }
    image.onload = () => finish(image.naturalWidth > 0);
    image.onerror = () => finish(false);
    image.decoding = 'async';
    image.src = url;
  });
  return probe;
}
