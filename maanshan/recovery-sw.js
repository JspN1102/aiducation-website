'use strict';

// Navigation recovery, plus the optional resource pack. Every page, module and
// account request still uses the network; no response, identity or learning
// record is stored here. The pack cache holds only public teaching files the
// pupil asked to download (resource-pack.mjs), each served only while its
// bytes match the pack manifest of the deployment the page came from.
const MAIN_ENTRANCE = self.location.hostname === 'mandarin.aiducation.asia';
const SCHOOL_ENTRIES = new Set(['/school/', '/school/index.html']);
const LEGACY_ENTRIES = /^\/(?:maanshan\/?|)$/;
const APP_ROOT = new URL('./', self.location.href).pathname;
const COS_ORIGIN = 'https://aiducation-mandarin-media-1427410149.cos.ap-guangzhou.myqcloud.com';
const PACK_CACHE = 'maanshan-pack-v1';
const PACKED = /^(?:media\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:mp4|glb|webp|mp3|m4a)|vendor\/fonts\/[a-z0-9_-]+\.woff2)$/;
const PUBLISHED = /^(?:\/published\/(g-)?([a-f0-9]{20}))?\/maanshan\/(.+)$/;
const VERSION_KEY = self.location.origin + APP_ROOT + '__pack-version';
const MANIFEST_KEY = self.location.origin + APP_ROOT + 'pack-manifest.json';
let pageVersion = null, manifest = null;

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function recoveryPage() {
  const other = MAIN_ENTRANCE
    ? ['https://aiducation.asia/school/', '使用備用入口']
    : ['https://mandarin.aiducation.asia/school/', '使用主要入口'];
  return new Response(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AI普通話學習平台</title><style>html{color:#243b32;background:#fbf9f1;font:20px/1.65 system-ui,sans-serif}body{margin:0;padding:24px}main{max-width:30rem;margin:12vh auto}h1{font-size:1.8rem;line-height:1.3}nav{display:flex;flex-wrap:wrap;gap:14px;margin-top:28px}a{display:inline-block;padding:12px 20px;border:2px solid #286249;border-radius:12px;color:#286249;font-weight:700;text-decoration:none}a:first-child{background:#286249;color:white}a:focus-visible{outline:3px solid #c57b13;outline-offset:4px}</style><main><h1>暫時未能連線</h1><p>請重新連線，或使用另一個入口。</p><nav aria-label="重新連線"><a href="/school/">重新連線</a><a href="${other[0]}">${other[1]}</a></nav></main></html>`, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

// --- resource pack -------------------------------------------------------

// The pack cache exists only once a pupil asked for the pack; the worker
// never creates it, so a browser that never downloaded holds nothing.
async function packCache() {
  try { return (await caches.has(PACK_CACHE)) ? await caches.open(PACK_CACHE) : null; } catch { return null; }
}

// The pack version the page expects: told by the page, or read from the
// entry HTML as it passes through, and kept in the cache across restarts.
async function rememberVersion(version) {
  if (!/^[a-f0-9]{20}$/.test(version) || version === pageVersion) return;
  pageVersion = version;
  manifest = null;
  try {
    const cache = await packCache();
    if (cache) await cache.put(VERSION_KEY, new Response(version, {headers: {'Content-Type': 'text/plain'}}));
  } catch { /* cache unavailable */ }
}

async function currentVersion() {
  if (pageVersion) return pageVersion;
  try {
    const cache = await packCache();
    const stored = cache ? await cache.match(VERSION_KEY) : null;
    const version = stored ? (await stored.text()).trim() : '';
    if (/^[a-f0-9]{20}$/.test(version)) pageVersion = version;
  } catch { /* cache unavailable */ }
  return pageVersion;
}

self.addEventListener('message', event => {
  const data = event.data;
  if (data && data.type === 'pack-version' && typeof data.version === 'string') event.waitUntil(rememberVersion(data.version));
  // The page stored a new manifest: drop the parsed one so the next lookup reads it afresh.
  if (data && data.type === 'pack-manifest') manifest = null;
});

function noteEntryVersion(response) {
  try {
    if (!response.ok || !/text\/html/.test(response.headers.get('content-type') || '')) return response;
    response.clone().text().then(html => {
      const match = /<meta name="school-pack" content="([a-f0-9]{20})">/.exec(html);
      if (match) rememberVersion(match[1]);
    }).catch(() => {});
  } catch { /* stream unavailable */ }
  return response;
}

// The stored pack manifest, parsed once per worker life: path -> digest.
async function currentManifest() {
  // A parsed manifest from an older deployment is stale once the page moved on;
  // read the stored one again until the new pack has written its manifest.
  if (manifest && manifest.version === await currentVersion()) return manifest;
  manifest = null;
  try {
    const cache = await packCache();
    const stored = cache ? await cache.match(MANIFEST_KEY) : null;
    if (!stored) return null;
    const data = await stored.json();
    if (data?.schemaVersion !== 1 || !/^[a-f0-9]{20}$/.test(data.version) || !Array.isArray(data.assets)) return null;
    const byPath = new Map();
    for (const asset of data.assets) if (typeof asset?.path === 'string' && /^[a-f0-9]{64}$/.test(asset.sha256)) byPath.set(asset.path, asset.sha256);
    manifest = {version: data.version, byPath};
  } catch { manifest = null; }
  return manifest;
}

// Which packed file a request is for: same-origin deployed copies and the
// COS copies map to one cache entry each. A content-addressed COS URL names
// the exact bytes it wants; the rest rely on the manifest.
function packTarget(url) {
  if (url.origin === self.location.origin) {
    if (!url.pathname.startsWith(APP_ROOT)) return null;
    const path = url.pathname.slice(APP_ROOT.length);
    return PACKED.test(path) ? {path, digest: null} : null;
  }
  if (url.origin === COS_ORIGIN) {
    const match = PUBLISHED.exec(url.pathname);
    if (!match || !PACKED.test(match[3])) return null;
    return {path: match[3], digest: !match[1] && match[2] ? match[2] : null};
  }
  return null;
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!match || (!match[1] && !match[2])) return null;
  let start = match[1] ? Number(match[1]) : size - Number(match[2]);
  let end = match[2] && match[1] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isFinite(start) || start < 0) start = 0;
  if (start >= size || end < start) return {invalid: true};
  return {start, end};
}

async function fromPack(request, target) {
  const cache = await packCache();
  const entry = cache ? await cache.match(new URL(target.path, self.location.origin + APP_ROOT).href) : null;
  if (!entry) return null;
  const digest = entry.headers.get('X-Pack-Sha256') || '';
  // A content-addressed URL names exact bytes; every other URL means the bytes
  // the current deployment's manifest lists for that path.
  let usable;
  if (target.digest) usable = digest.startsWith(target.digest);
  else {
    const [version, current] = [await currentVersion(), await currentManifest()];
    usable = !!version && !!current && current.version === version && current.byPath.get(target.path) === digest;
  }
  if (!usable) return null;
  const type = entry.headers.get('Content-Type') || 'application/octet-stream';
  const blob = await entry.blob();
  const headers = {'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Pack': 'hit'};
  const range = request.headers.get('range');
  if (!range) return new Response(blob, {status: 200, headers: {...headers, 'Content-Length': String(blob.size)}});
  const span = parseRange(range, blob.size);
  if (!span || span.invalid) return new Response(null, {status: 416, headers: {...headers, 'Content-Range': 'bytes */' + blob.size}});
  const part = blob.slice(span.start, span.end + 1, type);
  return new Response(part, {status: 206, headers: {...headers, 'Content-Length': String(part.size), 'Content-Range': 'bytes ' + span.start + '-' + span.end + '/' + blob.size}});
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode !== 'navigate') {
    const target = packTarget(url);
    if (!target) return;
    event.respondWith(fromPack(request, target).catch(() => null).then(response => response || fetch(request)));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // The company backup retains its homepage and separate legacy demo.
  if (MAIN_ENTRANCE && LEGACY_ENTRIES.test(url.pathname)) {
    event.respondWith(Promise.resolve(Response.redirect(new URL('/school/', url).href, 307)));
    return;
  }
  if (!SCHOOL_ENTRIES.has(url.pathname)) return;
  event.respondWith(fetch(request).then(noteEntryVersion).catch(() => recoveryPage()));
});
