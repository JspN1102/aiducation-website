// One-tap resource pack: every published picture, font, recording, 3D model
// and animation is downloaded in the background into the browser's Cache
// Storage, verified byte for byte against the pack manifest, and served from
// there by recovery-sw.js from then on. The platform stays fully usable while
// the pack downloads: at most a few small files (or one big file) are in
// flight, each requested at low priority from whichever host the session
// knows to be faster, the other host taking over when one fails. The pack
// resumes automatically on later visits until it is complete, and refreshes
// itself when a deployment changes a file. The pack follows the pupil's
// learning scope: an own-grade account downloads the shared files and its
// own poem's material only; teachers and all-grade accounts download
// everything. Nothing about the pupil is sent or stored; the cache holds
// public teaching material only, and files of several grades can share it.
import {orderRoutes, rememberRoute, rememberedRoute} from './media-route.mjs?v=20260923-school23';
import {publicImagesReady} from './media-images.mjs?v=20260923-school23';

export const APP_ROOT = new URL('./', import.meta.url);
export const MANIFEST_URL = new URL('pack-manifest.json', APP_ROOT);
export const VERSION_URL = new URL('__pack-version', APP_ROOT);
export const WANTED_KEY = 'maanshan:pack';
export const COS_ORIGIN = 'https://aiducation-mandarin-media-1427410149.cos.ap-guangzhou.myqcloud.com';
export const PACKED = /^(?:media\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:mp4|glb|webp|mp3|m4a)|vendor\/fonts\/[a-z0-9_-]+\.woff2)$/;
const TYPES = {mp4: 'video/mp4', glb: 'model/gltf-binary', webp: 'image/webp', mp3: 'audio/mpeg', m4a: 'audio/mp4', woff2: 'font/woff2'};
const CONCURRENCY = 3;
const LARGE_BYTES = 4 * 1024 * 1024;
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_ASSETS = 5000;

let manifestPromise = null, run = null;
const state = {status: 'idle', done: 0, total: 0, bytesDone: 0, totalBytes: 0, version: null, error: null, scope: 'all'};
const listeners = new Set();
// null downloads everything; {grades: [n]} keeps the pack to those grades' poems plus shared files.
let scope = null;

export function packSupported(view = globalThis) {
  try {
    return typeof view.caches?.open === 'function' && typeof view.crypto?.subtle?.digest === 'function' &&
      typeof view.fetch === 'function' && typeof view.Response === 'function' && !!view.isSecureContext;
  } catch { return false; }
}

export function packState() { return {...state}; }

export function onPackChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(patch) {
  Object.assign(state, patch);
  for (const listener of [...listeners]) { try { listener(packState()); } catch { /* listener error */ } }
}

export function scopeKey(value = scope) {
  return value?.grades?.length ? 'g' + value.grades.join('-') : 'all';
}

function normalizeScope(value) {
  const grades = Array.isArray(value?.grades) ? [...new Set(value.grades.filter(grade => Number.isInteger(grade) && grade >= 1 && grade <= 12))].sort((a, b) => a - b) : [];
  return grades.length ? {grades} : null;
}

export function configureResourcePack(options = {}) {
  scope = normalizeScope(options.scope);
  update({scope: scopeKey()});
}

// The files one scope downloads: shared files and those marked for one of its grades.
export function selectAssets(manifest, value = scope) {
  if (!value) return manifest.assets;
  return manifest.assets.filter(asset => !asset.grades || asset.grades.some(grade => value.grades.includes(grade)));
}

// The wish is kept per scope, so pupils of different grades sharing a device each keep their own.
function wantedScopes() {
  try { return new Set((localStorage.getItem(WANTED_KEY) || '').split(',').filter(Boolean)); } catch { return new Set(); }
}

export function packWanted(key = scopeKey()) {
  return wantedScopes().has(key);
}

function setWanted(value, key = scopeKey()) {
  const wanted = wantedScopes();
  if (value) wanted.add(key); else wanted.delete(key);
  try { if (wanted.size) localStorage.setItem(WANTED_KEY, [...wanted].sort().join(',')); else localStorage.removeItem(WANTED_KEY); } catch { /* storage unavailable */ }
}

