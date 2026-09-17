const crypto = require('crypto');
const https = require('https');

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, voice, speed } = req.body || {};
  if (!text) return res.status(400).json({ error: 'Missing text' });

  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  if (!secretId || !secretKey) return res.status(500).json({ error: 'TTS credentials not configured' });

  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    Text: text,
    SessionId: crypto.randomUUID(),
    VoiceType: voice || 101015,
    Speed: speed !== undefined ? speed : 0,
    Codec: 'mp3'
  });

  const authorization = buildAuth(secretId, secretKey, payload, timestamp);

  return new Promise((resolve) => {
    let settled = false, deadline;
    const finish = (status, body, audio = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (audio) {
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', body.length);
        res.status(status).end(body);
      } else {
        res.status(status).json(body);
      }
      resolve();
    };
    const reqOpts = {
      hostname: 'tts.tencentcloudapi.com',
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': 'tts.tencentcloudapi.com',
        'X-TC-Action': 'TextToVoice',
        'X-TC-Version': '2019-08-23',
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Region': 'ap-guangzhou',
        'Authorization': authorization
      }
    };

    const apiReq = https.request(reqOpts, (apiRes) => {
      const chunks = [];
      apiRes.on('data', chunk => chunks.push(chunk));
      apiRes.on('end', () => {
        if (settled) return;
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const resp = body.Response;
          if (resp && resp.Audio) {
            const audioBuf = Buffer.from(resp.Audio, 'base64');
            if (!audioBuf.length) return finish(502, { error: 'Empty TTS response' });
            finish(200, audioBuf, true);
          } else {
            finish(502, { error: 'TTS temporarily unavailable' });
          }
        } catch (e) {
          finish(502, { error: 'Invalid TTS response' });
        }
      });
      apiRes.on('error', () => finish(502, { error: 'TTS connection interrupted' }));
      apiRes.on('aborted', () => finish(502, { error: 'TTS connection interrupted' }));
    });

    apiReq.on('error', () => finish(502, { error: 'TTS connection unavailable' }));

    apiReq.setTimeout(8000, () => {
      finish(504, { error: 'TTS timeout' });
      apiReq.destroy();
    });
    // Also bound the complete request when bytes arrive too slowly to trigger a socket timeout.
    deadline = setTimeout(() => { finish(504, { error: 'TTS timeout' });apiReq.destroy(); }, 12000);

    apiReq.write(payload);
    apiReq.end();
  });
};
