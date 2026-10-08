import {schoolFetch} from './school-session.mjs?v=20261007-school46';
function audioError(code, message, canRetry = false) {
  return Object.assign(new Error(message), {code, canRetry});
}

export function recordingErrorMessage(error, online = globalThis.navigator?.onLine !== false) {
  if (typeof error?.code === 'string') return error.message;
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return '請先允許使用麥克風：看到提示時按「允許」；沒有提示的話，到 iPad「設定」›「Safari」›「麥克風」選「允許」，再重新整理頁面。';
  if (error?.name === 'NotFoundError') return '找不到麥克風，請檢查裝置。';
  if (error?.name === 'NotReadableError') return '麥克風正在被其他程式使用，請關閉後再試。';
  if (!online) return '網絡未連上，連線後可以再送一次。';
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return '這次等得有點久，可以再送一次。';
  if (error instanceof TypeError) return '網絡暫時未連上，可以再送一次。';
  return '這次未能完成，請再試一次。';
}

async function within(promise, ms, error) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(error), ms); })]); }
  finally { clearTimeout(timer); }
}

export async function encodeRecording(blob, context, scope = globalThis) {
  if (!blob || blob.size < 100) throw audioError('TOO_SHORT', '這次錄音太短，再讀一次吧。');
  const Offline = scope.OfflineAudioContext || scope.webkitOfflineAudioContext;
  if (!context?.decodeAudioData || !Offline) throw audioError('AUDIO_UNSUPPORTED', '此瀏覽器未能處理錄音，請使用新版 Safari、Chrome 或 Edge。');
  let decoded;
  try {
    decoded = await within(context.decodeAudioData(await blob.arrayBuffer()), 12000,
      audioError('AUDIO_DECODE', '錄音未能讀取，請再錄一次。'));
  } catch (error) {
    if (typeof error?.code === 'string') throw error;
    throw audioError('AUDIO_DECODE', '錄音格式未能讀取，請再錄一次，或使用新版 Safari、Chrome。');
  }
  if (!Number.isFinite(decoded.duration) || decoded.duration < .25) throw audioError('TOO_SHORT', '這次錄音太短，再讀一次吧。');
  if (decoded.duration > 32) throw audioError('TOO_LONG', '每次讀一句就好，請在三十秒內完成。');
  const offline = new Offline(1, Math.ceil(decoded.duration * 16000), 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded;source.connect(offline.destination);source.start();
  let rendered;
  try { rendered = await within(offline.startRendering(), 10000, audioError('AUDIO_RENDER', '錄音處理未能完成，請再錄一次。')); }
  catch (error) { if (typeof error?.code === 'string') throw error;throw audioError('AUDIO_RENDER', '錄音處理未能完成，請再錄一次。'); }
  const pcm = rendered.getChannelData(0), buffer = new ArrayBuffer(44 + pcm.length * 2), data = new DataView(buffer);
  const str = (offset, text) => Array.from(text).forEach((c, i) => data.setUint8(offset + i, c.charCodeAt(0)));
  str(0, 'RIFF');data.setUint32(4, 36 + pcm.length * 2, true);str(8, 'WAVE');str(12, 'fmt ');
  data.setUint32(16, 16, true);data.setUint16(20, 1, true);data.setUint16(22, 1, true);data.setUint32(24, 16000, true);
  data.setUint32(28, 32000, true);data.setUint16(32, 2, true);data.setUint16(34, 16, true);str(36, 'data');data.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) { const sample = Math.max(-1, Math.min(1, pcm[i]));data.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true); }
  const bytes = new Uint8Array(buffer);let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

