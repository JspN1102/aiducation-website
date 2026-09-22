import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CHALLENGE_SETS} from '../maanshan/challenge-data.mjs';

test('every dictation target has usable local demonstration and tracing geometry',()=>{
  const targets=new Set(Object.values(CHALLENGE_SETS).flatMap(set=>(set.bank||set.items).filter(item=>item.type==='dictation').map(item=>item.target.char)));
  assert(targets.has('峯'),'preserve the curriculum upper/lower character');
  for(const char of targets){
    const file=new URL(`../maanshan/vendor/hanzi-data/${char.codePointAt(0).toString(16)}.json`,import.meta.url);
    assert(fs.existsSync(file),`Missing local stroke data for ${char}`);
    const data=JSON.parse(fs.readFileSync(file,'utf8'));
    assert(Array.isArray(data.strokes)&&data.strokes.length>0,`${char} stroke paths`);
    assert.equal(data.strokes.length,data.medians.length,`${char} paths/medians match`);
    for(const [index,stroke]of data.strokes.entries()){
      assert(/^M /.test(stroke)&&/ Z$/.test(stroke),`${char} stroke ${index} has a closed shape`);
      assert(data.medians[index].length>=2,`${char} stroke ${index} can be traced`);
      assert(data.medians[index].every(point=>point.length===2&&point.every(value=>Number.isFinite(value)&&value>=-200&&value<=1200)),`${char} stroke ${index} has finite points within the glyph coordinate space`);
    }
  }
});

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
