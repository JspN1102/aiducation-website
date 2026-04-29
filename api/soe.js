const crypto = require('crypto');
const https = require('https');

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function buildAuth(secretId, secretKey, payload, timestamp) {
  const service = 'soe';
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const host = 'soe.tencentcloudapi.com';

  const canonicalRequest = [
    'POST',
    '/',
    '',
    `content-type:application/json\nhost:${host}\n`,
    'content-type;host',
    sha256(payload)
  ].join('\n');

  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    timestamp,
    credentialScope,
    sha256(canonicalRequest)
  ].join('\n');

  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');

  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`;
}

function callTencentAPI(payload, auth, timestamp) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(payload, 'utf8');
    const req = https.request({
      hostname: 'soe.tencentcloudapi.com',
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': 'soe.tencentcloudapi.com',
        'X-TC-Action': 'TransmitOralProcessWithInit',
        'X-TC-Version': '2018-07-24',
        'X-TC-Timestamp': String(timestamp),
        'Authorization': auth,
        'Content-Length': data.length
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON: ' + body.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
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
  if (!secretId || !secretKey) return res.status(500).json({ error: 'API credentials not configured' });

  const sessionId = crypto.randomUUID();
  const payload = JSON.stringify({
    SeqId: 1,
    IsEnd: 1,
    VoiceFileType: 2,
    VoiceEncodeType: 1,
    UserVoiceData: audio,
    SessionId: sessionId,
    RefText: refText,
    WorkMode: 1,
    EvalMode: 1,
    ScoreCoeff: 1.5,
    ServerType: 1
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const auth = buildAuth(secretId, secretKey, payload, timestamp);

  try {
    const result = await callTencentAPI(payload, auth, timestamp);
    if (result.Response && result.Response.Error) {
      return res.status(502).json({ error: result.Response.Error.Message, code: result.Response.Error.Code });
    }
    return res.status(200).json(result.Response);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
};
