const test = require('node:test');
const assert = require('node:assert/strict');
test('signed TTS audio stays on the active entrance and keeps its exact signature', async () => {
  const {schoolTtsURL} = await import('../maanshan/school-audio-url.mjs');
  const query = '?key=' + 'a'.repeat(64) + '&sig=' + 'b'.repeat(64);
  const url = '/api/tts/' + query;
  assert.equal(schoolTtsURL(url, 'https://mandarin.aiducation.asia/maanshan/school-audio-url.mjs'), url);
  assert.equal(schoolTtsURL(url, 'https://aiducation.asia/school/school-audio-url.mjs'), '/school-api/tts/' + query);
  for (const bad of [null, '//evil.test/api/tts/' + query, 'https://evil.test' + url, '/api/school-auth/' + query,
    url + '#fragment', url + '&key=extra', '/api/tts/?key=bad&sig=bad']) {
    assert.throws(() => schoolTtsURL(bad, 'https://aiducation.asia/school/school-audio-url.mjs'));
  }
});
