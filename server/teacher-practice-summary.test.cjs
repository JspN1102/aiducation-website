'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildPracticeSummary}=require('../api/_lib/teacher-practice-summary.cjs');
function event({attempt='round1',item='game',type='microgame',position=1,at=0,operation='challenge',source='server_verified',result={status:'completed',score:null,correct:null}}={}){
 return {researchId:'r_test_only',source,serverReceivedAt:new Date(Date.parse('2026-09-20T08:00:00Z')+at).toISOString(),event:{poemId:1,attemptId:attempt,itemId:item,activity:type==='dictation'?'writing':'challenge',type:source==='server_verified'?'provider_result':'answer_submitted',operation,context:{mode:'standard',itemType:type,position,total:5},result}};
}
test('latest round shows verified question results while games count only as completed',()=>{
 const rows=[event({attempt:'old',at:-1000,result:{status:'correct',score:100,correct:true}}),event(),event({item:'sound',type:'sound',position:2,result:{status:'correct',score:100,correct:true}}),event({item:'write',type:'dictation',position:3,operation:'handwriting',result:{status:'incorrect',score:0,correct:false}}),event({item:'write',type:'dictation',position:3,at:100})];
 const summary=buildPracticeSummary(rows);assert.equal(summary.attemptId,'round1');assert.equal(summary.total,5);assert.equal(summary.completedN,3);assert.equal(summary.correctN,1);assert.equal(summary.measuredN,2);assert.deepEqual(summary.items.map(item=>item.status),['completed','correct','incorrect']);
});
test('skipped acknowledgement wins over a draft handwriting result and client-only answers stay unmeasured',()=>{
 const rows=[event({item:'write',type:'dictation',operation:'handwriting',result:{status:'correct',score:100,correct:true}}),event({item:'write',type:'dictation',at:200,result:{status:'skipped',score:null,correct:null}}),event({item:'sound',type:'sound',position:2,source:'client',result:{status:'correct',score:100,correct:true}})];
 const summary=buildPracticeSummary(rows);assert.equal(summary.correctN,0);assert.deepEqual(summary.items.map(item=>item.status),['skipped','unmeasured']);assert.equal(summary.items[0].score,null);assert.equal(buildPracticeSummary([]),null);
});
test('an unavailable handwriting score is unmeasured and is never described as an untouched question',()=>{
 const summary=buildPracticeSummary([event({item:'write',type:'dictation',operation:'handwriting',result:{status:'unmeasured',score:null,correct:null}})]);
 assert.equal(summary.items[0].status,'unmeasured');assert.equal(summary.measuredN,0);assert.equal(summary.correctN,0);
});

test('historical microgame correctness acknowledgements never become correct exam answers',()=>{
 const summary=buildPracticeSummary([event({result:{status:'correct',score:100,correct:true}}),event({item:'sound',type:'sound',position:2,result:{status:'incorrect',score:0,correct:false}})]);
 assert.equal(summary.completedN,2);assert.equal(summary.correctN,0);assert.equal(summary.measuredN,1);
 assert.deepEqual(summary.items.map(item=>[item.status,item.score]),[['completed',null],['incorrect',0]]);
});

test('skipped prompts remain visible but count neither as completed nor correct',()=>{
 const summary=buildPracticeSummary([
  event({item:'skip',type:'sound',result:{status:'skipped',score:null,correct:null}}),
  event({item:'write',type:'dictation',operation:'handwriting',position:2,result:{status:'incorrect',score:0,correct:false}})
 ]);
 assert.equal(summary.completedN,1);assert.equal(summary.correctN,0);assert.equal(summary.measuredN,1);
 assert.deepEqual(summary.items.map(item=>item.status),['skipped','incorrect']);
});
