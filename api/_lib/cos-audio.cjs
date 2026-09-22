'use strict';
// Publish cached speech to the school's Tencent COS bucket in Guangzhou. A
// browser then downloads the waveform straight from COS instead of streaming
// it through the Vercel relay, whose Guangzhou uplink is only a few hundred
// KB/s. Nothing here is required: when COS is unconfigured, unreachable or not
// publicly readable, callers keep serving audio through the relay.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const {CACHE_VERSION} = require('./tts-cache');

const KEY = /^[0-9a-f]{64}$/;
const REQUEST_TIMEOUT_MS = 4000;
const RETRY_AFTER_FAILURE_MS = 60000;
const RETRY_AFTER_PRIVATE_MS = 600000;
const MAX_REMEMBERED = 4096;
const agent = new https.Agent({keepAlive: true, maxSockets: 4, maxFreeSockets: 2, timeout: 30000});
const published = new Set();
const pending = new Map();
let pausedUntil = 0;
let publicVerified = false;

function setting(name) {
  const value = String(process.env[name] || '').trim();
  return value && value !== '""' ? value : '';
}

// Only the Guangzhou origin (persistent TTS_CACHE_DIR) publishes; the same
// Tencent key already used for speech synthesis signs COS requests unless a
// dedicated COS key is configured.
function config() {
  const bucket = setting('TTS_COS_BUCKET'), region = setting('TTS_COS_REGION');
  if (!/^[a-z0-9-]+-\d+$/.test(bucket) || !/^[a-z0-9-]+$/.test(region) || !setting('TTS_CACHE_DIR')) return null;
  const secretId = setting('TTS_COS_SECRET_ID') || setting('TENCENT_SECRET_ID');
  const secretKey = setting('TTS_COS_SECRET_KEY') || setting('TENCENT_SECRET_KEY');
  if (!secretId || !secretKey) return null;
  const host = `${bucket}.cos.${region}.myqcloud.com`;
  const prefix = (setting('TTS_COS_PREFIX') || 'tts').replace(/^\/+|\/+$/g, '');
  if (!/^[a-z0-9_./-]+$/i.test(prefix)) return null;
  return {
    host, prefix, secretId, secretKey,
    endpoint: (setting('TTS_COS_ENDPOINT') || `https://${host}`).replace(/\/+$/, ''),
    publicBase: (setting('TTS_COS_PUBLIC_BASE') || `https://${host}`).replace(/\/+$/, '')
  };
}

function objectPath(cfg, key) {
  return `/${cfg.prefix}/${CACHE_VERSION}/${key}.wav`;
}

function sign(cfg, method, pathname) {
  const now = Math.floor(Date.now() / 1000), keyTime = `${now - 60};${now + 600}`;
  const signKey = crypto.createHmac('sha1', cfg.secretKey).update(keyTime).digest('hex');
  const httpString = `${method.toLowerCase()}\n${pathname}\n\nhost=${encodeURIComponent(cfg.host)}\n`;
  const stringToSign = `sha1\n${keyTime}\n${crypto.createHash('sha1').update(httpString).digest('hex')}\n`;
  const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');
  return `q-sign-algorithm=sha1&q-ak=${cfg.secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=host&q-url-param-list=&q-signature=${signature}`;
}

function request(cfg, method, pathname, {body = null, headers = {}, signed = true} = {}) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; resolve(value); } };
    let url;
    try { url = new URL(cfg.endpoint + pathname); } catch { return finish({status: 0, code: 'BAD_ENDPOINT'}); }
    const secure = url.protocol === 'https:';
    const requestHeaders = {Host: cfg.host, ...headers};
    if (signed) requestHeaders.Authorization = sign(cfg, method, pathname);
    if (body) requestHeaders['Content-Length'] = String(body.length);
    const client = (secure ? https : http).request({
      host: url.hostname, port: url.port || undefined, path: url.pathname, method,
      headers: requestHeaders, agent: secure ? agent : undefined, timeout: REQUEST_TIMEOUT_MS
    }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { if (size < 4096) chunks.push(chunk); size += chunk.length; });
      response.on('end', () => finish({status: response.statusCode, code: /<Code>([^<]*)<\/Code>/.exec(Buffer.concat(chunks).toString())?.[1] || null}));
      response.on('error', error => finish({status: 0, code: error.code || 'RESPONSE_ERROR'}));
    });
    client.on('timeout', () => client.destroy(new Error('COS request timed out')));
    client.on('error', error => finish({status: 0, code: error.code || error.message}));
    client.end(body || undefined);
  });
}

function markerPath(key) {
  return path.join(setting('TTS_CACHE_DIR'), CACHE_VERSION, `${key}.cos`);
}
async function hasMarker(key) {
  try { return (await fs.stat(markerPath(key))).isFile(); } catch { return false; }
}
async function writeMarker(key) {
  const file = markerPath(key);
  await fs.mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  await fs.writeFile(file, '', {mode: 0o600});
}
function remember(key) {
  published.add(key);
  while (published.size > MAX_REMEMBERED) published.delete(published.values().next().value);
}
function pause(stage, result, duration = RETRY_AFTER_FAILURE_MS) {
  pausedUntil = Date.now() + duration;
  console.error(JSON.stringify({event: 'tts-cos-unavailable', stage, status: result.status, code: result.code || null, retryMs: duration}));
}

function enabled() { return !!config(); }

function publicURL(key) {
  const cfg = config();
  return cfg && KEY.test(key) ? cfg.publicBase + objectPath(cfg, key) : null;
}

// Where a browser can already download this phrase, or null.
async function publishedURL(key) {
  const cfg = config();
  if (!cfg || !KEY.test(key)) return null;
  if (published.has(key)) return publicURL(key);
  if (!(await hasMarker(key))) return null;
  remember(key);
  return publicURL(key);
}

// Upload the phrase once and remember it on disk. Resolves to the public URL,
// or null when COS cannot be used right now; never throws.
async function publish(key, loadAudio) {
  try {
    const known = await publishedURL(key);
    if (known) return known;
    const cfg = config();
    if (!cfg || Date.now() < pausedUntil) return null;
    if (pending.has(key)) return pending.get(key);
    const work = (async () => {
      const audio = await loadAudio();
      if (!Buffer.isBuffer(audio) || audio.length <= 44) return null;
      const pathname = objectPath(cfg, key);
      const put = await request(cfg, 'PUT', pathname, {body: audio, headers: {'Content-Type': 'audio/wav', 'Cache-Control': 'public, max-age=31536000, immutable'}});
      if (put.status !== 200) { pause('put', put); return null; }
      if (!publicVerified) {
        // Redirecting browsers to a private bucket would break every playback.
        const check = await request(cfg, 'HEAD', pathname, {signed: false});
        if (check.status !== 200) { pause('public-read', check, RETRY_AFTER_PRIVATE_MS); return null; }
        publicVerified = true;
      }
      await writeMarker(key).catch(() => {});
      remember(key);
      return publicURL(key);
    })().catch(error => { pause('publish', {status: 0, code: error.code || error.message}); return null; })
      .finally(() => pending.delete(key));
    pending.set(key, work);
    return work;
  } catch { return null; }
}

module.exports = {enabled, publicURL, publishedURL, publish};
