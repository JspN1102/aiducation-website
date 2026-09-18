const crypto = require('crypto');
const https = require('https');
const {cacheKey, hasAudio, readAudio, writeAudio, CACHE_VERSION} = require('./_lib/tts-cache');

// Keep one request per phrase in each warm function instance. The Blob cache
// handles later instances; this map prevents a burst of first taps from
// creating the same paid synthesis several times.
const inflight = new Map();
const DEFAULT_VOICE = 502001; // 超自然大模型：智小柔，聊天女声
const DEFAULT_SPEED = -0.75; // about 0.85x; children need time to hear initials
const SAMPLE_RATE = 16000;
const LEADING_SAMPLES = Math.round(SAMPLE_RATE * .18);
const TRAILING_SAMPLES = Math.round(SAMPLE_RATE * .08);
const AUDIO_KEY = /^[0-9a-f]{64}$/;

// Vercel can return an explicitly quoted empty value when a secret was
// removed. Treat that as missing instead of signing a request with `""`.
function configuredSecret(name) {
  const value = String(process.env[name] || '').trim();
  return value && value !== '""' ? value : '';
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function buildAuth(secretId, secretKey, payload, timestamp) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const service = 'tts';
  const credentialScope = date + '/' + service + '/tc3_request';

  const hashedPayload = sha256(payload);
  const canonicalRequest = 'POST\n/\n\ncontent-type:application/json\nhost:tts.tencentcloudapi.com\n\ncontent-type;host\n' + hashedPayload;
  const stringToSign = 'TC3-HMAC-SHA256\n' + timestamp + '\n' + credentialScope + '\n' + sha256(canonicalRequest);

  const secretDate = hmacSha256('TC3' + secretKey, date);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');

  return 'TC3-HMAC-SHA256 Credential=' + secretId + '/' + credentialScope + ', SignedHeaders=content-type;host, Signature=' + signature;
}

function xmlEscape(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function withLeadingPause(text) {
  const value = String(text).trim();
  if (/^<speak\b[^>]*>\s*<break\b/i.test(value)) return value;
  if (/^<speak\b/i.test(value)) return value.replace(/^<speak\b([^>]*)>/i, '<speak$1><break time="160ms"/>');
  return `<speak><break time="160ms"/>${xmlEscape(value)}</speak>`;
}

function plainSynthesisText(text) {
  return String(text).trim()
    .replace(/^<speak\b[^>]*>/i, '')
    .replace(/<\/speak>$/i, '')
    .replace(/<break\b[^>]*\/?>/gi, '')
    .replace(/<phoneme\b[^>]*>([^<>]*)<\/phoneme>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim();
}

function synthesisText(text, allowSSML = false) {
  const value = String(text).trim();
  const wrapped = /^<speak>(?:<break time="160ms"\s*\/>)?([\s\S]*)<\/speak>$/.exec(value);
  const plain = (wrapped ? wrapped[1] : value)
    .replace(/<phoneme alphabet="py" ph="[a-z0-9]+">([^<>]+)<\/phoneme>/g, '$1')
    .replace(/[「」“”。，、,\s]/g, '');
  if (plain === '請寫出還鄉的還' || plain === '请写出还乡的还') {
    return allowSSML
      ? '<speak>请写出，还乡的<phoneme alphabet="py" ph="huan2">还</phoneme>。</speak>'
      : '请写出，还乡的还。';
  }
  return allowSSML ? withLeadingPause(value) : plainSynthesisText(value);
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function paddedWav(pcm) {
  if (!pcm.length || pcm.length % 2) throw Object.assign(new Error('Invalid TTS audio'), {statusCode: 502});
  const dataLength = pcm.length + 2 * (LEADING_SAMPLES + TRAILING_SAMPLES);
  const output = Buffer.alloc(44 + dataLength);
  output.write('RIFF', 0);
  output.writeUInt32LE(36 + dataLength, 4);
  output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(SAMPLE_RATE, 24);
  output.writeUInt32LE(SAMPLE_RATE * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36);
  output.writeUInt32LE(dataLength, 40);
  pcm.copy(output, 44 + LEADING_SAMPLES * 2);
  return output;
}

function audioSignature(key) {
  const secret = configuredSecret('TENCENT_SECRET_KEY') || configuredSecret('BLOB_READ_WRITE_TOKEN');
  return secret && crypto.createHmac('sha256', secret).update(`tts-audio:${CACHE_VERSION}:${key}`).digest('hex');
}

function audioURL(key) {
  const signature = audioSignature(key);
  return signature && `/api/tts/?key=${key}&sig=${signature}`;
}

function serveAudio(req, res, audio, cacheStatus, cacheControl = 'private, no-store') {
  const range = (req.method === 'GET' || req.method === 'HEAD') && req.headers?.range;
  let start = 0, end = audio.length - 1;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('X-TTS-Cache', cacheStatus);
  res.setHeader('Content-Type', 'audio/wav');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      res.setHeader('Content-Range', `bytes */${audio.length}`);
      return res.status(416).end();
    }
    if (!match[1]) {
      const suffix = Number(match[2]);
      start = suffix >= audio.length ? 0 : audio.length - suffix;
    } else {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), end) : end;
    }
    if (start >= audio.length || end < start || (!match[1] && !Number(match[2]))) {
      res.setHeader('Content-Range', `bytes */${audio.length}`);
      return res.status(416).end();
    }
    res.setHeader('Content-Range', `bytes ${start}-${end}/${audio.length}`);
  }
  res.setHeader('Content-Length', end - start + 1);
  return res.status(range ? 206 : 200).end(req.method === 'HEAD' ? undefined : audio.subarray(start, end + 1));
}

