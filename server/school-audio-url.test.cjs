const test = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const path = require('node:path');
test('signed TTS audio uses the main API after both main and fallback pages move to /school/', async () => {
  const {schoolTtsURL} = await import('../maanshan/school-audio-url.mjs');
  const query = '?key=' + 'a'.repeat(64) + '&sig=' + 'b'.repeat(64);
  const url = '/api/tts/' + query;
  assert.equal(schoolTtsURL(url), url);
  for (const bad of [null, '//evil.test/api/tts/' + query, 'https://evil.test' + url, '/api/school-auth/' + query,
    url + '#fragment', url + '&key=extra', '/api/tts/?key=bad&sig=bad']) {
    assert.throws(() => schoolTtsURL(bad));
  }
});
test('actual company packager relocates playback while preserving validation and exact signature', async () => {
  const source=execFileSync('python',['-c',
    "import importlib.util,pathlib; p=pathlib.Path('deploy/package-company-fallback.py'); s=importlib.util.spec_from_file_location('fallback',p); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.relocate_source(pathlib.Path('maanshan/school-audio-url.mjs').read_text(encoding='utf-8')))"] ,{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
  const {schoolTtsURL}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const query='?sig='+'b'.repeat(64)+'&key='+'a'.repeat(64);
  assert.equal(schoolTtsURL('/api/tts/'+query),'/school-api/tts/'+query);
  assert.throws(()=>schoolTtsURL('/school-api/tts/'+query));
  assert.throws(()=>schoolTtsURL('https://elsewhere.invalid/api/tts/'+query));
});
test('published speech plays straight from COS only for the same signed key', async () => {
  const {schoolTtsRemote} = await import('../maanshan/school-audio-url.mjs');
  const key = 'a'.repeat(64), signed = '/api/tts/?key=' + key + '&sig=' + 'b'.repeat(64);
  const remote = 'https://aiducation-mandarin-media-1427410149.cos.ap-guangzhou.myqcloud.com/tts/20260919b3/' + key + '.wav';
  assert.equal(schoolTtsRemote(remote, signed), remote);
  assert.equal(schoolTtsRemote(remote, '/school-api/tts/?key=' + key + '&sig=' + 'b'.repeat(64)), remote);
  for (const bad of [undefined, null, '', remote.replace(key, 'c'.repeat(64)), remote.replace('https:', 'http:'),
    'https://evil.test/tts/20260919b3/' + key + '.wav', 'https://x.cos.ap-guangzhou.myqcloud.com.evil.test/tts/v/' + key + '.wav',
    remote + '?x=1', remote.replace('.wav', '.mp3')]) {
    assert.equal(schoolTtsRemote(bad, signed), null);
  }
});
