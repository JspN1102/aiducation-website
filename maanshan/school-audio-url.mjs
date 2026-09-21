// The origin returns canonical signed audio paths at both school entrances.
// Derive the public prefix locally without changing the signed query string.
export function schoolTtsURL(value, moduleURL = import.meta.url) {
  const canonical = '/' + ['api', 'tts', ''].join('/');
  if (typeof value !== 'string' || !value.startsWith(canonical + '?')) throw new Error('TTS URL');
  const parsed = new URL(value, 'https://school.invalid');
  if (parsed.origin !== 'https://school.invalid' || parsed.pathname !== canonical || parsed.hash ||
      Array.from(parsed.searchParams.keys()).length !== 2 || !/^[a-f0-9]{64}$/.test(parsed.searchParams.get('key') || '') ||
      !/^[a-f0-9]{64}$/.test(parsed.searchParams.get('sig') || '')) throw new Error('TTS URL');
  return new URL(moduleURL).pathname.startsWith('/school/') ? '/school-api/tts/' + parsed.search : value;
}
