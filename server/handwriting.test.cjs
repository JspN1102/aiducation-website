'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
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
