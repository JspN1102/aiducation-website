'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
// network.mjs imports the browser session module, which derives its scope
// from location at module evaluation. All transport remains synthetic here.
const previousLocation=globalThis.location;
test.before(()=>{globalThis.location=new URL('https://chat-client.invalid/maanshan/');});
test.after(()=>{if(previousLocation===undefined)delete globalThis.location;else globalThis.location=previousLocation;});
const frame=value=>'data: '+JSON.stringify(value)+'\n\n';
test('chat displays split UTF8 deltas before the final verified answer',async()=>{
 const {requestChat}=await import('../maanshan/network.mjs');let controller;const shown=[];
 const stream=new ReadableStream({start(c){controller=c;}});
 const pending=requestChat({poemId:1,messages:[]},{fetchImpl:async()=>new Response(stream,{headers:{'Content-Type':'text/event-stream'}}),onDelta:(_delta,text)=>shown.push(text)});
 const bytes=new TextEncoder().encode(frame({type:'delta',text:'你好，白鵝！'}));
 for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));
 await new Promise(resolve=>setTimeout(resolve,5));assert.deepEqual(shown,['你好，白鵝！']);
 controller.enqueue(new TextEncoder().encode(frame({type:'done',reply:'你好，白鵝！',researchRecorded:true})));
 const answer=await pending;assert.equal(answer.reply,'你好，白鵝！');assert.equal(answer.researchRecorded,true);
});
test('partial chat is rejected without a completion, and explicit errors cannot become answers',async()=>{
 const {requestChat}=await import('../maanshan/network.mjs');
 for(const ending of ['',frame({type:'error',error:'provider interruption'})]){
  const shown=[];await assert.rejects(requestChat({}, {fetchImpl:async()=>new Response(frame({type:'delta',text:'未完整'})+ending,{headers:{'Content-Type':'text/event-stream'}}),onDelta:(_delta,text)=>shown.push(text)}),/未能完整/);
  assert.deepEqual(shown,['未完整']);
 }
});
test('chat stays compatible with JSON servers and closes readers after completion',async()=>{
 const {requestChat}=await import('../maanshan/network.mjs');
 const answer=await requestChat({}, {fetchImpl:async()=>Response.json({reply:'舊伺服器回覆'})});assert.equal(answer.reply,'舊伺服器回覆');
 let cancelled=false;const result=await requestChat({}, {fetchImpl:async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(frame({type:'done',reply:'完整'})));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}})});
 assert.equal(result.reply,'完整');assert.equal(cancelled,true);
});
test('chat cancellation stops a pending request and never retries automatically',async()=>{
 const {requestChat}=await import('../maanshan/network.mjs');const abort=new AbortController();let calls=0;
 const promise=requestChat({}, {signal:abort.signal,fetchImpl:async(_url,options)=>{calls++;return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}});
 abort.abort();await assert.rejects(promise,e=>e.name==='AbortError');assert.equal(calls,1);
});
