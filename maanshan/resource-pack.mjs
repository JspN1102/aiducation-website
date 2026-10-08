// One-tap resource pack: every published picture, font, recording, 3D model
// and animation is downloaded in the background into the browser's Cache
// Storage, verified byte for byte against the pack manifest, and served from
// there by recovery-sw.js from then on. The platform stays fully usable while
// the pack downloads: a few small files and one big file are in flight, each
// requested at low priority from whichever host the session knows to be
// faster, the other host taking over when one fails. The counts on the
// buttons follow the bytes as they arrive, not only whole files. The pack is
// chosen by poem among the poems the library shows: a pupil's own poem, or
// for a teacher any one poem (its round button) or every poem shown (the
// big button). Each poem's part is the shared files plus that poem's own
// material. A wished poem resumes automatically on later visits until it is
// complete, and refreshes itself when a deployment changes a file. Nothing
// about the pupil is sent or stored; the cache holds public teaching material
// only, and files of several poems can share it.
import {orderRoutes, rememberRoute, rememberedRoute} from './media-route.mjs?v=20260923-school23';
import {publicImagesReady} from './media-images.mjs?v=20261007-school46';

export const APP_ROOT = new URL('./', import.meta.url);
export const MANIFEST_URL = new URL('pack-manifest.json', APP_ROOT);
export const VERSION_URL = new URL('__pack-version', APP_ROOT);
export const WANTED_KEY = 'maanshan:pack';
export const COS_ORIGIN = 'https://aiducation-mandarin-media-1427410149.cos.ap-guangzhou.myqcloud.com';
export const PACKED = /^(?:media\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:mp4|glb|webp|mp3|m4a)|vendor\/fonts\/[a-z0-9_-]+\.woff2)$/;
const TYPES = {mp4: 'video/mp4', glb: 'model/gltf-binary', webp: 'image/webp', mp3: 'audio/mpeg', m4a: 'audio/mp4', woff2: 'font/woff2'};
const CONCURRENCY = 4;
const LARGE_BYTES = 4 * 1024 * 1024;
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_ASSETS = 5000;

export function packSupported(view = globalThis) {
  try {
    return typeof view.caches?.open === 'function' && typeof view.crypto?.subtle?.digest === 'function' &&
      typeof view.fetch === 'function' && typeof view.Response === 'function' && !!view.isSecureContext;
  } catch { return false; }
}

// The page's pack version, from the meta tag the deployment renders.
export function pageVersion(doc = globalThis.document) {
  const content = doc?.querySelector?.('meta[name="school-pack"]')?.content || '';
  return /^[a-f0-9]{20}$/.test(content) ? content : null;
}

const ids = (value, limit) => value !== undefined && (!Array.isArray(value) || !value.length || value.length > limit ||
  new Set(value).size !== value.length || value.some(item => !Number.isInteger(item) || item < 1 || item > limit));

