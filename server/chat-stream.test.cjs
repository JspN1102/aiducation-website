'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream'),https=require('node:https');
const {createSSEParser,wantsChatStream,installChatStream}=require('../api/_lib/chat-stream.cjs');
const {requestPoemText}=require('../api/_lib/poems.js');
const {withSchoolLearning}=require('../api/_lib/school-learning.cjs');
const auth=require('../api/_lib/school-auth.cjs'),research=require('../api/_lib/research-store.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const frame=content=>'data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason:null}]})+'\r\n\r\n';
const ending='data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
function response(){
 const res=new EventEmitter();Object.assign(res,{statusCode:200,headers:{},chunks:[],headersSent:false,writableEnded:false,destroyed:false,
  status(code){if(!this.headersSent)this.statusCode=code;return this;},
  setHeader(key,value){assert(!this.headersSent,'headers changed after streaming started');this.headers[key.toLowerCase()]=value;return this;},
  removeHeader(key){delete this.headers[key.toLowerCase()];},getHeader(key){return this.headers[key.toLowerCase()];},
  flushHeaders(){this.headersSent=true;},
  write(chunk){assert(!this.writableEnded&&!this.destroyed);this.headersSent=true;this.chunks.push(String(chunk));return true;},
  end(chunk){if(chunk!==undefined)this.write(chunk);this.writableEnded=true;this.emit('finish');this.emit('close');return this;},
  json(body){this.body=body;this.setHeader('Content-Type','application/json');return this.end(JSON.stringify(body));}
 });return res;
}
function request(body={}){const req=new EventEmitter();return Object.assign(req,{method:'POST',headers:{accept:'text/event-stream'},body:{stream:true,...body}});}
function events(res){return res.chunks.join('').split('\n\n').filter(Boolean).map(value=>JSON.parse(value.slice(6)));}
function provider(t,{type='text/event-stream',status=200}={}){
 const old={key:process.env.GPT_API_KEY,base:process.env.GPT_API_BASE};process.env.GPT_API_KEY='synthetic-test-only';process.env.GPT_API_BASE='https://provider.example.invalid/v1';
 t.after(()=>{if(old.key===undefined)delete process.env.GPT_API_KEY;else process.env.GPT_API_KEY=old.key;if(old.base===undefined)delete process.env.GPT_API_BASE;else process.env.GPT_API_BASE=old.base;});
 const upstream=new PassThrough();upstream.statusCode=status;upstream.headers={'content-type':type};
 const state={upstream,request:null,options:null,payload:null};let ready;
 state.ready=new Promise(resolve=>ready=resolve);
 t.mock.method(https,'request',(options,callback)=>{
  state.options=options;const req=new EventEmitter();req.destroyed=false;req.destroy=()=>{req.destroyed=true;};
  req.end=body=>{state.payload=JSON.parse(body);queueMicrotask(()=>{callback(upstream);ready();});};state.request=req;return req;
 });return state;
}
const opts={field:'reply',temperature:0.8,timeoutMs:1000,maxTokens:450,stream:true};

test('streaming requires both an explicit body flag and an accepted SSE media type',()=>{
 assert(wantsChatStream(request()));assert(wantsChatStream({...request(),headers:{accept:'application/json, text/event-stream;q=0.8'}}));
 for(const req of [{...request(),method:'GET'},{...request(),body:{stream:'true'}},{...request(),headers:{accept:'*/*'}},{...request(),headers:{accept:'text/event-stream;q=0'}}])assert.equal(wantsChatStream(req),false);
});

test('SSE parser preserves Chinese UTF-8, split CRLF, comments and multiline data',()=>{
 const input=Buffer.from(': heartbeat\r\ndata: 你好，詩人\r\ndata: 第二行\r\n\r\ndata: [DONE]\n\n'),expected=['你好，詩人\n第二行','[DONE]'];
 for(let boundary=0;boundary<=input.length;boundary++){
  const actual=[],parser=createSSEParser(value=>actual.push(value));parser.push(input.subarray(0,boundary));parser.push(input.subarray(boundary));parser.finish();assert.deepEqual(actual,expected);
 }
 const actual=[],parser=createSSEParser(value=>actual.push(value));for(const byte of input)parser.push(Buffer.from([byte]));parser.finish();assert.deepEqual(actual,expected);
 assert.throws(()=>{const bad=createSSEParser(()=>{});bad.push(Buffer.from([0xe4]));bad.finish();});
});

