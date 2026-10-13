'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{gzipSync}=require('node:zlib');
// fixed: a frozen clock and voice ID so the signed provider URL can be compared byte for byte.
const FIXED_AT=Date.parse('2026-10-08T00:00:00.000Z'),FIXED_VOICE='00000000-0000-4000-8000-000000000000';
class FixedDate extends Date{constructor(...args){super(...(args.length?args:[FIXED_AT]));}static now(){return FIXED_AT;}}
function fixture({transcode,fixed}={}){
 const clients=[],filename=path.resolve(__dirname,'../api/soe.js'),transcodes=[];
 const transcoder={FORMATS:{webm:{},mp4:{}},MAX_INPUT_BYTES:1024*1024,async transcodeToWav(input,format){transcodes.push({input,format});if(!transcode)throw new Error('unexpected transcode');return transcode(input,format);}};
 class WS extends EventEmitter{
  constructor(url,options){super();this.url=url;this.sent=[];this.options=options;clients.push(this);queueMicrotask(()=>this.emit('open'));}
  send(value){this.sent.push(value);}close(){this.closeRequested=true;}terminate(){this.terminated=true;this.emit('close');}
 }
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,Buffer,performance,setTimeout,clearTimeout,...fixed?{Date:FixedDate}:{},process:{env:{TENCENT_SECRET_ID:'synthetic',TENCENT_SECRET_KEY:'synthetic',TENCENT_APP_ID:'123'}},require:name=>fixed&&name==='crypto'?{...require('node:crypto'),randomUUID:()=>FIXED_VOICE}:name==='ws'?WS:name==='./_lib/school-learning.cjs'?{withSchoolLearning:(_operation,handler)=>handler}:name==='./_lib/soe-reference'?require('../api/_lib/soe-reference'):name==='./_lib/audio-transcode.cjs'?transcoder:require(name)},{filename});
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
test('SOE passes each word match tag and its phone scores through to the browser',async()=>{
 const f=fixture(),{res,pending}=f.call({refText:'曲项向天歌',audio:Buffer.alloc(1600,27).toString('base64')});
 await new Promise(resolve=>setImmediate(resolve));const ws=f.clients[0];
 ws.emit('message',Buffer.from(JSON.stringify({code:0,final:1,result:{pron_accuracy:70,words:[{word:'曲',pron_accuracy:69,match_tag:0,phone_infos:[{phone:'q',pron_accuracy:50},{phone:'v1',pron_accuracy:87}]},{word:'啊',pron_accuracy:40,match_tag:1},{word:'向',pron_accuracy:0,match_tag:2},{word:'天',pron_accuracy:99}]}})));await pending;
 const words=JSON.parse(JSON.stringify(res.body.Words));
 assert.deepEqual(words.map(w=>w.MatchTag),[0,1,2,0],'older results without a tag count as matched');
 assert.deepEqual(words[0].PhoneInfos,[{Phone:'q',PronAccuracy:50},{Phone:'v1',PronAccuracy:87}]);ws.emit('close');
});
// school48 research detail: signed provider URLs captured from the pre-change soe.js (synthetic credentials,
// frozen clock and voice ID). The research detail must never alter the provider request or the learner's response.
const CAPTURED_URLS={
 '鹅鹅鹅':'wss://soe.cloud.tencent.com/soe/api/123?eval_mode=1&expired=1791504000&nonce=1791417600&rec_mode=1&ref_text=%E9%B9%85%E9%B9%85%E9%B9%85&score_coeff=1.5&secretid=synthetic&sentence_info_enabled=0&server_engine_type=16k_zh&text_mode=0&timestamp=1791417600&voice_format=1&voice_id=00000000-0000-4000-8000-000000000000&signature=TzH6CN0QC3rhG%2FgRQBJnb5z4ues%3D',
 '曲项向天歌':'wss://soe.cloud.tencent.com/soe/api/123?eval_mode=1&expired=1791504000&nonce=1791417600&rec_mode=1&ref_text=%7B%22wordList%22%3A%5B%7B%22word%22%3A%22%E6%9B%B2%22%2C%22pron%22%3A%5B%5B%22qu1%22%5D%5D%7D%2C%7B%22word%22%3A%22%E9%A1%B9%22%7D%2C%7B%22word%22%3A%22%E5%90%91%22%7D%2C%7B%22word%22%3A%22%E5%A4%A9%22%7D%2C%7B%22word%22%3A%22%E6%AD%8C%22%7D%5D%7D&score_coeff=1.5&secretid=synthetic&sentence_info_enabled=0&server_engine_type=16k_zh&text_mode=1&timestamp=1791417600&voice_format=1&voice_id=00000000-0000-4000-8000-000000000000&signature=alSem%2BPP7%2FtJQVfOB781F2FZZ%2FY%3D'};
