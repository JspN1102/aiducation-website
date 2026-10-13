'use strict';
// school48 optional process detail: enum/integer extensions on context and
// metrics. Learning flows must be unaffected; older servers get the same
// events back without the extensions.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateBatch}=require('../api/_lib/research-store.cjs');
const actor={id:'s_'+'a'.repeat(24),researchId:'r_'+'b'.repeat(24),grade:5,cls:'A',role:'student'};
const moduleReady=import('../maanshan/research-client.mjs');
const PREFIX='maanshan-research-v1:'+actor.id+':event:';
function fixture(extra={}){
  const memory=new Map();let tick=0,counter=0;const statuses=[];
  const storage={get length(){return memory.size;},key:index=>[...memory.keys()][index],getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
  return {memory,storage,statuses,clock:value=>tick=value,
    options:{actorId:actor.id,csrfToken:'synthetic-csrf',storage,now:()=>Date.UTC(2026,9,8)+tick,
      monotonic:()=>tick,visible:()=>true,onStatus:status=>statuses.push(status),uuid:()=>`00000000-0000-4000-8000-${String(++counter).padStart(12,'0')}`,...extra}};
}
const accept=(body)=>({ok:true,status:200,json:async()=>({accepted:true,batchId:body.batchId,eventIds:body.events.map(e=>e.eventId)})});
const stored=f=>[...f.memory.entries()].filter(([key])=>key.startsWith(PREFIX)&&!key.startsWith(PREFIX+'hold:')).map(([,value])=>JSON.parse(value));
// The pre-school48 event construction, reproduced to prove legacy events are byte-identical.
const OPTIONAL=['attemptId','itemId','attemptNo','hint','retryCount','result','error','metrics','context','response','interaction'];
function legacyShape(emitted,fields){
  const event={eventId:emitted.eventId,sessionId:emitted.sessionId,seq:emitted.seq,clientAt:emitted.clientAt,activeMs:emitted.activeMs,
    poemId:emitted.poemId,activity:emitted.activity,type:emitted.type,appVersion:emitted.appVersion,contentVersion:emitted.contentVersion};
  for(const name of OPTIONAL)if(fields[name]!==undefined)event[name]=fields[name];
  if(fields.activity)event.activity=fields.activity;
  if(fields.poemId!==undefined)event.poemId=fields.poemId;
  return event;
}
const LEGACY_CONTEXT=['mode','itemType','position','total','optionOrder','sourceAttemptId','flow','traceCompleted','dictationCompleted'];
const LEGACY_METRICS=['elapsedMs','playbackMs','audioDurationMs','playbackRate','strokeCount','eraseCount','hintCount','userCharacters','assistantCharacters','latencyMs','wordCount','correctCount','itemCount','watchedMs','videoPositionMs','lostEventCount'];
// A pre-school48 server: any unknown context/metrics key is a 400 for the whole batch.
const oldServerRejects=event=>Object.keys(event.context||{}).some(k=>!LEGACY_CONTEXT.includes(k))||Object.keys(event.metrics||{}).some(k=>!LEGACY_METRICS.includes(k));

test('(a) valid extension values pass, invalid ones are dropped one by one, and the caller objects are untouched',async()=>{
  const {createResearchTracker}=await moduleReady;const f=fixture({fetchImpl:async()=>{throw new TypeError('offline');}});
  const tracker=createResearchTracker(f.options);
  const context=Object.freeze({mode:'standard',mediaRoute:'public',audioSource:'tts',audioTrigger:'line-tts',lineIndex:3,pinyinShown:false});
  const metrics=Object.freeze({playbackRate:1,latencyMs:120,fallbackCount:1,prepareMs:300});
  const valid=tracker.emit('playback_started',{activity:'listen',poemId:5,itemId:'p5.l3',context,metrics});
  assert.deepEqual(valid.context,{mode:'standard',mediaRoute:'public',audioSource:'tts',audioTrigger:'line-tts',lineIndex:3,pinyinShown:false});
  assert.deepEqual(valid.metrics,{playbackRate:1,latencyMs:120,fallbackCount:1,prepareMs:300});
  const badContext={mode:'standard',mediaRoute:'cdn',audioSource:'tts',lineIndex:200,pinyinShown:'yes',httpStatus:302,errorDetail:'boom',resend:true,deviceAccounts:0};
  const badMetrics={latencyMs:5,fallbackCount:11,stallCount:-1,selectionChanges:1.5,mediaDurationMs:5000,seekFromMs:'10',pendingCount:100001};
  const before=JSON.stringify([badContext,badMetrics]);
  const mixed=tracker.emit('item_interacted',{activity:'listen',poemId:5,itemId:'p5.l0',context:badContext,metrics:badMetrics});
  assert.equal(JSON.stringify(mixed.context),JSON.stringify({mode:'standard',audioSource:'tts',resend:true}));
  assert.equal(JSON.stringify(mixed.metrics),JSON.stringify({latencyMs:5,mediaDurationMs:5000}));
  assert.equal(JSON.stringify([badContext,badMetrics]),before,'caller objects must never be mutated');
  assert.notEqual(mixed.context,badContext);assert.notEqual(mixed.metrics,badMetrics);
  // Only invalid extensions: the field disappears rather than being sent empty.
  const empty=tracker.emit('item_presented',{activity:'read',poemId:5,itemId:'p5.l0',context:{mediaRoute:'cdn'},metrics:{stallCount:-5}});
  assert.equal('context' in empty,false);assert.equal('metrics' in empty,false);
  // A hostile getter cannot break emit; the extension is dropped.
  const hostile={mode:'standard'};Object.defineProperty(hostile,'mediaRoute',{enumerable:true,get(){throw Error('boom');}});
  const safe=tracker.emit('item_presented',{activity:'read',poemId:5,itemId:'p5.l1',context:hostile});
  assert.deepEqual(safe.context,{mode:'standard'});
  assert.equal(stored(f).find(e=>e.eventId===safe.eventId).context.mode,'standard');
});

test('(a) legacy-only events serialise byte-identically and keep the caller object reference',async()=>{
  const {createResearchTracker}=await moduleReady;const f=fixture({fetchImpl:async()=>{throw new TypeError('offline');}});
  const tracker=createResearchTracker(f.options),attemptId=f.options.uuid();
  const samples=[
    {activity:'challenge',poemId:5,itemId:'g5-s1',attemptId,attemptNo:1,context:{mode:'standard',itemType:'sound',position:1,total:5,optionOrder:['one','two']},response:{choiceId:'two'},result:{status:'incorrect',score:0,correct:false},metrics:{elapsedMs:4200}},
    {activity:'listen',poemId:5,itemId:'p5.l0',attemptId,metrics:{playbackRate:1}},
    {activity:'read',poemId:5,itemId:'p5.l0',attemptId,error:{code:'network',retryable:true}},
    {activity:'writing',poemId:5,itemId:'g5-d1',attemptId,interaction:'stroke_finished',context:{mode:'standard',itemType:'dictation',flow:'trace-dictation-v1',traceCompleted:true},metrics:{strokeCount:2}},
    {}];
  for(const fields of samples){
    const event=tracker.emit(fields.attemptNo?'answer_submitted':'item_interacted',fields);
    assert.equal(JSON.stringify(event),JSON.stringify(legacyShape(event,fields)));
    assert.equal(JSON.stringify(stored(f).find(e=>e.eventId===event.eventId)),JSON.stringify(legacyShape(event,fields)));
    if(fields.context)assert.equal(event.context,fields.context);
    if(fields.metrics)assert.equal(event.metrics,fields.metrics);
  }
});

test('(b) session_start carries start fields and the queue backlog; a failing provider still starts the session',async()=>{
  const {createResearchTracker}=await moduleReady;const f=fixture({fetchImpl:async()=>{throw new TypeError('offline');}});
  const first=createResearchTracker(f.options);first.emit('item_presented',{activity:'read',poemId:5,itemId:'p5.l0'});
  f.memory.set(PREFIX+'hold:00000000-0000-4000-8000-0000000009ff','schema_rejected');
  const startContext={pointer:'coarse',viewport:'small',pageLoad:'reload',deviceAccounts:2};
  const tracker=createResearchTracker({...f.options,startFields:()=>({context:startContext,metrics:{latencyMs:1234}})});
  const start=stored(f).find(e=>e.sessionId===tracker.sessionId&&e.type==='session_start');
  assert.deepEqual(start.context,startContext);
  assert.deepEqual(start.metrics,{latencyMs:1234,pendingCount:2,heldCount:1});
  // A plain object works too, and invalid values are dropped individually.
  const plain=createResearchTracker({...f.options,startFields:{context:{pointer:'stylus',viewport:'large',deviceAccounts:11},metrics:{latencyMs:0}}});
  const plainStart=stored(f).find(e=>e.sessionId===plain.sessionId&&e.type==='session_start');
  assert.deepEqual(plainStart.context,{viewport:'large'});
  assert.deepEqual(plainStart.metrics,{latencyMs:0,pendingCount:3,heldCount:1});
  // A throwing provider still emits one plain session_start.
  const throwing=createResearchTracker({...f.options,startFields:()=>{throw Error('matchMedia unavailable');}});
  const plainStarts=stored(f).filter(e=>e.sessionId===throwing.sessionId);
  assert.equal(plainStarts.length,1);assert.equal(plainStarts[0].type,'session_start');
  assert.equal('context' in plainStarts[0],false);assert.equal('metrics' in plainStarts[0],false);
  // Without a provider only the backlog counts are added.
  const bare=createResearchTracker(f.options);
  const bareStart=stored(f).find(e=>e.sessionId===bare.sessionId);
  assert.deepEqual(bareStart.metrics,{pendingCount:5,heldCount:1});assert.equal('context' in bareStart,false);
});

test('(c) an older server that rejects extensions receives the same events stripped, with the same eventIds',async()=>{
  const {createResearchTracker}=await moduleReady;const accepted=[];let rejected=0;
  const f=fixture({fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body);
    if(body.events.some(oldServerRejects)){rejected++;return {ok:false,status:400,json:async()=>({error:'INVALID_EVENT'})};}
    validateBatch(body,actor);accepted.push(...body.events);return accept(body);}});
  const tracker=createResearchTracker(f.options);
  const listen=tracker.emit('playback_started',{activity:'listen',poemId:5,itemId:'p5.l0',context:{mediaRoute:'public',audioSource:'tts',audioTrigger:'line-tts',lineIndex:0},metrics:{playbackRate:1,latencyMs:90,fallbackCount:0}});
  const answer=tracker.emit('answer_submitted',{activity:'challenge',poemId:5,itemId:'g5-s1',attemptId:f.options.uuid(),attemptNo:1,
    context:{mode:'standard',itemType:'sound',position:1,total:5},response:{choiceId:'two'},result:{status:'correct',score:100,correct:true},metrics:{elapsedMs:3000,selectionChanges:2}});
  const plain=tracker.emit('item_presented',{activity:'read',poemId:5,itemId:'p5.l1'});
  for(let i=0;i<10&&tracker.status().pending;i++)await tracker.flush({force:true});
  assert(rejected>0);
  assert.equal(tracker.status().pending,0);assert.equal(tracker.status().held,0);assert.equal(tracker.status().lastStatus,'synced');
  const byId=new Map(accepted.map(e=>[e.eventId,e]));
  assert.equal(byId.size,4,'session_start, listen, answer and the plain event each arrive once');
  assert.deepEqual(byId.get(listen.eventId).context,undefined);assert.deepEqual(byId.get(listen.eventId).metrics,{playbackRate:1,latencyMs:90});
  assert.deepEqual(byId.get(answer.eventId).context,{mode:'standard',itemType:'sound',position:1,total:5});
  assert.deepEqual(byId.get(answer.eventId).metrics,{elapsedMs:3000});assert.deepEqual(byId.get(answer.eventId).result,{status:'correct',score:100,correct:true});
  assert.equal(JSON.stringify(byId.get(plain.eventId)),JSON.stringify(plain));
  assert.equal(byId.get(listen.eventId).seq,listen.seq);assert.equal(byId.get(listen.eventId).clientAt,listen.clientAt);
  assert.equal(stored(f).length,0);assert.equal([...f.memory.keys()].some(key=>key.includes(':hold:')),false);
});

