'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateBatch}=require('../api/_lib/research-store.cjs');
const actor={id:'s_'+'a'.repeat(24),researchId:'r_'+'b'.repeat(24),grade:5,cls:'A',role:'student'};
const moduleReady=import('../maanshan/research-client.mjs');
function fixture(extra={}){
  const memory=new Map();let tick=0,hidden=false,counter=0;const statuses=[];
  const storage={get length(){return memory.size;},key:index=>[...memory.keys()][index],getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
  return {memory,storage,statuses,clock:value=>tick=value,visibility:value=>hidden=value,
    options:{actorId:actor.id,csrfToken:'synthetic-csrf',storage,now:()=>Date.UTC(2026,8,20)+tick,
      monotonic:()=>tick,visible:()=>!hidden,onStatus:status=>statuses.push(status),uuid:()=>`00000000-0000-4000-8000-${String(++counter).padStart(12,'0')}`,...extra}};
}
test('all emitted contract fields validate, free text and raw material are excluded',async()=>{
  const {createResearchTracker}=await moduleReady;let sent;
  const f=fixture({fetchImpl:async(_url,options)=>{sent=JSON.parse(options.body);validateBatch(sent,actor);return {ok:true,status:200,json:async()=>({accepted:true,batchId:sent.batchId,eventIds:sent.events.map(e=>e.eventId)})};}});
  const tracker=createResearchTracker(f.options);tracker.begin('challenge',5);
  tracker.emit('answer_submitted',{itemId:'g5-s1',attemptId:f.options.uuid(),result:{status:'incorrect',score:0,correct:false},
    context:{mode:'standard',itemType:'sound',position:1,total:5,optionOrder:['one','two']},response:{choiceId:'two'},
    rawAudio:'must never leave',chatText:'must never leave',name:'must never leave'});
  await tracker.flush();assert.equal(tracker.status().pending,0);assert.equal(JSON.stringify(sent).includes('must never leave'),false);
  assert.equal(sent.events.at(-1).result.score,0);
});
test('failed transport preserves pending data and a different account cannot inherit it',async()=>{
  const {createResearchTracker}=await moduleReady;const f=fixture({fetchImpl:async()=>{throw new TypeError('offline');}});
  const first=createResearchTracker(f.options);first.emit('item_presented',{itemId:'g5-s1'});await first.flush();assert.equal(first.status().pending,2);
  const next=createResearchTracker({...f.options,actorId:'s_'+'c'.repeat(24)});assert.equal(next.status().pending,1);
  const resumed=createResearchTracker(f.options);assert.equal(resumed.status().pending,3);
});
test('new events enqueued during upload survive its exact acknowledgement',async()=>{
  const {createResearchTracker}=await moduleReady;let complete,body;
  const f=fixture({fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);await new Promise(resolve=>complete=resolve);return {ok:true,status:200,json:async()=>({accepted:true,batchId:body.batchId,eventIds:body.events.map(e=>e.eventId)})};}});
  const tracker=createResearchTracker(f.options),upload=tracker.flush();await Promise.resolve();tracker.emit('item_presented',{itemId:'g5-s1'});complete();await upload;
  assert.equal(tracker.status().pending,1);
});
test('partial or wrong-batch acknowledgements never delete queued records',async()=>{
  const {createResearchTracker}=await moduleReady;let mode='partial',calls=0;
  const f=fixture({fetchImpl:async(_url,options)=>{calls++;const body=JSON.parse(options.body);return {ok:true,status:200,json:async()=>({accepted:true,batchId:mode==='wrong'?'wrong':body.batchId,eventIds:mode==='partial'?[]:body.events.map(e=>e.eventId)})};}});
  const tracker=createResearchTracker(f.options);await tracker.flush();assert.equal(tracker.status().pending,1);mode='wrong';await tracker.flush({force:true});assert.equal(calls,2);assert.equal(tracker.status().pending,1);
});
test('active time remains monotonic across routes, excludes hidden and idle time, and closes a span once',async()=>{
  const {createResearchTracker}=await moduleReady;const f=fixture({fetchImpl:async()=>{throw new Error('offline');}}),tracker=createResearchTracker(f.options);
  f.clock(1000);tracker.begin('read',1);f.clock(3000);tracker.touch();f.clock(7000);f.visibility(true);tracker.visibilityChanged(true);tracker.leave();
  let events=[...f.memory.values()].map(value=>JSON.parse(value));
  assert.equal(events.at(-1).activeMs,7000);assert.equal(events.filter(e=>e.type==='activity_end').length,2);
  f.clock(17000);f.visibility(false);tracker.visibilityChanged(false);f.clock(187000);tracker.emit('item_presented',{itemId:'p1.l0'});
  events=[...f.memory.values()].map(value=>JSON.parse(value));
  assert.equal(events.at(-1).activeMs,67000);assert(events.every((e,i)=>i===0||e.activeMs>=events[i-1].activeMs));
});
test('account or CSRF failures stop uploads, preserving the original account queue',async()=>{
  const {createResearchTracker}=await moduleReady;let calls=0;const f=fixture({fetchImpl:async()=>{calls++;return {ok:false,status:409,json:async()=>({code:'ACTOR_CHANGED'})};}});
  const tracker=createResearchTracker(f.options);await tracker.flush();await tracker.flush();assert.equal(calls,1);assert.equal(tracker.status().stopped,true);assert.equal(tracker.status().pending,1);assert(f.statuses.includes('session_changed'));
});

