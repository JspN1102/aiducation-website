'use strict';
const crypto = require('crypto');
const https = require('https');
const {gunzipSync} = require('node:zlib');
const schoolAuth = require('./_lib/school-auth.cjs');
const {FORMATS: AUDIO_FORMATS, MAX_INPUT_BYTES: MAX_COMPACT_BYTES, transcodeToWav} = require('./_lib/audio-transcode.cjs');

// Speech input for the poet conversation: one short question is recognised by
// Tencent one-sentence recognition (asr SentenceRecognition, 16 kHz WAV) and
// returned in Hong Kong traditional characters for the learner to check before
// sending. Nothing here is a learning outcome, so it is not recorded.
const asrAgent = new https.Agent({keepAlive: true, maxSockets: 4, maxFreeSockets: 2, timeout: 30000});
const HOST = 'asr.tencentcloudapi.com';
// Mandarin, Cantonese and English in one engine: pupils may ask in either.
const ENGINE = '16k_zh-PY';
// Poets, titles and places of the six course poems, in the engine's simplified
// script; each word is at most ten characters.
const HOTWORDS = ['骆宾王', '李白', '汪伦', '苏轼', '苏东坡', '王安石', '陶渊明', '韩愈', '咏鹅', '赠汪伦', '题西林壁', '泊船瓜洲', '归园田居', '初春小雨', '早春呈水部张十八员外', '桃花潭', '庐山', '瓜洲', '京口', '钟山', '南山', '天街小雨'].map(word => word + '|10').join(',');
// Each successful recognition is billed. A pupil asks a question at a time;
// these ceilings stop a stuck button or a script from running up the bill.
const ACTOR_LIMIT = {max: 20, windowMs: 10 * 60000};
const GLOBAL_LIMIT = {max: 1200, windowMs: 60 * 60000};
const usage = new Map();
let globalUsage = {count: 0, until: 0};
let converter = null;

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
  const credentialScope = date + '/asr/tc3_request';
  const canonicalRequest = 'POST\n/\n\ncontent-type:application/json\nhost:' + HOST + '\n\ncontent-type;host\n' + sha256(payload);
  const stringToSign = 'TC3-HMAC-SHA256\n' + timestamp + '\n' + credentialScope + '\n' + sha256(canonicalRequest);
  const secretSigning = hmacSha256(hmacSha256(hmacSha256('TC3' + secretKey, date), 'asr'), 'tc3_request');
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
  return 'TC3-HMAC-SHA256 Credential=' + secretId + '/' + credentialScope + ', SignedHeaders=content-type;host, Signature=' + signature;
}

function consume(key, now = Date.now()) {
  if (globalUsage.until <= now) globalUsage = {count: 0, until: now + GLOBAL_LIMIT.windowMs};
  const own = usage.get(key);
  const current = own && own.until > now ? own : {count: 0, until: now + ACTOR_LIMIT.windowMs};
  if (current.count >= ACTOR_LIMIT.max || globalUsage.count >= GLOBAL_LIMIT.max) return false;
  current.count++;globalUsage.count++;usage.set(key, current);
  if (usage.size > 5000) for (const [name, entry] of usage) if (entry.until <= now) usage.delete(name);
  return true;
}

function hongKongText(text) {
  if (!converter) {
    const OpenCC = require('opencc-js/cn2t');
    converter = OpenCC.Converter({from: 'cn', to: 'hk'});
  }
  return converter(text);
}

