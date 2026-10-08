'use strict';
// school48 research instrumentation: optional browser process context, server-only outcome detail
// (providerWords/service/recognition/provenance) and the guarantee that none of it reaches teachers.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const blob=require('@vercel/blob');
const s=require('../api/_lib/research-store.cjs');
const auth=require('../api/_lib/school-auth.cjs');
const {outcomeFor}=require('../api/_lib/school-learning.cjs');
const {getPoem}=require('../api/_lib/poems.js');
const {buildPracticeSummary}=require('../api/_lib/teacher-practice-summary.cjs');
const now=Date.parse('2026-09-20T08:00:00.000Z'),f={from:'2026-09-20',to:'2026-09-20',attempt:'latest'};
const actor={id:'s_123456789012345678901234',researchId:'r_123456789012345678901234',role:'student',grade:2,cls:'A'};
const client=(changes={})=>({eventId:randomUUID(),sessionId:randomUUID(),seq:0,clientAt:new Date(now).toISOString(),activeMs:0,poemId:2,
 activity:'read',type:'feedback_shown',appVersion:'test-v1',contentVersion:'poem-2-v1',...changes});
const reading=(changes={})=>client({type:'provider_result',provider:'tencent-soe',model:'16k_zh',operation:'reading',providerVersion:'eval1-coeff1.5-edb20260919',...changes});
const writing=(changes={})=>client({activity:'writing',type:'provider_result',provider:'google-input-tools',model:'zh-hant-t-i0-handwrit',operation:'handwriting',providerVersion:'upstream-unversioned',...changes});
const label=value=>{try{return JSON.stringify(value)?.slice(0,300);}catch{return String(value);}};
const accepts=(event,server)=>assert.doesNotThrow(()=>s.validateEvent(event,server),label(event));
const rejects=(event,server)=>assert.throws(()=>s.validateEvent(event,server),error=>error instanceof s.ResearchError&&error.code==='INVALID_EVENT',label(event));
const ENUMS={mediaRoute:['public','local'],audioSource:['recitation','static','tts','recording'],
 audioTrigger:['poem-heading-audio','line-tts','word-tts','sentence-tts','practice-word','practice-sequence','practice-compare','report-line-tts','record-pending-play','replay','replay-all','chat-speak','challenge','other'],
 recorderFormat:['webm-opus','webm','mp4','ogg','default','other'],stopReason:['manual','time-limit'],uploadPath:['compact','pcm','pcm-fallback'],
 errorDetail:['mic-denied','mic-missing','mic-busy','unsupported','too-short','too-long','offline','network','timeout','busy','service','transcode','decode','incomplete','aborted','other'],
 inputMode:['typed','voice','suggestion'],pointer:['coarse','fine','none'],viewport:['small','medium','large'],pageLoad:['navigate','reload','back-forward','prerender','other']};
const NEW_METRICS={fallbackCount:10,mediaDurationMs:3600000,seekFromMs:3600000,stallCount:10000,selectionChanges:1000,firstResponseMs:600000,prepareMs:600000,pendingCount:100000,heldCount:100000};
const OLD_METRICS={elapsedMs:21600000,playbackMs:21600000,audioDurationMs:600000,playbackRate:4,strokeCount:10000,eraseCount:10000,hintCount:10000,userCharacters:20000,assistantCharacters:20000,
 latencyMs:600000,wordCount:1000,correctCount:1000,itemCount:1000,watchedMs:21600000,videoPositionMs:3600000,lostEventCount:1000000,accuracyScore:100,fluencyScore:100,completionScore:100,suggestedScore:100};

// (a) Optional process context and metrics: same rules for browser and server events.
test('optional process context accepts exactly its enums and ranges, from the browser and from the server',()=>{
 for(const server of [false,true]){const make=(changes={})=>(server?reading:client)(changes),context=value=>make({context:value});
  for(const [key,values] of Object.entries(ENUMS)){
   for(const value of values)accepts(context({[key]:value}),server);
   for(const value of ['','unknown',values[0].toUpperCase(),' '+values[0],1,true,null,[values[0]],{}])rejects(context({[key]:value}),server);
  }
  for(const [key,[min,max]] of Object.entries({lineIndex:[0,199],httpStatus:[400,599],deviceAccounts:[1,10]})){
   accepts(context({[key]:min}),server);accepts(context({[key]:max}),server);
   for(const value of [min-1,max+1,min+0.5,String(min),null,NaN,Infinity,true])rejects(context({[key]:value}),server);
  }
  for(const key of ['pinyinShown','resend']){accepts(context({[key]:true}),server);accepts(context({[key]:false}),server);for(const value of ['true',1,0,null])rejects(context({[key]:value}),server);}
  // No identifiers, raw sizes or free text ride along in context.
  for(const key of ['deviceId','userAgent','ip','screenWidth','lineText','transcript','errorMessage','providerWords'])rejects(context({[key]:'x'}),server);
  accepts(context({mode:'standard',position:0,total:4,lineIndex:0,pinyinShown:true,recorderFormat:'webm-opus',stopReason:'manual',uploadPath:'compact',resend:false,mediaRoute:'public',audioSource:'recording',audioTrigger:'record-pending-play'}),server);
  accepts(make({type:'error',error:{code:'provider_unavailable',retryable:true},context:{errorDetail:'service',httpStatus:503,inputMode:'voice'}}),server);
  accepts(make({type:'session_start',activity:'navigation',context:{pointer:'coarse',viewport:'small',pageLoad:'navigate',deviceAccounts:2},metrics:{latencyMs:300,pendingCount:3,heldCount:0}}),server);
  for(const [key,max] of Object.entries(NEW_METRICS)){
   for(const value of [0,max])accepts(make({metrics:{[key]:value}}),server);
   for(const value of [max+1,-1,1.5,NaN,Infinity,'1',null])rejects(make({metrics:{[key]:value}}),server);
  }
  for(const key of ['bytes','deviceMemory','screenWidth'])rejects(make({metrics:{[key]:1}}),server);
 }
 assert.deepEqual({...s.METRICS},{...OLD_METRICS,...NEW_METRICS},'existing metric bounds unchanged; only the new keys were added');
 for(const key of ['accuracyScore','fluencyScore','completionScore','suggestedScore'])rejects(client({metrics:{[key]:50}}),false);
});