test('student learning generations retain old events and attach their own epoch to uploads',async()=>{
 const {createResearchTracker}=await moduleReady,f=fixture({fetchImpl:async()=>{throw Error('offline');}}),old=createResearchTracker(f.options),epoch='a'.repeat(32);old.emit('item_presented',{itemId:'old-period'});await old.flush();old.stop();
 const historical=new Map(f.memory),sent=[];
 const next=createResearchTracker({...f.options,learningEpoch:epoch,fetchImpl:async(_url,options)=>{sent.push(options);const body=JSON.parse(options.body);return{ok:true,status:200,json:async()=>({accepted:true,batchId:body.batchId,eventIds:body.events.map(e=>e.eventId)})};}});
 assert.equal(next.status().pending,1);await next.flush();
 assert.equal(sent.length,1);assert.equal(sent[0].headers['X-Learning-Epoch'],epoch);assert(!sent[0].body.includes('old-period'));
 for(const [key,value]of historical)assert.equal(f.memory.get(key),value);
 const rollback=createResearchTracker(f.options);assert.equal(rollback.status().pending,3);assert.equal(rollback.status().held,0);rollback.stop();
});

test('learning reset stops research retries while preserving the stale generation queue',async()=>{
 const {createResearchTracker}=await moduleReady;let calls=0;
 const f=fixture({learningEpoch:'a'.repeat(32),fetchImpl:async()=>{calls++;return{ok:false,status:409,json:async()=>({code:'LEARNING_RESET',error:'Reload learning'})};}}),tracker=createResearchTracker(f.options);
 await tracker.flush();await tracker.flush({force:true});assert.equal(calls,1);assert(tracker.status().stopped);assert.equal(tracker.status().pending,1);assert.equal(tracker.status().held,0);assert(f.statuses.includes('learning_reset'));assert.equal(f.memory.size,1);
});