test('(c) a legacy event that an older server rejects is still held, and stripping is attempted at most once',async()=>{
  const {createResearchTracker}=await moduleReady;const accepted=[];let calls=0;
  const f=fixture({fetchImpl:async(_url,options)=>{calls++;const body=JSON.parse(options.body);
    if(body.events.some(e=>oldServerRejects(e)||e.itemId==='bad'))return {ok:false,status:400,json:async()=>({error:'INVALID_EVENT'})};
    accepted.push(...body.events);return accept(body);}});
  const tracker=createResearchTracker(f.options);
  const legacyBad=tracker.emit('item_presented',{activity:'read',poemId:5,itemId:'bad'});
  const extBad=tracker.emit('item_presented',{activity:'read',poemId:5,itemId:'bad',context:{pinyinShown:true}});
  const good=tracker.emit('item_presented',{activity:'read',poemId:5,itemId:'good',context:{pinyinShown:true}});
  for(let i=0;i<12&&tracker.status().pending;i++)await tracker.flush({force:true});
  assert.equal(tracker.status().pending,0);assert.equal(tracker.status().held,2);assert.equal(tracker.status().lastStatus,'records_held');
  const ids=new Set(accepted.map(e=>e.eventId));
  assert(ids.has(good.eventId));assert(!ids.has(legacyBad.eventId));assert(!ids.has(extBad.eventId));
  assert(f.memory.has(PREFIX+'hold:'+legacyBad.eventId));assert(f.memory.has(PREFIX+'hold:'+extBad.eventId));
  // Held records stay on the device; the extension event's copy is the stripped resend under the same eventId, not a duplicate.
  const kept=stored(f);assert.equal(kept.length,2);
  assert.equal(JSON.stringify(kept.find(e=>e.eventId===extBad.eventId)),JSON.stringify({...extBad,context:undefined}));
  assert.equal(JSON.stringify(kept.find(e=>e.eventId===legacyBad.eventId)),JSON.stringify(legacyBad));assert(calls<20);
});

