// Bound the complete request (including the response body), and cancel it when
// its screen is left. Retry only an early transport failure, never a slow job.
export async function requestJSON(path, body, {timeout = 35000, signal, retry = false} = {}) {
  if (globalThis.navigator?.onLine === false) throw new Error('網絡已斷開，連線後可以再試一次。');
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  const url = path.startsWith('/api/') ? path.replace(/\/+$/, '') + '/' : path;
  const payload = JSON.stringify(body);
  try {
    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      try {
        const response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: payload, signal: controller.signal});
        if (!response.ok) {
          throw new Error(response.status === 429 ? '現在較多人使用，稍後再試一次吧。'
            : response.status === 504 ? '這次等得有點久，可以再試一次。'
              : '服務暫時未能完成，可以再試一次。');
        }
        let data;
        try { data = await response.json(); }
        catch (error) {
          if (controller.signal.aborted || error instanceof TypeError) throw error;
          throw new Error('剛才的回覆未能完整收到，可以再試一次。');
        }
        if (!data || data.error) throw new Error('服務暫時未能完成，可以再試一次。');
        return data;
      } catch (error) {
        if (controller.signal.aborted) throw error;
        if (retry && attempt === 0 && error instanceof TypeError && Date.now() - started < 4000 && globalThis.navigator?.onLine !== false) continue;
        throw error;
      }
    }
  } catch (error) {
    if (timedOut) throw new Error('這次等得有點久，可以再試一次。');
    if (signal?.aborted) throw new DOMException('Screen changed', 'AbortError');
    if (globalThis.navigator?.onLine === false) throw new Error('網絡已斷開，連線後可以再試一次。');
    if (error instanceof TypeError) throw new Error('剛才未能連線，請再試一次。');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