// (b) Server-only detail.
const WORDS=[{i:0,r:0,a:69,f:0.93,b:0,e:300,ph:[{s:'l',a:60},{s:'v3',x:'u3',m:3}]},{i:1,m:1,a:40.5,b:300,e:350},{i:2,m:2,r:1,a:0},{i:4,r:2},{i:39}];
const SERVICE={relay:'hop-gz',audioPath:'pcm-gzip',textMode:1,audioMs:1200,prepareMs:2,connectMs:30,scoreMs:400,providerCode:-1};
const RECOGNITION={candidateCount:3,targetRank:2,topCandidate:'雨'};
const PROVENANCE={serverVersion:s.RESEARCH_SERVER_VERSION,termsVersion:'2026-09-30-v3'};
test('server-only outcome detail is never accepted from the browser',()=>{
 for(const [key,value] of Object.entries({providerWords:WORDS,service:SERVICE,recognition:RECOGNITION,provenance:PROVENANCE})){
  for(const event of [client({[key]:value}),reading({[key]:value}),writing({[key]:value})])rejects(event,false);
  assert.throws(()=>s.validateBatch({schemaVersion:1,batchId:randomUUID(),actorId:actor.id,events:[client({[key]:value})]},actor,now,'client'),error=>error.code==='INVALID_EVENT',key);
 }
 accepts(reading({providerWords:WORDS,service:SERVICE,provenance:PROVENANCE}),true);
 accepts(writing({recognition:RECOGNITION,service:{relay:'none'},provenance:{serverVersion:'x'}}),true);
 assert.match(s.RESEARCH_SERVER_VERSION,/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,63}$/);
 assert.deepEqual(s.RELAYS,['hk','gz','hop-hk','hop-gz','none']);assert.deepEqual(s.AUDIO_PATHS,['webm','ogg','mp4','m4a','aac','mp3','pcm','pcm-gzip']);
});
test('provider words: aligned positions, bounded values, phones only and never any text',()=>{
 const pw=providerWords=>reading({providerWords});
 const phone={s:'abcdefgh1',x:'abcdefgh2',m:4,a:99.99},full=index=>({i:index,r:index,a:99.99,f:99.99,b:600000,e:600000,ph:[phone,phone,phone,phone]});
 for(const list of [[{i:0}],[{i:39}],Array.from({length:40},(_,i)=>({i})),[{i:0,m:0,r:0}],[{i:0,a:0,f:100,b:0,e:0}],[{i:0,a:69.4,f:0.93}],[{i:0,m:4,r:199}],
  [{i:0,m:1},{i:1,r:0},{i:2,m:2,r:1}],[{i:0,ph:[{s:'zh'}]}],[{i:0,ph:[{s:'l'},{s:'i3',x:'i1'},{s:'v3',m:0,a:0},{s:'n',a:100}]}],[{i:0,b:5,e:5}],[0,1,2,3,4].map(full)])accepts(pw(list),true);
 assert.ok(Buffer.byteLength(s.canonical([0,1,2,3,4].map(full)))<=1500);
 const big=[0,1,2,3,4,5,6,7].map(full);assert.ok(Buffer.byteLength(s.canonical(big))>1500);rejects(pw(big),true);
 rejects(writing({providerWords:[{i:0}]}),true);rejects(reading({operation:'chat',providerWords:[{i:0}]}),true);
 for(const value of ['x',{},[],null,Array.from({length:41},(_,i)=>({i})),[null],[[0]],['李']])rejects(pw(value),true);
 for(const list of [[{i:0,w:'李'}],[{i:0,char:'李'}],[{i:0,text:'啊'}],[{r:0}],[{i:-1}],[{i:40}],[{i:1.5}],[{i:'0'}],[{i:1},{i:1}],[{i:2},{i:1}],
  [{i:0,m:5}],[{i:0,m:-1}],[{i:0,m:1.5}],[{i:0,m:1,r:0}],[{i:0,r:200}],[{i:0,r:-1}],[{i:0,r:1},{i:1,r:1}],[{i:0,r:2},{i:1,r:1}],
  [{i:0,a:100.01}],[{i:0,a:-0.01}],[{i:0,a:NaN}],[{i:0,a:'50'}],[{i:0,f:101}],[{i:0,f:-1}],[{i:0,b:600001}],[{i:0,b:-1}],[{i:0,b:1.5}],[{i:0,e:600001}],[{i:0,b:10,e:9}],
  [{i:0,m:1,ph:[{s:'a1'}]}],[{i:0,ph:[]}],[{i:0,ph:Array.from({length:5},()=>({s:'l'}))}],[{i:0,ph:'l'}],[{i:0,ph:[{s:'l',text:'李'}]}],[{i:0,ph:[{}]}],
  [{i:0,ph:[{s:'Zh'}]}],[{i:0,ph:[{s:'zh6'}]}],[{i:0,ph:[{s:'abcdefghi'}]}],[{i:0,ph:[{s:'ü3'}]}],[{i:0,ph:[{s:''}]}],[{i:0,ph:[{s:1}]}],
  [{i:0,ph:[{s:'l',x:''}]}],[{i:0,ph:[{s:'l',x:3}]}],[{i:0,ph:[{s:'l',m:5}]}],[{i:0,ph:[{s:'l',a:101}]}],[{i:0,ph:[{s:'l',a:NaN}]}],[{i:0,ph:[null]}]])rejects(pw(list),true);
});
test('service, recognition and provenance accept only their typed, identifier-free values',()=>{
 const service=value=>reading({service:value}),recognition=value=>writing({recognition:value}),provenance=value=>reading({provenance:value});
 for(const relay of s.RELAYS)accepts(service({relay}),true);for(const audioPath of s.AUDIO_PATHS)accepts(service({audioPath}),true);
 for(const value of [{textMode:0},{textMode:1},{audioMs:0,prepareMs:600000,connectMs:0,scoreMs:600000},{providerCode:-1},{providerCode:0},{providerCode:999999999},SERVICE])accepts(service(value),true);
 accepts(writing({service:{relay:'gz'}}),true);
 for(const value of [{},{message:'x'},{relay:'none',ip:'1.2.3.4'},{relay:'hk:8443'},{relay:'HK'},{relay:'direct'},{relay:null},{audioPath:'wav'},{audioPath:'PCM'},
  {textMode:2},{textMode:'1'},{textMode:true},...['audioMs','prepareMs','connectMs','scoreMs'].flatMap(key=>[-1,600001,1.5,'1'].map(value=>({[key]:value}))),
  {providerCode:-2},{providerCode:1000000000},{providerCode:'4002'},{providerCode:1.5},'hk',[],null])rejects(service(value),true);
 for(const value of [{candidateCount:0,targetRank:0},{candidateCount:20,targetRank:20},{candidateCount:1,targetRank:0},RECOGNITION])accepts(recognition(value),true);
 rejects(reading({recognition:RECOGNITION}),true);
 for(const value of [{targetRank:0},{candidateCount:0},{candidateCount:21,targetRank:0},{candidateCount:-1,targetRank:0},{candidateCount:1.5,targetRank:0},{candidateCount:3,targetRank:21},
  {candidateCount:2,targetRank:3},{candidateCount:3,targetRank:-1},{candidateCount:3,targetRank:1,topCandidate:'雨水'},{candidateCount:3,targetRank:1,topCandidate:'a'},
  {candidateCount:3,targetRank:1,topCandidate:''},{candidateCount:3,targetRank:1,topCandidate:7},{candidateCount:3,targetRank:1,topCandidate:'豈'},
  {candidateCount:3,targetRank:1,candidates:['雨']},'x',null])rejects(recognition(value),true);
 for(const value of [{serverVersion:s.RESEARCH_SERVER_VERSION},{serverVersion:'x',termsVersion:'2026-09-21-v2'},PROVENANCE,{serverVersion:'x',termsVersion:'2026-09-30-v999'}])accepts(provenance(value),true);
 for(const value of [{},{termsVersion:'2026-09-30-v3'},{serverVersion:''},{serverVersion:'has space'},{serverVersion:'x'.repeat(65)},{serverVersion:'x',termsVersion:'2026-09-30'},
  {serverVersion:'x',termsVersion:'2026-09-30-v1000'},{serverVersion:'x',termsVersion:'v3'},{serverVersion:'x',termsVersion:7},{serverVersion:'x',termsVersion:null},{serverVersion:'x',ip:'1.2.3.4'},'x'])rejects(provenance(value),true);
});

