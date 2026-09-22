'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const {gzipSync} = require('node:zlib');
const handwriting = require('../api/handwriting.js');
const ink = [[[10, 20], [30, 40], [0, 50]]];
const relay = 'https://aiducation.asia/api/handwriting/';

async function invoke(body = { ink }, headers = {}, method = 'POST') {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; return this; } };
  await handwriting({ method, body, headers: { host: 'mandarin.aiducation.asia', ...headers } }, res);
  return res;
}

test('handwriting chooses the relay directly and only forwards ink/context', async t => {
  const previous = process.env.HANDWRITING_RELAY_URL;
  process.env.HANDWRITING_RELAY_URL = relay;
  t.after(() => previous === undefined ? delete process.env.HANDWRITING_RELAY_URL : process.env.HANDWRITING_RELAY_URL = previous);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.equal(url, relay);
    assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json', 'x-maanshan-handwriting-relay': '1' });
    assert.deepEqual(JSON.parse(options.body), { ink, pre_context: '春' });
    return Response.json({ candidates: ['雨', '兩'] });
  });
  const result = await invoke({ ink, pre_context: '春', url: 'http://localhost/', secret: 'must-not-forward' }, { authorization: 'must-not-forward', cookie: 'must-not-forward' });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.value, { candidates: ['雨', '兩'] });
  assert.equal(calls, 1);
});

test('unset relay retains direct Google recognition including incoming relay marker', async t => {
  const previous = process.env.HANDWRITING_RELAY_URL;
  delete process.env.HANDWRITING_RELAY_URL;
  t.after(() => previous === undefined ? delete process.env.HANDWRITING_RELAY_URL : process.env.HANDWRITING_RELAY_URL = previous);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url).hostname, 'inputtools.google.com');
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(options.body).requests[0].ink, ink);
    return Response.json(['SUCCESS', [['', ['雨']]]]);
  });
  const result = await invoke({ ink }, { 'x-maanshan-handwriting-relay': '1' });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.value, { candidates: ['雨'] });
});

test('compressed tablet drawing reaches recognition unchanged and ambiguous or oversized encodings are rejected', async t => {
  const previous = process.env.HANDWRITING_RELAY_URL;
  process.env.HANDWRITING_RELAY_URL = relay;
  t.after(() => previous === undefined ? delete process.env.HANDWRITING_RELAY_URL : process.env.HANDWRITING_RELAY_URL = previous);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.deepEqual(JSON.parse(options.body), {ink, pre_context:''});
    return Response.json({candidates:['\u4e00']});
  });
  const inkGzip = gzipSync(JSON.stringify(ink)).toString('base64');
  assert.equal((await invoke({inkGzip})).statusCode, 200);
  assert.equal(calls, 1);
  for (const body of [
    {ink, inkGzip}, {inkGzip:''}, {inkGzip:42}, {inkGzip:'not-gzip'},
    {inkGzip:Buffer.from('not gzip').toString('base64')},
    {inkGzip:gzipSync('x'.repeat(512 * 1024 + 1)).toString('base64')},
    {inkGzip:gzipSync(JSON.stringify({ink})).toString('base64')}
  ]) assert.equal((await invoke(body)).statusCode, 400);
  assert.equal(calls, 1, 'malformed compressed payloads never reach the provider');
});

test('relay refuses invalid destinations, self-host routing, loops and bad ink before network use', async t => {
  const previous = process.env.HANDWRITING_RELAY_URL;
  t.after(() => previous === undefined ? delete process.env.HANDWRITING_RELAY_URL : process.env.HANDWRITING_RELAY_URL = previous);
  t.mock.method(globalThis, 'fetch', () => assert.fail('Invalid request reached the network'));
  for (const url of ['http://aiducation.asia/api/handwriting/', 'https://example.com/api/handwriting/', 'https://aiducation.asia/other', relay + '?target=http://localhost/', 'https://user:password@aiducation.asia/api/handwriting/']) {
    process.env.HANDWRITING_RELAY_URL = url;
    assert.equal((await invoke()).statusCode, 503);
  }
  process.env.HANDWRITING_RELAY_URL = relay;
  assert.equal((await invoke({ ink }, { host: 'aiducation.asia' })).statusCode, 503);
  assert.equal((await invoke({ ink }, { 'x-forwarded-host': 'aiducation.asia' })).statusCode, 503);
  assert.equal((await invoke({ ink }, { 'x-maanshan-handwriting-relay': '1' })).statusCode, 503);
  for (const body of [null, {}, { ink: [] }, { ink: [[[1], [2, 3], [0]]] }, { ink: [[['1'], [2], [0]]] }, { ink, pre_context: {} }]) assert.equal((await invoke(body)).statusCode, 400);
  assert.equal((await invoke({ ink, ignored: 'x'.repeat(512 * 1024) })).statusCode, 413);
});

