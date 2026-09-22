'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'maanshan-tts-handler-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 return async options=>{
  const result=await run(process.execPath,[path.join(__dirname,'fixtures/tts-handler-process.cjs'),JSON.stringify(options)],{env:{...process.env,TTS_CACHE_DIR:root,TENCENT_SECRET_ID:'fixture-id',TENCENT_SECRET_KEY:'fixture-secret',BLOB_READ_WRITE_TOKEN:'',MAANSHAN_TTS_VOICE:'403001',MAANSHAN_TTS_SPEED:'-.25',...(options.env||{})}});
  return JSON.parse(result.stdout);
 };
}
const body={text:'來說說今天看到的風景。',delivery:'url',pronunciationVersion:'fixture-recording-v1'};

test('single-character demonstrations complete the utterance without changing its prescribed tone',async t=>{
 const processRequest=await fixture(t),plain={...body,text:'目'},ssml={...body,text:'<speak><phoneme alphabet="py" ph="mu4">目</phoneme></speak>',allowSSML:true};
 const first=await processRequest({batches:[[plain,ssml],[plain,ssml]]});
 assert.equal(first.synthesisCalls,2);
 assert.deepEqual([...first.texts].sort(),['目。','<speak><phoneme alphabet="py" ph="mu4">目</phoneme>。</speak>'].sort());
 assert.deepEqual(first.results.map(r=>r.cache),['MISS-STORED','MISS-STORED','HIT','HIT']);
 const next=await processRequest({batches:[[plain,ssml]]});assert.equal(next.synthesisCalls,0);
});

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

test('cached speech is published to COS once and its signed audio URL redirects there afterwards',async t=>{
 const processRequest=await fixture(t);
 const first=await processRequest({cos:'up',readback:true,batches:[[body],[body]]});
 assert.equal(first.synthesisCalls,1);assert.equal(first.cos.putCount,1);
 const remote=first.results[0].remote;
 assert.match(remote,/^https:\/\/fixture-bucket-1250000000\.cos\.ap-guangzhou\.myqcloud\.com\/tts\/[0-9a-z]+\/[0-9a-f]{64}\.wav$/);
 assert.equal(first.results[1].remote,remote);
 assert.deepEqual(first.cos.objects.map(o=>[o.path,o.ak,o.type,o.cacheControl,o.wav]),[[new URL(remote).pathname,'fixture-id','audio/wav','public, max-age=31536000, immutable',true]]);
 assert.deepEqual(first.deliveries.map(d=>[d.status,d.location,d.cache]),Array.from({length:6},()=>[302,remote,'HIT-REMOTE']));
 // A restarted server trusts the on-disk marker: same redirect, no second upload.
 const fresh=await processRequest({cos:'up',readback:true,batches:[[body]]});
 assert.equal(fresh.synthesisCalls,0);assert.equal(fresh.cos.putCount,0);
 assert.equal(fresh.results[0].cache,'HIT');assert.equal(fresh.results[0].remote,remote);
 assert.deepEqual(fresh.deliveries.map(d=>[d.status,d.location]),Array.from({length:3},()=>[302,remote]));
});

test('a dedicated COS key takes precedence over the speech synthesis key',async t=>{
 const processRequest=await fixture(t);
 const result=await processRequest({cos:'up',env:{TTS_COS_SECRET_ID:'cos-id',TTS_COS_SECRET_KEY:'cos-secret'},batches:[[body]]});
 assert.equal(result.cos.putCount,1);assert.equal(result.cos.objects[0].ak,'cos-id');assert(result.results[0].remote);
});

test('an unreachable or private COS bucket leaves relay delivery unchanged',async t=>{
 for(const cos of ['down','private']){
  const processRequest=await fixture(t);
  const result=await processRequest({cos,readback:true,batches:[[body],[body]]});
  assert.equal(result.synthesisCalls,1,cos);
  assert.deepEqual(result.results.map(r=>[r.status,r.cache,'remote' in r]),[[200,'MISS-STORED',false],[200,'HIT',false]],cos);
  assert.deepEqual(result.deliveries.map(d=>[d.status,d.wav,'location' in d]),[[200,true,false],[206,true,false],[206,false,false],[200,true,false],[206,true,false],[206,false,false]],cos);
  assert.equal(result.cos.putCount,cos==='private'?1:0,cos);
 }
});