// (c) Rows written before school48 still hash exactly as before (values computed with the pre-change store).
test('pre-school48 rows keep their canonical form, event checksums and batch checksums',()=>{
 const legacyClient={eventId:'11111111-1111-4111-8111-111111111111',sessionId:'22222222-2222-4222-8222-222222222222',seq:3,clientAt:'2026-09-20T07:59:00.000Z',activeMs:1200,poemId:2,
  activity:'read',type:'feedback_shown',appVersion:'test-v1',contentVersion:'poem-2-v1',attemptId:'33333333-3333-4333-8333-333333333333',itemId:'p2.l0',
  result:{status:'completed',score:80,correct:null},metrics:{latencyMs:900,elapsedMs:3000},context:{mode:'standard',position:0,total:4}};
 const legacyServer={eventId:'44444444-4444-4444-8444-444444444444',sessionId:'22222222-2222-4222-8222-222222222222',seq:0,clientAt:'2026-09-20T07:59:01.000Z',activeMs:0,poemId:2,
  activity:'read',type:'provider_result',appVersion:'test-v1',contentVersion:'poem-2-v1',attemptId:'33333333-3333-4333-8333-333333333333',itemId:'p2.l0',
  provider:'tencent-soe',model:'16k_zh',operation:'reading',providerVersion:'eval1-coeff1.5-edb20260919',
  result:{status:'completed',score:72.5,correct:null},metrics:{latencyMs:10,accuracyScore:72.5,fluencyScore:86,completionScore:100,suggestedScore:72.5,wordCount:1},
  wordScores:[{index:0,char:'李',score:70,pronunciationScore:70}]};
 const a=s.validateBatch({schemaVersion:1,batchId:'55555555-5555-4555-8555-555555555555',actorId:actor.id,events:[legacyClient]},actor,now,'client');
 const b=s.validateBatch({schemaVersion:1,batchId:'66666666-6666-4666-8666-666666666666',actorId:actor.id,events:[legacyServer]},actor,now,'server_verified');
 assert.equal(s.canonical(a.events[0].event),'{"activeMs":1200,"activity":"read","appVersion":"test-v1","attemptId":"33333333-3333-4333-8333-333333333333","clientAt":"2026-09-20T07:59:00.000Z","contentVersion":"poem-2-v1","context":{"mode":"standard","position":0,"total":4},"eventId":"11111111-1111-4111-8111-111111111111","itemId":"p2.l0","metrics":{"elapsedMs":3000,"latencyMs":900},"poemId":2,"result":{"correct":null,"score":80,"status":"completed"},"seq":3,"sessionId":"22222222-2222-4222-8222-222222222222","type":"feedback_shown"}');
 assert.equal(s.canonical(b.events[0].event),'{"activeMs":0,"activity":"read","appVersion":"test-v1","attemptId":"33333333-3333-4333-8333-333333333333","clientAt":"2026-09-20T07:59:01.000Z","contentVersion":"poem-2-v1","eventId":"44444444-4444-4444-8444-444444444444","itemId":"p2.l0","metrics":{"accuracyScore":72.5,"completionScore":100,"fluencyScore":86,"latencyMs":10,"suggestedScore":72.5,"wordCount":1},"model":"16k_zh","operation":"reading","poemId":2,"provider":"tencent-soe","providerVersion":"eval1-coeff1.5-edb20260919","result":{"correct":null,"score":72.5,"status":"completed"},"seq":0,"sessionId":"22222222-2222-4222-8222-222222222222","type":"provider_result","wordScores":[{"char":"李","index":0,"pronunciationScore":70,"score":70}]}');
 assert.equal(a.events[0].eventChecksum,'ca7964ea4421d07b99ca7c4a4f98f284d908170cf18ca4ea4c4a531c60444c78');
 assert.equal(a.checksum,'50c40abcf80b27eb1732509e3df91ed9ed9f441c1297ccf50eb2e5ccb5ddb079');
 assert.equal(b.events[0].eventChecksum,'29f6a7756db56e340109063c25207c8d82669e9b565f34c5cd4b057e85a5db03');
 assert.equal(b.checksum,'c688196e819138e6104b105e8766697e4cc643fe547b3ead84c47fa43261b81c');
 for(const batch of [a,b]){const stored=JSON.parse(s.canonical(batch));assert.deepEqual(s.verifyStoredBatch(stored),stored);}
});

