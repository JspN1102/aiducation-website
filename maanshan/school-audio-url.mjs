// The origin returns canonical signed audio paths at both school entrances.
// Both entrances use /school/ for pages but different API namespaces. The
// company fallback packager rewrites this literal together with other APIs;
// the main deployment keeps /api/. Do not infer an API from the page path.
const deliveryPath = '/api/tts/';
export function schoolTtsURL(value) {
  const canonical = '/' + ['api', 'tts', ''].join('/');
  if (typeof value !== 'string' || !value.startsWith(canonical + '?')) throw new Error('TTS URL');
  const parsed = new URL(value, 'https://school.invalid');
  if (parsed.origin !== 'https://school.invalid' || parsed.pathname !== canonical || parsed.hash ||
      Array.from(parsed.searchParams.keys()).length !== 2 || !/^[a-f0-9]{64}$/.test(parsed.searchParams.get('key') || '') ||
      !/^[a-f0-9]{64}$/.test(parsed.searchParams.get('sig') || '')) throw new Error('TTS URL');
  return deliveryPath + parsed.search;
}
