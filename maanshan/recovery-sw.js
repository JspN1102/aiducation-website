'use strict';

// Navigation recovery only. Every page, module and account request still uses
// the network; no response, identity or learning record is stored here.
const MAIN_ENTRANCE = self.location.hostname === 'mandarin.aiducation.asia';
const SCHOOL_ENTRIES = new Set(['/school/', '/school/index.html']);
const LEGACY_ENTRIES = /^\/(?:maanshan\/?|)$/;

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

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The company backup retains its homepage and separate legacy demo.
  if (MAIN_ENTRANCE && LEGACY_ENTRIES.test(url.pathname)) {
    event.respondWith(Promise.resolve(Response.redirect(new URL('/school/', url).href, 307)));
    return;
  }
  if (!SCHOOL_ENTRIES.has(url.pathname)) return;
  event.respondWith(fetch(request).catch(() => recoveryPage()));
});
