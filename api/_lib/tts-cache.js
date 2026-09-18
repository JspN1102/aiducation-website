const crypto = require('node:crypto');
const { BlobNotFoundError, get, head, put } = require('@vercel/blob');

const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const CACHE_VERSION = '20260919b2';
const blobPath = key => `speech/${CACHE_VERSION}/${key}.wav`;
function cacheKey({ text, voice, speed, pronunciationVersion = '', profile = '' }) {
  return crypto.createHash('sha256').update(JSON.stringify({ version: CACHE_VERSION, text, voice, speed, pronunciationVersion, profile, codec: 'pcm16le-wav-16k' })).digest('hex');
}
async function hasAudio(key) {
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
  if (!process.env.BLOB_READ_WRITE_TOKEN || !Buffer.isBuffer(audio) || audio.length < 44 || audio.length > MAX_AUDIO_BYTES) return false;
  try {
    await put(blobPath(key), audio, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'audio/wav', cacheControlMaxAge: 31536000, abortSignal: AbortSignal.timeout(3000) });
    return true;
  } catch { return false; }
}
module.exports = { CACHE_VERSION, MAX_AUDIO_BYTES, cacheKey, hasAudio, readAudio, writeAudio };
