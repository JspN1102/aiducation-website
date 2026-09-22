'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const https=require('node:https'),{PassThrough}=require('node:stream');
const {getPoem}=require('../api/_lib/poems.js');
const cache=require('../api/_lib/poet-preset-cache.cjs');
const warmer=require('../deploy/poet-presets-warm.cjs');
const {outcomeFor}=require('../api/_lib/school-learning.cjs');
const env={GPT_API_KEY:'synthetic-test-only',GPT_API_BASE:'https://provider.example.invalid/v1',POET_PRESET_MODEL:'deepseek-v4-pro'};
const catalogue=()=>import('../maanshan/poet-presets.mjs');
async function directory(t){const value=await fs.mkdtemp(path.join(os.tmpdir(),'poet-presets-test-'));t.after(()=>fs.rm(value,{recursive:true,force:true}));return value;}
function useEnv(t,values){const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));Object.assign(process.env,values);t.after(()=>{for(const [key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});}
function response(){const res=new EventEmitter();return Object.assign(res,{statusCode:200,headers:{},chunks:[],headersSent:false,writableEnded:false,destroyed:false,
  status(code){if(!this.headersSent)this.statusCode=code;return this;},setHeader(key,value){assert(!this.headersSent);this.headers[key.toLowerCase()]=value;},removeHeader(key){delete this.headers[key.toLowerCase()];},
  flushHeaders(){this.headersSent=true;},write(value){this.headersSent=true;this.chunks.push(value);return true;},end(value){if(value)this.write(value);this.writableEnded=true;this.emit('finish');this.emit('close');return this;},
  json(body){this.body=body;this.setHeader('Content-Type','application/json');return this.end(JSON.stringify(body));}});}

test('all six poems expose three shared preset buttons and eighteen unique keys',async()=>{
  const module=await catalogue();assert.equal(module.POET_PRESETS.length,18);assert.equal(new Set(module.POET_PRESETS.map(item=>item.id)).size,18);
  for(let poemId=1;poemId<=6;poemId++){
    const poem=getPoem(poemId),questions=module.getPoetSuggestions(poem);assert.equal(questions.length,3);
    for(const question of questions){const preset=module.matchPoetPreset(poemId,question);assert(preset);assert.equal(preset.poemId,poemId);assert.equal(preset.version,module.POET_PRESET_VERSION);}
  }
});
test('server verifies exact poem, question, grade and version; typed contextual prompts bypass',async()=>{
  const {POET_PRESETS}=await catalogue(),poem=getPoem(4),preset=POET_PRESETS.find(item=>item.id==='p4.new-poem');
  const messages=[{role:'user',content:'我的小貓叫小白。'},{role:'assistant',content:'我們可以寫牠。'},{role:'user',content:preset.question}];
  assert.equal(await cache.matchRequest({messages},poem,4),null);
  assert.equal(await cache.matchRequest({messages:[messages.at(-1)]},poem,4),null);
  const body={messages,presetId:preset.id,presetVersion:preset.version};assert.equal((await cache.matchRequest(body,poem,4)).id,preset.id);
  for(const changed of [{presetId:'p5.new-poem'},{presetVersion:'old'},{messages:[{role:'user',content:preset.question+'，主角要是我的小貓。'}]},{messages:[{role:'assistant',content:preset.question}]}])assert.equal(await cache.matchRequest({...body,...changed},poem,4),null);
  assert.equal(await cache.matchRequest(body,poem,3),null);
  const facts=POET_PRESETS.find(item=>item.id==='p4.places');
  assert.equal((await cache.matchRequest({messages:[{role:'user',content:facts.question}]},poem,4)).id,facts.id);
  assert.equal(await cache.matchRequest({messages:[...messages,{role:'user',content:facts.question}]},poem,4),null);
});
test('prepared answers persist, validate checksums and are isolated by model/content',async t=>{
  const dir=await directory(t),settings={...env,POET_PRESET_CACHE_DIR:dir},[expected]=await cache.listPrepared({env:settings,poemId:1});
  assert.equal(await cache.readPrepared(expected,{directory:dir}),null);
  await cache.storePrepared(expected,{reply:'白鵝的羽毛是白色的。',responseModel:expected.model},{directory:dir});
  const saved=await cache.readPrepared(expected,{directory:dir});assert.equal(saved.reply,'白鵝的羽毛是白色的。');
  const changed=(await cache.listPrepared({env:{...settings,POET_PRESET_MODEL:'deepseek-v4.1-pro'},poemId:1}))[0];assert.notEqual(changed.key,expected.key);assert.equal(await cache.readPrepared(changed,{directory:dir}),null);
  const {POET_PRESETS}=await catalogue(),preset=POET_PRESETS[0],poem=getPoem(1);
  assert.notEqual(cache.descriptor({...poem,description:'changed curriculum'},preset,1,cache.modelConfig(env)).key,expected.key);
  await fs.writeFile(path.join(dir,expected.key+'.json'),JSON.stringify({...saved,reply:'changed response'}));assert.equal(await cache.readPrepared(expected,{directory:dir}),null);
  await fs.writeFile(path.join(dir,expected.key+'.json'),'x'.repeat(cache.MAX_BYTES+1));assert.equal(await cache.readPrepared(expected,{directory:dir}),null);
});
test('warm-up only calls Pro for missing records and never includes prior student conversation',async t=>{
  const dir=await directory(t),settings={...env,POET_PRESET_CACHE_DIR:dir};let calls=0;
  const generate=async expected=>{calls++;assert.equal(expected.model,'deepseek-v4-pro');assert.equal(expected.messages.length,2);assert.equal(expected.messages[1].content,expected.question);return {reply:'這是這個獨立問題的回答。',responseModel:expected.model};};
  const check=await warmer.run({env:settings,poemId:1,emit:()=>{},generate});assert.equal(check.missing,3);assert.equal(calls,0);
  const warm=await warmer.run({apply:true,env:settings,poemId:1,emit:()=>{},generate});assert.equal(warm.generated,3);assert.equal(calls,3);
  const again=await warmer.run({apply:true,env:settings,poemId:1,emit:()=>{},generate});assert.equal(again.hits,3);assert.equal(calls,3);
  const files=await fs.readdir(dir);assert.equal(files.length,3);assert(files.every(name=>/^[a-f0-9]{64}\.json$/.test(name)));
});
test('concurrent administrative warmers cannot charge twice; failed answers are not cached',async t=>{
  const dir=await directory(t),settings={...env,POET_PRESET_CACHE_DIR:dir};let entered,release;
  const waiting=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const first=warmer.run({apply:true,env:settings,poemId:2,emit:()=>{},generate:async()=>{entered();await gate;throw new Error('synthetic failure');}});
  await waiting;await assert.rejects(warmer.run({apply:true,env:settings,poemId:2,emit:()=>{}}),error=>error.code==='EEXIST');release();
  assert.equal((await first).failed,3);assert.deepEqual(await fs.readdir(dir),[]);
});
test('pre-generation refuses truncated output or unexpected actual model',async()=>{
  const [expected]=await cache.listPrepared({env,poemId:1});
  for(const [model,finish]of [['deepseek-flash','stop'],[expected.model,'length']])await assert.rejects(cache.generatePrepared(expected,{env,fetchImpl:async()=>new Response(JSON.stringify({model,choices:[{finish_reason:finish,message:{content:'還沒有完整說完。'}}]}))}),/PRESET_INVALID_RESPONSE/);
  const result=await cache.generatePrepared(expected,{env,fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body);assert.equal(body.model,expected.model);assert.equal(body.messages[1].content,expected.question);return new Response(JSON.stringify({model:expected.model,choices:[{finish_reason:'stop',message:{content:'白鵝的羽毛是白色的。'}}]}));}});
  assert.equal(result.responseModel,expected.model);
});
test('cache hits keep SSE and verified research metadata without claiming a fresh provider call',async t=>{
  const dir=await directory(t),settings={...env,POET_PRESET_CACHE_DIR:dir,SCHOOL_AUTH_ENABLED:'0'};useEnv(t,settings);
  const [expected]=await cache.listPrepared({env:settings,poemId:1});await cache.storePrepared(expected,{reply:'白鵝的羽毛是白色的。',responseModel:expected.model},{directory:dir});
  const req=Object.assign(new EventEmitter(),{method:'POST',headers:{accept:'text/event-stream'},body:{poemId:1,grade:1,stream:true,messages:[{role:'user',content:expected.question}],presetId:expected.presetId,presetVersion:expected.presetVersion}}),res=response();
  await require('../api/maanshan-chat.js')(req,res);
  assert.equal(res.headers['x-poet-cache'],'HIT');assert.match(res.headers['content-type'],/^text\/event-stream/);
  const frames=res.chunks.join('').split('\n\n').filter(Boolean).map(item=>JSON.parse(item.slice(6)));
  assert.equal(frames[0].type,'delta');assert.equal(frames.at(-1).type,'done');assert.equal(frames.at(-1).reply,'白鵝的羽毛是白色的。');
  const outcome=outcomeFor('chat',frames.at(-1),200,{poem:getPoem(1)},2,res.providerMetadata);
  assert.equal(outcome.provider,'aiducation-cache');assert.equal(outcome.model,'deepseek-v4-pro');assert.match(outcome.providerVersion,/-preset-hit$/);assert.equal(outcome.result.score,null);assert(!JSON.stringify(outcome).includes('白鵝'));
  assert.doesNotThrow(()=>require('../api/_lib/research-store.cjs').validateEvent({
    eventId:'11111111-1111-4111-8111-111111111111',sessionId:'22222222-2222-4222-8222-222222222222',seq:1,
    clientAt:'2026-09-22T00:00:00.000Z',activeMs:1,poemId:1,activity:'chat',type:'provider_result',
    appVersion:'test',contentVersion:'test',...outcome
  },true));
});
test('live model is configurable and research records the returned model without client overrides',async t=>{
  useEnv(t,{...env,POET_CHAT_MODEL:'deepseek-v4.1-flash'});let requested;
  t.mock.method(https,'request',(_options,callback)=>{
    const req=new EventEmitter();req.destroy=()=>{};
    req.end=body=>{requested=JSON.parse(body);queueMicrotask(()=>{
      const upstream=new PassThrough();upstream.statusCode=200;upstream.headers={'content-type':'application/json'};callback(upstream);
      upstream.end(JSON.stringify({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:'我們接着聊。'}}]}));
    });};return req;
  });
  const res=response();await require('../api/_lib/poems.js').requestPoemText(res,[{role:'user',content:'接着說吧。'}],{field:'reply',temperature:.8,timeoutMs:1000,maxTokens:450});
  assert.equal(requested.model,'deepseek-v4.1-flash');assert.equal(res.providerMetadata.model,'deepseek-flash');
  const outcome=outcomeFor('chat',{reply:res.body.reply,model:'spoofed-model'},200,{poem:getPoem(1)},5,res.providerMetadata);
  assert.equal(outcome.model,'deepseek-flash');assert.equal(outcome.provider,'deepseek');
});
