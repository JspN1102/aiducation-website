'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const ready=import('../maanshan/answer-outbox.mjs');
const actor='s_'+'a'.repeat(24);
function fixture(){
 const memory=new Map(),storage={get length(){return memory.size;},key:i=>[...memory.keys()][i],getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
 const input={poemId:2,itemId:'sound-test',status:'correct',response:{choiceId:'one'},researchContext:{actorId:actor,sessionId:randomUUID(),attemptId:randomUUID(),poemId:2,itemId:'sound-test',activity:'challenge',appVersion:'test',contentVersion:'test',context:{mode:'standard',itemType:'sound'}}};
 return {memory,storage,input,options:{actorId:actor,csrfToken:'synthetic',storage}};
}
test('discrete answers survive network failure and replay exact operation identity after reload',async()=>{
 const {createAnswerOutbox}=await ready,f=fixture(),sent=[];
 const first=createAnswerOutbox({...f.options,fetchImpl:async(_url,options)=>{sent.push(JSON.parse(options.body));throw Error('offline');}});
 first.enqueue({...f.input,rawAudio:'private'});await first.flush();assert.equal(first.status().pending,1);
 const reloaded=createAnswerOutbox({...f.options,fetchImpl:async(_url,options)=>{sent.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>({ok:true,researchRecorded:true})};}});
 await reloaded.flush();assert.deepEqual(sent[0],sent[1]);assert(!JSON.stringify(sent).includes('private'));assert.equal(f.memory.size,0);assert.equal(reloaded.status().pending,0);
});
test('provider success without research durability never acknowledges an answer',async()=>{
 const {createAnswerOutbox}=await ready,f=fixture();
 const q=createAnswerOutbox({...f.options,fetchImpl:async()=>({ok:true,status:200,json:async()=>({ok:true,researchRecorded:false})})});
 q.enqueue(f.input);await q.flush();assert.equal(q.status().pending,1);assert.equal(f.memory.size,1);
});
test('student switch cannot inherit pending answers and session rejection preserves originals',async()=>{
 const {createAnswerOutbox}=await ready,f=fixture();
 const q=createAnswerOutbox({...f.options,fetchImpl:async()=>({ok:false,status:409,json:async()=>({code:'ACTOR_CHANGED'})})});q.enqueue(f.input);await q.flush();assert.equal(q.status().stopped,true);assert.equal(q.status().pending,1);
 const other=createAnswerOutbox({...f.options,actorId:'s_'+'b'.repeat(24)});assert.equal(other.status().pending,0);assert.equal(f.memory.size,1);
});
test('rejected answer is held without blocking a later healthy answer or logging out',async()=>{
 const {createAnswerOutbox}=await ready,f=fixture();let count=0;
 const q=createAnswerOutbox({...f.options,fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body);count++;return body.itemId==='bad'?{ok:false,status:409,json:async()=>({code:'EVENT_ID_CONFLICT'})}:{ok:true,status:200,json:async()=>({ok:true,researchRecorded:true})};}});
 q.enqueue({...f.input,itemId:'bad'});q.enqueue(f.input);await q.flush();await q.flush();assert.equal(q.status().held,1);assert.equal(q.status().pending,0);assert.equal(q.status().stopped,false);assert.equal(count,2);assert.equal(f.memory.size,2);
});

test('old cross-grade answers are removed without stopping valid answers or repeatedly retrying',async()=>{
 const {createAnswerOutbox}=await ready,f=fixture();let calls=0;
 const q=createAnswerOutbox({...f.options,fetchImpl:async(_url,options)=>{calls++;const body=JSON.parse(options.body);return body.poemId===6?{ok:false,status:422,json:async()=>({code:'POEM_GRADE_FORBIDDEN',retryable:false})}:{ok:true,status:200,json:async()=>({ok:true,researchRecorded:true})};}});
 q.enqueue({...f.input,poemId:6});q.enqueue(f.input);await q.flush();await q.flush();await q.flush();assert.equal(calls,2);assert.equal(q.status().pending,0);assert.equal(q.status().held,0);assert.equal(q.status().stopped,false);assert.equal(f.memory.size,0);
});
test('simultaneous tabs retain each others pending answers and exact acknowledgements',async()=>{
 const {createAnswerOutbox}=await ready,f=fixture();let finish;
 const a=createAnswerOutbox({...f.options,fetchImpl:async()=>{await new Promise(resolve=>finish=resolve);return {ok:true,status:200,json:async()=>({ok:true,researchRecorded:true})};}});
 a.enqueue(f.input);await Promise.resolve();
 const b=createAnswerOutbox({...f.options,fetchImpl:async()=>{throw Error('offline');}});b.enqueue(f.input);await b.flush();finish();await a.flush();assert.equal(f.memory.size,1);assert.equal(b.status().pending,2);
});
