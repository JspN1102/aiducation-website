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
// Speech the origin already published to the school's COS bucket downloads
// straight from Guangzhou; the signed URL (one relay round trip, then a
// redirect to that same COS object) stays the fallback route.
const PUBLISHED_SPEECH = /^https:\/\/[a-z0-9-]+\.cos\.[a-z0-9-]+\.myqcloud\.com\/tts\/[0-9a-z]+\/([0-9a-f]{64})\.wav$/;
export function schoolTtsRemote(value, signedURL) {
  const match = typeof value === 'string' && PUBLISHED_SPEECH.exec(value);
  const key = new URL(signedURL, 'https://school.invalid').searchParams.get('key');
  return match && match[1] === key ? value : null;
}
