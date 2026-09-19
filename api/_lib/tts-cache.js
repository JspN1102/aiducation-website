const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { BlobNotFoundError, get, head, put } = require('@vercel/blob');

const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const CACHE_VERSION = '20260919b3';
const blobPath = key => `speech/${CACHE_VERSION}/${key}.wav`;
// Repeated taps should not issue another overseas HEAD + GET in a warm
// instance. Persistent storage remains authoritative after this short TTL.
const HOT_TTL_MS = 60000;
const HOT_MAX_BYTES = 16 * 1024 * 1024;
const HOT_MAX_ENTRIES = 128;
const hot = new Map(), pendingReads = new Map(), pendingHeads = new Map();
let hotBytes = 0;
function hotKey(key) {
  return crypto.createHash('sha256').update(process.env.BLOB_READ_WRITE_TOKEN).digest('hex') + ':' + key;
}
function forget(id) {
  const item = hot.get(id);
  if (item) hotBytes -= item.audio?.length || 0;
  hot.delete(id);
}
function recall(id) {
  const item = hot.get(id);
  if (!item) return null;
  if (item.until <= Date.now()) { forget(id); return null; }
  hot.delete(id); hot.set(id, item);
  return item;
}
function remember(id, audio = null) {
  // A late HEAD must not replace an already downloaded waveform with metadata.
  const previous = recall(id);
  if (!audio && previous) return;
  forget(id);
  hot.set(id, { audio, until: Date.now() + HOT_TTL_MS });
  hotBytes += audio?.length || 0;
  while (hot.size > HOT_MAX_ENTRIES || hotBytes > HOT_MAX_BYTES) forget(hot.keys().next().value);
}
async function coalesce(pending, id, operation) {
  if (pending.has(id)) return pending.get(id);
  // Bound bookkeeping even if many distinct phrases arrive at once.
  if (pending.size >= 64) return operation();
  const work = operation().finally(() => pending.delete(id));
  pending.set(id, work);
  return work;
}
// A persistent directory on the standalone server avoids an overseas cache
// round-trip. Vercel keeps using Blob when this setting is absent.
function diskPath(key) {
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('Invalid speech cache key');
  return path.join(process.env.TTS_CACHE_DIR, CACHE_VERSION, `${key}.wav`);
}
function validDiskAudio(audio) {
  // synthesize() produces this fixed mono PCM header. Check lengths and format,
  // not only the RIFF marker, so truncated/corrupt files trigger regeneration.
  return Buffer.isBuffer(audio) && audio.length > 44 && audio.length <= MAX_AUDIO_BYTES &&
    audio.toString('ascii', 0, 4) === 'RIFF' && audio.readUInt32LE(4) === audio.length - 8 &&
    audio.toString('ascii', 8, 16) === 'WAVEfmt ' && audio.readUInt32LE(16) === 16 &&
    audio.readUInt16LE(20) === 1 && audio.readUInt16LE(22) === 1 &&
    audio.readUInt32LE(24) === 16000 && audio.readUInt32LE(28) === 32000 &&
    audio.readUInt16LE(32) === 2 && audio.readUInt16LE(34) === 16 &&
    audio.toString('ascii', 36, 40) === 'data' && audio.readUInt32LE(40) === audio.length - 44 &&
    (audio.length - 44) % 2 === 0;
}
async function readDisk(key) {
  try {
    const filename = diskPath(key), info = await fs.stat(filename);
    if (!info.isFile() || info.size < 44 || info.size > MAX_AUDIO_BYTES) return { status: 'unavailable', audio: null };
    const audio = await fs.readFile(filename);
    return validDiskAudio(audio)
      ? { status: 'hit', audio } : { status: 'unavailable', audio: null };
  } catch (error) { return { status: error.code === 'ENOENT' ? 'miss' : 'unavailable', audio: null }; }
}
async function replaceDiskFile(temporary, filename) {
  // Windows briefly denies replacing a file held by a concurrent reader.
  // Retry the atomic rename; never unlink the live audio to make room.
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(temporary, filename); return; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}
function cacheKey({ text, voice, speed, pronunciationVersion = '', profile = '' }) {
  return crypto.createHash('sha256').update(JSON.stringify({ version: CACHE_VERSION, text, voice, speed, pronunciationVersion, profile, codec: 'pcm16le-wav-16k' })).digest('hex');
}
async function hasAudio(key) {
  if (process.env.TTS_CACHE_DIR) { const result = await readDisk(key); return { status: result.status }; }
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { status: 'disabled' };
  if (!/^[0-9a-f]{64}$/.test(key)) return { status: 'unavailable' };
  const id = hotKey(key);
  if (recall(id)) return { status: 'hit' };
  return coalesce(pendingHeads, id, async () => { try {
    const info = await head(blobPath(key), { abortSignal: AbortSignal.timeout(3000) });
    if (info.size > 44 && info.size <= MAX_AUDIO_BYTES && info.contentType === 'audio/wav') {
      remember(id);
      return { status: 'hit' };
    }
    return { status: 'unavailable' };
  } catch (error) {
    return { status: error instanceof BlobNotFoundError ? 'miss' : 'unavailable' };
  } });
}
async function readAudio(key) {
  if (process.env.TTS_CACHE_DIR) return readDisk(key);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { status: 'disabled', audio: null };
  if (!/^[0-9a-f]{64}$/.test(key)) return { status: 'unavailable', audio: null };
  const id = hotKey(key), existing = recall(id);
  if (existing?.audio) return { status: 'hit', audio: existing.audio };
  return coalesce(pendingReads, id, async () => { try {
    const response = await get(blobPath(key), { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(3000) });
    if (!response) { forget(id); return { status: 'miss', audio: null }; }
    if (response.statusCode !== 200 || response.blob.size > MAX_AUDIO_BYTES || response.blob.contentType !== 'audio/wav') {
      await response.stream?.cancel();
      forget(id);
      return { status: 'unavailable', audio: null };
    }
    const reader = response.stream.getReader(), chunks = []; let length = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > MAX_AUDIO_BYTES) { await reader.cancel(); forget(id); return { status: 'unavailable', audio: null }; }
      chunks.push(Buffer.from(value));
    }
    const audio = Buffer.concat(chunks);
    if (!validDiskAudio(audio)) { forget(id); return { status: 'unavailable', audio: null }; }
    remember(id, audio);
    return { status: 'hit', audio };
  } catch { forget(id); return { status: 'unavailable', audio: null }; } });
}
async function writeAudio(key, audio) {
  if (process.env.TTS_CACHE_DIR) {
    let temporary;
    try {
      if (!validDiskAudio(audio)) return false;
      const filename = diskPath(key);
      await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      temporary = `${filename}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporary, audio, { flag: 'wx', mode: 0o600 });
      await replaceDiskFile(temporary, filename);
      return true;
    } catch { return false; }
    finally { if (temporary) await fs.unlink(temporary).catch(() => {}); }
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN || !/^[0-9a-f]{64}$/.test(key) || !validDiskAudio(audio)) return false;
  const id = hotKey(key);
  try {
    await put(blobPath(key), audio, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'audio/wav', cacheControlMaxAge: 31536000, abortSignal: AbortSignal.timeout(3000) });
    remember(id, audio);
    return true;
  } catch { return false; }
}
module.exports = { CACHE_VERSION, MAX_AUDIO_BYTES, cacheKey, hasAudio, readAudio, writeAudio };
