// The mainland standalone server can use the existing Vercel recognizer relay.
// This option is server configuration, never a URL supplied by a browser.
const {withSchoolLearning} = require('./_lib/school-learning.cjs');
const {Agent} = require('undici');
const {gunzipSync} = require('node:zlib');
const {closeGaps} = require('./_lib/writing-gaps.cjs');
// A pupil normally spends more than fetch's default five-second idle window
// writing the next character. Keep only this provider's connections warm so
// each check does not repeat the Guangzhou-to-relay TCP/TLS handshake.
// No result cache: every submitted drawing is recognised afresh (a resent copy
// with the same requestId shares the first answer, see request-replay.cjs).
const recognitionAgent = new Agent({
  keepAliveTimeout: 55000,
  keepAliveMaxTimeout: 55000,
  connections: 32,
  pipelining: 1
});
const MAX_BODY_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const RELAY_HEADER = 'x-maanshan-handwriting-relay';
const GOOGLE_URL = 'https://inputtools.google.com/request?itc=zh-hant-t-i0-handwrit&app=translate';
// The relay leg crosses to Vercel and back; one lost connection, refused or
// timed-out call is tried once more while an answer can still reach the pupil
// inside the origin's 15 s for this route (auth and recording need the rest).
const RELAY_BUDGET_MS = 12000, RELAY_ATTEMPT_MS = 9000, RELAY_RETRY_MIN_MS = 3000;
// The second reading (parts written far apart, gap closed) runs alongside the first and may
// trail it by this much before the pupil gets the first reading alone.
const SECOND_READING_WAIT_MS = 2000;

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

function requestInk(body) {
  if (body.inkGzip === undefined) return body.ink;
  // Do not accept two competing drawings or noncanonical base64. Bound both
  // the compressed request above and the decompressed JSON before parsing it.
  if (body.ink !== undefined || typeof body.inkGzip !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.inkGzip) || !body.inkGzip.length) throw new Error('Invalid compressed ink');
  const packed = Buffer.from(body.inkGzip, 'base64');
  if (packed.toString('base64') !== body.inkGzip) throw new Error('Invalid compressed ink');
  return JSON.parse(gunzipSync(packed, {maxOutputLength: MAX_BODY_BYTES}).toString('utf8'));
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

// One odd candidate (blank, too long, a control character) no longer fails the whole answer:
// it is dropped and the rest are marked (2026-10-22 20:43: one pupil got four 502s for one character).
function validCandidate(candidate) {
  return typeof candidate === 'string' && candidate.trim().length > 0 && candidate.length <= 32 && !/[\u0000-\u001f\u007f]/.test(candidate);
}

// One reading of the ink: {candidates}, or {status, error} for the pupil when the provider fails.
async function readInk(relay, ink, pre_context) {
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
  const started = performance.now();
  const again = attempt => relay && attempt === 0 && started + RELAY_BUDGET_MS - performance.now() >= RELAY_RETRY_MIN_MS;
  let data;
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(relay || GOOGLE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(relay ? { [RELAY_HEADER]: '1' } : {}) },
        body: JSON.stringify(payload),
        dispatcher: recognitionAgent,
        redirect: 'error',
        signal: AbortSignal.timeout(relay ? Math.min(RELAY_ATTEMPT_MS, Math.max(1, Math.round(started + RELAY_BUDGET_MS - performance.now()))) : 8000)
      });
    } catch (error) {
      // A network failure (fetch's TypeError) or this attempt's deadline.
      if ((error?.name === 'TypeError' || error?.name === 'TimeoutError') && again(attempt)) continue;
      throw error;
    }
    if (!response.ok) {
      await response.body?.cancel();
      console.warn(JSON.stringify({ event: 'handwriting_upstream_status', status: response.status, attempt }));
      if (response.status >= 500 && again(attempt)) continue;
      return { status: response.status === 504 ? 504 : 502, error: 'Recognition service unavailable' };
    }
    data = await responseJSON(response);
    break;
  }
  const candidates = relay ? data?.candidates : data?.[0] === 'SUCCESS' ? data?.[1]?.[0]?.[1] : null;
  if (!Array.isArray(candidates)) {
    console.warn(JSON.stringify({ event: 'handwriting_invalid_response', relay: Boolean(relay) }));
    return { status: 502, error: 'Invalid recognition response' };
  }
  const kept = candidates.filter(validCandidate).slice(0, 10);
  // Counts only: never the pupil's ink or the candidates.
  if (kept.length < candidates.length) console.warn(JSON.stringify({ event: 'handwriting_candidates_dropped', total: candidates.length, kept: kept.length }));
  return { candidates: kept };
}

module.exports = withSchoolLearning('handwriting', async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Invalid request body' });
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) return res.status(413).json({ error: 'Request too large' });
  let ink;
  try { ink = requestInk(body); }
  catch { return res.status(400).json({ error: 'Invalid ink data' }); }
  if (!validInk(ink)) return res.status(400).json({ error: 'Invalid ink data' });
  if (body.pre_context !== undefined && (typeof body.pre_context !== 'string' || body.pre_context.length > 256)) return res.status(400).json({ error: 'Invalid writing context' });
  let relay;
  try { relay = relayURL(req); }
  catch { return res.status(503).json({ error: 'Recognition relay unavailable' }); }

  try {
    const pre_context = body.pre_context || '';
    // A relayed request is already one of the readings made by the server that relays it.
    const closed = req.headers?.[RELAY_HEADER] ? null : closeGaps(ink);
    const started = performance.now();
    const reading = readInk(relay, ink, pre_context);
    const second = closed ? readInk(relay, closed, pre_context).catch(() => null) : null;
    const first = await reading;
    res.setHeader?.('Server-Timing', [res.getHeader?.('Server-Timing'), `handwriting_upstream;dur=${(performance.now() - started).toFixed(1)}`].filter(Boolean).join(', '));
    if (!first.candidates) return res.status(first.status).json({ error: first.error });
    let wait;
    const late = second && await Promise.race([second, new Promise(resolve => { wait = setTimeout(resolve, SECOND_READING_WAIT_MS, null); })]);
    clearTimeout(wait);
    // The client and the research record (school-learning.cjs) count the second reading only when the first is wrong.
    return res.status(200).json(late?.candidates ? { candidates: first.candidates, closedCandidates: late.candidates } : { candidates: first.candidates });
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return res.status(timeout ? 504 : 502).json({ error: timeout ? 'Recognition timed out' : 'Recognition service unavailable' });
  }
});