test('(c) a current server that accepts extensions gets them unchanged in one call',async()=>{
  const {createResearchTracker}=await moduleReady;let sent,calls=0;
  const f=fixture({fetchImpl:async(_url,options)=>{calls++;sent=JSON.parse(options.body);validateBatch(sent,actor);return accept(sent);}});
  const tracker=createResearchTracker({...f.options,startFields:{context:{pointer:'fine'}}});
  const event=tracker.emit('feedback_shown',{activity:'read',poemId:5,itemId:'p5.l0',context:{uploadPath:'compact',resend:false},metrics:{latencyMs:800}});
  await tracker.flush();assert.equal(calls,1);
  assert.deepEqual(sent.events.find(e=>e.eventId===event.eventId).context,{uploadPath:'compact',resend:false});
  assert.deepEqual(sent.events[0].context,{pointer:'fine'});assert.deepEqual(sent.events[0].metrics,{pendingCount:0,heldCount:0});
});

test('(d) researchErrorContext maps errors to enum detail, and researchErrorCode is unchanged',async()=>{
  const {researchErrorContext,researchErrorCode,ERROR_DETAILS}=await moduleReady;
  const named=(name)=>Object.assign(new Error('x'),{name}),coded=(code)=>Object.assign(new Error('x'),{code});
  const table=[
    [named('NotAllowedError'),'mic-denied','permission_denied'],[named('SecurityError'),'mic-denied','permission_denied'],
    [named('NotFoundError'),'mic-missing','unknown'],[named('OverconstrainedError'),'mic-missing','unknown'],
    [named('NotReadableError'),'mic-busy','unknown'],[new DOMException('Aborted','AbortError'),'aborted','aborted'],
    [named('TimeoutError'),'timeout','timeout'],[coded('TIMEOUT'),'timeout','timeout'],
    [coded('AUDIO_UNSUPPORTED'),'unsupported','unsupported'],[coded('TOO_SHORT'),'too-short','unknown'],[coded('TOO_LONG'),'too-long','unknown'],
    [coded('OFFLINE'),'offline','network'],[coded('NETWORK'),'network','network'],[new TypeError('Failed to fetch'),'network','network'],
    [coded('BUSY'),'busy','provider_unavailable'],[coded('SERVICE'),'service','provider_unavailable'],[coded('TRANSCODE'),'transcode','unknown'],[coded('REJECTED'),'other','invalid_response'],
    [coded('AUDIO_DECODE'),'decode','unknown'],[coded('AUDIO_RENDER'),'decode','unknown'],
    [new Error('plain'),'other','unknown'],[null,'other','unknown'],[undefined,'other','unknown'],['text','other','unknown']];
  for(const [error,detail,code] of table){
    assert.deepEqual(researchErrorContext(error),{errorDetail:detail},String(error?.name||error?.code||error));
    assert.equal(researchErrorCode(error),code);
    assert(ERROR_DETAILS.includes(detail));
  }
  // network.mjs / recording-audio.mjs tags take precedence; an unknown tag falls back.
  const tagged=Object.assign(new TypeError('x'),{researchDetail:'service',researchHttpStatus:503});
  assert.deepEqual(researchErrorContext(tagged),{errorDetail:'service',httpStatus:503});assert.equal(researchErrorCode(tagged),'network');
  assert.deepEqual(researchErrorContext(Object.assign(new TypeError('x'),{researchDetail:'weird'})),{errorDetail:'network'});
  assert.deepEqual(researchErrorContext(Object.assign(coded('BUSY'),{researchHttpStatus:429})),{errorDetail:'busy',httpStatus:429});
  assert.deepEqual(researchErrorContext(Object.assign(new Error('伺服器繁忙'),{researchDetail:'busy',researchHttpStatus:429})),{errorDetail:'busy',httpStatus:429});
  assert.equal(researchErrorCode(Object.assign(new Error('伺服器繁忙'),{researchDetail:'busy',researchHttpStatus:429})),'unknown');
  for(const status of [302,399,600,'503',503.5,null])
    assert.deepEqual(researchErrorContext(Object.assign(coded('SERVICE'),{researchHttpStatus:status})),{errorDetail:'service'});
  const hostile=new Proxy({},{get(){throw Error('boom');}});
  assert.deepEqual(researchErrorContext(hostile),{errorDetail:'other'});
});