// `poems` names the poems (by id) a file serves; a file without it belongs to
// every pack. `grades` is kept for pages deployed before poem ids.
export function validateManifest(data) {
  if (!data || data.schemaVersion !== 1 || !/^[a-f0-9]{20}$/.test(data.version) || typeof data.cache !== 'string' ||
      !/^[a-z0-9-]{1,40}$/.test(data.cache) || !Array.isArray(data.assets) || data.assets.length > MAX_ASSETS) throw new Error('pack-manifest-invalid');
  const seen = new Set();
  let totalBytes = 0;
  const assets = data.assets.map(asset => {
    const {path, remote, bytes, sha256, type, grades, poems} = asset || {};
    if (typeof path !== 'string' || !PACKED.test(path) || seen.has(path)) throw new Error('pack-manifest-invalid');
    if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_ASSET_BYTES || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('pack-manifest-invalid');
    if (typeof remote !== 'string' || !remote.startsWith(COS_ORIGIN + '/') || /[?#]/.test(remote)) throw new Error('pack-manifest-invalid');
    if (type !== TYPES[path.slice(path.lastIndexOf('.') + 1)]) throw new Error('pack-manifest-invalid');
    if (ids(grades, 12) || ids(poems, 999)) throw new Error('pack-manifest-invalid');
    seen.add(path);
    totalBytes += bytes;
    return {path, remote, bytes, sha256, type, local: new URL(path, APP_ROOT).href, ...(poems ? {poems: [...poems]} : {})};
  });
  if (totalBytes !== data.totalBytes) throw new Error('pack-manifest-invalid');
  return {version: data.version, cache: data.cache, totalBytes, assets};
}

// The files a set of poems downloads: the shared files and those of the poems.
export function selectAssets(manifest, poemIds) {
  const wanted = new Set(poemIds);
  return manifest.assets.filter(asset => !asset.poems || asset.poems.some(id => wanted.has(id)));
}

export async function loadManifest({fetchImpl = (url, init) => fetch(url, init)} = {}) {
  const response = await fetchImpl(MANIFEST_URL.href, {cache: 'no-cache', credentials: 'same-origin'});
  if (!response.ok) throw new Error('pack-manifest-unavailable');
  return validateManifest(await response.json());
}

async function digest(buffer, view = globalThis) {
  const hash = await view.crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// Ask the browser to keep the cache: without this Chrome may evict it under
// storage pressure. Safari still removes it after a week without a visit.
async function persist(view = globalThis) {
  try { return (await view.navigator?.storage?.persist?.()) === true; } catch { return false; }
}

function entryHeaders(asset, version) {
  return {'Content-Type': asset.type, 'Content-Length': String(asset.bytes), 'X-Pack-Sha256': asset.sha256, 'X-Pack-Version': version, 'Cache-Control': 'no-store'};
}

// One file: skip when the cache already holds these exact bytes; otherwise
// try the routes in order (a stale browser-cached copy of the deployed file
// is fetched again bypassing the HTTP cache) and store the verified bytes.
// Reads the body in pieces so the button can count bytes as they arrive; the
// whole file is still checked against the manifest before it is stored.
async function readBody(response, bytes, onProgress) {
  if (typeof response.body?.getReader !== 'function') {
    const buffer = await response.arrayBuffer();
    onProgress?.(buffer.byteLength);
    return buffer;
  }
  const reader = response.body.getReader();
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    if (offset + value.byteLength > bytes) { reader.cancel().catch(() => {}); throw new Error('pack-file-changed'); }
    buffer.set(value, offset);
    offset += value.byteLength;
    onProgress?.(offset);
  }
  return offset === bytes ? buffer.buffer : buffer.buffer.slice(0, offset);
}

export async function syncAsset(cache, asset, version, {signal, fetchImpl = (url, init) => fetch(url, init), view = globalThis, memory, onProgress} = {}) {
  const key = asset.local;
  const existing = await cache.match(key);
  if (existing?.headers.get('X-Pack-Sha256') === asset.sha256) return 'kept';
  const routes = orderRoutes(asset.local, asset.remote, {memory});
  let failures = 0, firstError = null;
  for (const [index, route] of routes.entries()) {
    for (const mode of route.route === 'local' ? ['default', 'reload'] : ['default']) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const response = await fetchImpl(route.url, {signal, mode: 'cors', credentials: 'same-origin', cache: mode, priority: 'low'});
        if (!response.ok) throw new Error('pack-file-unavailable');
        const length = Number(response.headers.get('content-length'));
        if (length && length !== asset.bytes) throw new Error('pack-file-changed');
        onProgress?.(0);
        const buffer = await readBody(response, asset.bytes, onProgress);
        if (buffer.byteLength !== asset.bytes) throw new Error('pack-file-changed');
        if (await digest(buffer, view) !== asset.sha256) throw new Error('pack-file-changed');
        await cache.put(key, new view.Response(buffer, {status: 200, headers: entryHeaders(asset, version)}));
        if (index > 0 || failures) rememberRoute(route.route);
        return 'stored';
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        failures++;
        firstError ??= error;
        // A stale deployed copy is refetched; any other failure moves on.
        if (!(route.route === 'local' && mode === 'default' && error?.message === 'pack-file-changed')) break;
      }
    }
  }
  throw firstError || new Error('pack-file-unavailable');
}

