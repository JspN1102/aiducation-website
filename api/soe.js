const crypto = require('crypto');
const WebSocket = require('ws');

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { audio, refText } = req.body || {};
  if (!audio || !refText) return res.status(400).json({ error: 'Missing audio or refText' });

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
    ref_text: refText,
    score_coeff: 1.5,
    secretid: secretId,
    sentence_info_enabled: 0,
    server_engine_type: '16k_zh',
    text_mode: 0,
    timestamp: String(now),
    voice_format: 1,
    voice_id: voiceId
  };

  const { url } = buildWsUrl(params, secretKey);

  return new Promise((resolve) => {
    let result = null;
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch (_) {}
        res.status(504).json({ error: 'Evaluation timeout' });
        resolve();
      }
    }, 20000);

    const ws = new WebSocket(url);

    ws.on('open', () => {
      const audioBuf = Buffer.from(audio, 'base64');
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
          result = msg;
          ws.close();
        } else if (msg.result) {
          result = msg;
        }
      } catch (_) {}
    });

    ws.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        if (result && result.result) {
          res.status(200).json(mapResult(result.result));
        } else if (result) {
          res.status(200).json(result);
        } else {
          res.status(502).json({ error: 'No result received' });
        }
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
};

function mapResult(r) {
  return {
    PronAccuracy: r.pron_accuracy ?? r.PronAccuracy ?? 0,
    PronFluency: r.pron_fluency ?? r.PronFluency ?? 0,
    PronCompletion: r.pron_completion ?? r.PronCompletion ?? 0,
    SuggestedScore: r.suggested_score ?? r.SuggestedScore ?? 0,
    Words: (r.words || r.Words || []).map(w => ({
      Word: w.word || w.Word || '',
      PronAccuracy: w.pron_accuracy ?? w.PronAccuracy ?? 0,
      PronFluency: w.pron_fluency ?? w.PronFluency ?? 0,
      MemBeginTime: w.begin_time ?? w.MemBeginTime ?? 0,
      MemEndTime: w.end_time ?? w.MemEndTime ?? 0,
      PhoneInfos: (w.phone_infos || w.PhoneInfos || []).map(p => ({
        Phone: p.phone || p.Phone || '',
        PronAccuracy: p.pron_accuracy ?? p.PronAccuracy ?? 0
      }))
    }))
  };
}
