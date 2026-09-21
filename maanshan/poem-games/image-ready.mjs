// The page can replace an image URL with its compatible copy while decode()
// is pending. A rejected decode does not mean the final image failed to load.
export function waitForImageElement(image, options = {}) {
  return waitForImages([image], options).then(() => image);
}

// A slow request can still finish after the retry notice appears. Retain the
// load listeners until every current source is ready, or the owner cancels.
function waitForImages(values, {signal, timeout = 12000, onTimeout} = {}) {
  const images = [...new Set(values)];
  return new Promise((resolve, reject) => {
    let timer, settled = false;
    const clean = () => {
      clearTimeout(timer);
      images.forEach(image => image.removeEventListener('load', loaded));
      signal?.removeEventListener('abort', cancelled);
    };
    const finish = error => {
      if (settled) return;
      settled = true;
      clean();
      if (error) reject(error); else resolve(images);
    };
    const loaded = () => {
      if (images.every(image => image.complete && image.naturalWidth > 0)) finish();
    };
    const cancelled = () => finish(new DOMException('Image loading cancelled', 'AbortError'));
    if (signal?.aborted) { cancelled(); return; }
    images.forEach(image => image.addEventListener('load', loaded));
    signal?.addEventListener('abort', cancelled, {once: true});
    timer = setTimeout(() => {
      loaded();
      if (settled) return;
      if (typeof onTimeout !== 'function') { finish(new Error('Image loading timed out')); return; }
      try { onTimeout(); } catch (error) { finish(error); }
    }, timeout);
    loaded();
    for (const image of images) if (!settled && typeof image.decode === 'function') {
      // URL recovery can reject the old decode promise. Keep listening for
      // the replacement's load event; a genuine failure still times out.
      image.decode().then(loaded, loaded);
    }
  });
}

// One active wait per game: manual retry retires the previous generation,
// while leaving the game cancels the active wait and removes all listeners.
export function createGameImageLoader({signal, timeout = 12000} = {}) {
  let current = null;
  return function loadImages(images, {onTimeout} = {}) {
    current?.abort();
    const controller = new AbortController();
    current = controller;
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, {once: true});
    if (signal?.aborted) cancel();
    return waitForImages(images, {signal: controller.signal, timeout, onTimeout}).finally(() => {
      signal?.removeEventListener('abort', cancel);
      if (current === controller) current = null;
    });
  };
}