// Remove entries no current asset uses (old versions of changed files).
async function prune(cache, manifest) {
  const keep = new Set(manifest.assets.map(asset => asset.local));
  keep.add(MANIFEST_URL.href);
  keep.add(VERSION_URL.href);
  for (const request of await cache.keys()) if (!keep.has(request.url.split('?')[0])) await cache.delete(request);
}

function schedule(assets) {
  // Small files first so pictures and recordings help soonest; one big file
  // streams beside them from the start so the count moves at once.
  return [...assets].sort((a, b) => a.bytes - b.bytes);
}

// --- what the page shows, wants and holds ---------------------------------

let manifestPromise = null, manifest = null, manifestFailed = false, lookup = null;
let options = {fetchImpl: (url, init) => fetch(url, init), view: globalThis}, supported = null;
// The poems the library shows ({id, grade, preview}) and the wished ones of
// this device ('p<id>'), so that pupils sharing a device each keep their own.
let shown = [], wanted = new Set();
// Paths whose current bytes the cache holds (null until looked up), bytes of
// files still arriving, files that failed and poems paused on this page.
let held = null;
const arriving = new Map(), failed = new Set(), paused = new Set();
// The cache once its stored manifest is current, and the files in flight.
let cache = null, preparing = null, prepareFailed = false, largeActive = 0;
const active = new Map();
const listeners = new Set();
let timer = null;

export function onPackChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  clearTimeout(timer);
  timer = null;
  for (const listener of [...listeners]) { try { listener(); } catch { /* listener error */ } }
}

// Bytes still arriving move the counts a few times a second at most.
function notifySoon() { timer ??= setTimeout(notify, 250); }

function wishes() {
  try { return new Set((localStorage.getItem(WANTED_KEY) || '').split(',').filter(Boolean)); } catch { return new Set(); }
}

function saveWishes() {
  try { if (wanted.size) localStorage.setItem(WANTED_KEY, [...wanted].sort().join(',')); else localStorage.removeItem(WANTED_KEY); } catch { /* storage unavailable */ }
}

// Pages before poem ids kept one wish per grade ('g<n>', a pupil) or one for
// everything ('all', a teacher or all-grade account); each becomes the
// published poems it meant among those shown here, and is otherwise kept for
// the other accounts of the device.
function migrateWishes() {
  const published = shown.filter(poem => !poem.preview);
  let changed = false;
  for (const key of [...wanted]) {
    const match = /^(?:all|g(\d+))$/.exec(key);
    const poems = !match ? [] : match[1] ? published.filter(poem => poem.grade === Number(match[1])) : published.length > 1 ? published : [];
    if (!poems.length) continue;
    for (const poem of poems) wanted.add('p' + poem.id);
    wanted.delete(key);
    changed = true;
  }
  if (changed) saveWishes();
}

export function packWanted(id) { return wanted.has('p' + id); }

const shownIds = () => shown.map(poem => poem.id);
const known = poemIds => [...new Set(poemIds)].filter(id => shown.some(poem => poem.id === id));
const wishedShown = () => shownIds().filter(packWanted);
const sum = assets => assets.reduce((total, asset) => total + asset.bytes, 0);

// Files the wished poems shown here still need.
function needed() {
  const ids = wishedShown();
  return manifest && held && ids.length ? selectAssets(manifest, ids).filter(asset => !held.has(asset.path)) : [];
}