test('relay validates candidate shape and caps upstream response size', async t => {
  const previous = process.env.HANDWRITING_RELAY_URL;
  process.env.HANDWRITING_RELAY_URL = relay;
  t.after(() => previous === undefined ? delete process.env.HANDWRITING_RELAY_URL : process.env.HANDWRITING_RELAY_URL = previous);
  let response;
  t.mock.method(globalThis, 'fetch', async () => response);
  for (const candidates of [null, {}, '雨', ['雨', {}], [''], ['a'.repeat(33)], Array(11).fill('雨')]) {
    response = Response.json({ candidates });
    assert.equal((await invoke()).statusCode, 502);
  }
  response = Response.json({ candidates: [] });
  assert.equal((await invoke()).statusCode, 200);
  response = new Response('x'.repeat(65537));
  assert.equal((await invoke()).statusCode, 502);
});

test('relay network failures and deadlines return bounded errors without leaked details', async t => {
  const previous = process.env.HANDWRITING_RELAY_URL;
  process.env.HANDWRITING_RELAY_URL = relay;
  t.after(() => previous === undefined ? delete process.env.HANDWRITING_RELAY_URL : process.env.HANDWRITING_RELAY_URL = previous);
  let failure = 'network';
  t.mock.method(globalThis, 'fetch', async () => {
    if (failure === 'network') throw new Error('private upstream details');
    if (failure === 'timeout') throw new DOMException('private request details', 'TimeoutError');
    return new Response('', { status: failure });
  });
  assert.deepEqual((await invoke()).value, { error: 'Recognition service unavailable' });
  failure = 'timeout';
  const timeout = await invoke();
  assert.equal(timeout.statusCode, 504);
  assert.deepEqual(timeout.value, { error: 'Recognition timed out' });
  failure = 500;
  assert.equal((await invoke()).statusCode, 502);
  failure = 504;
  assert.equal((await invoke()).statusCode, 504);
});

test('relay abort signal enforces its deadline while the provider is still pending', async t => {
  const previous = process.env.HANDWRITING_RELAY_URL;
  process.env.HANDWRITING_RELAY_URL = relay;
  t.after(() => previous === undefined ? delete process.env.HANDWRITING_RELAY_URL : process.env.HANDWRITING_RELAY_URL = previous);
  const timeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.equal(milliseconds, 9000);
    return timeout(15);
  });
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => new Promise((resolve, reject) => {
    const unexpectedWait = setTimeout(() => reject(new Error('Abort signal was ignored')), 500);
    signal.addEventListener('abort', () => { clearTimeout(unexpectedWait); reject(signal.reason); }, { once: true });
  }));
  const result = await invoke();
  assert.equal(result.statusCode, 504);
  assert.deepEqual(result.value, { error: 'Recognition timed out' });
});

test('successive checks reuse a connection after writing time but each drawing is recognised afresh', async t => {
  const previous = process.env.HANDWRITING_RELAY_URL;
  process.env.HANDWRITING_RELAY_URL = relay;
  t.after(() => previous === undefined ? delete process.env.HANDWRITING_RELAY_URL : process.env.HANDWRITING_RELAY_URL = previous);
  const sockets = new Set(), drawings = [];
  let interruptResponse = false;
  const server = http.createServer(async (req, res) => {
    sockets.add(req.socket);
    let body = '';
    for await (const chunk of req) body += chunk;
    drawings.push(JSON.parse(body));
    if (interruptResponse) {res.destroy(); return;}
    res.setHeader('Content-Type', 'application/json');
    // No advertised timeout: exercise our provider-specific idle lifetime.
    res.sendDate = false;
    res.writeHead(200, {Connection: 'keep-alive'});
    res.end(JSON.stringify({candidates: [drawings.length === 1 ? '\u4e00' : '\u4e8c']}));
  });
  server.keepAliveTimeout = 65000;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {server.closeAllConnections(); server.close();});
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    assert.equal(url, relay);
    return realFetch(`http://127.0.0.1:${server.address().port}/`, options);
  });
  assert.deepEqual((await invoke({ink})).value.candidates, ['\u4e00']);
  // More than the default fetch idle timeout, less than a new character takes.
  await new Promise(resolve => setTimeout(resolve, 5500));
  assert.deepEqual((await invoke({ink})).value.candidates, ['\u4e8c']);
  assert.equal(sockets.size, 1, 'the second check must not repeat the handshake');
  assert.deepEqual(drawings, [{ink, pre_context: ''}, {ink, pre_context: ''}], 'identical ink still reaches the recognizer for each assessment');
  // A provider may close an idle socket before our own idle lifetime expires.
  server.closeIdleConnections();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await invoke({ink})).statusCode, 200);
  assert.equal(sockets.size, 2, 'a remotely closed idle socket is replaced');
  interruptResponse = true;
  assert.equal((await invoke({ink})).statusCode, 502);
  assert.equal(drawings.length, 4, 'a posted drawing must not be automatically replayed after a broken response');
});