test('old cross-grade queued events are discarded permanently while valid own-grade events continue',async()=>{
 const {createResearchTracker}=await moduleReady,sent=[];
 const f=fixture({fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body);if(body.events.some(e=>e.poemId===6))return {ok:false,status:422,json:async()=>({error:'POEM_GRADE_FORBIDDEN',retryable:false})};sent.push(...body.events);return {ok:true,status:200,json:async()=>({accepted:true,batchId:body.batchId,eventIds:body.events.map(e=>e.eventId)})};}});
 const tracker=createResearchTracker(f.options);tracker.emit('item_presented',{poemId:6,itemId:'old-cross-grade'});tracker.emit('item_presented',{poemId:5,itemId:'own-grade'});
 for(let i=0;i<5&&tracker.status().pending;i++)await tracker.flush({force:true});
 assert.equal(tracker.status().pending,0);assert.equal(tracker.status().held,0);assert.equal(tracker.status().stopped,false);assert(sent.some(e=>e.itemId==='own-grade'));assert(!sent.some(e=>e.itemId==='old-cross-grade'));assert(!f.statuses.includes('session_changed'));
});
test('storage failures are reported without crashing the learning interaction',async()=>{
  const {createResearchTracker}=await moduleReady;const f=fixture({storage:{getItem(){throw Error('denied');},setItem(){throw Error('full');}}});
  const tracker=createResearchTracker(f.options);tracker.emit('item_presented',{itemId:'p1.l0'});assert.equal(tracker.status().pending,2);assert(f.statuses.includes('storage_unavailable'));
});

test('two tabs cannot overwrite events or resurrect an acknowledged queue',async()=>{
  const {createResearchTracker}=await moduleReady;
  const f=fixture({fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body);return {ok:true,status:200,json:async()=>({accepted:true,batchId:body.batchId,eventIds:body.events.map(e=>e.eventId)})};}});
  const a=createResearchTracker(f.options),b=createResearchTracker(f.options);
  a.emit('item_presented',{itemId:'tab-a'});b.emit('item_presented',{itemId:'tab-b'});
  assert.equal(f.memory.size,4);await a.flush();assert.equal(f.memory.size,0);
  b.emit('item_presented',{itemId:'tab-b-next'});await b.flush();assert.equal(f.memory.size,0);
  await a.flush();assert.equal(a.status().pending,0);
});

test('current progress excludes recursive archives and recognizer candidates',async()=>{
  const {compactLearningSnapshot}=await import('../maanshan/learning-snapshot.mjs');
  const attempt={version:1,attemptId:'test',itemIds:['one'],answers:[{status:'correct',itemId:'one',candidates:['private'],recognized:'private'}],resultArchive:[{raw:'private'}],freePlayDrafts:{raw:'private'},gameDrafts:{one:{stage:2}}};
  attempt.sourceAttempt={...attempt};
  const state=compactLearningSnapshot({reading:[],challenge:attempt,chat:['private']});
  assert(!JSON.stringify(state).includes('private'));assert.equal(state.challenge.gameDrafts.one.stage,2);assert.equal(state.challenge.sourceAttempt.answers.length,1);
});

test('damaged stored record is retained separately while healthy records still upload',async()=>{
  const {createResearchTracker}=await moduleReady;let sent=[];
  const f=fixture({fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body);sent.push(...body.events);return {ok:true,status:200,json:async()=>({accepted:true,batchId:body.batchId,eventIds:body.events.map(e=>e.eventId)})};}});
  const broken='maanshan-research-v1:'+actor.id+':event:broken';f.memory.set(broken,'{bad json');
  const tracker=createResearchTracker(f.options);tracker.emit('item_presented',{itemId:'healthy'});await tracker.flush();
  assert.equal(sent.length,2);assert.equal(tracker.status().pending,0);assert.equal(tracker.status().held,1);assert.equal(f.memory.get(broken),'{bad json');assert.equal(tracker.status().stopped,false);
});

test('offline backlog drains several bounded batches without replaying new events in the same flush',async()=>{
  const {createResearchTracker}=await moduleReady;let sent=0,calls=0;
  const f=fixture({fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body);calls++;sent+=body.events.length;assert(body.events.length<=32);validateBatch(body,actor);return {ok:true,status:200,json:async()=>({accepted:true,batchId:body.batchId,eventIds:body.events.map(e=>e.eventId)})};}});
  for(let i=0;i<110;i++){
    const event={eventId:f.options.uuid(),sessionId:'11111111-1111-4111-8111-111111111111',seq:i,clientAt:new Date(f.options.now()).toISOString(),activeMs:0,poemId:5,activity:'read',type:'item_presented',appVersion:'test',contentVersion:'test',itemId:'p5.l0'};
    f.memory.set('maanshan-research-v1:'+actor.id+':event:'+event.eventId,JSON.stringify(event));
  }
  const tracker=createResearchTracker(f.options);await tracker.flush();assert.equal(sent,111);assert.equal(calls,4);assert.equal(tracker.status().pending,0);
});