const sampleSupport=()=>{try{validateBatch({schemaVersion:1,batchId:'00000000-0000-4000-8000-00000000ffff',actorId:actor.id,events:[{eventId:'00000000-0000-4000-8000-00000000fffe',sessionId:'00000000-0000-4000-8000-00000000fffd',seq:0,clientAt:new Date(Date.UTC(2026,9,8)).toISOString(),activeMs:0,poemId:null,activity:'navigation',type:'session_start',appVersion:'test',contentVersion:'test',context:{pointer:'coarse'},metrics:{pendingCount:0}}]},actor,Date.UTC(2026,9,8));return true;}catch{return false;}};
test('(f) every extension the app emits passes the server validator',{skip:sampleSupport()?false:'server validator lacks school48 extensions'},async()=>{
  const {createResearchTracker,researchErrorContext,pageErrorContext,AUDIO_TRIGGERS,ERROR_DETAILS,ERROR_SOURCES,ERROR_KINDS}=await moduleReady;const batches=[];
  const f=fixture({fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body);batches.push(validateBatch(body,actor,Date.UTC(2026,9,8)));return accept(body);}});
  const tracker=createResearchTracker({...f.options,startFields:()=>({context:{pointer:'coarse',viewport:'medium',pageLoad:'back-forward',deviceAccounts:10},metrics:{latencyMs:640}})});
  const emitted=[],emit=(type,fields)=>emitted.push(tracker.emit(type,{poemId:5,attemptId:f.options.uuid(),...fields}));
  for(const [index,trigger] of [...AUDIO_TRIGGERS,'challenge','other'].entries())
    emit('playback_started',{activity:'listen',itemId:'p5.l0',context:{mediaRoute:index%2?'local':'public',audioSource:['recitation','static','tts','recording'][index%4],audioTrigger:trigger,lineIndex:index},metrics:{playbackRate:1,latencyMs:150,fallbackCount:index%3,prepareMs:20}});
  emit('playback_ended',{activity:'listen',itemId:'p5.l0',result:{status:'completed',score:null,correct:null},metrics:{playbackMs:1200,playbackRate:1,mediaDurationMs:1300}});
  emit('playback_started',{activity:'animation',itemId:'p5.animation',context:{mediaRoute:'local'},metrics:{playbackRate:1,latencyMs:400}});
  emit('playback_ended',{activity:'animation',itemId:'p5.animation',result:{status:'cancelled',score:null,correct:null},metrics:{watchedMs:2400,videoPositionMs:2400,mediaDurationMs:90000,stallCount:2}});
  emit('item_interacted',{activity:'animation',itemId:'p5.animation',interaction:'video_seek',metrics:{videoPositionMs:30000,seekFromMs:12000}});
  emit('attempt_started',{activity:'read',itemId:'p5.l0',context:{pinyinShown:true}});
  for(const recorderFormat of ['webm-opus','webm','mp4','ogg','default','other'])emit('recording_started',{activity:'read',itemId:'p5.l0',metrics:{latencyMs:300},context:{recorderFormat}});
  for(const stopReason of ['manual','time-limit'])emit('recording_stopped',{activity:'read',itemId:'p5.l0',metrics:{audioDurationMs:4000},context:{stopReason}});
  for(const uploadPath of ['compact','pcm','pcm-fallback'])emit('feedback_shown',{activity:'read',itemId:'p5.l0',result:{status:'completed',score:88,correct:null},metrics:{latencyMs:2100},context:{uploadPath,resend:uploadPath==='pcm'}});
  emit('feedback_shown',{activity:'read',itemId:'p5.l0',result:{status:'completed',score:88,correct:null},metrics:{latencyMs:2100},context:{resend:true}});
  for(const detail of ERROR_DETAILS)emit('error',{activity:'read',itemId:'p5.l0',error:{code:'unknown',retryable:true},context:researchErrorContext(Object.assign(new Error('x'),{researchDetail:detail,researchHttpStatus:detail==='busy'?429:503}))});
  emit('error',{activity:'chat',itemId:'p5.chat',error:{code:'permission_denied',retryable:true},context:researchErrorContext(Object.assign(new Error('x'),{name:'NotAllowedError'}))});
  for(const [index,errorKind] of ERROR_KINDS.entries())emit('error',{itemId:index%2?'client.unhandled':'client.runtime',error:{code:'unknown',retryable:false},context:{errorSource:ERROR_SOURCES[index%ERROR_SOURCES.length],errorKind}});
  emit('error',{itemId:'client.runtime',error:{code:'unknown',retryable:false},context:pageErrorContext({message:'Uncaught TypeError: x',filename:'https://mandarin.aiducation.asia/school/app.js',error:new TypeError('x')},'https://mandarin.aiducation.asia/school/','https://mandarin.aiducation.asia/school/')});
  emit('answer_submitted',{activity:'challenge',itemId:'g5-s1',attemptNo:1,context:{mode:'standard',itemType:'sound',position:1,total:5,optionOrder:['one','two']},response:{choiceId:'two'},result:{status:'correct',score:100,correct:true},metrics:{elapsedMs:5000,selectionChanges:3}});
  emit('answer_submitted',{activity:'challenge',itemId:'g5-m1',attemptNo:1,context:{mode:'standard',itemType:'match',position:2,total:5},response:{placements:[{slotId:'a',choiceId:'b'}]},result:{status:'incorrect',score:0,correct:false},metrics:{elapsedMs:5000,selectionChanges:1000}});
  for(const inputMode of ['typed','voice','suggestion'])emit('attempt_started',{activity:'chat',itemId:'p5.chat',metrics:{userCharacters:8},context:{inputMode}});
  emit('feedback_shown',{activity:'chat',itemId:'p5.chat',metrics:{assistantCharacters:24,latencyMs:1850,firstResponseMs:600}});
  for(let i=0;i<10&&tracker.status().pending;i++)await tracker.flush({force:true});
  assert.equal(tracker.status().pending,0);assert.equal(tracker.status().held,0);
  const accepted=batches.flatMap(batch=>batch.events.map(row=>row.event));
  assert.equal(accepted.length,emitted.length+1);
  for(const event of emitted){
    const row=accepted.find(e=>e.eventId===event.eventId);assert(row,event.type);
    assert.deepEqual(row.context,event.context);assert.deepEqual(row.metrics,event.metrics);
  }
  const start=accepted.find(e=>e.type==='session_start');
  assert.deepEqual(start.context,{deviceAccounts:10,pageLoad:'back-forward',pointer:'coarse',viewport:'medium'});
  assert.deepEqual(start.metrics,{heldCount:0,latencyMs:640,pendingCount:0});
  // Consent v3: only enum tokens and bounded integers, never identifiers or device strings.
  const text=JSON.stringify(accepted);
  for(const banned of ['userAgent','Mozilla','innerWidth','screen','deviceId','ip'])assert.equal(text.includes('"'+banned),false,banned);
});

