'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { createApiServer } = require('./index.cjs');
const routes = require('./routes.cjs');

async function start(t, options) {
  const server = createApiServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
function fixtures(handler) {
  return Object.fromEntries(Object.keys(routes).map(name => [name, handler]));
}
function post(base, path, body, headers = {}) {
  return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
}

test('bundled real handlers preserve health, validation, methods and dynamic teaching import', async t => {
  // No paid API or real database requests are made by this test.
  const names = ['GPT_API_KEY', 'GPT_API_BASE', 'TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY', 'TENCENT_APP_ID', 'DB_HOST', 'INIT_KEY'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  names.forEach(name => delete process.env[name]);
  t.after(() => names.forEach(name => previous[name] === undefined ? delete process.env[name] : process.env[name] = previous[name]));
  const base = await start(t);
  const health = await fetch(base + '/api/health/');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  const head = await fetch(base + '/api/health', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  for (const name of ['soe', 'tts', 'maanshan-chat', 'maanshan-report', 'maanshan-save', 'handwriting']) {
    const response = await post(base, `/api/${name}/`, '{}');
    assert.equal(response.status, 400, name);
  }
  const options = await fetch(base + '/api/soe', { method: 'OPTIONS' });
  assert.equal(options.status, 200);
  assert.match(options.headers.get('access-control-allow-methods'), /POST/);
  assert.equal((await fetch(base + '/api/soe/')).status, 405);
  assert.equal((await fetch(base + '/api/maanshan-init?key=incorrect')).status, 403);
  const report = await post(base, '/api/maanshan-report', JSON.stringify({ poemId: 1, studentGrade: 1, soeResult: { total_score: 70, words: [], linesCompleted: 1 } }));
  assert.equal(report.status, 500);
  assert.deepEqual(await report.json(), { error: 'GPT API not configured' });
});

test('unknown paths and source files are never executed or served', async t => {
  const base = await start(t, { handlers: fixtures(() => assert.fail('Unknown route called a handler')) });
  for (const path of ['/.env', '/api/_lib/db.js', '/api/tts.js', '/api/tts/extra', '/server/.build/handlers.cjs', '/maanshan/', '/api/%74ts', '/api/constructor']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});

test('JSON bodies, duplicate query parameters and Buffer responses follow Vercel semantics', async t => {
  const base = await start(t, { handlers: fixtures((req, res) => {
    if (req.query.binary) return res.status(206).setHeader('Content-Type', 'audio/wav').send(Buffer.from([1, 2, 3]));
    return res.status(201).json({ body: req.body, query: req.query });
  }) });
  const response = await post(base, '/api/tts/?key=a&key=b&__proto__=safe', '{"text":"春雨"}');
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { body: { text: '春雨' }, query: { key: ['a', 'b'], ['__proto__']: 'safe' } });
  const binary = await fetch(base + '/api/tts?binary=1');
  assert.equal(binary.status, 206);
  assert.equal(binary.headers.get('content-type'), 'audio/wav');
  assert.deepEqual(Buffer.from(await binary.arrayBuffer()), Buffer.from([1, 2, 3]));
  const head = await fetch(base + '/api/tts?binary=1', { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '3');
  assert.equal(await head.text(), '');
});

test('malformed, compressed, non-JSON and oversized requests fail before handlers', async t => {
  const base = await start(t, { handlers: fixtures(() => assert.fail('Invalid input called a handler')) });
  assert.equal((await post(base, '/api/tts', '{')).status, 400);
  assert.equal((await post(base, '/api/tts', '{}', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post(base, '/api/tts', '{}', { 'Content-Encoding': 'gzip' })).status, 415);
  assert.equal((await post(base, '/api/tts', JSON.stringify({ text: 'a'.repeat(65536) }))).status, 413);
  const chunkedStatus = await new Promise((resolve, reject) => {
    const req = http.request(base + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.write('"');
    req.write('a'.repeat(65537));
    req.end('"');
  });
  assert.equal(chunkedStatus, 413);
});

test('callback handlers finish normally and hung handlers receive a bounded timeout', async t => {
  const base = await start(t, { requestTimeoutMs: 100, handlers: fixtures((req, res) => {
    if (req.query.hang) return;
    setTimeout(() => res.status(200).json({ delayed: true }), 10);
  }) });
  assert.deepEqual(await (await fetch(base + '/api/tts')).json(), { delayed: true });
  const timedOut = await fetch(base + '/api/tts?hang=1');
  assert.equal(timedOut.status, 504);
  assert.deepEqual(await timedOut.json(), { error: 'Request timed out' });
  assert.equal((await fetch(base + '/api/health')).status, 200);
});

test('late provider callbacks cannot change a timeout response or crash the service', async t => {
  let completed;
  const callback = new Promise(resolve => { completed = resolve; });
  const base = await start(t, { requestTimeoutMs: 25, handlers: fixtures((req, res) => {
    setTimeout(() => {
      try {
        res.status(200);
        res.setHeader('Content-Type', 'audio/wav');
        res.end(Buffer.from('late audio'));
        completed();
      } catch (error) { completed(error); }
    }, 75);
  }) });
  const response = await fetch(base + '/api/tts');
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), { error: 'Request timed out' });
  assert.equal(await callback, undefined);
  assert.equal((await fetch(base + '/api/health')).status, 200);
});
