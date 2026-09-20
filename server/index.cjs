'use strict';

const http = require('node:http');
const {gzipSync} = require('node:zlib');
const routes = require('./routes.cjs');
const {TEACHER_ROUTES,acceptsGzip,varyAcceptEncoding} = require('../api/_lib/response-encoding.cjs');

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

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

async function parseBody(req, limit) {
  const declaredLength = req.headers['content-length'];
  if (declaredLength && Number(declaredLength) > limit) throw new RequestError(413, 'Request body too large');
  const contentEncoding = req.headers['content-encoding'];
  if (contentEncoding && contentEncoding !== 'identity') throw new RequestError(415, 'Unsupported content encoding');
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  let length = 0;
  const chunks = [];
  // Event listeners let us return a JSON 413 before closing an oversized request.
  await new Promise((resolve, reject) => {
    function cleanup() {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onAborted);
    }
    function onData(chunk) {
      length += chunk.length;
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
  });
  if (!length) return {};
  if (type !== 'application/json' && !/^application\/[a-z0-9.+-]+\+json$/.test(type)) throw new RequestError(415, 'Expected application/json');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new RequestError(400, 'Invalid JSON body'); }
}

function createApiServer({ handlers, requestTimeoutMs } = {}) {
  const loadedHandlers = handlers || require('./.build/handlers.cjs').default;
  for (const name of Object.keys(routes)) {
    if (typeof loadedHandlers[name] !== 'function') throw new Error(`Missing API handler: ${name}`);
  }
  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, async (req, res) => {
    addResponseHelpers(req, res);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { return res.status(400).json({ error: 'Invalid request URL' }); }
    if (url.pathname === '/api/health' || url.pathname === '/api/health/') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'Method not allowed' });
      return res.status(200).json({ ok: true });
    }
    const name = /^\/api\/([a-z-]+)\/?$/.exec(url.pathname)?.[1];
    if (!name || !Object.hasOwn(routes, name)) return res.status(404).json({ error: 'Not found' });
    req.query = parseQuery(url.searchParams);
    const timer = setTimeout(() => {
      if (!res.writableEnded && !res.destroyed) {
        if (res.headersSent) { res.destroy(); return; }
        res.setHeader('Connection', 'close');
        res.status(504).json({ error: 'Request timed out' });
      }
    }, requestTimeoutMs ?? routes[name].timeoutMs);
    timer.unref();
    const clearTimer = () => clearTimeout(timer);
    res.once('finish', clearTimer);
    res.once('close', clearTimer);
    try {
      req.body = await parseBody(req, routes[name].bodyLimit);
      if (res.writableEnded || res.destroyed) return;
      await loadedHandlers[name](req, res);
      // Some Vercel handlers use callbacks without returning a promise. Their
      // response may arrive after the handler returns, so leave it open here.
    } catch (error) {
      if (res.writableEnded || res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      const expected = error instanceof RequestError;
      if (!expected) console.error(`API handler failed: ${name}`); // no payloads or credentials
      res.setHeader('Connection', 'close');
      res.status(expected ? error.status : 500).json({ error: expected ? error.message : 'Internal server error' });
    }
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 30000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
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

module.exports = { createApiServer };