// (g) Page errors carry where the script came from and its error class as enums; nothing else about the error leaves the device.
const PAGE='https://mandarin.aiducation.asia/school/?from=login',BASE='https://mandarin.aiducation.asia/school/';
test('(g) pageErrorContext classifies the script origin and error class, never the message, URL or stack',async()=>{
  const {pageErrorContext,ERROR_SOURCES,ERROR_KINDS}=await moduleReady;
  const named=(name,message='x')=>Object.assign(new Error(message),{name});
  const sources=[
    ['https://mandarin.aiducation.asia/school/app.js?v=20261009-school53','own-module'],['https://mandarin.aiducation.asia/school/poem-games/rain.mjs?v=1','own-module'],
    ['https://mandarin.aiducation.asia/school/vendor/poetry-three.mjs#x','own-module'],
    ['https://mandarin.aiducation.asia/school/','own-page'],['https://mandarin.aiducation.asia/school/index.html','own-page'],['https://mandarin.aiducation.asia/school/?from=login','own-page'],
    ['https://mandarin.aiducation.asia/schoolx/app.js','own-page'],['https://mandarin.aiducation.asia/mandarin-assessment/app.js','own-page'],
    ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/content.js','extension'],['safari-extension://com.example.ext-0000/abc/inject.js','extension'],
    ['safari-web-extension://00000000-0000-4000-8000-000000000000/content.js','extension'],['moz-extension://00000000-0000-4000-8000-000000000000/inject.js','extension'],
    ['webkit-masked-url://hidden/','extension'],['Chrome-Extension://abc/x.js','extension'],
    ['https://cdn.example.com/school/app.js','other-origin'],['http://mandarin.aiducation.asia/school/app.js','other-origin'],['https://aiducation.asia/school/app.js','other-origin'],
    ['https://mandarin.aiducation.asia:8443/school/app.js','other-origin'],['undefined','other-origin'],['about:blank','other-origin'],
    ['','none'],[undefined,'none'],[null,'none'],[42,'none']];
  for(const [filename,source] of sources)
    assert.deepEqual(pageErrorContext({filename,message:'Uncaught TypeError: x',error:new TypeError('x')},PAGE,BASE),{errorSource:source,errorKind:'type'},String(filename));
  // The staging entrance classifies its own scripts the same way.
  assert.equal(pageErrorContext({filename:'https://aiducation.asia/school/app.js'},'https://aiducation.asia/school/','https://aiducation.asia/school/').errorSource,'own-module');
  // A rejection has no filename: WebKit's sourceURL or Firefox's fileName on the reason is used when present, never the stack.
  assert.deepEqual(pageErrorContext({error:Object.assign(new TypeError('x'),{sourceURL:'https://mandarin.aiducation.asia/school/challenge.mjs?v=1'})},PAGE,BASE),{errorSource:'own-module',errorKind:'type'});
  assert.deepEqual(pageErrorContext({error:Object.assign(new Error('x'),{fileName:'moz-extension://abc/inject.js'})},PAGE,BASE),{errorSource:'extension',errorKind:'other'});
  assert.deepEqual(pageErrorContext({error:Object.assign(new TypeError('x'),{stack:'TypeError: x\n    at https://mandarin.aiducation.asia/school/app.js:1:2'})},PAGE,BASE),{errorSource:'none',errorKind:'type'});
  assert.equal(pageErrorContext({filename:'chrome-extension://abc/x.js',error:Object.assign(new Error('x'),{sourceURL:BASE+'app.js'})},PAGE,BASE).errorSource,'extension','the event filename wins');
  const kinds=[
    [new TypeError('x'),'type'],[new ReferenceError('x'),'reference'],[new RangeError('x'),'range'],[new SyntaxError('x'),'syntax'],
    [new DOMException('x','SecurityError'),'security'],[new DOMException('x','AbortError'),'abort'],[new DOMException('x','NotAllowedError'),'not-allowed'],
    [new DOMException('x','NetworkError'),'network'],[named('NotAllowedError'),'not-allowed'],
    [new TypeError('Failed to fetch'),'network'],[new TypeError('Load failed'),'network'],[new TypeError('NetworkError when attempting to fetch resource.'),'network'],
    [new TypeError('Failed to fetch dynamically imported module: https://mandarin.aiducation.asia/school/x.mjs'),'type'],
    [new Error('Failed to fetch'),'other'],[new DOMException('x','NotSupportedError'),'other'],[new DOMException('x','QuotaExceededError'),'other'],[new Error('x'),'other'],
    [named('constructor'),'other'],[named('toString'),'other'],[{name:'TypeError'},'type'],
    ['TypeError: string reason','other'],[42,'other'],[{},'other'],[[],'other'],[Symbol('s'),'other'],[undefined,'other'],[null,'other']];
  for(const [error,kind] of kinds)
    assert.deepEqual(pageErrorContext({error},PAGE,BASE),{errorSource:'none',errorKind:kind},String(error?.name||typeof error));
  // Window error events: browser notices are told apart by their fixed message; with no error object the class comes off the message.
  const events=[
    [{message:'Script error.',filename:'',lineno:0,colno:0,error:null},{errorSource:'none',errorKind:'muted'}],
    [{message:'Script error',filename:''},{errorSource:'none',errorKind:'muted'}],
    [{message:'Script error.',filename:'https://cdn.example.com/lib.js',error:null},{errorSource:'other-origin',errorKind:'muted'}],
    [{message:'ResizeObserver loop completed with undelivered notifications.',filename:'',error:null},{errorSource:'none',errorKind:'resize-loop'}],
    [{message:'ResizeObserver loop limit exceeded',error:undefined},{errorSource:'none',errorKind:'resize-loop'}],
    [{message:'TypeError: undefined is not an object',filename:BASE+'app.js',error:null},{errorSource:'own-module',errorKind:'type'}],
    [{message:'Uncaught ReferenceError: foo is not defined',filename:PAGE},{errorSource:'own-page',errorKind:'reference'}],
    [{message:'Uncaught SyntaxError: Unexpected token',filename:BASE+'app.js',error:new SyntaxError('Unexpected token')},{errorSource:'own-module',errorKind:'syntax'}],
    [{message:'Uncaught boom',filename:BASE+'app.js',error:'boom'},{errorSource:'own-module',errorKind:'other'}],
    [{message:'Error: Script error.',error:new Error('Script error.')},{errorSource:'none',errorKind:'other'}],
    [{message:42,filename:{},error:{}},{errorSource:'none',errorKind:'other'}]];
  for(const [event,expected] of events)assert.deepEqual(pageErrorContext(event,PAGE,BASE),expected,String(event.message));
  // Never throws, and never returns anything but the two enum keys.
  const hostile=new Proxy({},{get(){throw Error('boom');}});
  const getters=Object.defineProperties({},{filename:{get(){throw Error('boom');}},message:{value:'x'},error:{get(){throw Error('boom');}}});
  for(const value of [hostile,getters,{error:hostile},{error:new Proxy(new TypeError('x'),{get(){throw Error('boom');}})},null,undefined,'x',42])
    assert.deepEqual(pageErrorContext(value,PAGE,BASE),{errorSource:'none',errorKind:'other'},typeof value);
  assert.deepEqual(pageErrorContext({filename:BASE+'app.js',error:new TypeError('x')},undefined,null),{errorSource:'other-origin',errorKind:'type'},'without a page or app URL nothing is claimed as ours');
  const secret='https://mandarin.aiducation.asia/school/?token=abc 學生姓名';
  const context=pageErrorContext({filename:secret,message:'Uncaught TypeError: '+secret,error:Object.assign(new TypeError(secret),{stack:secret})},PAGE,BASE);
  assert.deepEqual(Object.keys(context).sort(),['errorKind','errorSource']);assert.doesNotMatch(JSON.stringify(context),/token|學生|https/);
  for(const [,source] of sources)assert(ERROR_SOURCES.includes(source));for(const [,kind] of kinds)assert(ERROR_KINDS.includes(kind));
});