test('pre-stream authentication and input errors remain ordinary JSON with their status',async t=>{
 t.mock.method(auth,'enabled',()=>true);t.mock.method(auth,'requireActor',async()=>{throw new auth.AuthError(401,'AUTH_REQUIRED');});
 let calls=0;const res=response();await withSchoolLearning('chat',async()=>calls++)(request({poemId:2}),res);
 assert.equal(calls,0);assert.equal(res.statusCode,401);assert.equal(res.getHeader('content-type'),'application/json');assert.equal(res.body.code,'AUTH_REQUIRED');assert.equal(res.getHeader('x-accel-buffering'),undefined);
 const input=response();installChatStream(request(),input);input.status(400).json({error:'Invalid messages'});assert.equal(input.statusCode,400);assert.equal(input.getHeader('content-type'),'application/json');
});

test('real provider deltas arrive before durable research confirmation and done waits for it',async t=>{
 const source=provider(t),actor={id:'s_stream',role:'student',grade:2};
 t.mock.method(auth,'enabled',()=>true);t.mock.method(auth,'requireActor',async()=>actor);
 let finishResearch,stored=null;const durable=new Promise(resolve=>finishResearch=resolve);
 t.mock.method(research,'recordVerifiedOutcome',async(req,outcome)=>{stored=outcome;await durable;return {recorded:true};});
 const req=request({poemId:2,researchContext:{actorId:actor.id,poemId:2}}),res=response();
 const pending=withSchoolLearning('chat',(req,res)=>requestPoemText(res,[{role:'user',content:'你好'}],opts))(req,res);
 await source.ready;assert.equal(source.payload.stream,true);assert.equal(source.options.agent.keepAlive,true);
 const first=Buffer.from(frame('**你好，**'));for(const byte of first)source.upstream.write(Buffer.from([byte]));
 assert.deepEqual(events(res),[{type:'delta',text:'你好，'}]);assert.equal(stored,null);assert.equal(res.writableEnded,false);
 source.upstream.end(frame('一起讀詩。')+ending);await tick();
 assert(stored);assert.equal(stored.metrics.assistantCharacters,'你好，一起讀詩。'.length);assert.doesNotMatch(JSON.stringify(stored),/你好|一起讀詩/);
 assert(events(res).every(event=>event.type==='delta'));assert.equal(res.writableEnded,false);
 finishResearch();await pending;
 assert.deepEqual(events(res).at(-1),{type:'done',reply:'你好，一起讀詩。',researchRecorded:true});
 assert.match(res.getHeader('content-type'),/^text\/event-stream/);assert.match(res.getHeader('cache-control'),/no-store/);assert.equal(res.getHeader('x-accel-buffering'),'no');assert.match(res.getHeader('server-timing'),/^ai_ttfb;dur=\d+$/);
 assert.equal(res.listenerCount('close'),0);assert.equal(req.listenerCount('aborted'),0);
});

test('research persistence failure still finishes with an explicit false flag',async t=>{
 const source=provider(t),actor={id:'s_stream',role:'student',grade:2};
 t.mock.method(auth,'enabled',()=>true);t.mock.method(auth,'requireActor',async()=>actor);t.mock.method(research,'recordVerifiedOutcome',async()=>{throw new Error('synthetic storage failure');});
 const req=request({poemId:2,researchContext:{actorId:actor.id,poemId:2}}),res=response();
 const pending=withSchoolLearning('chat',(req,res)=>requestPoemText(res,[],opts))(req,res);await source.ready;source.upstream.end(frame('可以。')+ending);await pending;
 assert.deepEqual(events(res).at(-1),{type:'done',reply:'可以。',researchRecorded:false});
});

test('truncated and malformed upstream streams end with error, never a completed partial reply',async t=>{
 for(const tail of ['', 'data: not-json\n\n','data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n']){
  const source=provider(t),res=response();installChatStream(request(),res);const pending=requestPoemText(res,[],opts);await source.ready;
  source.upstream.end(frame('未完成')+tail);await pending;const result=events(res);
  assert.equal(result[0].type,'delta');assert.equal(result.at(-1).type,'error');assert.equal(result.at(-1).reply,undefined);assert(!result.some(event=>event.type==='done'));
 }
});

test('client disconnect destroys the paid request and records only cancellation metadata',async t=>{
 const source=provider(t),actor={id:'s_stream',role:'student',grade:2};let stored;
 t.mock.method(auth,'enabled',()=>true);t.mock.method(auth,'requireActor',async()=>actor);t.mock.method(research,'recordVerifiedOutcome',async(req,value)=>{stored=value;return {recorded:true};});
 const req=request({poemId:2,researchContext:{actorId:actor.id,poemId:2}}),res=response();
 const pending=withSchoolLearning('chat',(req,res)=>requestPoemText(res,[],opts))(req,res);await source.ready;source.upstream.write(frame('這是部分內容'));
 res.destroyed=true;res.emit('close');await assert.rejects(pending,error=>error.name==='AbortError');
 assert.equal(source.request.destroyed,true);assert.equal(source.upstream.destroyed,true);assert.equal(stored.result.status,'cancelled');assert.equal(stored.error.code,'aborted');assert.doesNotMatch(JSON.stringify(stored),/部分內容/);assert(!events(res).some(event=>event.type==='done'));
});

