// The page can replace an image URL with its compatible copy while decode()
// is pending. A rejected decode does not mean the final image failed to load.
export function waitForImageElement(image, {signal, timeout = 12000} = {}) {
  return new Promise((resolve, reject) => {
    let timer, settled = false;
    const clean = () => {
      clearTimeout(timer);
      image.removeEventListener('load', loaded);
      signal?.removeEventListener('abort', cancelled);
    };
    const finish = error => {
      if (settled) return;
      settled = true;
      clean();
      if (error) reject(error); else resolve(image);
    };
    const loaded = () => {
      if (image.complete && image.naturalWidth > 0) finish();
    };
    const cancelled = () => finish(new DOMException('Image loading cancelled', 'AbortError'));
    if (signal?.aborted) { cancelled(); return; }
    image.addEventListener('load', loaded);
    signal?.addEventListener('abort', cancelled, {once: true});
    timer = setTimeout(() => finish(new Error('Image loading timed out')), timeout);
    loaded();
    if (!settled && typeof image.decode === 'function') {
      // URL recovery can reject the old decode promise. Keep listening for
      // the replacement's load event; a genuine failure still times out.
      image.decode().then(loaded, loaded);
    }
  });
}