function wav(ms,{rate=16000,channels=1,bits=16}={}){
 const data=Buffer.alloc(Math.round(ms*rate*channels*bits/8/1000),3),h=Buffer.alloc(44);
 h.write('RIFF',0,'ascii');h.writeUInt32LE(36+data.length,4);h.write('WAVE',8,'ascii');h.write('fmt ',12,'ascii');h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);
 h.writeUInt16LE(channels,22);h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*channels*bits/8,28);h.writeUInt16LE(channels*bits/8,32);h.writeUInt16LE(bits,34);h.write('data',36,'ascii');h.writeUInt32LE(data.length,40);
 return Buffer.concat([h,data]);
}
const settle=()=>new Promise(resolve=>setImmediate(resolve)),plain=value=>JSON.parse(JSON.stringify(value));
test('SOE research detail leaves the signed provider request identical to the pre-change capture (text_mode 0 and 1)',async()=>{
 for(const [refText,url] of Object.entries(CAPTURED_URLS))for(const body of [{audio:Buffer.alloc(1600,27).toString('base64')},{audio:gzipSync(wav(500)).toString('base64'),audioCompression:'gzip'}]){
  const f=fixture({fixed:true}),{res,pending}=f.call({refText,...body});await settle();const ws=f.clients[0];
  assert.equal(ws.url,url);assert.deepEqual(plain(ws.options),{handshakeTimeout:8000,perMessageDeflate:false});
  ws.emit('message',Buffer.from(JSON.stringify({code:0,final:1,result:{pron_accuracy:80,words:[]}})));await pending;ws.emit('close');
  assert.equal(res.statusCode,200);assert.equal(res.researchExtras.service.textMode,refText==='鹅鹅鹅'?0:1);
 }
});
test('SOE response body and Server-Timing are unchanged while the wrapper receives raw words, path, length and timings',async()=>{
 const words=[{word:'曲',pron_accuracy:69.4,pron_fluency:0.93,match_tag:0,begin_time:120,end_time:400,phone_infos:[{phone:'q',pron_accuracy:50},{phone:'v1',reference_phone:'u1',pron_accuracy:87}]},{word:'啊',pron_accuracy:40,match_tag:1},{word:'项',pron_accuracy:0,match_tag:2}];
 const audio=wav(1000),f=fixture({fixed:true}),{res,pending}=f.call({refText:'曲项向天歌',audio:gzipSync(audio).toString('base64'),audioCompression:'gzip'});
 await settle();const ws=f.clients[0];assert.deepEqual(ws.sent[0],audio);
 ws.emit('message',Buffer.from(JSON.stringify({code:0,final:1,result:{pron_accuracy:70,pron_fluency:0.9,pron_completion:100,suggested_score:71,words}})));await pending;ws.emit('close');
 assert.equal(res.statusCode,200);
 assert.deepEqual(JSON.parse(JSON.stringify(res.body)),{PronAccuracy:70,PronFluency:0.9,PronCompletion:100,SuggestedScore:71,Words:[
  {Word:'曲',PronAccuracy:69.4,PronFluency:0.93,MatchTag:0,MemBeginTime:120,MemEndTime:400,PhoneInfos:[{Phone:'q',PronAccuracy:50},{Phone:'v1',PronAccuracy:87}]},
  {Word:'啊',PronAccuracy:40,PronFluency:null,MatchTag:1,MemBeginTime:0,MemEndTime:0,PhoneInfos:[]},
  {Word:'项',PronAccuracy:0,PronFluency:null,MatchTag:2,MemBeginTime:0,MemEndTime:0,PhoneInfos:[]}]});
 assert.deepEqual(Object.keys(res.headers),['Access-Control-Allow-Origin','Access-Control-Allow-Methods','Access-Control-Allow-Headers','Server-Timing']);
 assert.match(res.headers['Server-Timing'],/^audio_prepare;dur=\d+\.\d, soe_connect;dur=\d+\.\d, soe_score;dur=\d+\.\d, soe_total;dur=\d+\.\d$/);
 const {service,rawWords}=res.researchExtras;
 assert.deepEqual(plain(rawWords),words);assert.equal(service.audioPath,'pcm-gzip');assert.equal(service.textMode,1);assert.equal(service.audioMs,1000);
 for(const key of ['prepareMs','connectMs','scoreMs'])assert.ok(Number.isInteger(service[key])&&service[key]>=0,key);
 assert.deepEqual(Object.keys(service).sort(),['audioMs','audioPath','connectMs','prepareMs','scoreMs','textMode']);
});
test('SOE compact path reports the decoded length; a provider error keeps only its numeric code',async()=>{
 const decoded=wav(2000,{rate:48000,channels:2}),input=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]),Buffer.alloc(9000,5)]);
 const f=fixture({transcode:async()=>decoded}),{res,pending}=f.call({refText:'鹅鹅鹅',audio:input.toString('base64'),audioFormat:'webm'});
 await settle();await settle();const ws=f.clients[0];assert.deepEqual(ws.sent[0],decoded);
 ws.emit('message',Buffer.from(JSON.stringify({code:4002,message:'synthetic provider message'})));await pending;
 assert.equal(res.statusCode,502);assert.deepEqual(plain(res.body),{error:'synthetic provider message',code:4002});
 assert.deepEqual(Object.keys(res.researchExtras),['service']);
 const {service}=res.researchExtras;assert.equal(service.audioPath,'webm');assert.equal(service.textMode,0);assert.equal(service.audioMs,2000);assert.equal(service.providerCode,4002);
 assert.ok(Number.isInteger(service.prepareMs));assert.equal('connectMs' in service,false);
 assert.equal(JSON.stringify(res.researchExtras).includes('synthetic'),false,'no provider error text');
 const other=fixture(),call=other.call({refText:'鹅鹅鹅',audio:Buffer.alloc(1600,27).toString('base64')});await settle();
 other.clients[0].emit('message',Buffer.from(JSON.stringify({code:'E1',message:'x'})));await call.pending;
 assert.equal(call.res.statusCode,502);assert.deepEqual(plain(call.res.body),{error:'x',code:'E1'});assert.equal('providerCode' in call.res.researchExtras.service,false);
});
test('SOE refusals of the line or audio are 422 SOE_REJECTED and keep the provider code; service codes stay 502',async()=>{
 for(const [code,status,reason] of [[4103,422,'text'],[4007,422,'audio'],[4100,422,'other'],[4199,422,'other'],[4001,502],[4006,502],[4008,502],[4200,502],[5000,502]]){
  const f=fixture(),{res,pending}=f.call({refText:'鹅鹅鹅',audio:Buffer.alloc(1600,27).toString('base64')});await settle();
  f.clients[0].emit('message',Buffer.from(JSON.stringify({code,message:'synthetic'})));await pending;
  assert.equal(res.statusCode,status,String(code));assert.equal(res.researchExtras.service.providerCode,code);
  assert.deepEqual(plain(res.body),reason?{error:'synthetic',code:'SOE_REJECTED',reason,providerCode:code}:{error:'synthetic',code});
 }
});
test('a refused line is shown its own message, is never resent and offers no retry of the same audio',async()=>{
 globalThis.location??=new URL('https://mandarin.aiducation.asia/school/');
 const {submitAssessment}=await import('../maanshan/recording-audio.mjs');
 for(const [reason,message] of [['text','這一句暫時未能評分，可以先讀下一句。'],['audio','這次錄音聽不清楚，請靠近一點，大聲把整句讀完再試。'],['other','這一句這次未能評分，可以重新朗讀，或者先讀下一句。'],['new','這一句這次未能評分，可以重新朗讀，或者先讀下一句。']]){
  let sent=0;const fetchImpl=async()=>{sent++;return {ok:false,status:422,json:async()=>({error:'x',code:'SOE_REJECTED',reason,providerCode:4103})};};
  await assert.rejects(submitAssessment({audio:'AAAA',refText:'鹅'},{fetchImpl,page:null}),error=>error.code==='REJECTED'&&error.canRetry===false&&error.message===message&&error.researchHttpStatus===422&&!/稍後/.test(error.message));
  assert.equal(sent,1,reason);
 }
 // A pre-school62b 502 for the same refusal is still resent once and shown the service text.
 let sent=0;const legacy=async()=>{sent++;return {ok:false,status:502,json:async()=>({error:'x',code:4103})};};
 await assert.rejects(submitAssessment({audio:'AAAA',refText:'鹅'},{fetchImpl:legacy,page:null}),error=>error.code==='SERVICE');assert.equal(sent,2);
});
test('SOE socket failures keep their responses and leave only the preparation time and path',async()=>{
 for(const [fail,error] of [[ws=>ws.emit('error',new Error('synthetic socket failure')),'synthetic socket failure'],[ws=>ws.emit('close'),'No final result received']]){
  const f=fixture(),{res,pending}=f.call({refText:'鹅鹅鹅',audio:Buffer.alloc(1600,27).toString('base64')});await settle();fail(f.clients[0]);await pending;
  assert.equal(res.statusCode,502);assert.deepEqual(plain(res.body),{error});
  assert.deepEqual(Object.keys(res.researchExtras.service).sort(),['audioPath','prepareMs','textMode']);assert.equal(res.researchExtras.service.audioPath,'pcm');
  assert.equal(res.researchExtras.rawWords,undefined);
 }
 const invalid=fixture(),{res,pending}=invalid.call({refText:'鹅鹅鹅',audio:'bad?'});await pending;assert.equal(res.statusCode,400);assert.equal(res.researchExtras,undefined);
});
test('a reading whose answer was lost is sent once more with the same body; refusals never are',async()=>{
 globalThis.location??=new URL('https://mandarin.aiducation.asia/school/');
 const {submitAssessment}=await import('../maanshan/recording-audio.mjs');
 const payload={audio:'AAAA',audioFormat:'webm',refText:'曲项向天歌',requestId:'0b6c1e8e-2f6b-4d0a-9d55-6d1f6f0d4a11'};
 const script=steps=>{const sent=[];return {sent,fetchImpl:async(url,options)=>{sent.push(options.body);const step=steps[sent.length-1];if(step instanceof Error)throw step;if(step==='hang')return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));if(step==='cut')return {ok:true,status:200,json:async()=>{throw new SyntaxError('Unexpected end');}};return {ok:step===200,status:step,json:async()=>step===200?{SuggestedScore:88}:{error:'x',code:'X'}};}};};
 for(const first of [new TypeError('Failed to fetch'),502,503,504,'cut','hang']){
  const s=script([first,200]);let retries=0;
  assert.deepEqual(await submitAssessment(payload,{fetchImpl:s.fetchImpl,timeout:60,onRetry:()=>retries++}),{SuggestedScore:88},String(first));
  assert.equal(s.sent.length,2);assert.equal(s.sent[0],s.sent[1],'the resend carries the same requestId and audio');assert.equal(retries,1);
 }
 for(const [steps,code] of [[[502,502],'SERVICE'],[[new TypeError('x'),new TypeError('x')],'NETWORK'],[['hang','hang'],'TIMEOUT']]){
  const s=script(steps);await assert.rejects(submitAssessment(payload,{fetchImpl:s.fetchImpl,timeout:60}),error=>error.code===code&&error.canRetry===true);assert.equal(s.sent.length,2,'never a third time while the page stays shown');
 }
 for(const [status,code] of [[400,'SERVICE'],[413,'SERVICE'],[422,'SERVICE'],[500,'SERVICE'],[429,'BUSY']]){
  const s=script([status,200]);await assert.rejects(submitAssessment(payload,{fetchImpl:s.fetchImpl}),error=>error.code===code);assert.equal(s.sent.length,1,status+' is an answer, not a lost one');
 }
 const controller=new AbortController(),s=script(['hang',200]);const pending=submitAssessment(payload,{fetchImpl:s.fetchImpl,signal:controller.signal});
 setTimeout(()=>controller.abort(),20);await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(s.sent.length,1,'a cancelled reading is not resent');
});
test('a reading lost while the page was hidden goes again when the page is shown',async()=>{
 globalThis.location??=new URL('https://mandarin.aiducation.asia/school/');
 const {submitAssessment}=await import('../maanshan/recording-audio.mjs');
 const page=Object.assign(new EventTarget(),{visibilityState:'visible'}),show=state=>{page.visibilityState=state;page.dispatchEvent(new Event('visibilitychange'));};
 const sent=[];let fail=2;
 const fetchImpl=async(url,options)=>{sent.push(options.body);if(sent.length===1)show('hidden');if(fail-->0)throw new TypeError('Load failed');return {ok:true,status:200,json:async()=>({SuggestedScore:70})};};
 const pending=submitAssessment({audio:'AAAA',refText:'x',requestId:'abcdefgh-1'},{fetchImpl,page});
 await new Promise(resolve=>setTimeout(resolve,30));assert.equal(sent.length,1,'nothing is sent while the page is hidden');
 show('visible');assert.deepEqual(await pending,{SuggestedScore:70});assert.equal(sent.length,3,'once on return, then the one quiet resend');
 // Hidden during the request, shown again before it failed: the quiet resend first, then the one for the return.
 const again=[];let n=0;const g=async(url,options)=>{again.push(1);if(again.length===1){show('hidden');show('visible');}if(n++<2)throw new TypeError('x');return {ok:true,status:200,json:async()=>({SuggestedScore:60})};};
 assert.deepEqual(await submitAssessment({audio:'AAAA',refText:'x'},{fetchImpl:g,page}),{SuggestedScore:60});assert.equal(again.length,3);
 // A page that never comes back is cancelled by the learner leaving (logout aborts).
 const controller=new AbortController(),h=[];const stuck=submitAssessment({audio:'AAAA',refText:'x'},{fetchImpl:async()=>{h.push(1);show('hidden');throw new TypeError('x');},page,signal:controller.signal});
 await new Promise(resolve=>setTimeout(resolve,20));controller.abort();await assert.rejects(stuck,error=>error.name==='AbortError');assert.equal(h.length,1);show('visible');
 // A refusal while hidden is still never resent.
 const r=[];await assert.rejects(submitAssessment({audio:'AAAA',refText:'x'},{fetchImpl:async()=>{r.push(1);show('hidden');return {ok:false,status:400,json:async()=>({error:'x'})};},page}),error=>error.code==='SERVICE');assert.equal(r.length,1);show('visible');
});
test('speech input keeps its single quick retry and returns slower failures to the pupil',async()=>{
 globalThis.location??=new URL('https://mandarin.aiducation.asia/school/');
 const {submitSpeech}=await import('../maanshan/recording-audio.mjs');
 const sent=[];await assert.rejects(submitSpeech({audio:'AAAA'},{fetchImpl:async()=>{sent.push(1);return {ok:false,status:502,json:async()=>({error:'x'})};}}),error=>error.code==='SERVICE');assert.equal(sent.length,1);
 const quick=[];await assert.rejects(submitSpeech({audio:'AAAA'},{fetchImpl:async()=>{quick.push(1);throw new TypeError('x');}}),error=>error.code==='NETWORK');assert.equal(quick.length,2);
});
test('a refused microphone tells the pupil where to allow it',async()=>{
 globalThis.location??=new URL('https://mandarin.aiducation.asia/school/');
 const {recordingErrorMessage,micDeniedHelp,micNeedsReload}=await import('../maanshan/recording-audio.mjs');
 // Without device details (chat voice input) the iPad Safari wording stays.
 for(const name of ['NotAllowedError','SecurityError']){const text=recordingErrorMessage(new DOMException('denied',name));assert.match(text,/允許使用麥克風/);assert.match(text,/「設定」›「Safari」›「麥克風」/);assert.ok(text.length<=70,text);}
 assert.equal(recordingErrorMessage(new DOMException('x','NotFoundError')),'找不到麥克風，請檢查裝置。');
 // One step for the browser in hand. iPadOS Safari reports a Mac user agent and is told apart by touch points.
 const safari='到「設定」›「Safari」›「麥克風」選「允許」，再按「重新載入」。',address='按網址列左邊的圖示 ›「麥克風」選「允許」，再按「重新載入」。',general='請在瀏覽器設定中允許本網站使用麥克風，再按「重新載入」。';
 const mac='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15';
 const iphone=(app,os='17_6')=>'Mozilla/5.0 (iPhone; CPU iPhone OS '+os+' like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) '+app+' Mobile/15E148 Safari/604.1';
 // iOS 18 moved app settings under 「App」; iOS 26 Safari still says OS 18_6.
 const apps=text=>text.replace('「設定」›','「設定」›「App」›');
 const windows=tail=>'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'+tail;
 const android='Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
 const cases=[
  ['iPadOS Safari (desktop user agent)',{userAgent:mac,maxTouchPoints:5},safari],
  ['iPhone Safari',{userAgent:iphone('Version/17.6'),maxTouchPoints:5},safari],
  ['older iPad Safari',{userAgent:'Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1',maxTouchPoints:5},safari],
  ['iOS Chrome',{userAgent:iphone('CriOS/129.0.6668.69'),maxTouchPoints:5},'到「設定」›「Chrome」› 打開「麥克風」，再按「重新載入」。'],
  ['iOS Edge',{userAgent:iphone('EdgiOS/129.0.2792.84 Version/17.0'),maxTouchPoints:5},'到「設定」›「Edge」› 打開「麥克風」，再按「重新載入」。'],
  ['iOS Firefox',{userAgent:iphone('FxiOS/131.0'),maxTouchPoints:5},'到「設定」›「Firefox」› 打開「麥克風」，再按「重新載入」。'],
  ['iPadOS 18 Safari (desktop user agent)',{userAgent:mac.replace('17.6','18.0'),maxTouchPoints:5},apps(safari)],
  ['iPadOS 26 Safari (desktop user agent)',{userAgent:mac.replace('17.6','26.0'),maxTouchPoints:5},apps(safari)],
  ['iPhone iOS 18 Safari',{userAgent:iphone('Version/18.0','18_0'),maxTouchPoints:5},apps(safari)],
  ['iPhone iOS 26 Safari',{userAgent:iphone('Version/26.0','18_6'),maxTouchPoints:5},apps(safari)],
  ['iPad iOS 18 Safari',{userAgent:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',maxTouchPoints:5},apps(safari)],
  ['iOS 18 Chrome',{userAgent:iphone('CriOS/129.0.6668.69','18_0'),maxTouchPoints:5},'到「設定」›「App」›「Chrome」› 打開「麥克風」，再按「重新載入」。'],
  ['iOS 18 Firefox',{userAgent:iphone('FxiOS/131.0','18_0'),maxTouchPoints:5},'到「設定」›「App」›「Firefox」› 打開「麥克風」，再按「重新載入」。'],
  ['Facebook in-app on iPad',{userAgent:iphone('[FBAN/FBIOS;FBAV/480.0.0.38.107;FBBV/1]'),maxTouchPoints:5},'請改用 Safari 打開這個網頁。'],
  ['Instagram in-app',{userAgent:iphone('Instagram 350.0.0.0.98'),maxTouchPoints:5},'請改用 Safari 打開這個網頁。'],
  ['LINE in-app',{userAgent:iphone('Line/14.16.0'),maxTouchPoints:5},'請改用 Safari 打開這個網頁。'],
  ['WeChat in-app',{userAgent:iphone('MicroMessenger/8.0.50(0x1800322f) NetType/WIFI Language/zh_HK'),maxTouchPoints:5},'請改用 Safari 打開這個網頁。'],
  ['Android WhatsApp web view',{userAgent:android.replace('SM-X200)','SM-X200; wv)')+' WhatsApp/2.24',maxTouchPoints:5},'請改用 Chrome 打開這個網頁。'],
  ['Windows Chrome',{userAgent:windows(''),maxTouchPoints:0},address],
  ['Windows Edge with a touch screen',{userAgent:windows(' Edg/129.0.2792.79'),maxTouchPoints:10},address],
  ['Mac Chrome',{userAgent:mac.replace('Version/17.6 ','Chrome/129.0.0.0 '),maxTouchPoints:0},address],
  ['Android Chrome',{userAgent:android,maxTouchPoints:5},address],
  ['Mac Safari',{userAgent:mac,maxTouchPoints:0},'Safari 選單 ›「此網站的設定」›「麥克風」選「允許」，再按「重新載入」。'],
  ['Windows Firefox',{userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',maxTouchPoints:0},general],
  ['no details',{},general],
 ];
 for(const [label,device,expected] of cases){
  assert.equal(micDeniedHelp(device),expected,label);assert.ok(expected.length<=45,label);
  for(const name of ['NotAllowedError','SecurityError'])assert.equal(recordingErrorMessage(new DOMException('denied',name),true,device),'請先允許使用麥克風：'+expected,label);
  assert.ok(recordingErrorMessage(new DOMException('denied','NotAllowedError'),true,device).length<=70,label);
  assert.equal(recordingErrorMessage(new DOMException('x','NotFoundError'),true,device),'找不到麥克風，請檢查裝置。',label);
 }
 assert.equal(micDeniedHelp(null),general);assert.equal(micDeniedHelp(),general);
 const {unsupportedHelp}=await import('../maanshan/recording-audio.mjs');
 assert.equal(unsupportedHelp({userAgent:'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50'}),'請改用 Safari 開啟本網站。');
 assert.equal(unsupportedHelp({userAgent:'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 MicroMessenger/8.0.50'}),'請改用 Chrome 開啟本網站。');
 assert.equal(unsupportedHelp(null),'如果是從微信等 app 打開，請改用 Safari 開啟本網站；也可以換用新版 Safari、Chrome 或 Edge。');
 // A kept recording would be lost on reload, so its step stops at 允許.
 assert.equal(micDeniedHelp({userAgent:windows(''),maxTouchPoints:0},{keep:true}),'按網址列左邊的圖示 ›「麥克風」選「允許」。');
 assert.equal(micDeniedHelp({userAgent:mac,maxTouchPoints:5},{keep:true}),'到「設定」›「Safari」›「麥克風」選「允許」。');
 assert.equal(micDeniedHelp({userAgent:iphone('Instagram 350.0.0.0.98'),maxTouchPoints:5},{keep:true}),'請改用 Safari 打開這個網頁。');
 // WebKit keeps refusing until a reload; other browsers ask again.
 for(const [label,device] of [['iPadOS Safari',{userAgent:mac,maxTouchPoints:5}],['Mac Safari',{userAgent:mac,maxTouchPoints:0}],['iPhone Safari',{userAgent:iphone('Version/17.6'),maxTouchPoints:5}],['iOS Chrome',{userAgent:iphone('CriOS/129.0.6668.69'),maxTouchPoints:5}]])assert.equal(micNeedsReload(device),true,label);
 for(const [label,device] of [['Mac Chrome',{userAgent:mac.replace('Version/17.6 ','Chrome/129.0.0.0 '),maxTouchPoints:0}],['Windows Edge',{userAgent:windows(' Edg/129.0.2792.79'),maxTouchPoints:10}],['Android Chrome',{userAgent:android,maxTouchPoints:5}],['Mac Firefox',{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',maxTouchPoints:0}],['no details',{}]])assert.equal(micNeedsReload(device),false,label);
});

test('long poet replies are read in parts Tencent accepts, in order, without losing text',async()=>{
 const {speechChunks}=await import('../maanshan/speech-audio.mjs');
 assert.deepEqual(speechChunks('  春眠不覺曉。 '),['春眠不覺曉。']);assert.deepEqual(speechChunks(''),[]);
 const sentence='床前明月光，疑是地上霜，舉頭望明月，低頭思故鄉。',long=Array(12).fill(sentence).join('')+'「好詩！」'+'啊'.repeat(300);
 const parts=speechChunks(long),size=part=>Array.from(part).length;
 assert(parts.length>3);assert(parts.every(part=>size(part)>0&&size(part)<=120));
 assert.equal(parts.join(''),long);
 assert(parts.slice(0,2).every(part=>/[。，]$/.test(part)));
});
test('七步詩「萁」is outside the SOE lexicon (4103) and is always sent with its reading',()=>{
 const {assessmentReference}=require('../api/_lib/soe-reference.js');
 for(const text of ['萁在釜下燃，豆在釜中泣','萁在釜下燃']){const r=assessmentReference(text);assert.equal(r.text_mode,1);
  assert.deepEqual(JSON.parse(r.ref_text).wordList[0],{word:'萁',pron:[['qi2']]});}
 assert.deepEqual(assessmentReference('鹅鹅鹅'),{ref_text:'鹅鹅鹅',text_mode:0});
});
