const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { BlobNotFoundError, get, head, put } = require('@vercel/blob');

const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const CACHE_VERSION = '20260919b3';
const blobPath = key => `speech/${CACHE_VERSION}/${key}.wav`;
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
  try {
    const info = await head(blobPath(key), { abortSignal: AbortSignal.timeout(3000) });
    return info.size >= 44 && info.size <= MAX_AUDIO_BYTES && info.contentType === 'audio/wav'
      ? { status: 'hit' } : { status: 'unavailable' };
  } catch (error) {
    return { status: error instanceof BlobNotFoundError ? 'miss' : 'unavailable' };
  }
}
async function readAudio(key) {
  if (process.env.TTS_CACHE_DIR) return readDisk(key);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { status: 'disabled', audio: null };
  try {
    const response = await get(blobPath(key), { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(3000) });
    if (!response) return { status: 'miss', audio: null };
    if (response.statusCode !== 200 || response.blob.size > MAX_AUDIO_BYTES || response.blob.contentType !== 'audio/wav') return { status: 'unavailable', audio: null };
    const reader = response.stream.getReader(), chunks = []; let length = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > MAX_AUDIO_BYTES) { await reader.cancel(); return { status: 'unavailable', audio: null }; }
      chunks.push(Buffer.from(value));
    }
    return length >= 44 ? { status: 'hit', audio: Buffer.concat(chunks) } : { status: 'unavailable', audio: null };
  } catch { return { status: 'unavailable', audio: null }; }
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
  if (!process.env.BLOB_READ_WRITE_TOKEN || !Buffer.isBuffer(audio) || audio.length < 44 || audio.length > MAX_AUDIO_BYTES) return false;
  try {
    await put(blobPath(key), audio, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'audio/wav', cacheControlMaxAge: 31536000, abortSignal: AbortSignal.timeout(3000) });
    return true;
  } catch { return false; }
}
module.exports = { CACHE_VERSION, MAX_AUDIO_BYTES, cacheKey, hasAudio, readAudio, writeAudio };
