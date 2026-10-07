'use strict';

const http = require('node:http');
const {gzipSync} = require('node:zlib');
const routes = require('./routes.cjs');
const {TEACHER_ROUTES,acceptsGzip,varyAcceptEncoding} = require('../api/_lib/response-encoding.cjs');

class RequestError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

// Every route answers within a deadline counted from arrival. Recordings cross
// the slow relay leg before any work can start, so theirs is longer, the body
// gets its own budget and the handler deadline starts once the body is in, but
// the total stays under the browser's wait (50 s; speech 40 s, counted from
// before the relay) and the relay's 55 s: nobody is left scoring for no one.
const UPLOAD_DEADLINES = new Map([['soe', 45000], ['school-recordings', 45000], ['speech-to-text', 35000]]);
const routeDeadline = name => UPLOAD_DEADLINES.get(name) ?? routes[name].timeoutMs;
// Uploads leave the handler at least 5 s and get a distinct 408 their clients
// retry; other routes keep the old window (Node's 30 s) and the old 504.
const bodyBudget = name => UPLOAD_DEADLINES.has(name) ? UPLOAD_DEADLINES.get(name) - 5000 : Math.min(30000, routes[name].timeoutMs);
// Only the labels the relay sends (route:port, `hop-` after a sibling hop); a
// direct client's header can never put an arbitrary token in the journal.
const RELAY_LABEL = /^(?:hop-)?(?:hk:310[0-2]|gz:3100)$/;

function addResponseHelpers(req, res) {
  // Providers may settle after our deadline or after a browser disconnects.
  // Their late callback must not raise ERR_HTTP_HEADERS_SENT/write-after-end.
  for (const method of ['setHeader', 'removeHeader', 'writeHead', 'write', 'end']) {
    const native = res[method];
    res[method] = function (...args) {
      if (this.writableEnded || this.destroyed) return method === 'write' ? false : this;
      return native.apply(this, args);
    };
  }
  res.status = function (code) {
    if (!this.headersSent) this.statusCode = code;
    return this;
  };
  res.send = function (body) {
    if (this.writableEnded || this.destroyed) return this;
    if (body !== null && typeof body === 'object' && !Buffer.isBuffer(body)) return this.json(body);
    const content = body == null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    if (!this.hasHeader('Content-Type')) this.setHeader('Content-Type', Buffer.isBuffer(body) ? 'application/octet-stream' : 'text/plain; charset=utf-8');
    if (!this.hasHeader('Content-Length')) this.setHeader('Content-Length', content.length);
    return this.end(req.method === 'HEAD' ? undefined : content);
  };
  res.json = function (body) {
    if (this.writableEnded || this.destroyed) return this;
    this.setHeader('Content-Type', 'application/json; charset=utf-8');
    const content=Buffer.from(JSON.stringify(body)??'');
    const route=/^\/api\/([a-z-]+)\/?(?:\?|$)/.exec(req.url)?.[1];
    if(TEACHER_ROUTES.has(route)){
      this.setHeader('Vary',varyAcceptEncoding(this.getHeader('Vary')));
      // Low-level synchronous gzip costs only a few milliseconds for the bounded
      // teacher payload and cannot race a timeout/late provider response.
      if(content.length>=1024&&this.statusCode!==204&&this.statusCode!==304&&!this.hasHeader('Content-Encoding')&&acceptsGzip(req.headers['accept-encoding'])){
        const compressed=gzipSync(content,{level:1});
        if(compressed.length<content.length){
          this.setHeader('Content-Encoding','gzip');this.setHeader('Content-Length',compressed.length);
          return this.send(compressed);
        }
      }
    }
    return this.send(content);
  };
}

function parseQuery(searchParams) {
  const query = Object.create(null);
  for (const [key, value] of searchParams) {
    if (!Object.hasOwn(query, key)) query[key] = value;
    else if (Array.isArray(query[key])) query[key].push(value);
    else query[key] = [query[key], value];
  }
  return query;
}

async function parseBody(req, limit, timeoutMs, stats, expired) {
  const declaredLength = req.headers['content-length'];
  if (declaredLength && Number(declaredLength) > limit) throw new RequestError(413, 'Request body too large');
  const contentEncoding = req.headers['content-encoding'];
  if (contentEncoding && contentEncoding !== 'identity') throw new RequestError(415, 'Unsupported content encoding');
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  let length = 0;
  const chunks = [];
  // Event listeners let us return a JSON 413/408/504 before closing the request.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); req.pause(); reject(expired()); }, timeoutMs);
    timer.unref();
    function cleanup() {
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onAborted);
      req.off('close', onAborted);
    }
    function onData(chunk) {
      length += chunk.length;
      stats.bytes = length;
      if (length > limit) { cleanup(); req.pause(); reject(new RequestError(413, 'Request body too large')); }
      else chunks.push(chunk);
    }
    function onEnd() { cleanup(); resolve(); }
    function onError(error) { cleanup(); reject(error); }
    function onAborted() { cleanup(); reject(new RequestError(400, 'Request interrupted')); }
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    req.once('aborted', onAborted);
    req.once('close', onAborted);
  });
  if (!length) return {};
  if (type !== 'application/json' && !/^application\/[a-z0-9.+-]+\+json$/.test(type)) throw new RequestError(415, 'Expected application/json');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new RequestError(400, 'Invalid JSON body'); }
}

