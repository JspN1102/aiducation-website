'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {gunzipSync} = require('node:zlib');
const moduleURL = '../maanshan/handwriting-payload.mjs';

test('dense tablet ink is much smaller on the wire without losing any samples or assessment context', async () => {
  const {prepareHandwritingPayload} = await import(moduleURL);
  const ink = Array.from({length:12}, (_, stroke) => [
    Array.from({length:200}, (_, point) => Math.round(100 + point * 1.4)),
    Array.from({length:200}, () => 50 + stroke * 35),
    Array.from({length:200}, (_, point) => stroke * 1500 + point * 5)
  ]);
  const original = {ink, poemId:6, researchContext:{mode:'review', actorId:'synthetic', itemId:'synthetic'}};
  const packed = await prepareHandwritingPayload(original);
  assert.equal(packed.ink, undefined);
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(packed.inkGzip, 'base64')).toString('utf8')), ink);
  assert.equal(packed.poemId, original.poemId);
  assert.deepEqual(packed.researchContext, original.researchContext);
  assert(JSON.stringify(packed).length < JSON.stringify(original).length / 3);
  assert.deepEqual(original.ink, ink, 'the original stroke arrays remain untouched');
});

test('small ink, unsupported browsers and local compression failure retain the legacy request', async () => {
  const {prepareHandwritingPayload} = await import(moduleURL);
  const small = {ink:[[[1], [2], [0]]], poemId:1};
  assert.equal(await prepareHandwritingPayload(small), small);
  const large = {ink:[Array(2000).fill(1), Array(2000).fill(2), Array(2000).fill(0)]};
  assert.equal(await prepareHandwritingPayload(large, {scope:{}}), large);
  assert.equal(await prepareHandwritingPayload(large, {scope:{CompressionStream:class {constructor(){throw new Error('Unavailable');}}}}), large);
  assert.equal(await prepareHandwritingPayload({inkGzip:'already-packed'}).then(value=>value.inkGzip), 'already-packed');
});
