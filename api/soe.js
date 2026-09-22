const crypto = require('crypto');
const WebSocket = require('ws');
const {gunzipSync} = require('node:zlib');
const { assessmentReference } = require('./_lib/soe-reference');
const {withSchoolLearning} = require('./_lib/school-learning.cjs');
const {FORMATS: AUDIO_FORMATS, MAX_INPUT_BYTES: MAX_COMPACT_BYTES, transcodeToWav} = require('./_lib/audio-transcode.cjs');

function sign(signStr, secretKey) {
  return crypto.createHmac('sha1', secretKey).update(signStr).digest('base64');
}

function encodeParam(v) {
  return encodeURIComponent(String(v));
}

function buildWsUrl(params, secretKey) {
  const appid = params.appid;
  const sortedKeys = Object.keys(params).filter(k => k !== 'appid').sort();

  const signStr = 'soe.cloud.tencent.com/soe/api/' + appid + '?' +
    sortedKeys.map(k => k + '=' + String(params[k])).join('&');
  const signature = sign(signStr, secretKey);

  const urlQuery = sortedKeys.map(k => k + '=' + encodeParam(params[k])).join('&');

  return {
    url: 'wss://soe.cloud.tencent.com/soe/api/' + appid + '?' + urlQuery + '&signature=' + encodeParam(signature),
    voiceId: params.voice_id
  };
}

module.exports = withSchoolLearning('reading', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { audio, refText, audioFormat, audioCompression } = req.body || {};
  if (!audio || !refText) return res.status(400).json({ error: 'Missing audio or refText' });
  const started = performance.now();
  let audioBuf;
  try {
    if (typeof audio !== 'string' || audio.length > 4 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) throw new Error('Invalid audio');
    audioBuf = Buffer.from(audio, 'base64');
    if (audioFormat != null) {
      // The browser's own compact recording; decoded below to the same PCM WAV.
      if (typeof audioFormat !== 'string' || !AUDIO_FORMATS[audioFormat] || audioCompression != null || audioBuf.length > MAX_COMPACT_BYTES) throw new Error('Invalid audio');
    } else if (audioCompression === 'gzip') audioBuf = gunzipSync(audioBuf, {maxOutputLength: 3 * 1024 * 1024});
    else if (audioCompression != null) throw new Error('Unsupported audio compression');
    if (!audioBuf.length || audioBuf.length > 3 * 1024 * 1024) throw new Error('Invalid audio');
  } catch { return res.status(400).json({error: 'Invalid audio encoding'}); }
  if (audioFormat != null) {
    try { audioBuf = await transcodeToWav(audioBuf, audioFormat); }
    catch (error) {
      // Nothing has been scored yet. The browser keeps the recording and sends
      // it again as plain PCM, so this is not a learning outcome and is written
      // directly instead of through the research wrapper.
      res.status(422);res.setHeader('Content-Type', 'application/json; charset=utf-8');res.setHeader('Cache-Control', 'private, no-store');
      return res.end(JSON.stringify({error: 'Audio transcode failed', code: 'AUDIO_TRANSCODE_FAILED', reason: error?.code || 'TRANSCODE_FAILED'}));
    }
  }
  const prepared = performance.now();

  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  const appId = process.env.TENCENT_APP_ID;
  if (!secretId || !secretKey || !appId) {
    return res.status(500).json({ error: 'API credentials not configured' });
  }

  const now = Math.floor(Date.now() / 1000);
  const voiceId = crypto.randomUUID();

  const params = {
    appid: appId,
    eval_mode: 1,
    expired: now + 86400,
    nonce: String(now),
    rec_mode: 1,
    ...assessmentReference(refText),
    score_coeff: 1.5,
    secretid: secretId,
    sentence_info_enabled: 0,
    server_engine_type: '16k_zh',
    timestamp: String(now),
    voice_format: 1,
    voice_id: voiceId
  };

  const { url } = buildWsUrl(params, secretKey);

  return new Promise((resolve) => {
    let result = null, connected = null;
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.terminate(); } catch (_) {}
        res.status(504).json({ error: 'Evaluation timeout' });
        resolve();
      }
    }, 20000);

    const ws = new WebSocket(url, {handshakeTimeout: 8000, perMessageDeflate: false});

    function finishResult() {
      if (settled) return;
      settled = true;clearTimeout(timeout);
      const completed = performance.now();
      res.setHeader('Server-Timing', `audio_prepare;dur=${(prepared-started).toFixed(1)}, soe_connect;dur=${((connected||completed)-prepared).toFixed(1)}, soe_score;dur=${(completed-(connected||prepared)).toFixed(1)}, soe_total;dur=${(completed-started).toFixed(1)}`);
      if (result?.result) res.status(200).json(mapResult(result.result));
      else res.status(502).json({error: 'No final result received'});
      // The final scores are already complete. A slow peer close must not keep
      // the learner waiting or make the final response time out.
      ws.close();
      const closing = setTimeout(() => { try { ws.terminate(); } catch (_) {} }, 1000);
      closing.unref?.();ws.once('close', () => clearTimeout(closing));
      resolve();
    }

    ws.on('open', () => {
      connected = performance.now();
      ws.send(audioBuf);
      ws.send(JSON.stringify({ type: 'end' }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.code !== 0) {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            res.status(502).json({ error: msg.message, code: msg.code });
            ws.close();
            resolve();
          }
          return;
        }
        if (msg.final === 1) {
          if (msg.result) result = msg;
          finishResult();
        } else if (msg.result) {
          result = msg;
        }
      } catch (_) {}
    });

    ws.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        res.status(502).json({ error: 'No final result received' });
        resolve();
      }
    });

    ws.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        res.status(502).json({ error: err.message || 'WebSocket error' });
        resolve();
      }
    });
  });
});

function mapResult(r) {
  return {
    PronAccuracy: r.pron_accuracy ?? r.PronAccuracy ?? null,
    PronFluency: r.pron_fluency ?? r.PronFluency ?? null,
    PronCompletion: r.pron_completion ?? r.PronCompletion ?? null,
    SuggestedScore: r.suggested_score ?? r.SuggestedScore ?? null,
    Words: (r.words || r.Words || []).map(w => ({
      Word: w.word || w.Word || '',
      PronAccuracy: w.pron_accuracy ?? w.PronAccuracy ?? null,
      PronFluency: w.pron_fluency ?? w.PronFluency ?? null,
      MemBeginTime: w.begin_time ?? w.MemBeginTime ?? 0,
      MemEndTime: w.end_time ?? w.MemEndTime ?? 0,
      PhoneInfos: (w.phone_infos || w.PhoneInfos || []).map(p => ({
        Phone: p.phone || p.Phone || '',
        PronAccuracy: p.pron_accuracy ?? p.PronAccuracy ?? null
      }))
    }))
  };
}