// One button's state for a set of poems: unsupported, idle, checking,
// downloading, paused, error or complete, with its bytes in all and held.
export function packView(poemIds = shownIds()) {
  if (supported === false) return {status: 'unsupported', totalBytes: 0, bytesDone: 0};
  const ids = known(poemIds), wishedAll = ids.length > 0 && ids.every(packWanted);
  if (!manifest) return {status: wishedAll ? manifestFailed ? 'error' : 'checking' : 'idle', totalBytes: 0, bytesDone: 0};
  const assets = selectAssets(manifest, ids), totalBytes = sum(assets);
  if (!held) return {status: wishedAll ? 'checking' : 'idle', totalBytes, bytesDone: 0};
  const missing = assets.filter(asset => !held.has(asset.path));
  const bytesDone = totalBytes - sum(missing) + missing.reduce((total, asset) => total + (arriving.get(asset.path) || 0), 0);
  if (!missing.length) return {status: 'complete', totalBytes, bytesDone};
  const need = new Set(needed().map(asset => asset.path));
  let status;
  if (missing.every(asset => need.has(asset.path))) {
    status = prepareFailed || missing.every(asset => failed.has(asset.path)) ? 'error' : cache ? 'downloading' : 'checking';
  } else status = missing.some(asset => failed.has(asset.path)) ? 'error' : ids.some(id => paused.has(id)) ? 'paused' : 'idle';
  return {status, totalBytes, bytesDone};
}

export function packState() {
  return {...packView(), version: manifest?.version || null};
}

// Which current files the cache already holds, without creating it.
async function lookUp() {
  const {view} = options, found = new Set();
  try {
    if (await view.caches.has(manifest.cache)) {
      const opened = await view.caches.open(manifest.cache), assets = selectAssets(manifest, shownIds());
      for (let index = 0; index < assets.length; index += 24) await Promise.all(assets.slice(index, index + 24).map(async asset => {
        const existing = await opened.match(asset.local);
        if (existing?.headers.get('X-Pack-Sha256') === asset.sha256) found.add(asset.path);
      }));
    }
  } catch { /* cache unavailable: nothing is held */ }
  return found;
}

// The manifest once per page, the cache look-up once per set of poems shown.
function ensure() {
  if (supported === false || !shown.length) return Promise.resolve();
  const current = lookup ||= (async () => {
    manifest ||= await (manifestPromise ||= loadManifest({fetchImpl: options.fetchImpl}).catch(error => { manifestPromise = null; throw error; }));
    const found = await lookUp();
    if (lookup === current) held = found;
  })().catch(() => { manifestFailed = true; if (lookup === current) lookup = null; });
  return current.then(() => { notify(); drive(); });
}

// Before the page's first download: store the manifest so the worker knows
// which bytes are current, drop entries no current file uses, and let the
// session's route probe settle.
function prepare() {
  const {view} = options;
  preparing ||= (async () => {
    const opened = await view.caches.open(manifest.cache);
    await opened.put(MANIFEST_URL.href, new view.Response(JSON.stringify({schemaVersion: 1, version: manifest.version, cache: manifest.cache, totalBytes: manifest.totalBytes,
      assets: manifest.assets.map(({path, remote, bytes, sha256, type}) => ({path, remote, bytes, sha256, type}))}),
      {status: 200, headers: {'Content-Type': 'application/json', 'X-Pack-Version': manifest.version, 'Cache-Control': 'no-store'}}));
    await opened.put(VERSION_URL.href, new view.Response(manifest.version, {status: 200, headers: {'Content-Type': 'text/plain', 'Cache-Control': 'no-store'}}));
    try { view.navigator?.serviceWorker?.controller?.postMessage({type: 'pack-manifest'}); } catch { /* no worker */ }
    await prune(opened, manifest);
    if (!rememberedRoute()) await publicImagesReady.catch(() => false);
    cache = opened;
  })().catch(() => { prepareFailed = true; preparing = null; }).finally(() => { notify(); drive(); });
}

