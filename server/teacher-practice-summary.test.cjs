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

test('new displayed round cannot replace five completed item records and two reanswers update only those items',()=>{
 const rows=Array.from({length:5},(_,i)=>event({item:'item'+i,type:i?'sound':'microgame',position:i+1,at:i,result:i?{status:'correct',score:100,correct:true}:{status:'completed',score:null,correct:null}}));
 const presented=event({attempt:'round2',item:'item0',at:100,source:'client'});presented.event.type='item_presented';
 const opened=buildPracticeSummary([...rows,presented]);assert.equal(opened.completedN,5);assert.equal(opened.attemptId,'round1');
 const repeated=[...rows,presented,event({attempt:'round2',item:'item0',at:101}),event({attempt:'round2',item:'item1',type:'sound',position:2,at:102,result:{status:'incorrect',score:0,correct:false}})];
 const result=buildPracticeSummary(repeated);assert.equal(result.completedN,5);assert.equal(result.correctN,3);assert.equal(result.total,5);
 assert.equal(result.items.find(i=>i.itemId==='item1').status,'incorrect');assert.equal(result.items.find(i=>i.itemId==='item1').best.status,'correct');
 for(let i=2;i<5;i++)assert.equal(result.items.find(item=>item.itemId==='item'+i).attemptId,'round1');
 const skip=event({attempt:'round3',item:'item2',type:'sound',position:3,at:200,result:{status:'skipped',score:null,correct:null}});
 assert.equal(buildPracticeSummary([...repeated,skip]).items.find(i=>i.itemId==='item2').status,'correct');
 const unavailable=event({attempt:'round3',item:'item2',type:'sound',position:3,at:201,result:{status:'unmeasured',score:null,correct:null}});
 assert.equal(buildPracticeSummary([...repeated,unavailable]).items.find(i=>i.itemId==='item2').score,100);
 const clientOnly=event({attempt:'round3',item:'item2',type:'sound',position:3,source:'client',at:202,result:{status:'incorrect',score:0,correct:false}});
 assert.equal(buildPracticeSummary([...repeated,clientOnly]).items.find(i=>i.itemId==='item2').score,100,'unverified browser answer cannot erase the last verified score');
 assert.deepEqual(buildPracticeSummary([...repeated].reverse()),result,'event arrival array order does not change per-item results');
});

test('overlapping rounds use the actual item result time, not the round opening order',()=>{
 const rows=[event({attempt:'early-open',item:'sound',type:'sound',at:500,result:{status:'incorrect',score:0,correct:false}}),event({attempt:'later-open',item:'sound',type:'sound',at:200,result:{status:'correct',score:100,correct:true}})];
 const opening=event({attempt:'early-open',item:'game',at:0,source:'client'});opening.event.type='item_presented';
 rows.push(opening);
 const item=buildPracticeSummary(rows).items.find(value=>value.itemId==='sound');
 assert.equal(item.status,'incorrect');assert.equal(item.best.status,'correct');assert.equal(item.attemptId,'early-open');
});

test('teacher per-item display does not fabricate missing ordinal slots or label cumulative work as one completed round',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'../maanshan/teacher-dashboard.mjs'),'utf8');
 const functionSource=source.slice(source.indexOf('function studentPracticeBody('),source.indexOf('function studentLearningBody('));
 const render=vm.runInNewContext(`(${functionSource})`,{esc:value=>String(value??''),shown:value=>String(value??0)});
 const html=render({practiceSummary:{scope:'per-item',title:'測試',completedN:2,correctN:1,total:5,items:[{itemId:'a',position:2,type:'sound',status:'correct'},{itemId:'b',position:2,type:'sound',status:'incorrect'}]}});
 assert.equal((html.match(/<li>/g)||[]).length,2);assert.match(html,/各題最近成績/);assert.doesNotMatch(html,/最近一輪|\/ 5|尚未作答/);
 assert.match(html,/<span class="practice-position">1<\/span>/);assert.match(html,/<span class="practice-position">2<\/span>/);
});