test('schema poison and event conflicts cannot permanently block good events or log out the account',async()=>{
  const {createResearchTracker}=await moduleReady;const sent=[];
  const f=fixture({fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body);if(body.events.some(e=>e.itemId==='bad'))return {ok:false,status:409,json:async()=>({error:'EVENT_ID_CONFLICT'})};sent.push(...body.events);return {ok:true,status:200,json:async()=>({accepted:true,batchId:body.batchId,eventIds:body.events.map(e=>e.eventId)})};}});
  const tracker=createResearchTracker(f.options);tracker.emit('item_presented',{itemId:'bad'});for(let i=0;i<25;i++)tracker.emit('item_presented',{itemId:'good'});
  for(let i=0;i<8&&tracker.status().pending;i++)await tracker.flush({force:true});
  assert.equal(sent.length,26);assert.equal(tracker.status().pending,0);assert.equal(tracker.status().held,1);assert.equal(tracker.status().stopped,false);
  assert(!f.statuses.includes('session_changed'));
});

test('network failure backs off automatic retries while manual retry remains available',async()=>{
  const {createResearchTracker}=await moduleReady;let calls=0;
  const f=fixture({fetchImpl:async()=>{calls++;throw Error('network');}}),tracker=createResearchTracker(f.options);
  await tracker.flush();await tracker.flush();assert.equal(calls,1);assert(tracker.status().retryAt>f.options.now());
  await tracker.flush({force:true});assert.equal(calls,2);f.clock(61000);await tracker.flush();assert.equal(calls,3);assert.equal(tracker.status().pending,1);
});

test('volatile records still upload when localStorage is completely absent, and callbacks cannot break learning',async()=>{
  const {createResearchTracker}=await moduleReady;let sent;
  const f=fixture({storage:null,onStatus(){throw Error('view destroyed');},fetchImpl:async(_url,options)=>{sent=JSON.parse(options.body);return {ok:true,status:200,json:async()=>({accepted:true,batchId:sent.batchId,eventIds:sent.events.map(e=>e.eventId)})};}});
  const tracker=createResearchTracker(f.options);tracker.emit('item_presented',{itemId:'volatile'});assert.equal(tracker.status().volatile,2);await tracker.flush();assert.equal(sent.events.length,2);assert.equal(tracker.status().pending,0);
});

test('temporary storage access denial is retried rather than classifying valid JSON as damaged',async()=>{
 const {createResearchTracker}=await moduleReady;let denied=false;
 const f=fixture({fetchImpl:async()=>{throw Error('offline');}}),original=f.storage.getItem;
 f.storage.getItem=key=>{if(denied)throw Error('access denied');return original(key);};
 const tracker=createResearchTracker(f.options);tracker.emit('item_presented',{itemId:'safe'});denied=true;await tracker.flush();
 assert.equal(tracker.status().held,0);assert.equal(tracker.status().pending,2);assert.equal(tracker.status().storageAvailable,false);
 denied=false;await tracker.flush({force:true});assert.equal(tracker.status().held,0);assert.equal(f.memory.size,2);
});

