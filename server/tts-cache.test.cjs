'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const cache = require('../api/_lib/tts-cache.js');

function wav(size = 3200, fill = 1) {
  const audio = Buffer.alloc(44 + size, fill);
  audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4);
  audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(size, 40);
  return audio;
}

async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'maanshan-tts-test-'));
  const previous = process.env.TTS_CACHE_DIR;
  process.env.TTS_CACHE_DIR = root;
  t.after(async () => {
    previous === undefined ? delete process.env.TTS_CACHE_DIR : process.env.TTS_CACHE_DIR = previous;
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

test('disk speech survives a fresh process and preserves complete audio during atomic replacement', async t => {
  const root = await directory(t);
  const key = cache.cacheKey({ text: '春雨', voice: 403001, speed: -.75 });
  assert.equal((await cache.readAudio(key)).status, 'miss');
  const first = wav(), second = wav(6400, 2);
  assert.equal(await cache.writeAudio(key, first), true);
  assert.deepEqual((await cache.readAudio(key)).audio, first);
  const child = spawnSync(process.execPath, ['-e', 'require(process.argv[1]).readAudio(process.argv[2]).then(r => console.log(JSON.stringify({status:r.status,bytes:r.audio?.length})))', require.resolve('../api/_lib/tts-cache.js'), key], { encoding: 'utf8', env: { ...process.env, TTS_CACHE_DIR: root } });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { status: 'hit', bytes: first.length });
  for (let index = 0; index < 100; index++) {
    const [written, read] = await Promise.all([cache.writeAudio(key, index % 2 ? first : second), cache.readAudio(key)]);
    assert.equal(written, true);
    assert.equal(read.status, 'hit');
    assert.ok(read.audio.equals(first) || read.audio.equals(second));
  }
  const files = await fs.readdir(path.join(root, cache.CACHE_VERSION));
  assert.deepEqual(files, [`${key}.wav`]);
});

test('disk cache rejects traversal keys, corrupted and oversized audio without unsafe files', async t => {
  const root = await directory(t);
  for (const key of ['../outside', '', 'a'.repeat(63), 'A'.repeat(64)]) {
    assert.equal(await cache.writeAudio(key, wav()), false);
    assert.equal((await cache.readAudio(key)).status, 'unavailable');
  }
  const key = cache.cacheKey({ text: '雨', voice: 403001, speed: -.75 });
  assert.equal(await cache.writeAudio(key, Buffer.alloc(50)), false);
  assert.equal(await cache.writeAudio(key, wav(cache.MAX_AUDIO_BYTES)), false);
  assert.equal(await cache.writeAudio(key, wav()), true);
  const filename = path.join(root, cache.CACHE_VERSION, `${key}.wav`);
  await fs.writeFile(filename, Buffer.alloc(50));
  assert.equal((await cache.hasAudio(key)).status, 'unavailable');
  await fs.writeFile(filename, Buffer.alloc(cache.MAX_AUDIO_BYTES + 1));
  assert.equal((await cache.readAudio(key)).status, 'unavailable');
  const corrupt = wav(); corrupt.writeUInt32LE(99, 40);
  await fs.writeFile(filename, corrupt);
  assert.equal((await cache.readAudio(key)).status, 'unavailable');
});
