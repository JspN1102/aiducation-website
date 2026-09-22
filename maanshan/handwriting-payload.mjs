// Preserve every sampled coordinate and timestamp. Only the transport changes;
// the Guangzhou handler restores the exact ink before recognition and scoring.
export async function prepareHandwritingPayload(payload, {scope = globalThis, timeout = 750} = {}) {
  if (!Array.isArray(payload?.ink) || payload.inkGzip !== undefined || typeof scope.CompressionStream !== 'function') return payload;
  const original = JSON.stringify(payload.ink);
  if (original.length < 4096 || original.length > 512 * 1024) return payload;
  let timer;
  try {
    const stream = new Blob([original]).stream().pipeThrough(new scope.CompressionStream('gzip'));
    const packed = new Response(stream).arrayBuffer();
    const bytes = new Uint8Array(await Promise.race([
      packed,
      new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('Compression deadline')), timeout);})
    ]));
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const inkGzip = btoa(binary);
    if (inkGzip.length >= original.length * .85) return payload;
    const {ink, ...context} = payload;
    return {...context, inkGzip};
  } catch {
    return payload;
  } finally {
    clearTimeout(timer);
  }
}
