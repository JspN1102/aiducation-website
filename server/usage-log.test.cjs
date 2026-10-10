'use strict';
// school55 使用紀錄: chat text in the research outcome, teacher dashboard counts,
// and the site administrator's log of both.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const s=require('../api/_lib/research-store.cjs');
const {outcomeFor}=require('../api/_lib/school-learning.cjs');
const {getPoem}=require('../api/_lib/poems.js');
const {createActivity}=require('../api/_lib/teacher-activity.cjs');
const {chatLog}=require('../api/_lib/activity-log-handler.cjs');

const event=(changes={})=>({eventId:'11111111-1111-4111-8111-111111111111',sessionId:'22222222-2222-4222-8222-222222222222',seq:0,
 clientAt:'2026-10-10T00:00:00.000Z',activeMs:0,poemId:6,activity:'chat',type:'provider_result',appVersion:'test',contentVersion:'test',
 provider:'deepseek',model:'deepseek-flash',operation:'chat',providerVersion:'poet-conversation-20260922-v1',result:{status:'completed',score:null,correct:null},...changes});

test('a chat outcome keeps the question, how it was asked, the suggestion tapped and the reply',()=>{
 const extras={chat:{question:'你為什麼喜歡小雨？',inputMode:'suggestion',presetId:'p6-q1'}};
 const done=outcomeFor('chat',{reply:'  小雨潤物，草色遙看近卻無。 '},200,{poem:getPoem(6)},5,undefined,extras);
 assert.deepEqual(done.chat,{question:'你為什麼喜歡小雨？',inputMode:'suggestion',presetId:'p6-q1',reply:'小雨潤物，草色遙看近卻無。'});
 assert.doesNotThrow(()=>s.validateEvent(event({chat:done.chat}),true));
 // A failed answer still records what was asked, without a reply.
 const failed=outcomeFor('chat',{},504,{poem:getPoem(6)},5,undefined,extras);
 assert.equal(failed.chat.question,'你為什麼喜歡小雨？');assert.equal(failed.chat.reply,undefined);assert.equal(failed.error.code,'timeout');
 // Other operations and outcomes without a question carry none.
 assert.equal(outcomeFor('report',{reply:'x'},200,{poem:getPoem(6)},5,undefined,extras).chat,undefined);
 assert.equal(outcomeFor('chat',{reply:'x'},200,{poem:getPoem(6)},5,undefined,{}).chat,undefined);
});

test('chat text is accepted only as server detail on a chat outcome and within its limits',()=>{
 const ok={question:'春雨是甚麼味道？',reply:'清清甜甜的。',inputMode:'typed'};
 assert.doesNotThrow(()=>s.validateEvent(event({chat:ok}),true));
 assert.throws(()=>s.validateEvent(event({chat:ok}),false));
 assert.throws(()=>s.validateEvent(event({operation:'report',chat:ok}),true));
 for(const bad of [{},{question:''},{question:'  '},{question:'問'.repeat(1001)},{question:'問',reply:'答'.repeat(4001)},{question:'問',inputMode:'keyboard'},
  {question:'問',presetId:'bad id'},{question:'問',name:'小明'},{question:1}])assert.throws(()=>s.validateEvent(event({chat:bad}),true),JSON.stringify(bad).slice(0,60));
 assert.doesNotThrow(()=>s.validateEvent(event({chat:{question:'問'.repeat(1000),reply:'答'.repeat(4000)}}),true));
 assert(!s.DATA_DICTIONARY.exclusions?.includes?.('chat text'));
 assert(JSON.stringify(s.DATA_DICTIONARY).includes('event.chat'));
});

function fakePool(){
 const rows=new Map(),queries=[];
 return {rows,queries,async query(sql,params=[]){queries.push(sql);
  if(/^CREATE TABLE/.test(sql))return {rows:[]};
  if(/^INSERT INTO teacher_activity/.test(sql)){const [day,login,kind,name,at]=params,key=day+'|'+login+'|'+kind,row=rows.get(key)||{day,login,kind,n:0};row.n++;row.name=name;row.last=Date.parse(at);rows.set(key,row);return {rows:[]};}
  if(/FROM teacher_activity/.test(sql)){const grouped=new Map();for(const r of rows.values()){if(r.day<params[0])continue;const key=r.login+'|'+r.kind,g=grouped.get(key)||{login:r.login,name:r.name,kind:r.kind,n:0,days:new Set(),last:0};g.n+=r.n;g.days.add(r.day);g.last=Math.max(g.last,r.last);grouped.set(key,g);}
   return {rows:[...grouped.values()].map(g=>({...g,days:g.days.size}))};}
  throw new Error('unexpected '+sql.slice(0,40));}};
}