// Keep the download in step with the wishes: stop files no wished poem needs
// and keep a few small files and one big one in flight, smallest first.
function drive() {
  if (!manifest || !held) return;
  const need = needed(), paths = new Set(need.map(asset => asset.path));
  for (const [path, controller] of active) if (!paths.has(path)) controller.abort();
  if (!wishedShown().length) return;
  if (!cache) { if (!preparing && !prepareFailed) prepare(); return; }
  const queue = schedule(need.filter(asset => !active.has(asset.path) && !failed.has(asset.path)));
  while (active.size < CONCURRENCY && queue.length) {
    let index = largeActive ? -1 : queue.findIndex(asset => asset.bytes >= LARGE_BYTES);
    if (index < 0) index = queue.findIndex(asset => asset.bytes < LARGE_BYTES);
    if (index < 0) break;
    download(queue.splice(index, 1)[0]);
  }
}

function download(asset) {
  const controller = new AbortController(), large = asset.bytes >= LARGE_BYTES, {fetchImpl, view} = options;
  active.set(asset.path, controller);
  if (large) largeActive++;
  syncAsset(cache, asset, manifest.version, {signal: controller.signal, fetchImpl, view, onProgress: received => { arriving.set(asset.path, received); notifySoon(); }})
    .then(() => { held.add(asset.path); }, error => { if (error?.name !== 'AbortError') failed.add(asset.path); })
    .finally(() => {
      arriving.delete(asset.path);
      active.delete(asset.path);
      if (large) largeActive--;
      drive();
      if (active.size) notifySoon(); else notify();
    });
}

// Called once the library knows its poems ({id, grade, preview}): announce
// the version, then look up what the cache holds and resume wished poems.
export function resumeResourcePack({poems = [], fetchImpl, view} = {}) {
  if (fetchImpl) options.fetchImpl = fetchImpl;
  if (view) options.view = view;
  announcePackVersion(options.view);
  supported = packSupported(options.view);
  shown = poems.filter(poem => Number.isInteger(poem?.id) && poem.id > 0).map(poem => ({id: poem.id, grade: Number(poem.grade), preview: poem.preview === true}));
  wanted = wishes();
  migrateWishes();
  held = null;
  lookup = null;
  notify();
  return ensure();
}

// A tap on the button of these poems: remember the wish, ask for durable
// storage, and download (again, after a failure or a pause).
export function requestResourcePack(poemIds = shownIds()) {
  const ids = known(poemIds);
  for (const id of ids) { wanted.add('p' + id); paused.delete(id); }
  saveWishes();
  if (manifest) for (const asset of selectAssets(manifest, ids)) failed.delete(asset.path);
  manifestFailed = false;
  prepareFailed = false;
  void persist(options.view);
  notify();
  return ensure();
}

// A tap while they download: forget the wish of those still incomplete and
// stop their files; complete poems stay wished and keep refreshing.
export function pauseResourcePack(poemIds = shownIds()) {
  const ids = known(poemIds).filter(id => !manifest || !held || selectAssets(manifest, [id]).some(asset => !held.has(asset.path)));
  for (const id of ids) { wanted.delete('p' + id); paused.add(id); }
  saveWishes();
  drive();
  notify();
}

export function togglePack(poemIds) {
  const {status} = packView(poemIds);
  if (status === 'downloading' || status === 'checking') pauseResourcePack(poemIds);
  else if (status !== 'complete' && status !== 'unsupported') void requestResourcePack(poemIds);
}

// Tell the recovery worker which pack version this page expects, so that it
// serves cached files only while they match this deployment.
export function announcePackVersion(view = globalThis) {
  const version = pageVersion(view.document);
  const worker = view.navigator?.serviceWorker;
  if (!version || !worker) return;
  const post = () => { try { worker.controller?.postMessage({type: 'pack-version', version}); } catch { /* no controller */ } };
  post();
  try { worker.addEventListener('controllerchange', post); } catch { /* unsupported */ }
}
