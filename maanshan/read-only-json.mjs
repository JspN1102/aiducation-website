const RETRY_STATUS = new Set([502, 503, 504]);
const EARLY_FAILURE_MS = 4000;
const RETRY_DELAY_MS = 150;
const abortReason = signal => signal.reason || new DOMException('Request cancelled', 'AbortError');

function pause(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortReason(signal)); return; }
    const cancel = () => { clearTimeout(timer); reject(abortReason(signal)); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, RETRY_DELAY_MS);
    signal.addEventListener('abort', cancel, {once:true});
  });
}

// Only reads may retry. One deadline includes the response body, the short
// pause and both attempts; a slow request never receives a fresh time budget.
export async function readOnlyJSON(url, {timeout = 15000, signal, fetchImpl = globalThis.fetch, ...options} = {}) {
  if (options.method && options.method !== 'GET') throw new TypeError('READ_ONLY_GET_REQUIRED');
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, {once:true});
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeout);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (controller.signal.aborted) throw abortReason(controller.signal);
      const started = Date.now();
      let retry = false;
      try {
        const response = await fetchImpl(url, {...options, method:'GET', signal:controller.signal});
        if (controller.signal.aborted) throw abortReason(controller.signal);
        if (!attempt && RETRY_STATUS.has(response.status)) {
          // The failed read has no useful body. Free its connection before retry.
          void response.body?.cancel().catch(() => {});
          retry = true;
        } else {
          const data = response.ok ? await response.json() : null;
          if (controller.signal.aborted) throw abortReason(controller.signal);
          return {response, data};
        }
      } catch (error) {
        if (controller.signal.aborted) throw abortReason(controller.signal);
        if (attempt || !(error instanceof TypeError) || Date.now() - started >= EARLY_FAILURE_MS) throw error;
        retry = true;
      }
      if (retry) await pause(controller.signal);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
