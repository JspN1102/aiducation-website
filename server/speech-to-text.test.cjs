'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{gzipSync}=require('node:zlib');
const month=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,7);
const wav=(bytes=3200)=>{const b=Buffer.alloc(44+bytes);b.write('RIFF',0,'ascii');b.write('WAVE',8,'ascii');return b;};
// The monthly count in the school database, kept in memory here.
function usagePool(){
 const used=new Map(),pool={used,async query(sql,params=[]){
  if(/^CREATE TABLE IF NOT EXISTS speech_input_usage/.test(sql))return {rows:[]};
  const key=params[0]+'|'+params[1],count=used.get(key)||0;
  if(/^INSERT INTO speech_input_usage/.test(sql)){if(count>=params[2])return {rows:[]};used.set(key,count+1);return {rows:[{used:count+1}]};}
  if(/^UPDATE speech_input_usage SET used = used - 1/.test(sql)){if(count>0)used.set(key,count-1);return {rows:[]};}
  throw new Error('unexpected query');
 }};
 return pool;
}
function fixture({reply={Response:{Result:'骆宾王你几岁写的咏鹅？',AudioDuration:2100,RequestId:'synthetic'}},auth=true,transcode,pool=usagePool()}={}){
 const calls=[],transcodes=[],filename=path.resolve(__dirname,'../api/speech-to-text.js');
 const https={Agent:class{},request(options,callback){
  const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=()=>{};
  req.end=payload=>{calls.push({options,payload:JSON.parse(payload)});const res=new EventEmitter();callback(res);queueMicrotask(()=>{res.emit('data',Buffer.from(JSON.stringify(typeof reply==='function'?reply():reply)));res.emit('end');});};
  return req;
 }};
 const schoolAuth={enabled:()=>auth,async requireActor(req){if(req.headers?.cookie!=='session')throw Object.assign(new Error('auth'),{status:401});return {id:req.headers['x-actor']||'s1',role:req.headers['x-role']||'student'};},getStore(){if(!pool)throw new Error('Missing PostgreSQL');return {pool};},sendError(res,error){return res.status(error.status).json({error:'AUTH_REQUIRED'});}};
 const transcoder={FORMATS:{webm:{},mp4:{},ogg:{}},MAX_INPUT_BYTES:1024*1024,async transcodeToWav(input,format){transcodes.push(format);if(!transcode)throw Object.assign(new Error('bad'),{code:'DECODE_FAILED'});return transcode(input,format);}};
 const module={exports:{}},errors=[];
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,Buffer,setTimeout,clearTimeout,queueMicrotask,console:{error:(...args)=>errors.push(args.join(' '))},process:{env:{TENCENT_SECRET_ID:'synthetic-id',TENCENT_SECRET_KEY:'synthetic-key'}},require:name=>name==='https'?https:name==='./_lib/school-auth.cjs'?schoolAuth:name==='./_lib/audio-transcode.cjs'?transcoder:require(name)});
 const call=async(body,headers={cookie:'session'})=>{const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=JSON.parse(JSON.stringify(v));return this;},end(){}};await module.exports({method:'POST',headers,body},res);return res;};
 return {call,calls,transcodes,errors,pool};
}

test('speech input recognises one question and returns Hong Kong traditional text',async()=>{
 const f=fixture(),audio=wav(),res=await f.call({audio:audio.toString('base64')});
 assert.equal(res.statusCode,200);assert.deepEqual(res.body,{text:'駱賓王你幾歲寫的詠鵝？'});
 assert.equal(res.headers['Cache-Control'],'private, no-store');
 const {options,payload}=f.calls[0];
 assert.equal(options.hostname,'asr.tencentcloudapi.com');assert.equal(options.headers['X-TC-Action'],'SentenceRecognition');assert.equal(options.headers['X-TC-Version'],'2019-06-14');
 assert.match(options.headers.Authorization,/^TC3-HMAC-SHA256 Credential=synthetic-id\/\d{4}-\d\d-\d\d\/asr\/tc3_request, SignedHeaders=content-type;host, Signature=[0-9a-f]{64}$/);
 assert.equal(payload.EngSerViceType,'16k_zh-PY');assert.equal(payload.VoiceFormat,'wav');assert.equal(payload.SourceType,1);
 assert.equal(payload.DataLen,audio.length);assert.equal(payload.Data,audio.toString('base64'));assert.equal(payload.FilterDirty,1);
 for(const entry of payload.HotwordList.split(',')){const [word,weight]=entry.split('|');assert(Array.from(word).length<=10,word);assert.equal(weight,'10');}
});

test('speech input decodes compact recordings on the origin and asks for PCM when that fails',async()=>{
 const decoded=wav(6400),f=fixture({transcode:async()=>decoded}),res=await f.call({audio:Buffer.from('opus-bytes').toString('base64'),audioFormat:'webm'});
 assert.equal(res.statusCode,200);assert.deepEqual(f.transcodes,['webm']);assert.equal(f.calls[0].payload.Data,decoded.toString('base64'));
 const refused=fixture(),failed=await refused.call({audio:Buffer.from('opus-bytes').toString('base64'),audioFormat:'webm'});
 assert.equal(failed.statusCode,422);assert.equal(failed.body.code,'AUDIO_TRANSCODE_FAILED');assert.equal(refused.calls.length,0);
 const gzip=fixture(),original=wav(),zipped=await gzip.call({audio:gzipSync(original).toString('base64'),audioCompression:'gzip'});
 assert.equal(zipped.statusCode,200);assert.equal(gzip.calls[0].payload.Data,original.toString('base64'));
});