// The recorder's own Opus/AAC bytes are several times smaller than PCM. The
// origin decodes them to the identical mono 16 kHz WAV before scoring or
// storing, so only the upload changes. Unknown containers or large blobs keep
// the in-browser PCM path.
const COMPACT_FORMATS = {'audio/webm':'webm', 'audio/ogg':'ogg', 'audio/mp4':'mp4', 'audio/x-m4a':'m4a', 'audio/m4a':'m4a', 'audio/aac':'aac', 'audio/mpeg':'mp3'};
export const COMPACT_MAX_BYTES = 800 * 1024;
export function compactFormat(type) {
  return COMPACT_FORMATS[String(type || '').split(';')[0].trim().toLowerCase()] || null;
}
export async function compactRecording(blob, {maxBytes = COMPACT_MAX_BYTES} = {}) {
  const audioFormat = compactFormat(blob?.type);
  if (!audioFormat || !(blob.size >= 100) || blob.size > maxBytes) return null;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return {audio: btoa(binary), audioFormat};
  } catch { return null; }
}

export async function prepareAssessmentPayload(payload, scope = globalThis) {
  if (typeof payload?.audio !== 'string' || payload.audioCompression != null || typeof payload.audioFormat === 'string' || typeof scope.CompressionStream !== 'function') return payload;
  try {
    const binary = atob(payload.audio), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    if (bytes.length < 8192) return payload;
    // This changes only transport size: the server restores the exact WAV bytes
    // before evaluation. Keep full sample rate and every recorded sample.
    const stream = new Blob([bytes]).stream().pipeThrough(new scope.CompressionStream('gzip'));
    const compressed = new Uint8Array(await within(new Response(stream).arrayBuffer(), 1500, new Error('Compression timeout')));
    if (compressed.length >= bytes.length * .95) return payload;
    let encoded = '';
    for (let i = 0; i < compressed.length; i += 8192) encoded += String.fromCharCode(...compressed.subarray(i, i + 8192));
    return {...payload, audio: btoa(encoded), audioCompression: 'gzip'};
  } catch { return payload; }
}

// A reading whose answer was lost on the way (the network dropped, the relay
// answered 502/503/504, or the wait ran out) is sent once more by itself. Its
// requestId lets the origin hand back the first copy's score instead of scoring
// and recording it twice. When the tablet hid the page meanwhile (Safari
// freezes requests in the background), it is sent again once the page is shown.
// A refusal (4xx) is never resent; TRANSCODE is the caller's single PCM fallback.
export function submitAssessment(payload, options = {}) {
  return postRecording('/api/soe/', payload, {resend:true, ...options}, {busy:'現在較多人使用，稍後可以再送一次。', service:'評測暫時未能完成，稍後可以再送一次。'});
}