test('plain JSON clients and JSON-returning providers remain compatible',async t=>{
 for(const streaming of [false,true]){
  const source=provider(t,{type:'application/json'}),res=response();if(streaming)installChatStream(request(),res);
  const pending=requestPoemText(res,[],{...opts,stream:streaming});await source.ready;
  source.upstream.end(JSON.stringify({choices:[{message:{content:' **你好。** '},finish_reason:'stop'}]}));await pending;
  assert.equal(source.payload.stream,streaming);
  if(streaming)assert.deepEqual(events(res),[{type:'done',reply:'你好。',researchRecorded:false}]);else assert.deepEqual(res.body,{reply:'你好。'});
 }
});

test('non-success upstream status does not expose provider content or start SSE',async t=>{
 const source=provider(t,{status:429}),res=response();installChatStream(request(),res);const pending=requestPoemText(res,[],opts);await source.ready;await pending;
 assert.equal(res.statusCode,502);assert.equal(res.getHeader('content-type'),'application/json');assert.deepEqual(res.body,{error:'GPT service unavailable'});assert(source.request.destroyed);
});

test('a slow client pauses the provider and resumes it on drain',async t=>{
 const source=provider(t),res=response(),write=res.write;let first=true;
 res.write=function(chunk){const result=write.call(this,chunk);if(first){first=false;return false;}return result;};
 installChatStream(request(),res);const pending=requestPoemText(res,[],opts);await source.ready;source.upstream.write(frame('你好'));
 assert(source.upstream.isPaused());res.emit('drain');assert.equal(source.upstream.isPaused(),false);
 source.upstream.end(ending);await pending;assert.equal(events(res).at(-1).type,'done');assert.equal(res.listenerCount('drain'),0);
});

test('a timeout after deltas remains a timeout in research despite HTTP 200 already being sent',async t=>{
 const source=provider(t),actor={id:'s_stream',role:'student',grade:2};let stored;
 t.mock.method(auth,'enabled',()=>true);t.mock.method(auth,'requireActor',async()=>actor);t.mock.method(research,'recordVerifiedOutcome',async(req,value)=>{stored=value;return {recorded:true};});
 const req=request({poemId:2,researchContext:{actorId:actor.id,poemId:2}}),res=response();
 const pending=withSchoolLearning('chat',(req,res)=>requestPoemText(res,[],{...opts,timeoutMs:25}))(req,res);await source.ready;source.upstream.write(frame('尚未完成'));await pending;
 assert.equal(res.statusCode,200);assert.equal(events(res).at(-1).type,'error');assert.equal(stored.result.status,'error');assert.equal(stored.error.code,'timeout');assert.equal(stored.metrics.assistantCharacters,undefined);assert(source.request.destroyed);
});

test('the actual chat handler streams over HTTP before the upstream answer is complete',async t=>{
 const source=provider(t),{createApiServer}=require('./index.cjs'),routes=require('./routes.cjs'),chat=require('../api/maanshan-chat.js');
 t.mock.method(auth,'enabled',()=>true);t.mock.method(auth,'requireActor',async()=>({id:'t_stream',role:'teacher'}));
 const handlers=Object.fromEntries(Object.keys(routes).map(name=>[name,(req,res)=>res.status(404).json({error:'not in test'})]));handlers['maanshan-chat']=chat;
 const server=createApiServer({handlers});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const pending=fetch('http://127.0.0.1:'+server.address().port+'/api/maanshan-chat',{method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({stream:true,poemId:2,messages:[{role:'user',content:'你好'}]})});
 await source.ready;source.upstream.write(frame('你好，'));const httpResponse=await pending;assert.equal(httpResponse.status,200);assert.match(httpResponse.headers.get('content-type'),/^text\/event-stream/);
 const reader=httpResponse.body.getReader(),first=await reader.read();assert.match(Buffer.from(first.value).toString('utf8'),/"type":"delta"/);assert.equal(source.upstream.writableEnded,false);
 source.upstream.end(frame('一起讀詩。')+ending);let rest='';for(;;){const part=await reader.read();if(part.done)break;rest+=Buffer.from(part.value).toString('utf8');}
 assert.match(rest,/"type":"done"/);assert.match(rest,/"reply":"你好，一起讀詩。"/);assert.match(rest,/"researchRecorded":false/);
});
