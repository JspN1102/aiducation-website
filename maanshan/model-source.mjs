// Two independent routes for every 3D model: the page's own origin (the
// Vercel deployment) and the public content-addressed COS copy in Guangzhou.
// Unlike a video, a model is only useful once every byte has arrived and
// validated, so the download is hedged rather than switched: the preferred
// route starts first; the other route also starts when the first one fails
// outright or has not finished within hedgeMs and is less than half done; a
// route that stops delivering bytes for stallMs is dropped while another route
// can still take over (the last live route waits, since a weak link can take
// well over stallMs before the first byte); the first complete
// valid model wins and every other attempt is cancelled. The page only sees an
// error when every route failed. The winning route is remembered for the
// session, shared with the poem animations. Nothing about the pupil is sent.
// Pages bound a load with loadBudget, a deadline that restarts on progress
// (onProgress reports every chunk), so a slow but flowing link is never cut.
import {MODEL_ASSETS} from './media-models.mjs?v=20260922-school20';
import {orderRoutes, rememberRoute} from './media-route.mjs?v=20260923-school23';

export const MAX_MODEL_BYTES = 12 * 1024 * 1024;
export const HEDGE_MS = 3000;
export const STALL_MS = 8000;
// Silence a page tolerates during one model load before offering a retry.
// The budget restarts whenever the load moves (library imported, response
// headers, each chunk of bytes), so only a link that stops entirely for this
// long is given up; fetchModel already drops a stalled route while another
// can take over. From a weak link the first byte alone can take 20-40 s.
export const MODEL_LOAD_TIMEOUT_MS = 60000;

// A restartable deadline for one load: touch() on every sign of progress,
// expire runs after timeoutMs without one, clear() once the load is over.
export function loadBudget(expire, {timeoutMs = MODEL_LOAD_TIMEOUT_MS, view = globalThis} = {}) {
  let timer = null;
  const touch = () => { view.clearTimeout(timer); timer = view.setTimeout(expire, timeoutMs); };
  touch();
  return {touch, clear() { view.clearTimeout(timer); timer = null; }};
}

// Generated assets are self-contained GLBs. Reject external references so a
// model can never silently start unbounded third-party texture downloads.
export function validateGLB(buffer) {
  if (buffer.byteLength < 20 || buffer.byteLength > MAX_MODEL_BYTES) throw new Error('invalid-model');
  const header = new DataView(buffer);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 ||
      header.getUint32(8, true) !== buffer.byteLength || header.getUint32(16, true) !== 0x4e4f534a) throw new Error('invalid-model');
  const length = header.getUint32(12, true);
  if (20 + length > buffer.byteLength) throw new Error('invalid-model');
  const data = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  for (const entry of [...(data.buffers || []), ...(data.images || [])]) {
    if (entry.uri && !entry.uri.startsWith('data:')) throw new Error('external-model-resource');
  }
  return buffer;
}

// Read one response completely within the size budget; onChunk reports the
// bytes received so far, which the hedge uses for stall and progress checks.
export async function readModel(response, signal, onChunk) {
  if (!response.ok) throw new Error('model-unavailable');
  if (Number(response.headers.get('content-length')) > MAX_MODEL_BYTES) throw new Error('model-too-large');
  if (!response.body?.getReader) return validateGLB(await response.arrayBuffer());
  const reader = response.body.getReader(), chunks = [];
  let total = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_MODEL_BYTES) throw new Error('model-too-large');
      chunks.push(value);
      onChunk?.(total);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  return validateGLB(bytes.buffer);
}

// Ordered routes for one model given as a path relative to this directory
// such as "media/exploration/<poem>/model.glb", a URL string or a URL. The
// local copy keeps its exact URL, including any cache-busting query; the
// public copy is the content-addressed COS object published for that path.
// The cache mode only applies to the local copy: public objects are immutable.
export function modelCandidates(source, {preferPublic, memory, cache = 'default'} = {}) {
  let url;
  try { url = new URL(source, import.meta.url); } catch { return []; }
  const remote = url.origin === new URL(import.meta.url).origin ? MODEL_ASSETS[url.pathname] : undefined;
  return orderRoutes(url.href, remote, {preferPublic, memory})
    .map(candidate => ({...candidate, cache: candidate.route === 'public' ? 'default' : cache}));
}

async function download(candidate, controller, progress, {stallMs, fetchImpl, canDrop = () => true, onProgress}) {
  let stall = null, stalled = false;
  const arm = () => {
    clearTimeout(stall);
    stall = setTimeout(() => { if (canDrop()) { stalled = true; controller.abort(); } else arm(); }, stallMs);
  };
  arm();
  try {
    const response = await fetchImpl(candidate.url, {signal: controller.signal, credentials: 'same-origin', cache: candidate.cache || 'default'});
    progress.total = Number(response.headers.get('content-length')) || 0;
    arm();
    onProgress?.(0, progress.total);
    return await readModel(response, controller.signal, received => { progress.received = received; arm(); onProgress?.(received, progress.total); });
  } catch (error) {
    throw stalled ? new Error('model-stalled') : error;
  } finally { clearTimeout(stall); }
}

// Resolve with the validated model bytes from whichever route completes
// first. Reject with the caller's abort, or with the first route's error once
// every route has failed.
export function fetchModel(source, {signal, hedgeMs = HEDGE_MS, stallMs = STALL_MS, cache = 'default',
                                    candidates = modelCandidates(source, {cache}), fetchImpl = (url, init) => fetch(url, init), onRoute, onProgress} = {}) {
  return new Promise((resolve, reject) => {
    if (!candidates.length) { reject(new Error('model-unavailable')); return; }
    const attempts = [], live = new Set();
    let started = 0, failed = 0, settled = false, timer = null, firstError = null, latest = null;
    // Another live download, or one not yet started, can replace a stalled route.
    const canDrop = () => live.size > 1 || started < candidates.length;
    function finish(callback, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortAll);
      for (const attempt of attempts) attempt.abort();
      callback(value);
    }
    function abortAll() { finish(reject, new DOMException('Aborted', 'AbortError')); }
    function hedge() {
      timer = null;
      // A route already past the halfway mark will almost certainly finish
      // before a fresh download could; keep waiting while it keeps moving.
      if (latest?.total && latest.received >= latest.total / 2) { timer = setTimeout(hedge, hedgeMs); return; }
      startNext();
    }
    function startNext() {
      clearTimeout(timer);
      timer = null;
      if (settled || started >= candidates.length) return;
      const candidate = candidates[started++], controller = new AbortController(), progress = {received: 0, total: 0};
      attempts.push(controller);
      live.add(controller);
      latest = progress;
      if (started < candidates.length) timer = setTimeout(hedge, hedgeMs);
      download(candidate, controller, progress, {stallMs, fetchImpl, canDrop, onProgress}).then(buffer => {
        live.delete(controller);
        if (settled) return;
        rememberRoute(candidate.route);
        onRoute?.(candidate.route, candidate.url);
        finish(resolve, buffer);
      }, error => {
        live.delete(controller);
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