// Speech input for the poet conversation: the same upload, returned as text.
// Only one quick network failure is retried; anything slower returns to the pupil.
export function submitSpeech(payload, options = {}) {
  return postRecording('/api/speech-to-text/', payload, {timeout:40000, ...options}, {busy:'語音輸入現在繁忙，請稍後再試，或者先打字。', service:'暫時未能把聲音變成文字，請再說一次，或者先打字。'});
}
const aborted = () => new DOMException('Aborted', 'AbortError');
function shown(page, signal) {
  return new Promise((resolve, reject) => {
    const done = () => {if (page.visibilityState !== 'hidden') {stop();resolve();}};
    const cancel = () => {stop();reject(aborted());};
    const stop = () => {page.removeEventListener('visibilitychange', done);signal?.removeEventListener('abort', cancel);};
    if (signal?.aborted) return reject(aborted());
    page.addEventListener('visibilitychange', done);signal?.addEventListener('abort', cancel, {once:true});
  });
}
// When a whole class sends at once the US-to-Guangzhou relay can queue a reading
// for a while even though Guangzhou scores it within seconds. Wait up to fifty
// seconds (the relay itself gives up at fifty-five) before asking for a resend.
// A resend after a full wait has thirty seconds more at most.
async function postRecording(url, payload, {signal, onRetry, onWaiting, fetchImpl = schoolFetch, page = globalThis.document, resend = false, timeout = 50000} = {}, messages) {
  if (globalThis.navigator?.onLine === false) throw audioError('OFFLINE', '網絡未連上，連線後可以再送一次。', true);
  const body = JSON.stringify(await prepareAssessmentPayload(payload)), first = Date.now();
  let quick = !resend, silent = resend, onShow = resend && !!page?.addEventListener, fresh = false, hidden = false;
  for (let attempt = 0;; attempt++) {
    if (signal?.aborted) throw aborted();
    const limit = attempt === 0 || fresh ? timeout : Math.min(timeout, Math.max(15000, timeout + 30000 - (Date.now() - first)));
    const controller = new AbortController(), started = Date.now();let expired = false, lost = false;hidden ||= page?.visibilityState === 'hidden';fresh = false;
    const cancel = () => controller.abort();signal?.addEventListener('abort', cancel, {once:true});
    const watch = () => {if (page.visibilityState === 'hidden') hidden = true;};if (onShow) page.addEventListener('visibilitychange', watch);
    const timer = setTimeout(() => {expired = true;controller.abort();}, limit);
    const waiting = setTimeout(() => onWaiting?.(), 7000);
    let failure;
    try {
      const response = await fetchImpl(url, {method:'POST', headers:{'Content-Type':'application/json'}, body, signal:controller.signal});
      const data = await response.json().catch(() => null);
      if (signal?.aborted) throw aborted();
      if (!response.ok || !data || data.error) {
        if (response.status === 429) throw audioError('BUSY', messages.busy, true);
        // Definite, pre-scoring refusal of the compact upload: the caller re-sends PCM once.
        if (response.status === 422 && data?.code === 'AUDIO_TRANSCODE_FAILED') throw audioError('TRANSCODE', '錄音處理未能完成，請再試一次。', true);
        // The relay or gateway lost the answer, or it broke off: the reading may well have been scored.
        lost = [502, 503, 504].includes(response.status) || (response.ok && !data);
        throw audioError('SERVICE', messages.service, true);
      }
      return data;
    } catch (error) {
      if (signal?.aborted) throw aborted();
      if (expired) failure = audioError('TIMEOUT', '這次等得有點久，可以再送一次。', true);
      else if (typeof error?.code === 'string') failure = error;
      else if (globalThis.navigator?.onLine === false && page?.visibilityState !== 'hidden') throw audioError('OFFLINE', '網絡未連上，連線後可以再送一次。', true);
      else failure = audioError('NETWORK', '網絡暫時未連上，可以再送一次。', true);
      lost ||= expired || error instanceof TypeError;
      if (quick && error instanceof TypeError && Date.now() - started < 8000) {quick = false;onRetry?.();continue;}
    } finally {
      clearTimeout(timer);clearTimeout(waiting);signal?.removeEventListener('abort', cancel);if (onShow) page.removeEventListener('visibilitychange', watch);
    }
    if (!lost || !resend) throw failure;
    if (onShow && page.visibilityState === 'hidden') {onShow = false;await shown(page, signal);fresh = true;onRetry?.();continue;}
    if (silent && globalThis.navigator?.onLine !== false) {silent = false;onRetry?.();continue;}
    if (onShow && hidden) {onShow = false;fresh = true;onRetry?.();continue;}
    throw failure;
  }
}

// The relay opens its SSH session and channel lazily; when no request has
// passed for a while that costs several seconds at the moment a score is
// awaited. Start it while the microphone prompt and the recording are still in
// progress instead. The reply is discarded, nothing is retried and no learning
// data is sent, so this can never replay or duplicate an assessment.
const PREWARM_INTERVAL_MS = 30000;
const PREWARM_TIMEOUT_MS = 8000;
let lastPrewarmAt = 0;
export function prewarmAssessment({fetchImpl = globalThis.fetch, now = Date.now} = {}) {
  const at = now();
  if (typeof fetchImpl !== 'function' || at - lastPrewarmAt < PREWARM_INTERVAL_MS || globalThis.navigator?.onLine === false) return false;
  lastPrewarmAt = at;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREWARM_TIMEOUT_MS);
  Promise.resolve()
    .then(() => fetchImpl('/api/school-auth/', {method:'GET', credentials:'same-origin', cache:'no-store', signal:controller.signal}))
    .then(response => response?.body?.cancel?.())
    .catch(() => {})
    .finally(() => clearTimeout(timer));
  return true;
}