function createApiServer({ handlers, requestTimeoutMs, bodyTimeoutMs, deadlineMs, log = line => console.log(line) } = {}) {
  const loadedHandlers = handlers || require('./.build/handlers.cjs').default;
  for (const name of Object.keys(routes)) {
    if (typeof loadedHandlers[name] !== 'function') throw new Error(`Missing API handler: ${name}`);
  }
  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, async (req, res) => {
    const started = performance.now(), stats = { bytes: 0 };
    let bodyMs = null, handlerStarted = null, logged = false, timer;
    addResponseHelpers(req, res);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { return res.status(400).json({ error: 'Invalid request URL' }); }
    const name = /^\/api\/([a-z-]+)\/?$/.exec(url.pathname)?.[1];
    if (url.pathname.startsWith('/api/')) {
      // One line per request for journald: fixed labels, sizes and timings only;
      // never addresses, cookies, query strings, accounts or payloads.
      const route = name === 'health' ? name : name && Object.hasOwn(routes, name) ? name : 'unknown';
      const relay = req.headers['x-school-relay'];
      const done = finished => {
        if (logged) return;
        logged = true;
        const now = performance.now();
        // 499: the connection closed before any response; closed: cut off midway.
        const entry = { event: 'api', route, method: req.method, status: finished || res.headersSent ? res.statusCode : 499, bodyBytes: stats.bytes, bodyMs,
          handlerMs: handlerStarted === null ? null : Math.round(now - handlerStarted), totalMs: Math.round(now - started) };
        if (typeof relay === 'string' && RELAY_LABEL.test(relay)) entry.relay = relay;
        if (!finished) entry.closed = true;
        try { log(JSON.stringify(entry)); } catch {}
      };
      res.once('finish', () => done(true));
      res.once('close', () => done(false));
    }
    if (url.pathname === '/api/health' || url.pathname === '/api/health/') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'Method not allowed' });
      return res.status(200).json({ ok: true });
    }
    if (!name || !Object.hasOwn(routes, name)) return res.status(404).json({ error: 'Not found' });
    req.query = parseQuery(url.searchParams);
    const clearTimer = () => clearTimeout(timer);
    res.once('finish', clearTimer);
    res.once('close', clearTimer);
    const expired = UPLOAD_DEADLINES.has(name) ? () => new RequestError(408, 'Request body timed out', { ok: false, code: 'BODY_TIMEOUT' }) : () => new RequestError(504, 'Request timed out');
    try {
      try { req.body = await parseBody(req, routes[name].bodyLimit, bodyTimeoutMs ?? bodyBudget(name), stats, expired); }
      finally { bodyMs = Math.round(performance.now() - started); }
      if (res.writableEnded || res.destroyed) return;
      // Armed only now, with whatever the route's deadline from arrival leaves.
      timer = setTimeout(() => {
        if (!res.writableEnded && !res.destroyed) {
          if (res.headersSent) { res.destroy(); return; }
          res.setHeader('Connection', 'close');
          res.status(504).json({ error: 'Request timed out' });
        }
      }, Math.max(0, Math.min(requestTimeoutMs ?? routes[name].timeoutMs, (deadlineMs ?? routeDeadline(name)) - (performance.now() - started))));
      timer.unref();
      handlerStarted = performance.now();
      await loadedHandlers[name](req, res);
      // Some Vercel handlers use callbacks without returning a promise. Their
      // response may arrive after the handler returns, so leave it open here.
    } catch (error) {
      if (res.writableEnded || res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      const expected = error instanceof RequestError;
      if (!expected) console.error(`API handler failed: ${name}`); // no payloads or credentials
      res.setHeader('Connection', 'close');
      res.status(expected ? error.status : 500).json(expected ? error.body || { error: error.message } : { error: 'Internal server error' });
    }
  });
  server.headersTimeout = 15000;
  // Above every body budget (40 s) and below the relay's own 55 s deadline.
  server.requestTimeout = 50000;
  server.keepAliveTimeout = 95000; // the relay expires its channels ten seconds earlier
  server.maxRequestsPerSocket = 100;
  const stopReportWorker=loadedHandlers['teacher-tools'].startBackgroundWorker?.();
  if(stopReportWorker)server.once('close',stopReportWorker);
  return server;
}

if (require.main === module) {
  const host = process.env.API_HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = createApiServer();
  server.listen(port, host, () => console.log(`Mandarin API listening on ${host}:${port}`));
  server.on('error', error => { console.error(`API server error: ${error.code || 'unknown'}`); process.exitCode = 1; });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => process.exit(0));
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createApiServer, bodyBudget, routeDeadline };