function lifecycleScope(){
  const listeners={};const add=(type,fn)=>{(listeners[type]||=[]).push(fn);};
  return {scope:{addEventListener:add,document:{visibilityState:'visible',addEventListener:()=>{}}},fire:(type,event)=>listeners[type].forEach(fn=>fn(event))};
}
test('(h) uncaught errors and rejections are recorded with enum context; ResizeObserver notices once per page outside the budget',async()=>{
  const {createResearchTracker,attachResearchLifecycle}=await moduleReady;const f=fixture({fetchImpl:async()=>{throw new TypeError('offline');}});
  const tracker=createResearchTracker(f.options),{scope,fire}=lifecycleScope(),detach=attachResearchLifecycle(tracker,scope);
  try{
    for(let i=0;i<5;i++)fire('error',{message:'ResizeObserver loop completed with undelivered notifications.',filename:'',error:null});
    fire('error',{message:'Uncaught TypeError: x',filename:'chrome-extension://abc/content.js',error:new TypeError('x')});
    fire('error',{message:'Script error.',filename:'',error:null});
    fire('unhandledrejection',{reason:new TypeError('Load failed')});
    fire('unhandledrejection',{reason:new DOMException('play() failed','NotAllowedError')});
    fire('unhandledrejection',{reason:'plain string'});
    fire('unhandledrejection',{reason:undefined});
    for(let i=0;i<10;i++)fire('error',{message:'Uncaught RangeError: x',filename:'',error:new RangeError('x')});
    for(let i=0;i<3;i++)fire('error',{message:'ResizeObserver loop limit exceeded',error:null});
    const errors=stored(f).filter(e=>e.type==='error').sort((a,b)=>a.seq-b.seq);
    assert.deepEqual(errors.map(e=>[e.itemId,e.error.code,e.error.retryable,e.context.errorSource,e.context.errorKind]),[
      ['client.runtime','unknown',false,'none','resize-loop'],
      ['client.runtime','unknown',false,'extension','type'],
      ['client.runtime','unknown',false,'none','muted'],
      ['client.unhandled','network',false,'none','network'],
      ['client.unhandled','permission_denied',false,'none','not-allowed'],
      ['client.unhandled','unknown',false,'none','other'],
      ['client.unhandled','unknown',false,'none','other'],
      ['client.runtime','unknown',false,'none','range'],['client.runtime','unknown',false,'none','range']]);
    for(const event of errors){assert.deepEqual(Object.keys(event.context).sort(),['errorKind','errorSource']);assert.doesNotMatch(JSON.stringify(event),/chrome-extension|Load failed|play\(\)|plain string/);}
  }finally{detach();}
});