test('speech input refuses signed-out, malformed or unknown audio before any paid call',async()=>{
 const f=fixture();
 assert.equal((await f.call({audio:wav().toString('base64')},{})).statusCode,401);
 for(const body of [{},{audio:'bad?'},{audio:Buffer.from('not a wave file at all, just bytes').toString('base64')},{audio:wav().toString('base64'),audioCompression:'zip'},{audio:'AAAA',audioFormat:'flac'},{audio:gzipSync(Buffer.alloc(3*1024*1024+1)).toString('base64'),audioCompression:'gzip'}])
  assert.equal((await f.call(body)).statusCode,400,JSON.stringify(body).slice(0,60));
 assert.equal(f.calls.length,0);
});

test('speech input caps a burst so a stuck button cannot run up the bill',async()=>{
 const f=fixture(),audio=wav().toString('base64'),teacher={cookie:'session','x-actor':'t1','x-role':'teacher'};
 for(let i=0;i<20;i++)assert.equal((await f.call({audio},teacher)).statusCode,200);
 const limited=await f.call({audio},teacher);assert.equal(limited.statusCode,429);assert.equal(limited.body.code,'SPEECH_LIMIT');
 assert.equal((await f.call({audio},{cookie:'session','x-actor':'t2','x-role':'teacher'})).statusCode,200,'another account is not affected');
 assert.equal(f.calls.length,21);
 assert.deepEqual([...f.pool.used],[['*site|'+month(),21]],'teachers count only towards the site total');
});

test('each pupil account has ten recognitions a month, and failures are given back',async()=>{
 const refusing={Response:{Error:{Code:'InternalError',Message:'synthetic'},RequestId:'x'}};let reply={Response:{Result:'你好',RequestId:'x'}};
 const f=fixture({reply:()=>reply}),audio=wav().toString('base64');
 reply=refusing;assert.equal((await f.call({audio})).statusCode,502);
 reply={Response:{Result:'你好',RequestId:'x'}};
 for(let i=0;i<10;i++)assert.equal((await f.call({audio})).statusCode,200,'recognition '+(i+1));
 const limited=await f.call({audio});
 assert.equal(limited.statusCode,429);assert.deepEqual(limited.body,{error:'Too many speech requests',code:'SPEECH_LIMIT'});
 assert.equal(f.calls.length,11,'the eleventh question this month is not sent');
 assert.equal(f.pool.used.get('s1|'+month()),10);assert.equal(f.pool.used.get('*site|'+month()),10,'the refused call is not counted');
 assert.equal((await f.call({audio},{cookie:'session','x-actor':'s2'})).statusCode,200,'another pupil is not affected');
 const offline=fixture({pool:null});
 assert.equal((await offline.call({audio})).statusCode,429,'without the database no recognition is sent');assert.equal(offline.calls.length,0);
});

test('speech input reports provider refusals without echoing them and keeps empty results empty',async()=>{
 const refused=fixture({reply:{Response:{Error:{Code:'UnauthorizedOperation',Message:'synthetic'},RequestId:'x'}}}),res=await refused.call({audio:wav().toString('base64')});
 assert.equal(res.statusCode,502);assert.deepEqual(res.body,{error:'Speech recognition unavailable',code:'SPEECH_UNAVAILABLE'});
 assert.deepEqual(refused.errors,['speech-to-text upstream UnauthorizedOperation']);
 const silent=fixture({reply:{Response:{Result:'',RequestId:'x'}}});
 assert.deepEqual((await silent.call({audio:wav().toString('base64')})).body,{text:''});
});

test('the whole site stops below the provider free quota',async()=>{
 const f=fixture(),audio=wav().toString('base64');f.pool.used.set('*site|'+month(),4799);
 assert.equal((await f.call({audio})).statusCode,200);
 const pupil=await f.call({audio},{cookie:'session','x-actor':'s2'}),teacher=await f.call({audio},{cookie:'session','x-actor':'t1','x-role':'teacher'});
 assert.deepEqual([pupil.statusCode,teacher.statusCode],[429,429]);assert.equal(f.calls.length,1);
 assert.equal(f.pool.used.get('s2|'+month()),undefined,'a refused pupil keeps this month of questions');
});

test('the browser posts speech to its own endpoint and names what to do on refusal',async()=>{
 globalThis.location??={hostname:'speech.invalid',pathname:'/maanshan/'};
 const {submitSpeech}=await import('../maanshan/recording-audio.mjs');
 const seen=[],reply=(status,body)=>async(url,options)=>{seen.push({url,body:JSON.parse(options.body)});return {ok:status===200,status,json:async()=>body};};
 assert.deepEqual(await submitSpeech({audio:'AAAA',audioFormat:'webm'},{fetchImpl:reply(200,{text:'你好'})}),{text:'你好'});
 assert.equal(seen[0].url,'/api/speech-to-text/');assert.deepEqual(seen[0].body,{audio:'AAAA',audioFormat:'webm'});
 await assert.rejects(submitSpeech({audio:'AAAA',audioFormat:'webm'},{fetchImpl:reply(422,{error:'x',code:'AUDIO_TRANSCODE_FAILED'})}),error=>error.code==='TRANSCODE');
 await assert.rejects(submitSpeech({audio:'AAAA'},{fetchImpl:reply(429,{error:'x',code:'SPEECH_LIMIT'})}),error=>error.code==='BUSY'&&/繁忙/.test(error.message)&&!/次/.test(error.message));
 await assert.rejects(submitSpeech({audio:'AAAA'},{fetchImpl:reply(502,{error:'x'})}),error=>error.code==='SERVICE'&&/先打字/.test(error.message));
});
