'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

function wav(size = 3200) {
  const audio = Buffer.alloc(44 + size, 1);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4);
  audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(size, 40);
  return audio;
}

// Exercise the real cache against a private-store stand-in. No paid APIs or
// production credentials; verify network calls and returned bytes, not internals.
function fixture() {
  const env = { BLOB_READ_WRITE_TOKEN: 'test-private-store' };
  const persisted = new Map(), calls = { head: 0, get: 0, put: 0 };
  let clock = 1000, rejectWrites = false;
  class Missing extends Error {}
  const provider = {
    BlobNotFoundError: Missing,
    async head(name) {
      calls.head++;
      await new Promise(resolve => setTimeout(resolve, 2));
      if (!persisted.has(name)) throw new Missing();
      return { size: persisted.get(name).length, contentType: 'audio/wav' };
    },
    async get(name) {
      calls.get++;
      await new Promise(resolve => setTimeout(resolve, 2));
      const audio = persisted.get(name);
      return audio ? { statusCode: 200, blob: { size: audio.length, contentType: 'audio/wav' },
        stream: new ReadableStream({ start(controller) { controller.enqueue(audio); controller.close(); } }) } : null;
    },
    async put(name, audio) {
      calls.put++;
      if (rejectWrites) throw new Error('Store unavailable');
      persisted.set(name, Buffer.from(audio));
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../api/_lib/tts-cache.js'), 'utf8'), {
    module, require: name => name === '@vercel/blob' ? provider : require(name),
    Buffer, process: { env }, AbortSignal, Date: { now: () => clock }, setTimeout,
  }, { filename: 'tts-cache.js' });
  const cache = module.exports;
  const key = text => cache.cacheKey({ text, voice: 403001, speed: -.75 });
  const add = (id, audio = wav()) => persisted.set(`speech/${cache.CACHE_VERSION}/${id}.wav`, audio);
  return { cache, env, calls, persisted, key, add, advance: () => { clock += 61000; }, failWrites: () => { rejectWrites = true; } };
}

test('concurrent speech reads download once; repeated taps reuse verified audio', async () => {
  const f = fixture(), id = f.key('雨'), audio = wav(); f.add(id, audio);
  const heads = await Promise.all(Array.from({ length: 20 }, () => f.cache.hasAudio(id)));
  assert.ok(heads.every(result => result.status === 'hit'));
  assert.equal(f.calls.head, 1);
  const reads = await Promise.all(Array.from({ length: 20 }, () => f.cache.readAudio(id)));
  assert.ok(reads.every(result => result.status === 'hit' && result.audio.equals(audio)));
  assert.equal(f.calls.get, 1);
  await f.cache.hasAudio(id); await f.cache.readAudio(id);
  assert.equal(f.calls.head, 1); assert.equal(f.calls.get, 1);
});

test('TTL and credential changes recheck private storage; no persistent success is fabricated', async () => {
  const f = fixture(), id = f.key('荷'), audio = wav();
  assert.equal(await f.cache.writeAudio(id, audio), true);
  assert.equal((await f.cache.readAudio(id)).status, 'hit'); assert.equal(f.calls.get, 0);
  f.env.BLOB_READ_WRITE_TOKEN = 'different-private-store';
  await f.cache.readAudio(id); assert.equal(f.calls.get, 1);
  f.persisted.clear(); f.advance();
  assert.equal((await f.cache.readAudio(id)).status, 'miss');
  assert.equal((await f.cache.hasAudio(id)).status, 'miss');
  f.failWrites();
  assert.equal(await f.cache.writeAudio(id, audio), false);
  assert.equal((await f.cache.readAudio(id)).status, 'miss');
  delete f.env.BLOB_READ_WRITE_TOKEN;
  assert.equal((await f.cache.readAudio(id)).status, 'disabled');
});

test('corrupted stored waveforms and invalid keys never enter the hot cache', async () => {
  const f = fixture(), id = f.key('舟'); f.add(id, Buffer.alloc(100));
  assert.equal((await f.cache.readAudio(id)).status, 'unavailable');
  f.add(id, wav());
  assert.equal((await f.cache.readAudio(id)).status, 'hit');
  assert.equal(f.calls.get, 2);
  assert.equal(await f.cache.writeAudio(id, Buffer.alloc(100)), false);
  assert.equal(await f.cache.writeAudio(id, wav(3 * 1024 * 1024)), false,'long server recordings must not expand the Blob upload limit');
  for (const key of ['../escape', '', 'A'.repeat(64)]) {
    assert.equal((await f.cache.readAudio(key)).status, 'unavailable');
    assert.equal((await f.cache.hasAudio(key)).status, 'unavailable');
    assert.equal(await f.cache.writeAudio(key, wav()), false);
  }
  assert.equal(f.calls.get, 2); assert.equal(f.calls.put, 0);
});

test('hot audio bytes and metadata are bounded and evicted data stays persistent', async () => {
  const f = fixture(), first = f.key('audio-0');
  for (let i = 0; i < 9; i++) assert.equal(await f.cache.writeAudio(f.key('audio-' + i), wav(2 * 1024 * 1024 - 44)), true);
  assert.equal((await f.cache.readAudio(first)).status, 'hit');
  assert.equal(f.calls.get, 1); // Over 16 MiB: oldest waveform needed a download.
  const metadata = fixture(), firstMetadata = metadata.key('meta-0');
  for (let i = 0; i < 129; i++) {
    const id = metadata.key('meta-' + i); metadata.add(id);
    await metadata.cache.hasAudio(id);
  }
  await metadata.cache.hasAudio(firstMetadata);
  assert.equal(metadata.calls.head, 130);
});
