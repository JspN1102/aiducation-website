'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{gzipSync}=require('node:zlib');
function fixture({transcode}={}){
 const clients=[],filename=path.resolve(__dirname,'../api/soe.js'),transcodes=[];
 const transcoder={FORMATS:{webm:{},mp4:{}},MAX_INPUT_BYTES:1024*1024,async transcodeToWav(input,format){transcodes.push({input,format});if(!transcode)throw new Error('unexpected transcode');return transcode(input,format);}};
 class WS extends EventEmitter{
  constructor(url,options){super();this.sent=[];this.options=options;clients.push(this);queueMicrotask(()=>this.emit('open'));}
  send(value){this.sent.push(value);}close(){this.closeRequested=true;}terminate(){this.terminated=true;this.emit('close');}
 }
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,Buffer,performance,setTimeout,clearTimeout,process:{env:{TENCENT_SECRET_ID:'synthetic',TENCENT_SECRET_KEY:'synthetic',TENCENT_APP_ID:'123'}},require:name=>name==='ws'?WS:name==='./_lib/school-learning.cjs'?{withSchoolLearning:(_operation,handler)=>handler}:name==='./_lib/soe-reference'?require('../api/_lib/soe-reference'):name==='./_lib/audio-transcode.cjs'?transcoder:require(name)},{filename});
 const call=body=>{const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},end(raw){this.raw=raw;}};return {res,pending:module.exports({method:'POST',body},res)};};
 return {clients,call,transcodes};
}
test('SOE lossless upload restores identical PCM/WAV bytes and returns final scores before socket closes',async()=>{
 const f=fixture(),original=Buffer.alloc(32000,37),{res,pending}=f.call({refText:'曲项向天歌',audio:gzipSync(original).toString('base64'),audioCompression:'gzip'});
 await new Promise(resolve=>setImmediate(resolve));const ws=f.clients[0];assert.deepEqual(ws.sent[0],original);assert.equal(ws.sent[1],'{"type":"end"}');
 ws.emit('message',Buffer.from(JSON.stringify({code:0,final:1,result:{pron_accuracy:82,pron_completion:100,words:[{word:'曲',pron_accuracy:80}]}})));
 await Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Response waited for peer close')),150))]);
 assert.equal(res.statusCode,200);assert.equal(res.body.PronAccuracy,82);assert.equal(res.body.Words[0].Word,'曲');assert.equal(ws.closeRequested,true);assert.match(res.headers['Server-Timing'],/soe_score;dur=/);ws.emit('close');
});
test('SOE keeps legacy uploads and does not turn a partial interrupted score into a completed result',async()=>{
 const f=fixture(),original=Buffer.alloc(1600,27),{res,pending}=f.call({refText:'鹅鹅鹅',audio:original.toString('base64')});
 await new Promise(resolve=>setImmediate(resolve));const ws=f.clients[0];assert.deepEqual(ws.sent[0],original);
 ws.emit('message',Buffer.from(JSON.stringify({code:0,result:{pron_accuracy:60}})));ws.emit('close');await pending;
 assert.equal(res.statusCode,502);assert.equal(res.body.PronAccuracy,undefined);
});
test('SOE final acknowledgement can complete the preceding provider result exactly once',async()=>{
 const f=fixture(),{res,pending}=f.call({refText:'鹅鹅鹅',audio:Buffer.alloc(1600,27).toString('base64')});
 await new Promise(resolve=>setImmediate(resolve));const ws=f.clients[0];
 ws.emit('message',Buffer.from(JSON.stringify({code:0,result:{pron_accuracy:76,words:[]}})));
 assert.equal(res.body,undefined);
 ws.emit('message',Buffer.from(JSON.stringify({code:0,final:1})));await pending;assert.equal(res.statusCode,200);assert.equal(res.body.PronAccuracy,76);
 const completed=res.body;ws.emit('close');assert.strictEqual(res.body,completed);
});
test('SOE rejects corrupt, oversized or unknown compressed audio before calling provider',async()=>{
 for(const body of [{audio:'bad?'},{audio:Buffer.from('invalid gzip').toString('base64'),audioCompression:'gzip'},{audio:gzipSync(Buffer.alloc(3*1024*1024+1)).toString('base64'),audioCompression:'gzip'},{audio:'AAAA',audioCompression:'unknown'}]){
  const f=fixture(),{res,pending}=f.call({refText:'鹅',...body});await pending;assert.equal(res.statusCode,400);assert.equal(f.clients.length,0);
 }
});
test('browser compression preserves all samples and safely falls back without native support',async()=>{
 globalThis.location??=new URL('https://mandarin.aiducation.asia/school/');
 const {prepareAssessmentPayload}=await import('../maanshan/recording-audio.mjs');
 const original=Buffer.alloc(96000);for(let i=0;i<original.length;i++)original[i]=i%127;
 const payload={audio:original.toString('base64'),refText:'曲项向天歌',researchContext:{attemptId:'synthetic'}};
 const compressed=await prepareAssessmentPayload(payload);
 assert.equal(compressed.audioCompression,'gzip');assert.deepEqual(require('node:zlib').gunzipSync(Buffer.from(compressed.audio,'base64')),original);assert.strictEqual(compressed.researchContext,payload.researchContext);assert.equal(payload.audioCompression,undefined);
 assert.strictEqual(await prepareAssessmentPayload(payload,{}),payload);
 assert.strictEqual(await prepareAssessmentPayload(payload,{CompressionStream:class{constructor(){throw new Error('unsupported');}}}),payload);
});
test('SOE compact upload is decoded on the origin and the decoded WAV is what the provider scores',async()=>{
 const decoded=Buffer.alloc(64044,11),input=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]),Buffer.alloc(9000,5)]);
 const f=fixture({transcode:async()=>decoded}),{res,pending}=f.call({refText:'曲项向天歌',audio:input.toString('base64'),audioFormat:'webm'});
 await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.transcodes.length,1);assert.deepEqual(f.transcodes[0].input,input);assert.equal(f.transcodes[0].format,'webm');
 const ws=f.clients[0];assert.deepEqual(ws.sent[0],decoded);assert.equal(ws.sent[1],'{"type":"end"}');
 ws.emit('message',Buffer.from(JSON.stringify({code:0,final:1,result:{pron_accuracy:88,words:[]}})));await pending;
 assert.equal(res.statusCode,200);assert.equal(res.body.PronAccuracy,88);assert.match(res.headers['Server-Timing'],/audio_prepare;dur=/);ws.emit('close');
});
test('SOE refuses a compact upload it cannot decode with 422 before any provider call, bypassing outcome recording',async()=>{
 const f=fixture({transcode:async()=>{throw Object.assign(new Error('bad'),{code:'DECODE_FAILED'});}});
 const {res,pending}=f.call({refText:'鹅鹅鹅',audio:Buffer.from('OggS....').toString('base64'),audioFormat:'webm'});await pending;
 assert.equal(res.statusCode,422);assert.equal(res.body,undefined,'not sent through res.json');
 assert.deepEqual(JSON.parse(res.raw),{error:'Audio transcode failed',code:'AUDIO_TRANSCODE_FAILED',reason:'DECODE_FAILED'});
 assert.equal(res.headers['Content-Type'],'application/json; charset=utf-8');assert.equal(f.clients.length,0);
});
test('SOE validates the compact format and size without invoking the decoder',async()=>{
 for(const body of [{audio:'AAAA',audioFormat:'flac'},{audio:'AAAA',audioFormat:'webm',audioCompression:'gzip'},{audio:'AAAA',audioFormat:7},{audio:Buffer.alloc(1024*1024+1).toString('base64'),audioFormat:'webm'}]){
  const f=fixture({transcode:async()=>Buffer.alloc(64044)}),{res,pending}=f.call({refText:'鹅',...body});await pending;
  assert.equal(res.statusCode,400);assert.equal(f.transcodes.length,0);assert.equal(f.clients.length,0);
 }
});
test('browser compact upload keeps the recorder bytes, skips gzip and maps the decoder refusal to a single PCM fallback',async()=>{
 globalThis.location??=new URL('https://mandarin.aiducation.asia/school/');
 const {compactRecording,compactFormat,prepareAssessmentPayload,submitAssessment}=await import('../maanshan/recording-audio.mjs');
 const bytes=Buffer.alloc(20000);for(let i=0;i<bytes.length;i++)bytes[i]=(i*7)%251;
 const compact=await compactRecording(new Blob([bytes],{type:'audio/webm;codecs=opus'}));
 assert.equal(compact.audioFormat,'webm');assert.deepEqual(Buffer.from(compact.audio,'base64'),bytes);
 assert.equal((await compactRecording(new Blob([bytes],{type:'audio/mp4'}))).audioFormat,'mp4');
 assert.equal(await compactRecording(new Blob([bytes],{type:'audio/flac'})),null);
 assert.equal(await compactRecording(new Blob([bytes],{type:'audio/webm'}),{maxBytes:1000}),null);
 assert.equal(await compactRecording(new Blob([Buffer.alloc(10)],{type:'audio/webm'})),null);
 assert.equal(compactFormat('AUDIO/OGG; codecs=opus'),'ogg');assert.equal(compactFormat(undefined),null);
 const payload={audio:compact.audio,audioFormat:'webm',refText:'曲项向天歌'};
 assert.strictEqual(await prepareAssessmentPayload(payload),payload,'compact uploads are never gzipped again');
 const sent=[];
 const fetchImpl=async(url,options)=>{sent.push(JSON.parse(options.body));return {ok:false,status:422,json:async()=>({error:'Audio transcode failed',code:'AUDIO_TRANSCODE_FAILED'})};};
 await assert.rejects(submitAssessment(payload,{fetchImpl}),error=>error.code==='TRANSCODE'&&error.canRetry===true);
 assert.equal(sent.length,1,'a definite refusal is not retried as a transport failure');assert.equal(sent[0].audioFormat,'webm');assert.equal(sent[0].audioCompression,undefined);
 const other=async()=>({ok:false,status:422,json:async()=>({error:'other'})});
 await assert.rejects(submitAssessment(payload,{fetchImpl:other}),error=>error.code==='SERVICE');
});