test('teacher activity counts logins, visits, data loads and files per teacher; pupils and bad kinds are ignored',async()=>{
 let t=Date.parse('2026-10-10T01:00:00.000Z');const pool=fakePool(),a=createActivity({pool:()=>pool,now:()=>t});
 const teacher={role:'teacher',login:'chan',displayName:'陳老師'};
 assert.equal(await a.record(teacher,'login'),true);
 await a.record(teacher,'view');t+=5*60000;await a.record(teacher,'view');t+=31*60000;await a.record(teacher,'view');
 await a.record(teacher,'xlsx');await a.record(teacher,'docx');await a.record(teacher,'docx');await a.record(teacher,'analysis');
 assert.equal(await a.record({role:'student',login:'p1'},'view'),false);assert.equal(await a.record(teacher,'delete'),false);
 assert.equal(await a.record({role:'teacher',login:'lee',displayName:'李老師'},'view'),true);
 t+=86400000;await a.record(teacher,'login');
 const summary=await a.summary(7);
 assert.equal(summary.available,true);assert.equal(summary.teachers.length,2);
 const chan=summary.teachers.find(r=>r.login==='chan');
 assert.deepEqual(chan.counts,{login:2,open:2,view:3,analysis:1,xlsx:1,docx:2,research_export:0});
 assert.equal(chan.name,'陳老師');assert.equal(chan.activeDays,2);assert.equal(summary.teachers[0].login,'chan');
 assert.equal(summary.teachers.find(r=>r.login==='lee').counts.open,1);
 // A failing database never surfaces to the teacher's request.
 const broken=createActivity({pool:()=>({query:async()=>{throw new Error('down');}})});
 assert.equal(await broken.record(teacher,'view'),false);assert.equal((await broken.summary()).available,false);
 assert.equal(await createActivity({pool:()=>null}).record(teacher,'view'),false);
});

test('the chat log numbers pupils within the reply and never returns research IDs',async()=>{
 const recent=[{at:3,research_id:'r_bbbbbbbbbbbbbbbbbbbbbbbb',poem:6,grade:2,cls:'A',chat:{question:'第三問',reply:'答',inputMode:'typed'},status:'completed'},
  {at:2,research_id:'r_aaaaaaaaaaaaaaaaaaaaaaaa',poem:4,grade:3,cls:'B',chat:{question:'第二問',presetId:'p4-q2'},status:'error'},
  {at:1,research_id:'r_bbbbbbbbbbbbbbbbbbbbbbbb',poem:6,grade:2,cls:'A',chat:{question:'第一問',inputMode:'voice'},status:'completed'}];
 const client={async query(sql){if(/^(BEGIN|SET|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};
   if(sql.includes('count(DISTINCT research_id)::int AS pupils,\n'))return {rows:[{questions:3,pupils:2,suggested:1,typed:1,voice:1}]};
   if(sql.includes('GROUP BY 1,2'))return {rows:[{poem:6,question:'第一問',suggested:false,n:2,pupils:2}]};
   return {rows:recent};},release(){}};
 const log=await chatLog({connect:async()=>client},'2026-10-10T00:00:00.000Z');
 assert.equal(log.available,true);assert.equal(log.questions,3);assert.equal(log.top[0].poemTitle,getPoem(6).title);
 assert.deepEqual(log.recent.map(r=>[r.pupil,r.question,r.inputMode,r.failed]),[[1,'第三問','typed',false],[2,'第二問','suggestion',true],[1,'第一問','voice',false]]);
 assert.equal(log.recent[1].suggested,true);assert.equal(log.recent[0].reply,'答');
 assert(!JSON.stringify(log).includes('r_'));
 assert.equal((await chatLog(null,'x')).available,false);
});
