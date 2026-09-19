// The mainland standalone server can use the existing Vercel recognizer relay.
// This option is server configuration, never a URL supplied by a browser.
const MAX_BODY_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const RELAY_HEADER = 'x-maanshan-handwriting-relay';
const GOOGLE_URL = 'https://inputtools.google.com/request?itc=zh-hant-t-i0-handwrit&app=translate';

function validInk(ink) {
  if (!Array.isArray(ink) || !ink.length || ink.length > 128) return false;
  let points = 0;
  return ink.every(stroke => {
    if (!Array.isArray(stroke) || stroke.length !== 3 || stroke.some(axis => !Array.isArray(axis))) return false;
    const count = stroke[0].length;
    points += count;
    return count > 0 && points <= 12000 && stroke.every(axis => axis.length === count && axis.every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 3600000));
  });
}

function relayURL(req) {
  const value = process.env.HANDWRITING_RELAY_URL;
  if (!value) return null;
  const url = new URL(value);
  const allowedHost = url.hostname === 'aiducation.asia' || /^aiducation-website(?:-[a-z0-9-]+)?\.vercel\.app$/.test(url.hostname);
  if (url.protocol !== 'https:' || !allowedHost || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443') || !/^\/api\/handwriting\/?$/.test(url.pathname)) throw new Error('Invalid relay configuration');
  const requestHosts = [req.headers?.host, req.headers?.['x-forwarded-host']]
    .filter(value => typeof value === 'string')
    .flatMap(value => value.toLowerCase().split(',').map(host => host.trim().split(':')[0]));
  if (req.headers?.[RELAY_HEADER] || requestHosts.includes(url.hostname)) throw new Error('Recognition relay loop');
  // Use the existing Vercel trailing-slash route without an HTTP redirect.
  url.pathname = '/api/handwriting/';
  return url.href;
}

async function responseJSON(response) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error('Recognition response too large');
  }
  if (!response.body) throw new Error('Empty recognition response');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('Recognition response too large'); }
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validCandidates(value) {
  return Array.isArray(value) && value.length <= 10 && value.every(candidate =>
    typeof candidate === 'string' && candidate.trim().length > 0 && candidate.length <= 32 && !/[\u0000-\u001f\u007f]/.test(candidate));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Invalid request body' });
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) return res.status(413).json({ error: 'Request too large' });
  if (!validInk(body.ink)) return res.status(400).json({ error: 'Invalid ink data' });
  if (body.pre_context !== undefined && (typeof body.pre_context !== 'string' || body.pre_context.length > 256)) return res.status(400).json({ error: 'Invalid writing context' });
  let relay;
  try { relay = relayURL(req); }
  catch { return res.status(503).json({ error: 'Recognition relay unavailable' }); }

  try {
    const ink = body.ink;
    const pre_context = body.pre_context || '';
    const payload = relay ? { ink, pre_context } : {
      app_version: 0.4,
      api_level: '537.36',
      device: 'AIDUCATION-maanshan',
      input_type: 0,
      options: 'enable_pre_space',
      requests: [{
        writing_guide: { writing_area_width: 560, writing_area_height: 560 },
        ink, pre_context,
        max_num_results: 10,
        max_completions: 0,
        language: 'zh-hant'
      }]
    };
    const response = await fetch(relay || GOOGLE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(relay ? { [RELAY_HEADER]: '1' } : {}) },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: AbortSignal.timeout(relay ? 9000 : 8000)
    });
    if (!response.ok) {
      await response.body?.cancel();
      return res.status(response.status === 504 ? 504 : 502).json({ error: 'Recognition service unavailable' });
    }
    const data = await responseJSON(response);
    const candidates = relay ? data?.candidates : data?.[0] === 'SUCCESS' ? data?.[1]?.[0]?.[1] : null;
    if (!validCandidates(candidates)) return res.status(502).json({ error: 'Invalid recognition response' });
    return res.status(200).json({ candidates });
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return res.status(timeout ? 504 : 502).json({ error: timeout ? 'Recognition timed out' : 'Recognition service unavailable' });
  }
};