// (d) recordVerifiedOutcome end to end against an in-memory private Blob outbox.
const SESSION='22222222-2222-4222-8222-222222222222',ATTEMPT='33333333-3333-4333-8333-333333333333',poem=getPoem(2),line=poem.lines[0];
const PAYLOAD={SuggestedScore:72.5,PronAccuracy:72.5,PronFluency:86,PronCompletion:100,Words:[{Word:'李',PronAccuracy:70,MatchTag:0,MemBeginTime:0,MemEndTime:300,PhoneInfos:[{Phone:'l',PronAccuracy:60}]}]};
const EXTRAS={relay:'hop-gz',service:{audioPath:'pcm-gzip',textMode:0,audioMs:1200,prepareMs:2,connectMs:30,scoreMs:400},
 rawWords:[{word:'李',pron_accuracy:70.4,pron_fluency:0.93,match_tag:0,begin_time:0,end_time:300,phone_infos:[{phone:'l',pron_accuracy:60}]},{word:'啊',match_tag:1,pron_accuracy:30},{word:'白',pron_accuracy:80}]};
const CORE_KEYS=['activeMs','activity','appVersion','attemptId','clientAt','context','contentVersion','eventId','itemId','metrics','model','operation','poemId','provider','providerVersion','result','seq','sessionId','type','wordScores'].sort();
const requestFor=(activity='read',itemId='p2.l0',extra={},context={mode:'standard',position:0,total:4})=>({method:'POST',headers:{},body:{poemId:2,researchContext:{actorId:actor.id,sessionId:SESSION,attemptId:ATTEMPT,itemId,poemId:2,activity,appVersion:'test-v1',contentVersion:'poem-2-v1',context,...extra}}});
function outbox(t,{terms=async()=>'2026-09-30-v3'}={}){
 const saved={RESEARCH_ENABLED:process.env.RESEARCH_ENABLED,STUDENT_STORE:process.env.STUDENT_STORE};
 process.env.RESEARCH_ENABLED='1';process.env.STUDENT_STORE='blob';
 t.after(()=>{for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;});
 const objects=new Map();
 t.mock.method(blob,'put',async(path,body,options)=>{assert.equal(options.access,'private');if(objects.has(path)&&!options.allowOverwrite)throw new Error('already exists');objects.set(path,body);return {pathname:path};});
 t.mock.method(blob,'get',async path=>{if(!objects.has(path))return null;const bytes=Buffer.from(objects.get(path));return {statusCode:200,blob:{size:bytes.length},stream:new ReadableStream({start(c){c.enqueue(bytes);c.close();}})};});
 t.mock.method(auth,'requireActor',async()=>actor);
 if(terms===null){const original=Object.getOwnPropertyDescriptor(auth,'sessionTermsVersion');delete auth.sessionTermsVersion;t.after(()=>Object.defineProperty(auth,'sessionTermsVersion',original));}
 else t.mock.method(auth,'sessionTermsVersion',terms);
 return {objects,rows:()=>[...objects.entries()].filter(([path])=>path.includes('/outbox/')).map(([,body])=>s.verifyStoredBatch(JSON.parse(body))).flatMap(batch=>batch.events)};
}
test('verified outcomes carry provider detail and provenance end to end and stay verifiable',async t=>{
 const store=outbox(t);
 const read=outcomeFor('reading',PAYLOAD,200,{poem,line},10,undefined,EXTRAS);
 const saved=await s.recordVerifiedOutcome(requestFor(),read);assert.equal(saved.recorded,true);
 let rows=store.rows();assert.equal(rows.length,1);const [row]=rows;
 assert.equal(row.source,'server_verified');assert.equal(row.event.eventId,saved.eventId);
 assert.deepEqual(row.event.providerWords,[{i:0,r:0,a:70,f:0.93,b:0,e:300,ph:[{s:'l',a:60}]},{i:1,m:1,a:30},{i:2,r:1,a:80}]);
 assert.deepEqual(row.event.service,{relay:'hop-gz',audioPath:'pcm-gzip',textMode:0,audioMs:1200,prepareMs:2,connectMs:30,scoreMs:400});
 assert.deepEqual(row.event.provenance,{serverVersion:s.RESEARCH_SERVER_VERSION,termsVersion:'2026-09-30-v3'});
 for(const key of ['result','metrics','wordScores'])assert.deepEqual(row.event[key],JSON.parse(JSON.stringify(read[key])),key);
 assert.equal(row.event.recognition,undefined);assert.deepEqual(Object.keys(row.event).sort(),[...CORE_KEYS,'provenance','providerWords','service'].sort());
 assert.doesNotMatch(JSON.stringify(row.event.providerWords),/\p{Script=Han}/u);
 // Handwriting: rank detail and stroke count; the verdict is the one the pupil saw.
 const hand=outcomeFor('handwriting',{candidates:['雨','霑','露']},200,{item:{target:{char:'霑',accept:['霑','沾']}},strokes:15},1,undefined,{relay:'hk'});
 assert.equal((await s.recordVerifiedOutcome(requestFor('writing','p2.d1',{},{mode:'standard',itemType:'dictation'}),hand)).recorded,true);
 rows=store.rows();const written=rows.find(r=>r.event.operation==='handwriting').event;
 assert.deepEqual(written.recognition,{candidateCount:3,targetRank:2,topCandidate:'雨'});assert.equal(written.metrics.strokeCount,15);
 assert.deepEqual(written.service,{relay:'hk'});assert.deepEqual(written.result,{status:'correct',score:100,correct:true});assert.equal(written.provenance.termsVersion,'2026-09-30-v3');
 // A provider failure keeps the numeric code only.
 const failed=outcomeFor('reading',{error:'synthetic provider text'},502,{poem,line},10,undefined,{relay:'gz',service:{audioPath:'pcm',textMode:0,prepareMs:1,providerCode:4002}});
 assert.equal((await s.recordVerifiedOutcome(requestFor(),failed)).recorded,true);
 const error=store.rows().find(r=>r.event.result.status==='error').event;
 assert.deepEqual(error.service,{relay:'gz',audioPath:'pcm',textMode:0,prepareMs:1,providerCode:4002});assert.deepEqual(error.error,{code:'provider_unavailable',retryable:true});
 assert.equal(error.providerWords,undefined);assert.doesNotMatch(JSON.stringify(store.rows()),/synthetic provider text/);
 assert.equal(store.rows().length,3);
});
test('stable challenge receipts keep their exact pre-school48 shape and never read the session terms',async t=>{
 let calls=0;const store=outbox(t,{terms:async()=>{calls++;return '2026-09-30-v3';}});
 const eventId=s.stableOutcomeId(actor.id,randomUUID()),clientAt=new Date(Date.now()-60000).toISOString();
 const request=()=>requestFor('challenge','p2.s1',{},{mode:'standard',itemType:'sound'});
 const core={eventId,clientAt,stableBatch:true,provider:'aiducation',model:'curriculum-answer-key',operation:'challenge',providerVersion:'challenge-v1-20260919d',result:{status:'correct',score:100,correct:true},response:{choiceId:'a'}};
 assert.equal((await s.recordVerifiedOutcome(request(),core)).recorded,true);
 const [row]=store.rows();
 assert.deepEqual(row.event,{eventId,sessionId:SESSION,seq:0,clientAt,activeMs:0,poemId:2,activity:'challenge',type:'provider_result',appVersion:'test-v1',contentVersion:'poem-2-v1',
  provider:'aiducation',model:'curriculum-answer-key',operation:'challenge',providerVersion:'challenge-v1-20260919d',attemptId:ATTEMPT,itemId:'p2.s1',
  result:{status:'correct',score:100,correct:true},context:{mode:'standard',itemType:'sound'},response:{choiceId:'a'}});
 const intents=()=>[...store.objects.keys()].filter(path=>path.includes('/requests/'));assert.equal(intents().length,1);assert.equal(store.rows().length,1);
 // Detail offered with a retry is ignored, so the retry hashes identically and is acknowledged as the same receipt.
 const retry=await s.recordVerifiedOutcome(request(),{...core,providerWords:[{i:0}],service:{relay:'hk'},recognition:{candidateCount:0,targetRank:0},provenance:{serverVersion:'x'}});
 assert.equal(retry.recorded,true);assert.equal(intents().length,1);assert.ok(store.rows().every(stored=>stored.eventChecksum===row.eventChecksum&&stored.event.provenance===undefined));
 assert.equal(calls,0);
});
test('provenance records the accepted terms version only when the session provides a valid one',async t=>{
 for(const [name,terms,expected] of [['v2',async()=>'2026-09-21-v2',{termsVersion:'2026-09-21-v2'}],['null',async()=>null,{}],['forged',async()=>'forged',{}],['number',async()=>7,{}],
  ['object',async()=>({version:'2026-09-30-v3'}),{}],['rejects',async()=>{throw new Error('store down');},{}],['throws',()=>{throw new Error('sync');},{}],['missing',null,{}]]){
  await t.test(name,async st=>{
   const store=outbox(st,{terms});
   assert.equal((await s.recordVerifiedOutcome(requestFor(),outcomeFor('reading',PAYLOAD,200,{poem,line},10))).recorded,true);
   const [row]=store.rows();assert.deepEqual(row.event.provenance,{serverVersion:s.RESEARCH_SERVER_VERSION,...expected});
   assert.equal(row.event.result.score,72.5);
  });
 }
 assert.equal(typeof auth.sessionTermsVersion,'function','restored after the missing case');
});
test('detail in the browser research context is ignored; invalid detail is dropped without losing the outcome',async t=>{
 const store=outbox(t);
 const forged=requestFor('read','p2.l0',{providerWords:[{i:0,r:0,a:100}],service:{relay:'hk'},recognition:{candidateCount:1,targetRank:1},provenance:{serverVersion:'forged'}});
 assert.equal((await s.recordVerifiedOutcome(forged,outcomeFor('reading',{SuggestedScore:50},200,{poem,line},10))).recorded,true);
 let event=store.rows()[0].event;
 for(const key of ['providerWords','service','recognition'])assert.equal(event[key],undefined,key);
 assert.deepEqual(event.provenance,{serverVersion:s.RESEARCH_SERVER_VERSION,termsVersion:'2026-09-30-v3'});
 const valid=outcomeFor('reading',PAYLOAD,200,{poem,line},10,undefined,EXTRAS);
 for(const broken of [{providerWords:[{i:0,w:'李'}]},{service:{relay:'hk:8443'}},{recognition:{candidateCount:1,targetRank:1}},{providerWords:[{i:0,a:101}],service:{message:'x'}}]){
  const before=store.rows().length;
  const saved=await s.recordVerifiedOutcome(requestFor(),{...valid,...broken});assert.equal(saved.recorded,true,label(broken));
  event=store.rows().find(r=>r.event.eventId===saved.eventId).event;assert.equal(store.rows().length,before+1);
  assert.deepEqual(Object.keys(event).sort(),CORE_KEYS,'all optional detail is dropped together; the core event is unchanged');
  for(const key of ['result','metrics','wordScores'])assert.deepEqual(event[key],JSON.parse(JSON.stringify(valid[key])));
 }
 const before=store.objects.size;
 for(const broken of [{result:{status:'bogus'}},{result:{status:'bogus'},providerWords:[{i:0,w:'李'}]},{metrics:{latencyMs:-1}}]){
  assert.deepEqual(await s.recordVerifiedOutcome(requestFor(),{...valid,...broken}),{recorded:false,reason:'INVALID_EVENT',invalidRequest:true});
 }
 assert.equal(store.objects.size,before,'an invalid core event never reaches storage');
});