test('(i) a server without the page-error keys gets the error event stripped and resent; other detail is untouched',async()=>{
  const {createResearchTracker,attachResearchLifecycle}=await moduleReady;const accepted=[];let rejected=0;
  // The live school48-school53 server: knows the school48 extensions, not errorSource/errorKind.
  const knowsPageErrors=event=>!['errorSource','errorKind'].some(key=>Object.hasOwn(event.context||{},key));
  const f=fixture({fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body);
    if(!body.events.every(knowsPageErrors)){rejected++;return {ok:false,status:400,json:async()=>({error:'INVALID_EVENT'})};}
    validateBatch(body,actor);accepted.push(...body.events);return accept(body);}});
  const tracker=createResearchTracker(f.options),{scope,fire}=lifecycleScope(),detach=attachResearchLifecycle(tracker,scope);
  try{
    const listen=tracker.emit('playback_started',{activity:'listen',poemId:5,itemId:'p5.l0',context:{mediaRoute:'public',audioSource:'tts'},metrics:{latencyMs:90}});
    fire('error',{message:'Uncaught TypeError: x',filename:'webkit-masked-url://hidden/',error:new TypeError('x')});
    fire('unhandledrejection',{reason:new DOMException('x','AbortError')});
    const [runtime,unhandled]=stored(f).filter(e=>e.type==='error').sort((a,b)=>a.seq-b.seq);
    assert.deepEqual(runtime.context,{errorSource:'extension',errorKind:'type'});assert.deepEqual(unhandled.context,{errorSource:'none',errorKind:'abort'});
    for(let i=0;i<10&&tracker.status().pending;i++)await tracker.flush({force:true});
    assert(rejected>0);assert.equal(tracker.status().pending,0);assert.equal(tracker.status().held,0);assert.equal(tracker.status().lastStatus,'synced');
    const byId=new Map(accepted.map(e=>[e.eventId,e]));assert.equal(byId.size,4,'session_start, listen and both errors each arrive once');
    assert.equal(JSON.stringify(byId.get(runtime.eventId)),JSON.stringify({...runtime,context:undefined}));
    assert.equal(JSON.stringify(byId.get(unhandled.eventId)),JSON.stringify({...unhandled,context:undefined}));
    assert.deepEqual(byId.get(unhandled.eventId).error,{code:'aborted',retryable:false});
    assert.equal(JSON.stringify(byId.get(listen.eventId)),JSON.stringify(listen),'school48 detail on other events is kept');
  }finally{detach();}
});
