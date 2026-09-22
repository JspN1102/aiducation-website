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
