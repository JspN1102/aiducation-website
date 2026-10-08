'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const auth=require('../api/_lib/school-auth.cjs');
const research=require('../api/_lib/research-store.cjs');
const {getPoem}=require('../api/_lib/poems.js');
const {outcomeFor,referenceFor,withSchoolLearning}=require('../api/_lib/school-learning.cjs');
const challenge=require('../api/challenge-result.js');
const loader=require('../api/_lib/challenge-loader.cjs');
const actor={id:'s_'+'a'.repeat(24),grade:2,role:'student'};
function response(){return {statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}
test('unmeasured and real zero remain different; report generation is never a verified score',()=>{
 const poem=getPoem(1),reference={poem,line:poem.lines[0]};
 const empty=outcomeFor('reading',{},200,reference,10);assert.equal(empty.result.score,null);assert.equal(empty.result.status,'unmeasured');
 assert.equal(outcomeFor('reading',{SuggestedScore:0},200,reference,10).result.score,0);
 const detailed=outcomeFor('reading',{SuggestedScore:0,PronAccuracy:72.5,PronFluency:86,PronCompletion:100},200,reference,10);
 assert.deepEqual(detailed.metrics,{latencyMs:10,accuracyScore:72.5,fluencyScore:86,completionScore:100,suggestedScore:0,wordCount:0});
 assert.equal(Object.hasOwn(empty.metrics,'accuracyScore'),false);
 assert.equal(outcomeFor('report',{total_score:100,report:'Advice'},200,{poem},10).result.score,null);
 assert.equal(outcomeFor('reading',{},504,reference,10).result.status,'error');
});
test('dictation scores the first candidate, preserving no-recognition as missing',()=>{
 const reference={item:{target:{char:'雨',accept:[]}}};
 assert.equal(outcomeFor('handwriting',{candidates:['魚','雨']},200,reference,1).result.correct,false);
 assert.equal(outcomeFor('handwriting',{candidates:[]},200,reference,1).result.score,null);
 assert.equal(outcomeFor('handwriting',{candidates:['雨']},200,reference,1).result.score,100);
});
test('a component outranking the whole character counts only when the whole character was drawn',async()=>{
 const whole={item:{target:{char:'霑',accept:['霑','沾']}},strokes:15};
 assert.equal(outcomeFor('handwriting',{candidates:['雨','霑']},200,whole,1).result.correct,true);
 assert.equal(outcomeFor('handwriting',{candidates:['雨','霑']},200,{...whole,strokes:9},1).result.correct,false);
 assert.equal(outcomeFor('handwriting',{candidates:['雨','霈','露','霑']},200,whole,1).result.correct,false);
 assert.equal(outcomeFor('handwriting',{candidates:['借','惜']},200,{item:{target:{char:'惜',accept:['惜']}},strokes:11},1).result.correct,false);
 assert.equal(outcomeFor('handwriting',{candidates:['日','白']},200,{item:{target:{char:'白',accept:['白']}},strokes:5},1).result.correct,false);
 const {CHALLENGE_SETS}=await loader.load();
 const poem=[1,2,3,4,5,6].map(id=>getPoem(id)).find(p=>(CHALLENGE_SETS[p.slug]?.bank||CHALLENGE_SETS[p.slug]?.items||[]).some(i=>i.type==='dictation'));
 const item=(CHALLENGE_SETS[poem.slug].bank||CHALLENGE_SETS[poem.slug].items).find(i=>i.type==='dictation');
 const req={body:{ink:[[[1,2],[3,4],[0,9]],[[5],[6],[20]]],poemId:poem.id,researchContext:{poemId:poem.id,itemId:item.id}}};
 assert.equal((await referenceFor(req,'handwriting')).strokes,2);
});
test('reading reference must match the canonical poem and exact line',async()=>{
 const p=getPoem(2),req={body:{researchContext:{poemId:2,itemId:'p2.l0'},refText:p.lines[0].simplified}};
 assert.equal((await referenceFor(req,'reading')).line,p.lines[0]);assert.equal(req.body.researchContext.activity,'read');
 req.body.refText='unrelated';await assert.rejects(referenceFor(req,'reading'),e=>e.status===400);
});

test('every learning provider rejects another grade before a paid call, even without research context or with forged capabilities',async t=>{
 t.mock.method(auth,'enabled',()=>true);t.mock.method(auth,'requireActor',async()=>actor);let calls=0;
 for(const operation of ['reading','handwriting','chat','report']){
  const handler=withSchoolLearning(operation,async()=>calls++);
  for(const includeContext of [false,true]){
   const res=response(),body={poemId:6,refText:getPoem(6).lines[0].simplified,isTest:true,learningScope:'all-grades',grade:6,...includeContext?{researchContext:{actorId:actor.id,poemId:6,itemId:'p6.l0'}}:{}};
   await handler({method:'POST',body},res);assert.equal(res.statusCode,422);assert.equal(res.body.code,'POEM_GRADE_FORBIDDEN');assert.equal(res.body.retryable,false);
  }
 }
 assert.equal(calls,0);
 const res=response();await withSchoolLearning('reading',async()=>calls++)({method:'POST',body:{poemId:2,refText:getPoem(6).lines[0].simplified}},res);assert.equal(res.statusCode,400);assert.equal(calls,0);
});

test('teacher and explicitly stored all-grade test accounts can study all poems without research calls',async t=>{
 t.mock.method(auth,'enabled',()=>true);let learner;
 t.mock.method(auth,'requireActor',async()=>learner);t.mock.method(research,'recordVerifiedOutcome',async()=>assert.fail('practice-only identity reached research'));
 for(const person of [{...actor,isTest:true,learningScope:'all-grades'},{...actor,role:'teacher',grade:null,cls:null}]){
  learner=person;
  for(let poemId=1;poemId<=6;poemId++){
   const res=response();await withSchoolLearning('chat',async(req,res)=>{assert.equal(req.body.grade,poemId);return res.json({reply:'practice'});})({method:'POST',body:{poemId,grade:1,researchContext:{actorId:person.id,poemId}}},res);
   assert.equal(res.statusCode,200);assert.equal(res.body.reply,'practice');
  }
 }
});

test('challenge submission denies cross-grade students and grades teacher/test answers without research storage',async t=>{
 t.mock.method(auth,'enabled',()=>true);let learner=actor;
 t.mock.method(auth,'requireActor',async()=>learner);t.mock.method(research,'recordVerifiedOutcome',async()=>assert.fail('wrong-grade or practice-only result reached research'));
 const {CHALLENGE_SETS}=await loader.load(),item=CHALLENGE_SETS[getPoem(6).slug].bank.find(i=>i.type==='sound');
 const body={poemId:6,itemId:item.id,status:'correct',response:{choiceId:item.answerId},researchContext:{actorId:actor.id,poemId:6,itemId:item.id}};
 const denied=response();await challenge({method:'POST',body:structuredClone(body)},denied);assert.equal(denied.statusCode,422);
 for(const person of [{...actor,isTest:true,learningScope:'all-grades'},{...actor,role:'teacher',grade:null}]){learner=person;const res=response();await challenge({method:'POST',body:structuredClone(body)},res);assert.equal(res.statusCode,200);assert.equal(res.body.researchExcluded,true);assert.equal(res.body.researchRecorded,false);assert.equal(res.body.result.correct,true);}
});
test('poems 7-12 reach providers and challenge grading only for the two preview teachers',async t=>{
 t.mock.method(auth,'enabled',()=>true);let learner;
 t.mock.method(auth,'requireActor',async()=>learner);t.mock.method(research,'recordVerifiedOutcome',async()=>assert.fail('preview practice reached research'));
 const {CHALLENGE_SETS}=await loader.load(),teacher={id:'t_'+'b'.repeat(24),role:'teacher',login:'molly',grade:null,cls:null};
 const preview={...teacher,previewPoems:true},others=[{...teacher,login:'teacher2'},{...actor,isTest:true,learningScope:'all-grades',login:'jasper'},actor];
 let calls=0;
 for(let poemId=7;poemId<=12;poemId++){
  const poem=getPoem(poemId),item=CHALLENGE_SETS[poem.slug].bank.find(i=>i.type==='sound');
  const requests=[['chat',{poemId,grade:1}],['reading',{poemId,refText:poem.lines.at(-1).simplified}]];
  const answer=person=>({poemId,itemId:item.id,status:'correct',response:{choiceId:item.answerId},researchContext:{actorId:person.id,poemId,itemId:item.id}});
  learner=preview;
  for(const [operation,body] of requests){const res=response();await withSchoolLearning(operation,async(req,res)=>{calls++;return res.json({ok:true});})({method:'POST',body:structuredClone(body)},res);assert.equal(res.statusCode,200,operation+' '+poemId);}
  const graded=response();await challenge({method:'POST',body:answer(preview)},graded);assert.equal(graded.statusCode,200);assert.equal(graded.body.result.correct,true);
  for(const person of others){
   learner=person;
   for(const [operation,body] of requests){const res=response();await withSchoolLearning(operation,async()=>assert.fail('provider called for '+person.login))({method:'POST',body:structuredClone(body)},res);assert.equal(res.statusCode,422);assert.equal(res.body.code,'POEM_GRADE_FORBIDDEN');}
   const denied=response();await challenge({method:'POST',body:answer(person)},denied);assert.equal(denied.statusCode,422);
  }
 }
 assert.equal(calls,12);
});
test('provider response awaits durable recording, enforces school grade and binds actor',async t=>{
 t.mock.method(auth,'enabled',()=>true);t.mock.method(auth,'requireActor',async()=>actor);
 let recorded=false;
 t.mock.method(research,'recordVerifiedOutcome',async()=>{await new Promise(resolve=>setTimeout(resolve,10));recorded=true;return {recorded:true};});
 const handler=withSchoolLearning('chat',async(req,res)=>{assert.equal(req.body.grade,2);res.json({reply:'Test'});});
 const req={method:'POST',body:{grade:6,researchContext:{actorId:actor.id,poemId:2}}},res=response();await handler(req,res);
 assert(recorded);assert.equal(res.body.researchRecorded,true);
 req.body.researchContext.actorId='someone-else';const denied=response();await handler(req,denied);assert.equal(denied.statusCode,409);
});
test('collection failure leaves a usable provider response with an explicit missing-record flag',async t=>{
 t.mock.method(auth,'enabled',()=>true);t.mock.method(auth,'requireActor',async()=>actor);
 t.mock.method(research,'recordVerifiedOutcome',async()=>{throw new Error('unavailable');});
 const handler=withSchoolLearning('report',async(req,res)=>res.json({report:'Test'})),res=response();
 await handler({method:'POST',body:{researchContext:{actorId:actor.id,poemId:2}}},res);
 assert.equal(res.body.report,'Test');assert.equal(res.body.researchRecorded,false);
});
test('server verifies actual choice and canonical construct instead of browser success claims',async t=>{
 t.mock.method(auth,'enabled',()=>true);t.mock.method(auth,'requireActor',async()=>actor);
 let saved;
 t.mock.method(research,'recordVerifiedOutcome',async(req,outcome)=>{saved={context:req.body.researchContext,outcome};return {recorded:true};});
 const {CHALLENGE_SETS}=await loader.load(),set=CHALLENGE_SETS[getPoem(2).slug],item=(set.bank||set.items).find(i=>i.type==='sound');
 const wrong=item.options.find(o=>o.id!==item.answerId).id;
 const req={method:'POST',body:{poemId:2,itemId:item.id,status:'correct',response:{choiceId:wrong},researchContext:{actorId:actor.id,poemId:2,itemId:item.id,context:{mode:'standard',itemType:'dictation'}}}};
 const res=response();await challenge(req,res);assert.equal(res.statusCode,200);assert.equal(saved.outcome.result.score,0);assert.equal(saved.context.context.itemType,'sound');
 req.body.status='skipped';await challenge(req,response());assert.equal(saved.outcome.result.score,null);
});
test('same queued challenge answer has stable server event identity and persistence failure is never acknowledged',async t=>{
 t.mock.method(auth,'enabled',()=>true);t.mock.method(auth,'requireActor',async()=>actor);
 const saved=[];let responseResult={recorded:true};
 t.mock.method(research,'recordVerifiedOutcome',async(req,outcome)=>{saved.push(outcome);return responseResult;});
 const {CHALLENGE_SETS}=await loader.load(),set=CHALLENGE_SETS[getPoem(2).slug],item=(set.bank||set.items).find(i=>i.type==='sound');
 const requestId=require('node:crypto').randomUUID(),requestedAt='2026-01-01T00:00:00.000Z';
 const req={method:'POST',body:{poemId:2,itemId:item.id,status:'correct',response:{choiceId:item.answerId},researchContext:{actorId:actor.id,poemId:2,itemId:item.id,requestId,requestedAt,context:{mode:'standard'}}}};
 await challenge(req,response());await challenge(req,response());
 assert.equal(saved[0].eventId,saved[1].eventId);assert.equal(saved[0].clientAt,requestedAt);assert.equal(saved[0].stableBatch,true);
 assert.notEqual(research.stableOutcomeId('different-actor',requestId),saved[0].eventId);
 responseResult={recorded:false,reason:'outcome_storage_unavailable'};const pending=response();await challenge(req,pending);assert.equal(pending.statusCode,503);assert.equal(pending.body.ok,false);assert.equal(pending.body.retryable,true);
 for(const reason of ['INVALID_EVENT','BATCH_CHECKSUM','IDENTITY_UNAVAILABLE','RESEARCH_STORAGE_UNAVAILABLE']){
  responseResult={recorded:false,reason};const storage=response();await challenge(req,storage);assert.equal(storage.statusCode,503);assert.equal(storage.body.retryable,true);
 }
 responseResult={recorded:false,reason:'INVALID_EVENT',invalidRequest:true};const invalid=response();await challenge(req,invalid);assert.equal(invalid.statusCode,400);assert.equal(invalid.body.retryable,false);
 responseResult={recorded:false,reason:'outcome_storage_unavailable',invalidRequest:true};const unknown=response();await challenge(req,unknown);assert.equal(unknown.statusCode,503);assert.equal(unknown.body.retryable,true);
 responseResult={recorded:false,reason:'EVENT_ID_CONFLICT'};const conflict=response();await challenge(req,conflict);assert.equal(conflict.statusCode,409);assert.equal(conflict.body.researchRecorded,false);assert.equal(conflict.body.retryable,false);
 req.body.researchContext.requestedAt=new Date(Date.now()+600000).toISOString();const future=response();await challenge(req,future);assert.equal(future.statusCode,400);
 req.body.researchContext.requestedAt=requestedAt;delete req.body.researchContext.requestId;const incomplete=response();await challenge(req,incomplete);assert.equal(incomplete.statusCode,400);
});

test('malformed challenge event context is rejected without touching storage or retrying forever',async t=>{
 const oldEnabled=process.env.RESEARCH_ENABLED,oldStore=process.env.STUDENT_STORE;
 process.env.RESEARCH_ENABLED='1';process.env.STUDENT_STORE='blob';
 t.after(()=>{if(oldEnabled===undefined)delete process.env.RESEARCH_ENABLED;else process.env.RESEARCH_ENABLED=oldEnabled;if(oldStore===undefined)delete process.env.STUDENT_STORE;else process.env.STUDENT_STORE=oldStore;});
 t.mock.method(auth,'enabled',()=>true);t.mock.method(auth,'requireActor',async()=>({...actor,researchId:'r_'+'a'.repeat(24),cls:'A'}));
 // Any accidental storage access fails the test; validation must terminate first.
 t.mock.method(globalThis,'fetch',async()=>{assert.fail('invalid answer reached storage');});
 const {CHALLENGE_SETS}=await loader.load(),set=CHALLENGE_SETS[getPoem(2).slug],item=(set.bank||set.items).find(i=>i.type==='sound');
 const context={actorId:actor.id,poemId:2,itemId:item.id,sessionId:require('node:crypto').randomUUID(),appVersion:'test',contentVersion:'v1',context:{mode:'standard'}};
 for(const bad of [{...context,sessionId:undefined},{...context,attemptId:'invalid-uuid'},{...context,appVersion:'x'.repeat(65)}]){
  const req={method:'POST',body:{poemId:2,itemId:item.id,status:'correct',response:{choiceId:item.answerId},researchContext:bad}},res=response();
  await challenge(req,res);assert.equal(res.statusCode,400);assert.equal(res.body.code,'INVALID_EVENT');assert.equal(res.body.researchRecorded,false);assert.equal(res.body.retryable,false);
 }
});
test('thrown provider errors record a safe failure without changing response/error semantics',async t=>{
 t.mock.method(auth,'enabled',()=>true);t.mock.method(auth,'requireActor',async()=>actor);
 let stored;
 t.mock.method(research,'recordVerifiedOutcome',async(req,value)=>{stored=value;return {recorded:true};});
 const problem=Object.assign(new Error('private upstream diagnostic must never be persisted'),{name:'TimeoutError'});
 const handler=withSchoolLearning('chat',async()=>{throw problem;});
 await assert.rejects(handler({method:'POST',body:{researchContext:{actorId:actor.id,poemId:2}}},response()),error=>error===problem);
 assert.equal(stored.result.status,'error');assert.equal(stored.error.code,'timeout');assert.equal(stored.result.score,null);
 assert.doesNotMatch(JSON.stringify(stored),/private upstream/);assert.ok(stored.metrics.latencyMs>=0);
 assert.equal(outcomeFor('reading',null,200,{line:{text:'李',simplified:'李'}},NaN).result.status,'error');
});
// school48 server-only research detail (providerWords/service/recognition). None of it may change a verdict.
const line2=()=>{const poem=getPoem(2);return {poem,line:poem.lines[0]};}; // 李白乘舟將欲行 / 李白乘舟将欲行
test('server-only research detail never changes the verified score, word scores or metrics',()=>{
 const reference=line2(),payload={SuggestedScore:71,PronAccuracy:70,PronFluency:0.9,PronCompletion:100,
  Words:[{Word:'李',PronAccuracy:69,MatchTag:0,MemBeginTime:0,MemEndTime:300,PhoneInfos:[{Phone:'l',PronAccuracy:60}]},{Word:'白',PronAccuracy:88,MatchTag:0,MemBeginTime:300,MemEndTime:600,PhoneInfos:[]}]};
 const plain=outcomeFor('reading',payload,200,reference,10);
 const extended=outcomeFor('reading',payload,200,reference,10,undefined,{relay:'hop-hk',service:{audioPath:'webm',textMode:1,audioMs:2100,prepareMs:3,connectMs:40,scoreMs:900,message:'dropped'},rawWords:[{word:'李',pron_accuracy:69}]});
 for(const key of ['operation','provider','model','providerVersion','result','metrics','wordScores'])assert.deepEqual(extended[key],plain[key],key);
 assert.deepEqual(plain.metrics,{latencyMs:10,accuracyScore:70,fluencyScore:0.9,completionScore:100,suggestedScore:71,wordCount:2});
 assert.deepEqual(plain.wordScores.map(w=>w.index),[0,1]);
 assert.deepEqual(Object.keys(plain).sort(),['metrics','model','operation','provider','providerVersion','providerWords','result','wordScores']);
 assert.deepEqual(plain.providerWords,[{i:0,r:0,a:69,b:0,e:300,ph:[{s:'l',a:60}]},{i:1,r:1,a:88,b:300,e:600}]);
 assert.deepEqual(extended.service,{relay:'hop-hk',audioPath:'webm',textMode:1,audioMs:2100,prepareMs:3,connectMs:40,scoreMs:900});
 assert.deepEqual(extended.providerWords,[{i:0,r:0,a:69}],'raw provider words are preferred to the mapped response');
 const failed=outcomeFor('reading',{error:'x'},502,reference,10,undefined,{relay:'gz',service:{audioPath:'pcm',textMode:0,prepareMs:1,providerCode:4002}});
 assert.deepEqual(failed.error,outcomeFor('reading',{error:'x'},502,reference,10).error);assert.deepEqual(failed.service,{relay:'gz',audioPath:'pcm',textMode:0,prepareMs:1,providerCode:4002});
 assert.equal(failed.providerWords,undefined);
 for(const extras of [undefined,null,{},{service:'x'},{service:{relay:'hk:8443',audioPath:'wav',textMode:2,audioMs:-1,prepareMs:1.5,providerCode:'4002'}},{rawWords:'x'},{rawWords:[null]}]){
  const value=outcomeFor('reading',payload,200,reference,10,undefined,extras);
  assert.deepEqual(value.result,plain.result);assert.deepEqual(value.wordScores,plain.wordScores);assert.equal(value.service,undefined);
 }
 assert.equal(outcomeFor('chat',{reply:'hi'},200,{poem:reference.poem},10,undefined,{relay:'none'}).service.relay,'none');
});
test('provider words align inserted, missing, traditional and punctuation entries to the line without text',()=>{
 const raw=[
  {word:'李',pron_accuracy:69.4,pron_fluency:0.934,match_tag:0,begin_time:0,end_time:300,phone_infos:[{phone:'l',pron_accuracy:60.2},{phone:'i3',reference_phone:'i3',pron_accuracy:80},{phone:'Ü3',reference_phone:'u3',match_tag:3},{phone:'n',pron_accuracy:1},{phone:'g',pron_accuracy:2}]},
  {word:'啊',pron_accuracy:40,match_tag:1,begin_time:300,end_time:350,phone_infos:[{phone:'a1',pron_accuracy:40}]},
  {word:'白',pron_accuracy:0,match_tag:2},
  {word:'，',pron_accuracy:90},
  {word:'乘',pron_accuracy:90,mem_begin_time:400,mem_end_time:700},
  {word:'',match_tag:2},
  {word:'將',pron_accuracy:77},{word:'欲',pron_accuracy:78},{word:'行',pron_accuracy:79},{word:'哦',match_tag:1},{word:'外'}];
 const value=outcomeFor('reading',{SuggestedScore:50,Words:[]},200,line2(),10,undefined,{rawWords:raw});
 assert.deepEqual(value.providerWords,[
  {i:0,r:0,a:69,f:0.93,b:0,e:300,ph:[{s:'l',a:60},{s:'i3',a:80},{s:'v3',x:'u3',m:3},{s:'n',a:1}]},
  {i:1,m:1,a:40,b:300,e:350},
  {i:2,m:2,r:1,a:0},
  {i:4,r:2,a:90,b:400,e:700},
  {i:5,m:2,r:3},
  {i:6,r:4,a:77},{i:7,r:5,a:78},{i:8,r:6,a:79},{i:9,m:1},{i:10}]);
 assert.doesNotMatch(JSON.stringify(value.providerWords),/[\p{Script=Han}]/u,'no characters and no inserted speech content');
 assert.equal(value.result.score,50);assert.deepEqual(value.wordScores,[]);
 // Simplified forms align too; a different character anywhere voids the whole field.
 assert.deepEqual(outcomeFor('reading',{SuggestedScore:50},200,line2(),10,undefined,{rawWords:[{word:'李'},{word:'白'},{word:'乘'},{word:'舟'},{word:'将'}]}).providerWords.map(w=>w.r),[0,1,2,3,4]);
 for(const rawWords of [[{word:'李'},{word:'黑'}],[{word:'白'}],[{word:'李',match_tag:5}],[{word:'李',match_tag:-1}],[{word:'黑',match_tag:'1'}]])
  assert.equal(outcomeFor('reading',{SuggestedScore:50},200,line2(),10,undefined,{rawWords}).providerWords,undefined,JSON.stringify(rawWords));
 assert.equal(outcomeFor('reading',{SuggestedScore:50},200,line2(),10,undefined,{rawWords:[]}).providerWords,undefined);
 assert.equal(outcomeFor('reading',{SuggestedScore:50},200,line2(),10,undefined,{rawWords:[{word:'，'}]}).providerWords,undefined);
});
test('negative or out-of-range provider values are omitted and the byte budget drops phones before the field',()=>{
 const one=word=>outcomeFor('reading',{SuggestedScore:50},200,line2(),10,undefined,{rawWords:[word]}).providerWords;
 assert.deepEqual(one({word:'李',pron_accuracy:-1,pron_fluency:-1,begin_time:-10,end_time:-5,phone_infos:[{phone:'l',pron_accuracy:-1},{phone:'',pron_accuracy:5},{phone:'x9y'},{phone:'li',reference_phone:'LI'}]}),[{i:0,r:0,ph:[{s:'l'},{s:'li'}]}]);
 assert.deepEqual(one({word:'李',pron_accuracy:101,pron_fluency:Infinity,begin_time:500,end_time:400}),[{i:0,r:0,b:500}]);
 assert.deepEqual(one({word:'李',begin_time:600001,end_time:12.6}),[{i:0,r:0,e:13}]);
 assert.deepEqual(one({word:'李',pron_accuracy:NaN,phone_infos:'x'}),[{i:0,r:0}]);
 const phones=Array.from({length:4},()=>({phone:'zh',reference_phone:'z',match_tag:3,pron_accuracy:50}));
 const heavy=[...'李白乘舟將欲行'].map((word,i)=>({word,pron_accuracy:69,pron_fluency:0.93,begin_time:120000+i*1000,end_time:120500+i*1000,phone_infos:phones}));
 const trimmed=outcomeFor('reading',{SuggestedScore:50},200,line2(),10,undefined,{rawWords:heavy}).providerWords;
 assert.equal(trimmed.length,7);assert.equal(trimmed.some(w=>w.ph),false);assert.deepEqual(trimmed[6],{i:6,r:6,a:69,f:0.93,b:126000,e:126500});
 const inserted=Array.from({length:45},(_,i)=>({word:'啊',match_tag:1,pron_accuracy:40.4,pron_fluency:12.345,begin_time:100000+i,end_time:200000+i}));
 assert.equal(outcomeFor('reading',{SuggestedScore:50},200,line2(),10,undefined,{rawWords:inserted}).providerWords,undefined,'over budget even without phones');
 assert.equal(outcomeFor('reading',{SuggestedScore:50},200,line2(),10,undefined,{rawWords:inserted.slice(0,10)}).providerWords.length,10);
});
test('handwriting records strokes and recognition rank without changing the verdict',()=>{
 const whole={item:{target:{char:'霑',accept:['霑','沾']}},strokes:15};
 const value=outcomeFor('handwriting',{candidates:['雨','霑','露']},200,whole,1,undefined,{relay:'hk'});
 assert.equal(value.result.correct,outcomeFor('handwriting',{candidates:['雨','霑','露']},200,{...whole,strokes:15},1).result.correct);
 assert.equal(value.result.correct,true);assert.equal(value.metrics.strokeCount,15);
 assert.deepEqual(value.recognition,{candidateCount:3,targetRank:2,topCandidate:'雨'});assert.deepEqual(value.service,{relay:'hk'});
 assert.equal(value.providerWords,undefined);
 const multi=outcomeFor('handwriting',{candidates:['雨水','霑']},200,whole,1);
 assert.deepEqual(multi.recognition,{candidateCount:2,targetRank:2});
 assert.deepEqual(outcomeFor('handwriting',{candidates:[]},200,{item:whole.item,strokes:0},1).recognition,{candidateCount:0,targetRank:0});
 const many=outcomeFor('handwriting',{candidates:[...Array.from({length:22},(_,i)=>String.fromCodePoint(0x4e00+i)),'霑']},200,whole,1);
 assert.deepEqual(many.recognition,{candidateCount:20,targetRank:0,topCandidate:'一'});
 assert.equal(outcomeFor('handwriting',{candidates:['雨']},200,{item:{target:{char:'雨',accept:[]}}},1).metrics.strokeCount,undefined,'unknown stroke count stays absent');
 assert.equal(outcomeFor('handwriting',{candidates:['雨']},200,{item:{target:{char:'雨',accept:[]}},strokes:10001},1).metrics.strokeCount,undefined);
 assert.equal(outcomeFor('handwriting',{},502,whole,1).recognition,undefined);
});
test('the learning wrapper hands the relay path and provider detail to the recorder but never to the learner',async t=>{
 t.mock.method(auth,'enabled',()=>true);t.mock.method(auth,'requireActor',async()=>actor);
 const stored=[];t.mock.method(research,'recordVerifiedOutcome',async(req,outcome)=>{stored.push(outcome);return {recorded:true};});
 const line=getPoem(2).lines[0],payload={SuggestedScore:80,PronAccuracy:80,Words:[{Word:line.simplified[0],PronAccuracy:80,MatchTag:0,PhoneInfos:[]}]};
 const handler=withSchoolLearning('reading',async(req,res)=>{res.researchExtras={service:{audioPath:'pcm-gzip',textMode:0,audioMs:1200,prepareMs:2,connectMs:30,scoreMs:400},rawWords:[{word:line.simplified[0],pron_accuracy:80.4,match_tag:0}]};return res.json(payload);});
 for(const [header,relay] of [['hop-hk:8443','hop-hk'],['gz:9443','gz'],[undefined,'none'],['hk:443','none'],['hk:8443, gz:9443','none'],[['hk:8443'],'none']]){
  const res=response(),req={method:'POST',headers:header===undefined?{}:{'x-school-relay':header},body:{poemId:2,refText:line.simplified,researchContext:{actorId:actor.id,poemId:2,itemId:'p2.l0'}}};
  await handler(req,res);
  assert.deepEqual(res.body,{...payload,researchRecorded:true},'learner response unchanged');
  const outcome=stored.at(-1);assert.equal(outcome.service.relay,relay,String(header));
  assert.deepEqual(outcome.service,{relay,audioPath:'pcm-gzip',textMode:0,audioMs:1200,prepareMs:2,connectMs:30,scoreMs:400});
  assert.deepEqual(outcome.providerWords,[{i:0,r:0,a:80}]);assert.equal(outcome.result.score,80);
 }
});
