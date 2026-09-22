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
test('explicit research exclusion acknowledges teacher practice once and does not retry it after reload',async()=>{
 const {createAnswerOutbox}=await ready,f=fixture();let calls=0;
 const options={...f.options,actorId:'teacher-test',fetchImpl:async()=>{calls++;return{ok:true,status:200,json:async()=>({ok:true,researchRecorded:false,researchExcluded:true})};}};
 const q=createAnswerOutbox(options);q.enqueue(f.input);await q.flush();await q.flush({force:true});
 assert.equal(q.status().pending,0);assert.equal(q.status().retryAt,0);assert.equal(f.memory.size,0);assert.equal(calls,1);
 const reloaded=createAnswerOutbox(options);await reloaded.flush({force:true});assert.equal(calls,1);assert.equal(reloaded.status().pending,0);
});
test('student storage failure and nonboolean exclusion flags preserve an answer for a later confirmed retry',async()=>{
 const {createAnswerOutbox}=await ready;
 for(const exclusion of [undefined,false,'true',1]){
  const f=fixture();let confirm=false,calls=0;
  const q=createAnswerOutbox({...f.options,fetchImpl:async()=>{calls++;return{ok:true,status:200,json:async()=>confirm?{ok:true,researchRecorded:true}:{ok:true,researchRecorded:false,researchExcluded:exclusion}};}});
  q.enqueue(f.input);await q.flush();assert.equal(q.status().pending,1);assert.equal(f.memory.size,1);assert.equal(calls,1);
  confirm=true;await q.flush({force:true});assert.equal(q.status().pending,0);assert.equal(f.memory.size,0);assert.equal(calls,2);
 }
 const f=fixture(),failed=createAnswerOutbox({...f.options,fetchImpl:async()=>({ok:false,status:503,json:async()=>({ok:true,researchRecorded:false,researchExcluded:true})})});
 failed.enqueue(f.input);await failed.flush();assert.equal(failed.status().pending,1);assert.equal(f.memory.size,1);
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

test('student learning generations retain old answers and upload only their own namespace',async()=>{
 const {createAnswerOutbox}=await ready,f=fixture(),epoch='a'.repeat(32),secondEpoch='b'.repeat(32),sent=[];
 const old=createAnswerOutbox({...f.options,fetchImpl:async()=>{throw Error('offline');}});old.enqueue(f.input);await old.flush();old.stop();
 const historical=new Map(f.memory);
 const current=createAnswerOutbox({...f.options,learningEpoch:epoch,fetchImpl:async(_url,options)=>{sent.push(options);return{ok:true,status:200,json:async()=>({ok:true,researchRecorded:true})};}});
 assert.equal(current.status().pending,0);current.enqueue(f.input);await current.flush();
 assert.equal(sent.length,1);assert.equal(sent[0].headers['X-Learning-Epoch'],epoch);
 for(const [key,value]of historical)assert.equal(f.memory.get(key),value);
 const queued=createAnswerOutbox({...f.options,learningEpoch:secondEpoch,fetchImpl:async()=>{throw Error('offline');}});queued.enqueue(f.input);await queued.flush();queued.stop();
 const rollback=createAnswerOutbox({...f.options,fetchImpl:async()=>{throw Error('offline');}});
 assert.equal(rollback.status().pending,1);assert.equal(rollback.status().held,0);
 assert.equal([...f.memory.keys()].filter(key=>key.includes(secondEpoch)).length,1);
});

test('learning reset stops answer retries without acknowledging or deleting historical data',async()=>{
 const {createAnswerOutbox}=await ready,f=fixture(),statuses=[];let calls=0;
 const queue=createAnswerOutbox({...f.options,learningEpoch:'a'.repeat(32),onStatus:s=>statuses.push(s),fetchImpl:async()=>{calls++;return{ok:false,status:409,json:async()=>({code:'LEARNING_RESET',error:'Reload learning'})};}});
 queue.enqueue(f.input);await queue.flush();await queue.flush({force:true});
 assert.equal(calls,1);assert(queue.status().stopped);assert.equal(queue.status().pending,1);assert.equal(queue.status().held,0);assert.equal(f.memory.size,1);assert(statuses.includes('learning_reset'));
});