// The page's pack version, from the meta tag the deployment renders.
export function pageVersion(doc = globalThis.document) {
  const content = doc?.querySelector?.('meta[name="school-pack"]')?.content || '';
  return /^[a-f0-9]{20}$/.test(content) ? content : null;
}

export function validateManifest(data) {
  if (!data || data.schemaVersion !== 1 || !/^[a-f0-9]{20}$/.test(data.version) || typeof data.cache !== 'string' ||
      !/^[a-z0-9-]{1,40}$/.test(data.cache) || !Array.isArray(data.assets) || data.assets.length > MAX_ASSETS) throw new Error('pack-manifest-invalid');
  const seen = new Set();
  let totalBytes = 0;
  const assets = data.assets.map(asset => {
    const {path, remote, bytes, sha256, type, grades} = asset || {};
    if (typeof path !== 'string' || !PACKED.test(path) || seen.has(path)) throw new Error('pack-manifest-invalid');
    if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_ASSET_BYTES || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('pack-manifest-invalid');
    if (typeof remote !== 'string' || !remote.startsWith(COS_ORIGIN + '/') || /[?#]/.test(remote)) throw new Error('pack-manifest-invalid');
    if (type !== TYPES[path.slice(path.lastIndexOf('.') + 1)]) throw new Error('pack-manifest-invalid');
    if (grades !== undefined && (!Array.isArray(grades) || !grades.length || grades.length > 12 || new Set(grades).size !== grades.length ||
        grades.some(grade => !Number.isInteger(grade) || grade < 1 || grade > 12))) throw new Error('pack-manifest-invalid');
    seen.add(path);
    totalBytes += bytes;
    return {path, remote, bytes, sha256, type, local: new URL(path, APP_ROOT).href, ...(grades ? {grades: [...grades]} : {})};
  });
  if (totalBytes !== data.totalBytes) throw new Error('pack-manifest-invalid');
  return {version: data.version, cache: data.cache, totalBytes, assets};
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
export async function syncAsset(cache, asset, version, {signal, fetchImpl = (url, init) => fetch(url, init), view = globalThis, memory} = {}) {
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
        const buffer = await response.arrayBuffer();
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
  // Small files first so pictures and recordings help soonest; one big file at a time.
  return [...assets].sort((a, b) => a.bytes - b.bytes);
}

async function work(controller, {fetchImpl, view}) {
  const signal = controller.signal;
  update({status: 'checking', error: null});
  const manifest = await (manifestPromise ||= loadManifest({fetchImpl}).catch(error => { manifestPromise = null; throw error; }));
  if (signal.aborted) return;
  const cache = await view.caches.open(manifest.cache);
  const wanted = selectAssets(manifest);
  update({version: manifest.version, total: wanted.length, totalBytes: wanted.reduce((sum, asset) => sum + asset.bytes, 0), done: 0, bytesDone: 0});
  // The stored manifest tells the worker which bytes are current; it goes in
  // first so files already held with the right digest are served at once.
  await cache.put(MANIFEST_URL.href, new view.Response(JSON.stringify({schemaVersion: 1, version: manifest.version, cache: manifest.cache, totalBytes: manifest.totalBytes,
    assets: manifest.assets.map(({path, remote, bytes, sha256, type}) => ({path, remote, bytes, sha256, type}))}),
    {status: 200, headers: {'Content-Type': 'application/json', 'X-Pack-Version': manifest.version, 'Cache-Control': 'no-store'}}));
  await cache.put(VERSION_URL.href, new view.Response(manifest.version, {status: 200, headers: {'Content-Type': 'text/plain', 'Cache-Control': 'no-store'}}));
  try { view.navigator?.serviceWorker?.controller?.postMessage({type: 'pack-manifest'}); } catch { /* no worker */ }
  await prune(cache, manifest);
  if (!rememberedRoute()) await publicImagesReady.catch(() => false);
  update({status: 'downloading'});
  const queue = schedule(wanted);
  let done = 0, bytesDone = 0, failed = 0, active = 0, largeActive = 0, firstError = null;
  await new Promise(resolve => {
    const next = () => {
      if (signal.aborted) { if (!active) resolve(); return; }
      while (active < CONCURRENCY && queue.length) {
        const index = queue.findIndex(asset => asset.bytes < LARGE_BYTES || !largeActive);
        if (index < 0) break;
        const [asset] = queue.splice(index, 1);
        const large = asset.bytes >= LARGE_BYTES;
        active++;
        if (large) largeActive++;
        syncAsset(cache, asset, manifest.version, {signal, fetchImpl, view}).then(() => {
          done++;bytesDone += asset.bytes;
          update({done, bytesDone});
        }, error => {
          if (error?.name !== 'AbortError') { failed++; firstError ??= error; }
        }).finally(() => {
          active--;
          if (large) largeActive--;
          if (!active && (!queue.length || signal.aborted)) resolve();
          else next();
        });
      }
      if (!active && !queue.length) resolve();
    };
    next();
  });
  if (signal.aborted) return;
  if (failed) { update({status: 'error', error: firstError?.message || 'pack-incomplete'}); return; }
  update({status: 'complete', done, bytesDone});
}

// Start or resume the pack download. Returns once the run has ended, but
// callers normally just watch onPackChange.
export function startResourcePack({fetchImpl = (url, init) => fetch(url, init), view = globalThis} = {}) {
  if (!packSupported(view)) { update({status: 'unsupported'}); return Promise.resolve(); }
  if (run) return run.promise;
  const controller = new AbortController();
  run = {controller, promise: null};
  run.promise = work(controller, {fetchImpl, view}).catch(error => {
    if (error?.name !== 'AbortError') update({status: 'error', error: error?.message || 'pack-failed'});
  }).finally(() => { if (run?.controller === controller) run = null; if (controller.signal.aborted && state.status !== 'complete') update({status: 'paused'}); });
  return run.promise;
}

export function pauseResourcePack() {
  run?.controller.abort();
}

// The pupil's tap: remember the wish, ask for durable storage, and start.
export async function requestResourcePack(options = {}) {
  setWanted(true);
  void persist(options.view);
  return startResourcePack(options);
}

export function cancelResourcePack() {
  setWanted(false);
  pauseResourcePack();
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

// Called once per page with the pupil's scope: announce the version, then
// resume a pack this scope asked for.
export function resumeResourcePack(options = {}) {
  if ('scope' in options) configureResourcePack(options);
  announcePackVersion(options.view);
  if (!packSupported(options.view || globalThis)) { update({status: 'unsupported'}); return; }
  if (packWanted()) void startResourcePack(options);
  else void checkResourcePack(options);
}

// Without downloading anything, report whether the cache already holds this
// scope's whole current pack (a pupil who downloaded it on an earlier visit).
export async function checkResourcePack({fetchImpl = (url, init) => fetch(url, init), view = globalThis} = {}) {
  try {
    const manifest = await (manifestPromise ||= loadManifest({fetchImpl}).catch(error => { manifestPromise = null; throw error; }));
    // Only look inside a cache that a download created; never create one here.
    const cache = (await view.caches.has(manifest.cache)) ? await view.caches.open(manifest.cache) : null;
    const wanted = selectAssets(manifest);
    let done = 0, bytesDone = 0;
    if (cache) for (const asset of wanted) {
      const existing = await cache.match(asset.local);
      if (existing?.headers.get('X-Pack-Sha256') === asset.sha256) { done++; bytesDone += asset.bytes; }
    }
    update({version: manifest.version, total: wanted.length, totalBytes: wanted.reduce((sum, asset) => sum + asset.bytes, 0), done, bytesDone,
      status: done === wanted.length ? 'complete' : state.status === 'complete' ? 'idle' : state.status});
  } catch { /* manifest unavailable: the button offers the download anyway */ }
}
