'use strict';
// Recordings arrive as the browser's own compact container (Opus in WebM/Ogg,
// AAC in MP4). The inbound path from the relay to Guangzhou is the narrow part
// of the journey, so shipping those bytes and decoding here with ffmpeg is far
// faster than uploading PCM. The output is the same mono 16 kHz PCM WAV that
// the browser used to produce, so the scoring input and the stored format are
// unchanged. ffmpeg only ever sees a private temporary file with a forced
// demuxer, no network protocols and a bounded runtime.
const {spawn} = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const FORMATS = Object.freeze({
  webm: {demuxer: 'matroska,webm', magic: [Buffer.from([0x1a, 0x45, 0xdf, 0xa3])]},
  ogg: {demuxer: 'ogg', magic: [Buffer.from('OggS')]},
  mp4: {demuxer: 'mov,mp4,m4a,3gp,3g2,mj2', magic: [Buffer.from('ftyp')], magicOffset: 4},
  m4a: {demuxer: 'mov,mp4,m4a,3gp,3g2,mj2', magic: [Buffer.from('ftyp')], magicOffset: 4},
  aac: {demuxer: 'aac'},
  mp3: {demuxer: 'mp3'}
});
const SAMPLE_RATE = 16000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2;
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_SECONDS = 32; // the browser rejects longer readings as well
const MIN_PCM_BYTES = BYTES_PER_SECOND / 4;
const MAX_PCM_BYTES = BYTES_PER_SECOND * MAX_SECONDS;
const MAX_CONCURRENT = 3;
const MAX_WAITING = 12;

class TranscodeError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

let running = 0;
const waiting = [];
async function gate(work) {
  if (running >= MAX_CONCURRENT) {
    if (waiting.length >= MAX_WAITING) throw new TranscodeError('BUSY', 'Too many recordings are being processed');
    await new Promise(resolve => waiting.push(resolve));
  }
  running++;
  try { return await work(); }
  finally { running--; waiting.shift()?.(); }
}

function wavFromPcm(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');header.writeUInt32LE(36 + pcm.length, 4);header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');header.writeUInt32LE(16, 16);header.writeUInt16LE(1, 20);header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);header.writeUInt32LE(BYTES_PER_SECOND, 28);header.writeUInt16LE(2, 32);header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function looksLike(input, spec) {
  if (!spec.magic) return true;
  const offset = spec.magicOffset || 0;
  return spec.magic.some(magic => input.length >= offset + magic.length && input.compare(magic, 0, magic.length, offset, offset + magic.length) === 0);
}

function runFfmpeg(file, spec, {ffmpeg, timeoutMs, spawnImpl}) {
  return new Promise((resolve, reject) => {
    const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '1',
      '-protocol_whitelist', 'file', '-f', spec.demuxer, '-i', file,
      '-vn', '-sn', '-dn', '-map_metadata', '-1', '-t', String(MAX_SECONDS + 0.05),
      '-ac', '1', '-ar', String(SAMPLE_RATE), '-acodec', 'pcm_s16le', '-f', 's16le', 'pipe:1'];
    let child;
    try { child = spawnImpl(ffmpeg, args, {stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true}); }
    catch (error) { return reject(error?.code === 'ENOENT' ? new TranscodeError('FFMPEG_UNAVAILABLE') : new TranscodeError('DECODE_FAILED')); }
    const chunks = [];let received = 0, settled = false, timedOut = false, overflow = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
    timer.unref?.();
    child.stdout.on('data', chunk => {
      if (overflow) return;
      received += chunk.length;
      if (received > MAX_PCM_BYTES) { overflow = true; try { child.kill('SIGKILL'); } catch {} return; }
      chunks.push(chunk);
    });
    child.stderr.on('data', () => {});
    child.once('error', error => finish(error?.code === 'ENOENT' ? new TranscodeError('FFMPEG_UNAVAILABLE') : new TranscodeError('DECODE_FAILED')));
    child.once('close', code => {
      if (overflow) return finish(new TranscodeError('TOO_LONG'));
      if (timedOut) return finish(new TranscodeError('TIMEOUT'));
      if (code !== 0) return finish(new TranscodeError('DECODE_FAILED'));
      finish(null, Buffer.concat(chunks));
    });
  });
}

// Returns the exact mono 16 kHz PCM16 WAV bytes (header + samples) or throws a
// TranscodeError with a stable code. Nothing about the caller is logged.
async function transcodeToWav(input, format, {ffmpeg = process.env.MAANSHAN_FFMPEG || 'ffmpeg', timeoutMs = 8000, tmpDir = os.tmpdir(), spawnImpl = spawn} = {}) {
  const spec = typeof format === 'string' ? FORMATS[format] : null;
  if (!spec) throw new TranscodeError('UNSUPPORTED_FORMAT');
  if (!Buffer.isBuffer(input) || !input.length || input.length > MAX_INPUT_BYTES || !looksLike(input, spec)) throw new TranscodeError('INVALID_INPUT');
  return gate(async () => {
    const file = path.join(tmpDir, `maanshan-audio-${crypto.randomBytes(12).toString('hex')}.bin`);
    let pcm;
    try {
      await fs.writeFile(file, input, {mode: 0o600, flag: 'wx'});
      pcm = await runFfmpeg(file, spec, {ffmpeg, timeoutMs, spawnImpl});
    } finally {
      await fs.unlink(file).catch(() => {});
    }
    if (pcm.length % 2) pcm = pcm.subarray(0, pcm.length - 1);
    if (pcm.length < MIN_PCM_BYTES) throw new TranscodeError('TOO_SHORT');
    if (pcm.length > MAX_PCM_BYTES) throw new TranscodeError('TOO_LONG');
    return wavFromPcm(pcm);
  });
}

// Transient conditions where the same upload may succeed shortly afterwards.
const RETRYABLE = new Set(['FFMPEG_UNAVAILABLE', 'TIMEOUT', 'BUSY']);
function isTransient(error) { return error instanceof TranscodeError && RETRYABLE.has(error.code); }

module.exports = {FORMATS, MAX_INPUT_BYTES, MAX_SECONDS, TranscodeError, transcodeToWav, wavFromPcm, isTransient};