// (h) Teacher invisibility and (i) stored-row verification.
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function cohort(extended){
 const A1=id(101),A2=id(102),S1=id(100),at=n=>new Date(now-600000+n*1000).toISOString();
 const base=(n,changes)=>({eventId:id(n),sessionId:S1,seq:0,clientAt:at(n),activeMs:0,poemId:2,appVersion:'test-v1',contentVersion:'poem-2-v1',...changes});
 const server=(n,changes)=>base(n,{type:'provider_result',...changes});
 const items=[
  ['client',base(1,{seq:0,activity:'navigation',type:'session_start',metrics:{latencyMs:300}}),{context:{pointer:'coarse',viewport:'small',pageLoad:'navigate',deviceAccounts:2},metrics:{pendingCount:3,heldCount:1}}],
  ['client',base(2,{seq:1,activeMs:1000,activity:'listen',type:'playback_started',metrics:{latencyMs:200}}),{context:{mediaRoute:'public',audioSource:'recitation',audioTrigger:'poem-heading-audio',lineIndex:0},metrics:{mediaDurationMs:42000,stallCount:1,seekFromMs:0,fallbackCount:1}}],
  ['client',base(3,{seq:2,activeMs:2000,activity:'read',type:'recording_started',attemptId:A1,itemId:'p2.l0'}),{context:{recorderFormat:'webm-opus',lineIndex:0,pinyinShown:true}}],
  ['client',base(4,{seq:3,activeMs:4000,activity:'read',type:'recording_stopped',attemptId:A1,itemId:'p2.l0'}),{context:{stopReason:'manual'}}],
  ['client',base(5,{seq:4,activeMs:5000,activity:'read',type:'feedback_shown',attemptId:A1,itemId:'p2.l0',result:{status:'completed',score:80,correct:null},metrics:{latencyMs:900},context:{mode:'standard',position:0,total:4}}),{context:{uploadPath:'compact',resend:false,lineIndex:0},metrics:{prepareMs:12}}],
  ['server_verified',server(6,{activity:'read',attemptId:A1,itemId:'p2.l0',provider:'tencent-soe',model:'16k_zh',operation:'reading',providerVersion:'eval1-coeff1.5-edb20260919',context:{mode:'standard',position:0,total:4},
   result:{status:'completed',score:72.5,correct:null},metrics:{latencyMs:10,accuracyScore:72.5,wordCount:1},wordScores:[{index:0,char:'李',score:70,pronunciationScore:70}]}),
   {providerWords:[{i:0,r:0,a:70,b:0,e:300,ph:[{s:'l',a:60}]},{i:1,m:1,a:30}],service:SERVICE,provenance:PROVENANCE}],
  ['client',base(7,{seq:5,activeMs:6000,activity:'challenge',type:'answer_submitted',attemptId:A2,itemId:'p2.s1',context:{mode:'standard',itemType:'sound',position:0,total:2},result:{status:'correct',score:100,correct:true},response:{choiceId:'a'}}),
   {context:{audioTrigger:'challenge',audioSource:'static',mediaRoute:'local'},metrics:{selectionChanges:2}}],
  ['server_verified',server(8,{activity:'challenge',attemptId:A2,itemId:'p2.s1',provider:'aiducation',model:'curriculum-answer-key',operation:'challenge',providerVersion:'challenge-v1-20260919d',
   context:{mode:'standard',itemType:'sound',position:0,total:2},result:{status:'correct',score:100,correct:true},response:{choiceId:'a'}}),{}],
  ['client',base(9,{seq:6,activeMs:7000,activity:'writing',type:'answer_submitted',attemptId:A2,itemId:'p2.d1',context:{mode:'standard',itemType:'dictation',position:1,total:2},result:{status:'correct',score:100,correct:true}}),{metrics:{selectionChanges:0}}],
  ['server_verified',server(10,{activity:'writing',attemptId:A2,itemId:'p2.d1',provider:'google-input-tools',model:'zh-hant-t-i0-handwrit',operation:'handwriting',providerVersion:'upstream-unversioned',
   context:{mode:'standard',itemType:'dictation',position:1,total:2},result:{status:'correct',score:100,correct:true},metrics:{latencyMs:20}}),{metrics:{strokeCount:15},recognition:RECOGNITION,service:{relay:'hk'},provenance:PROVENANCE}],
  ['client',base(11,{seq:7,activeMs:8000,activity:'chat',type:'error',error:{code:'provider_unavailable',retryable:true}}),{context:{inputMode:'voice',errorDetail:'service',httpStatus:503}}],
  ['client',base(12,{seq:8,activeMs:9000,activity:'chat',type:'activity_end',result:{status:'completed'}}),{metrics:{firstResponseMs:1500}}]];
 return items.map(([source,event,extra],index)=>{
  const value=extended?{...event,...extra,...(extra.context?{context:{...event.context,...extra.context}}:{}),...(extra.metrics?{metrics:{...event.metrics,...extra.metrics}}:{})}:event;
  return s.validateBatch({schemaVersion:1,batchId:id(200+index),actorId:actor.id,events:[value]},actor,now,source).events[0];
 });
}
test('teacher summaries, practice summaries and the CSV export are identical with and without the school48 fields',()=>{
 const plain=cohort(false),extended=cohort(true),options={generatedAt:'2026-09-20T09:00:00.000Z',includeStudentDetails:true};
 assert.equal(extended.filter(row=>row.event.providerWords||row.event.recognition||row.event.context?.deviceAccounts).length,3);
 for(const filters of [f,{...f,student:actor.researchId},{...f,poemId:2,cls:'A'},{...f,attempt:'first'}])
  assert.deepEqual(s.aggregateEvents(extended,filters,options),s.aggregateEvents(plain,filters,options),label(filters));
 const aggregate=s.aggregateEvents(plain,{...f,student:actor.researchId},options);
 assert.match(JSON.stringify(aggregate),/reading\.pronunciation/);assert.ok(aggregate.practiceSummary,'student detail includes a practice summary');
 const summary=buildPracticeSummary(plain);assert.ok(summary);assert.deepEqual(buildPracticeSummary(extended),summary);
 const csv=s.exportRows(plain,f,{format:'csv'}),wide=s.exportRows(extended,f,{format:'csv'});
 assert.equal(wide.content,csv.content);assert.deepEqual(wide.manifest.columns,csv.manifest.columns);
 // The research JSONL is where the new fields live; content hashes change with the content, as for any new row.
 const jsonl=s.exportRows(extended,f).content;for(const key of ['providerWords','recognition','provenance','service','deviceAccounts','pendingCount'])assert.ok(jsonl.includes(`"${key}"`),key);
 assert.doesNotMatch(s.exportRows(plain,f).content,/providerWords|deviceAccounts/);
 assert.notEqual(extended[5].eventChecksum,plain[5].eventChecksum);assert.equal(extended[7].eventChecksum,plain[7].eventChecksum,'stable receipts are untouched');
});
test('stored batches with the new fields verify, and tampering or smuggled detail is detected',()=>{
 const rows=cohort(true);
 const sign=batch=>{const {checksum,...unsigned}=batch;return {...unsigned,checksum:s.hash(s.canonical(unsigned))};};
 const batch=sign({schemaVersion:1,batchId:id(300),serverReceivedAt:rows[0].serverReceivedAt,events:rows});
 const copy=()=>JSON.parse(s.canonical(batch));
 assert.deepEqual(s.verifyStoredBatch(copy()),copy());
 const tampered=copy();tampered.events[5].event.providerWords[0].a=99;
 assert.throws(()=>s.verifyStoredBatch(tampered),error=>error.code==='BATCH_CHECKSUM');
 assert.throws(()=>s.verifyStoredBatch(sign(tampered)),error=>error.code==='EVENT_CHECKSUM');
 const reseal=(mutate)=>{const value=copy();mutate(value.events);for(const row of value.events)row.eventChecksum=s.hash(s.canonical({researchId:row.researchId,source:row.source,event:row.event}));return sign(value);};
 assert.doesNotThrow(()=>s.verifyStoredBatch(reseal(()=>{})));
 for(const mutate of [events=>{events[5].event.service.relay='hk:8443';},events=>{events[9].event.recognition.topCandidate='雨水';},events=>{events[5].event.provenance.termsVersion='forged';},
  events=>{events[4].event.providerWords=[{i:0}];},events=>{events[0].event.context.deviceAccounts=11;},events=>{events[1].event.metrics.stallCount=10001;},
  events=>{events[5].event.providerWords[0].text='李';}])
  assert.throws(()=>s.verifyStoredBatch(reseal(mutate)),error=>error.code==='INVALID_EVENT');
});