async function serveCachedAudio(req, res) {
  const {key, sig} = req.query || {};
  if (typeof key !== 'string' || !AUDIO_KEY.test(key) || typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) {
    return res.status(404).json({error: 'Audio not found'});
  }
  const expected = audioSignature(key);
  if (!expected || !crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) {
    return res.status(404).json({error: 'Audio not found'});
  }
  const cached = await readAudio(key);
  if (cached.status !== 'hit') return res.status(404).json({error: 'Audio not found'});
  return serveAudio(req, res, cached.audio, 'HIT', 'private, max-age=3600');
}

async function synthesize({text, voice, speed, allowSSML}) {
  const secretId = configuredSecret('TENCENT_SECRET_ID');
  const secretKey = configuredSecret('TENCENT_SECRET_KEY');
  if (!secretId || !secretKey) throw Object.assign(new Error('TTS credentials not configured'), {statusCode: 500});

  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    Text: synthesisText(text, allowSSML),
    SessionId: crypto.randomUUID(),
    VoiceType: voice,
    Speed: speed,
    Volume: 0,
    PrimaryLanguage: 1,
    SampleRate: SAMPLE_RATE,
    Codec: 'pcm'
  });
  const authorization = buildAuth(secretId, secretKey, payload, timestamp);
  const body = await new Promise((resolve, reject) => {
    let settled = false, deadline;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(deadline); error ? reject(error) : resolve(value); };
    const reqOpts = {
      hostname: 'tts.tencentcloudapi.com', path: '/', method: 'POST',
      headers: {'Content-Type': 'application/json', Host: 'tts.tencentcloudapi.com',
        'X-TC-Action': 'TextToVoice', 'X-TC-Version': '2019-08-23',
        'X-TC-Timestamp': String(timestamp), 'X-TC-Region': 'ap-guangzhou', Authorization: authorization}
    };
    const apiReq = https.request(reqOpts, apiRes => {
      const chunks = [];
      apiRes.on('data', chunk => chunks.push(chunk));
      apiRes.on('end', () => {
        try {
          const response = JSON.parse(Buffer.concat(chunks).toString('utf8')).Response;
          if (!response?.Audio) {
            const upstream = response?.Error || {};
            return finish(Object.assign(new Error('TTS temporarily unavailable'), {statusCode: 502, upstreamCode: upstream.Code, upstreamMessage: upstream.Message}));
          }
          const audio = Buffer.from(response.Audio, 'base64');
          if (!audio.length) return finish(Object.assign(new Error('Empty TTS response'), {statusCode: 502}));
          finish(null, paddedWav(audio));
        } catch { finish(Object.assign(new Error('Invalid TTS response'), {statusCode: 502})); }
      });
      apiRes.on('error', () => finish(Object.assign(new Error('TTS connection interrupted'), {statusCode: 502})));
      apiRes.on('aborted', () => finish(Object.assign(new Error('TTS connection interrupted'), {statusCode: 502})));
    });
    apiReq.on('error', () => finish(Object.assign(new Error('TTS connection unavailable'), {statusCode: 502})));
    apiReq.setTimeout(8000, () => { finish(Object.assign(new Error('TTS timeout'), {statusCode: 504})); apiReq.destroy(); });
    deadline = setTimeout(() => { finish(Object.assign(new Error('TTS timeout'), {statusCode: 504})); apiReq.destroy(); }, 12000);
    apiReq.end(payload);
  });
  return body;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET' || req.method === 'HEAD') return serveCachedAudio(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {text} = req.body || {};
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({error: 'Missing text'});
  if (text.length > 6000) return res.status(413).json({error: 'Text too long'});
  const voice = Math.trunc(number(req.body?.voice, Number(process.env.MAANSHAN_TTS_VOICE || DEFAULT_VOICE)));
  const speed = Math.max(-2, Math.min(6, number(req.body?.speed, Number(process.env.MAANSHAN_TTS_SPEED || DEFAULT_SPEED))));
  const pronunciationVersion = String(req.body?.pronunciationVersion || process.env.MAANSHAN_PRONUNCIATION_VERSION || '20260919b3');
  const allowSSML = req.body?.allowSSML === true;
  const profile = `pcm-silence-180-80-v1-${allowSSML ? 'ssml' : 'plain'}`;
  const key = cacheKey({text: text.normalize('NFC').trim(), voice, speed, pronunciationVersion, profile});
  const wantsURL = req.body?.delivery === 'url' && !!audioSignature(key);
  const cached = wantsURL ? await hasAudio(key) : await readAudio(key);
  if (cached.status === 'hit') {
    res.setHeader('X-TTS-Cache', 'HIT');res.setHeader('X-TTS-Voice', String(voice));
    if (wantsURL) return res.status(200).json({url: audioURL(key)});
    return serveAudio(req, res, cached.audio, 'HIT');
  }
  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      const audio = await synthesize({text, voice, speed, allowSSML});
      const stored = await writeAudio(key, audio);
      return {audio, stored};
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  try {
    const result = await pending;
    res.setHeader('X-TTS-Voice', String(voice));res.setHeader('X-TTS-Cache-Version', CACHE_VERSION);
    if (wantsURL && result.stored) {
      res.setHeader('X-TTS-Cache', 'MISS-STORED');
      return res.status(200).json({url: audioURL(key)});
    }
    return serveAudio(req, res, result.audio, result.stored ? 'MISS-STORED' : 'MISS');
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 502;
    console.error(JSON.stringify({event: 'tts-failure', status, code: error.code || error.upstreamCode || null, message: error.message || null, upstreamMessage: error.upstreamMessage || null}));
    return res.status(status).json({error: error.message || 'TTS temporarily unavailable'});
  }
};
