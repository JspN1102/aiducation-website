'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'maanshan-tts-handler-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 return async options=>{
  const result=await run(process.execPath,[path.join(__dirname,'fixtures/tts-handler-process.cjs'),JSON.stringify(options)],{env:{...process.env,TTS_CACHE_DIR:root,TENCENT_SECRET_ID:'fixture-id',TENCENT_SECRET_KEY:'fixture-secret',BLOB_READ_WRITE_TOKEN:'',MAANSHAN_TTS_VOICE:'403001',MAANSHAN_TTS_SPEED:'-.25'}});
  return JSON.parse(result.stdout);
 };
}
const body={text:'來說說今天看到的風景。',delivery:'url',pronunciationVersion:'fixture-recording-v1'};

test('generated speech is reused on the next request and after a fresh server process',async t=>{
 const processRequest=await fixture(t);
 const first=await processRequest({batches:[[body],[body]]});
 assert.equal(first.synthesisCalls,1);assert.deepEqual(first.results.map(r=>r.cache),['MISS-STORED','HIT']);
 assert(first.results.every(r=>r.status===200));assert.equal(first.results[0].url,first.results[1].url);
 const fresh=await processRequest({batches:[[body]]});
 assert.equal(fresh.synthesisCalls,0);assert.equal(fresh.results[0].cache,'HIT');assert.equal(fresh.results[0].url,first.results[0].url);
});

test('poet conversations use Zhirui while ordinary speech stays Yun Xiaohe with separate persistent audio',async t=>{
 const processRequest=await fixture(t),poet={...body,purpose:'poet-chat',voice:403001};
 const first=await processRequest({batches:[[body],[poet],[body,poet]]});
 assert.deepEqual(first.voices,[403001,101021]);assert.equal(first.synthesisCalls,2);
 assert.deepEqual(first.results.map(r=>r.voice),['403001','101021','403001','101021']);
 assert.notEqual(first.results[0].url,first.results[1].url);
 assert.equal(first.results[0].url,first.results[2].url);assert.equal(first.results[1].url,first.results[3].url);
 const fresh=await processRequest({batches:[[body,poet]]});
 assert.equal(fresh.synthesisCalls,0);assert.deepEqual(fresh.results.map(r=>r.cache),['HIT','HIT']);
});

test('a burst of first taps synthesizes the phrase once and all callers get the same stored audio',async t=>{
 const processRequest=await fixture(t),result=await processRequest({batches:[Array.from({length:20},()=>body)]});
 assert.equal(result.synthesisCalls,1);assert.equal(result.results.length,20);
 assert(result.results.every(r=>r.status===200&&r.url===result.results[0].url));
});

test('a stale cache miss that returns after synthesis cannot trigger a second paid request',async t=>{
 const processRequest=await fixture(t),result=await processRequest({delayedMiss:true,batches:[[body,body]]});
 assert.equal(result.synthesisCalls,1);assert.deepEqual(result.results.map(r=>r.cache),['MISS-STORED','HIT']);
 assert.equal(result.results[0].url,result.results[1].url);
});

test('a long poet recording persists beyond the Blob limit and a restarted handler serves the full WAV and ranges',async t=>{
 const processRequest=await fixture(t),poet={...body,purpose:'poet-chat'},pcmBytes=3*1024*1024;
 const first=await processRequest({pcmBytes,batches:[[poet]]});
 assert.equal(first.synthesisCalls,1);assert.equal(first.results[0].cache,'MISS-STORED');
 const fresh=await processRequest({batches:[[poet]],readback:true});
 assert.equal(fresh.synthesisCalls,0);assert.equal(fresh.results[0].cache,'HIT');assert.equal(fresh.results[0].url,first.results[0].url);
 const total=44+pcmBytes+2*(Math.round(16000*.18)+Math.round(16000*.08));
 assert.deepEqual(fresh.deliveries,[{range:'full',status:200,bytes:total,wav:true},{range:'bytes=0-43',status:206,bytes:44,contentRange:`bytes 0-43/${total}`,wav:true},{range:'bytes=-1024',status:206,bytes:1024,contentRange:`bytes ${total-1024}-${total-1}/${total}`,wav:false}]);
});
