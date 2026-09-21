import {schoolFetch} from './school-session.mjs?v=20260922-school12b';
function audioError(code, message, canRetry = false) {
  return Object.assign(new Error(message), {code, canRetry});
}

export function recordingErrorMessage(error, online = globalThis.navigator?.onLine !== false) {
  if (typeof error?.code === 'string') return error.message;
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return '請先允許使用麥克風，再試一次。';
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

export async function prepareAssessmentPayload(payload, scope = globalThis) {
  if (typeof payload?.audio !== 'string' || payload.audioCompression != null || typeof scope.CompressionStream !== 'function') return payload;
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

// Only one quick transport failure is retried, with the same request context.
// A slow request, HTTP error, or explicit cancellation always returns control to the learner.
export async function submitAssessment(payload, {signal, onRetry, onWaiting, fetchImpl = schoolFetch, timeout = 30000} = {}) {
  if (globalThis.navigator?.onLine === false) throw audioError('OFFLINE', '網絡未連上，連線後可以再送一次。', true);
  const body = JSON.stringify(await prepareAssessmentPayload(payload));
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const controller = new AbortController(), started = Date.now();let expired = false;
    const cancel = () => controller.abort();signal?.addEventListener('abort', cancel, {once:true});
    const timer = setTimeout(() => {expired = true;controller.abort();}, timeout);
    const waiting = setTimeout(() => onWaiting?.(), 7000);
    try {
      const response = await fetchImpl('/api/soe/', {method:'POST', headers:{'Content-Type':'application/json'}, body, signal:controller.signal});
      const data = await response.json().catch(() => null);
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!response.ok || !data || data.error) {
        if (response.status === 429) throw audioError('BUSY', '現在較多人使用，稍後可以再送一次。', true);
        throw audioError('SERVICE', '評測暫時未能完成，稍後可以再送一次。', true);
      }
      return data;
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (expired) throw audioError('TIMEOUT', '這次等得有點久，可以再送一次。', true);
      if (typeof error?.code === 'string') throw error;
      if (globalThis.navigator?.onLine === false) throw audioError('OFFLINE', '網絡未連上，連線後可以再送一次。', true);
      if (error instanceof TypeError && attempt === 0 && Date.now() - started < 8000) {onRetry?.();continue;}
      throw audioError('NETWORK', '網絡暫時未連上，可以再送一次。', true);
    } finally {
      clearTimeout(timer);clearTimeout(waiting);signal?.removeEventListener('abort', cancel);
    }
  }
}
