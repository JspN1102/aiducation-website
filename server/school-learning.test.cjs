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
test('dictation scores only the first nonempty candidate, preserving no-recognition as missing',()=>{
 const reference={item:{target:{char:'雨',accept:[]}}};
 assert.equal(outcomeFor('handwriting',{candidates:['魚','雨']},200,reference,1).result.correct,false);
 assert.equal(outcomeFor('handwriting',{candidates:[]},200,reference,1).result.score,null);
 assert.equal(outcomeFor('handwriting',{candidates:['雨']},200,reference,1).result.score,100);
});
test('reading reference must match the canonical poem and exact line',async()=>{
 const p=getPoem(2),req={body:{researchContext:{poemId:2,itemId:'p2.l0'},refText:p.lines[0].simplified}};
 assert.equal((await referenceFor(req,'reading')).line,p.lines[0]);assert.equal(req.body.researchContext.activity,'read');
 req.body.refText='unrelated';await assert.rejects(referenceFor(req,'reading'),e=>e.status===400);
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