function recognise(wav) {
  const secretId = configuredSecret('TENCENT_SECRET_ID');
  const secretKey = configuredSecret('TENCENT_SECRET_KEY');
  if (!secretId || !secretKey) return Promise.reject(Object.assign(new Error('Speech credentials not configured'), {statusCode: 500}));
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    EngSerViceType: ENGINE, SourceType: 1, VoiceFormat: 'wav',
    Data: wav.toString('base64'), DataLen: wav.length,
    FilterDirty: 1, FilterModal: 0, FilterPunc: 0, ConvertNumMode: 1, HotwordList: HOTWORDS
  });
  const authorization = buildAuth(secretId, secretKey, payload, timestamp);
  return new Promise((resolve, reject) => {
    let settled = false, deadline;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(deadline); error ? reject(error) : resolve(value); };
    const request = https.request({
      hostname: HOST, path: '/', method: 'POST', agent: asrAgent,
      headers: {'Content-Type': 'application/json', Host: HOST,
        'X-TC-Action': 'SentenceRecognition', 'X-TC-Version': '2019-06-14',
        'X-TC-Timestamp': String(timestamp), 'X-TC-Region': 'ap-guangzhou', Authorization: authorization}
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')).Response;
          if (!body || body.Error || typeof body.Result !== 'string') return finish(Object.assign(new Error('Speech recognition unavailable'), {statusCode: 502, upstreamCode: body?.Error?.Code || 'INVALID_RESPONSE'}));
          finish(null, body.Result);
        } catch { finish(Object.assign(new Error('Invalid speech response'), {statusCode: 502, upstreamCode: 'INVALID_RESPONSE'})); }
      });
      response.on('error', () => finish(Object.assign(new Error('Speech connection interrupted'), {statusCode: 502})));
      response.on('aborted', () => finish(Object.assign(new Error('Speech connection interrupted'), {statusCode: 502})));
    });
    request.on('error', () => finish(Object.assign(new Error('Speech connection unavailable'), {statusCode: 502})));
    request.setTimeout(12000, () => { finish(Object.assign(new Error('Speech timeout'), {statusCode: 504})); request.destroy(); });
    deadline = setTimeout(() => { finish(Object.assign(new Error('Speech timeout'), {statusCode: 504})); request.destroy(); }, 15000);
    request.end(payload);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});
  let actor = null;
  if (schoolAuth.enabled()) {
    try { actor = await schoolAuth.requireActor(req, {roles: ['student', 'teacher'], csrf: true}); }
    catch (error) { return schoolAuth.sendError(res, error); }
  }
  const {audio, audioFormat, audioCompression} = req.body || {};
  let audioBuf;
  try {
    if (typeof audio !== 'string' || !audio || audio.length > 4 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) throw new Error('Invalid audio');
    audioBuf = Buffer.from(audio, 'base64');
    if (audioFormat != null) {
      if (typeof audioFormat !== 'string' || !AUDIO_FORMATS[audioFormat] || audioCompression != null || audioBuf.length > MAX_COMPACT_BYTES) throw new Error('Invalid audio');
    } else if (audioCompression === 'gzip') audioBuf = gunzipSync(audioBuf, {maxOutputLength: 3 * 1024 * 1024});
    else if (audioCompression != null) throw new Error('Unsupported audio compression');
    if (!audioBuf.length || audioBuf.length > 3 * 1024 * 1024) throw new Error('Invalid audio');
    if (audioFormat == null && (audioBuf.length < 44 || audioBuf.toString('ascii', 0, 4) !== 'RIFF' || audioBuf.toString('ascii', 8, 12) !== 'WAVE')) throw new Error('Invalid audio');
  } catch { return res.status(400).json({error: 'Invalid audio encoding'}); }
  if (audioFormat != null) {
    // As with reading: the browser keeps the recording and re-sends plain PCM.
    try { audioBuf = await transcodeToWav(audioBuf, audioFormat); }
    catch (error) { return res.status(422).json({error: 'Audio transcode failed', code: 'AUDIO_TRANSCODE_FAILED', reason: error?.code || 'TRANSCODE_FAILED'}); }
  }
  if (!consume(actor?.id ? 'actor:' + actor.id : 'anonymous')) return res.status(429).json({error: 'Too many speech requests', code: 'SPEECH_LIMIT'});
  try {
    const result = await recognise(audioBuf);
    return res.status(200).json({text: hongKongText(result.trim()).slice(0, 1000)});
  } catch (error) {
    if (error.upstreamCode) console.error('speech-to-text upstream', error.upstreamCode);
    return res.status(error.statusCode || 502).json({error: 'Speech recognition unavailable', code: 'SPEECH_UNAVAILABLE'});
  }
};
