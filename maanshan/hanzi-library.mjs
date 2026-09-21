// The drawing pad is independent of this optional stroke-demonstration library.
// Share one download per window; cancelling a view only retires that waiter.
const pending = new WeakMap();
const libraryURL = new URL('./vendor/hanzi-writer.min.js', import.meta.url).href;

function libraryFor(view, timeout) {
  if (typeof view.HanziWriter?.create === 'function') return Promise.resolve(view.HanziWriter);
  if (pending.has(view)) return pending.get(view);
  let download;
  download = new Promise((resolve, reject) => {
    const script = view.document.createElement('script');
    let timer;
    const finish = error => {
      view.clearTimeout(timer);script.onload = script.onerror = null;
      if (error) {script.remove();reject(error);} else resolve(view.HanziWriter);
    };
    script.src = libraryURL;script.async = true;
    script.onload = () => finish(typeof view.HanziWriter?.create === 'function' ? null : new Error('Stroke library is incomplete'));
    script.onerror = () => finish(new Error('Stroke library is unavailable'));
    timer = view.setTimeout(() => finish(new Error('Stroke library timed out')), timeout);
    view.document.head.append(script);
  }).finally(() => { if (pending.get(view) === download) pending.delete(view); });
  pending.set(view, download);
  return download;
}

export function loadHanziWriter(view = window, {signal, timeout = 15000} = {}) {
  const cancelled = () => new view.DOMException('Stroke demonstration cancelled', 'AbortError');
  if (signal?.aborted) return Promise.reject(cancelled());
  const download = libraryFor(view, timeout);
  if (!signal) return download;
  return new Promise((resolve, reject) => {
    const abort = () => {signal.removeEventListener('abort', abort);reject(cancelled());};
    signal.addEventListener('abort', abort, {once: true});
    download.then(library => {
      signal.removeEventListener('abort', abort);
      if (!signal.aborted) resolve(library);
    }, error => {signal.removeEventListener('abort', abort);reject(error);});
  });
}
