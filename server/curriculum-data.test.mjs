import test from 'node:test';
import assert from 'node:assert/strict';

test('boot and app share both public curriculum downloads', async () => {
  const original = globalThis.fetch, calls = [];
  try {
    globalThis.fetch = async (url, options) => {
      calls.push(url);assert(options.signal instanceof AbortSignal);
      return new Response(JSON.stringify(url.includes('poems.json') ? {poems:[{id:1}]} : {words:{}}));
    };
    const {loadCurriculum} = await import('../maanshan/curriculum-data.mjs?test=shared');
    const [boot, app] = await Promise.all([loadCurriculum(), loadCurriculum()]);
    assert.equal(calls.length, 2);assert.strictEqual(boot[0], app[0]);assert.strictEqual(boot[1], app[1]);
    await loadCurriculum();assert.equal(calls.length, 2);
    assert(calls.some(url => url.endsWith('poems.json?v=20260919b')));
    assert(calls.some(url => url.endsWith('pronunciation.json?v=20260919a')));
  } finally {globalThis.fetch = original;}
});

test('a failed resource retries without downloading successful content again', async () => {
  const original = globalThis.fetch, calls = [];
  let fail = true;
  try {
    globalThis.fetch = async url => {
      calls.push(url);
      if (url.includes('poems.json') && fail) return new Response('temporary', {status:503});
      return new Response(JSON.stringify({ok:true}));
    };
    const {loadCurriculum} = await import('../maanshan/curriculum-data.mjs?test=retry');
    await assert.rejects(loadCurriculum(), /unavailable/);fail = false;
    await loadCurriculum();
    assert.equal(calls.filter(url => url.includes('poems.json')).length, 2);
    assert.equal(calls.filter(url => url.includes('pronunciation.json')).length, 1);
  } finally {globalThis.fetch = original;}
});

test('malformed public JSON does not poison the shared cache', async () => {
  const original = globalThis.fetch;
  let malformed = true, count = 0;
  try {
    globalThis.fetch = async () => {count++;return new Response(malformed ? '<html>unavailable</html>' : '{}');};
    const {loadCurriculum} = await import('../maanshan/curriculum-data.mjs?test=invalid');
    await assert.rejects(loadCurriculum());malformed = false;
    await loadCurriculum();assert.equal(count, 4);
  } finally {globalThis.fetch = original;}
});