test('learning telemetry contract covers reading, dwell, animation, AR, practice, writing and poet chat',async()=>{
  const {createResearchTracker}=await moduleReady;let sent;
  const f=fixture({fetchImpl:async(_url,options)=>{
    sent=JSON.parse(options.body);validateBatch(sent,actor);
    return {ok:true,status:200,json:async()=>({accepted:true,batchId:sent.batchId,eventIds:sent.events.map(e=>e.eventId)})};
  }});
  const tracker=createResearchTracker(f.options),attempt=f.options.uuid();
  // Reading/TTS: presentation and successful playback are process observations.
  tracker.emit('item_presented',{activity:'read',poemId:5,itemId:'p5.l0'});
  tracker.emit('playback_started',{activity:'listen',poemId:5,itemId:'p5.l0',attemptId:attempt,metrics:{playbackRate:1}});
  tracker.emit('playback_ended',{activity:'listen',poemId:5,itemId:'p5.l0',attemptId:attempt,result:{status:'completed',score:null,correct:null},metrics:{playbackMs:1200,playbackRate:1}});
  // Animation and time-on-task: playback duration is retained without raw video data.
  tracker.emit('activity_start',{activity:'animation',poemId:5,itemId:'p5.animation'});
  tracker.emit('playback_started',{activity:'animation',poemId:5,itemId:'p5.animation',attemptId:attempt,metrics:{playbackRate:1}});
  tracker.emit('playback_ended',{activity:'animation',poemId:5,itemId:'p5.animation',attemptId:attempt,result:{status:'cancelled',score:null,correct:null},metrics:{watchedMs:2400,videoPositionMs:2400}});
  tracker.emit('activity_end',{activity:'animation',poemId:5,itemId:'p5.animation',result:{status:'completed',score:null,correct:null},metrics:{elapsedMs:3000}});
  // AR/model interaction: only semantic actions, never coordinates or camera frames.
  tracker.emit('item_interacted',{activity:'explore',poemId:5,itemId:'p5.explore.observation.0',interaction:'camera_rotate',response:{choiceId:'peak'},context:{mode:'free',itemType:'microgame'}});
  tracker.emit('item_interacted',{activity:'explore',poemId:5,itemId:'p5.explore.observation.0',interaction:'camera_zoom',response:{choiceId:'in'},context:{mode:'free',itemType:'microgame'}});
  tracker.emit('item_interacted',{activity:'explore',poemId:5,itemId:'p5.explore.observation.0',interaction:'camera_reset',response:{choiceId:'reset'},context:{mode:'free',itemType:'microgame'}});
  // Practice and handwriting: answer metadata is structured and score-free on the client.
  tracker.emit('answer_submitted',{activity:'challenge',poemId:5,itemId:'g5-s1',attemptId:attempt,attemptNo:1,
    context:{mode:'standard',itemType:'sound',position:1,total:5,optionOrder:['one','two']},response:{choiceId:'two'},result:{status:'incorrect',score:0,correct:false}});
  tracker.emit('item_interacted',{activity:'writing',poemId:5,itemId:'g5-d1',attemptId:attempt,interaction:'stroke_finished',context:{mode:'standard',itemType:'dictation'},metrics:{strokeCount:1}});
  // Poet chat: turn metadata and latency are retained; the conversation text is not.
  tracker.emit('attempt_started',{activity:'chat',poemId:5,itemId:'p5.chat',attemptId:attempt,metrics:{userCharacters:8}});
  tracker.emit('feedback_shown',{activity:'chat',poemId:5,itemId:'p5.chat',attemptId:attempt,metrics:{assistantCharacters:24,latencyMs:850}});
  tracker.emit('retry',{activity:'chat',poemId:5,itemId:'p5.chat',attemptId:attempt,retryCount:1});
  await tracker.flush();
  const observed=new Set(sent.events.map(e=>`${e.activity}:${e.type}`));
  for(const key of ['read:item_presented','listen:playback_started','listen:playback_ended','animation:activity_start','animation:playback_started','animation:playback_ended','animation:activity_end','explore:item_interacted','challenge:answer_submitted','writing:item_interacted','chat:attempt_started','chat:feedback_shown','chat:retry']) assert(observed.has(key),`missing ${key}`);
  assert.equal(JSON.stringify(sent).includes('conversation text'),false);
});
