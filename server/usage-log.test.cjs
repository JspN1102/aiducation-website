'use strict';
// school55 使用紀錄: chat text in the research outcome, teacher dashboard counts,
// and the site administrator's log of both.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const s=require('../api/_lib/research-store.cjs');
const {outcomeFor}=require('../api/_lib/school-learning.cjs');
const {getPoem}=require('../api/_lib/poems.js');
const {createActivity}=require('../api/_lib/teacher-activity.cjs');
const {chatLog,conversation,readings,filtersFrom,where,createActivityLog}=require('../api/_lib/activity-log-handler.cjs');

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

const A='r_aaaaaaaaaaaaaaaaaaaaaaaa',B='r_bbbbbbbbbbbbbbbbbbbbbbbb';
const NOW=Date.parse('2026-10-11T04:00:00.000Z');
const RECENT=[{at:3,research_id:B,poem:6,grade:2,cls:'A',chat:{question:'第三問',reply:'答',inputMode:'typed'},status:'completed'},
 {at:2,research_id:A,poem:4,grade:3,cls:'B',chat:{question:'第二問',presetId:'p4-q2'},status:'error'},
 {at:1,research_id:B,poem:6,grade:2,cls:'A',chat:{question:'第一問',inputMode:'voice'},status:'completed'}];
const MAP=new Map([[B,{name:'測試甲',login:'t2a01',grade:2,cls:'A',classNo:1}]]);
function chatPool(seen=[]){
 const client={async query(sql,params){if(/^(BEGIN|SET|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};seen.push({sql,params});
   if(sql.includes('AS questions'))return {rows:[{questions:3,pupils:2,suggested:1,typed:1,voice:1}]};
   if(sql.includes('GROUP BY 1,2'))return {rows:[{poem:6,question:'第一問',suggested:false,n:2,pupils:2}]};
   if(sql.includes('GROUP BY research_id,poem_id'))return {rows:[{research_id:B,grade:2,cls:'A',poem:2,line:0,n:4,failed:0,last:5},{research_id:B,grade:2,cls:'A',poem:2,line:1,n:5,failed:1,last:6},
     {research_id:A,grade:3,cls:'B',poem:4,line:3,n:2,failed:0,last:4},{research_id:A,grade:3,cls:'B',poem:99,line:0,n:7,failed:0,last:4}]};
   if(sql.includes('GROUP BY research_id'))return {rows:[{research_id:B,grade:2,cls:'A',n:2,failed:0,first:1,last:3,poems:[6,99]},{research_id:A,grade:3,cls:'B',n:1,failed:1,first:2,last:2,poems:[4]}]};
   if(sql.includes('DISTINCT grade,cls'))return {rows:[{grade:2,cls:'A'},{grade:3,cls:'B'},{grade:9,cls:'Z'}]};
   if(sql.includes('ASC'))return {rows:RECENT.filter(r=>!params.includes(B)||r.research_id===B).slice().reverse()};
   return {rows:RECENT};},release(){}};
 return {connect:async()=>client};
}

test('filters: days, Hong Kong dates, grade, class, poem, pupil and a search with LIKE characters escaped',()=>{
 const f=filtersFrom({},NOW);assert.equal(f.days,7);assert.equal(f.from,'2026-10-04T16:00:00.000Z');assert.equal(f.to,'2026-10-11T16:00:00.000Z');
 const g=filtersFrom({fromDate:'2026-10-10',toDate:'2026-10-10',grade:'2',cls:'A',poem:'6',student:B,q:' 50%_小\\雨 '},NOW);
 assert.equal(g.from,'2026-10-09T16:00:00.000Z');assert.equal(g.to,'2026-10-10T16:00:00.000Z');assert.equal(g.q,'50%_小\\雨');
 const w=where(g);assert.deepEqual(w.params,[g.from,g.to,2,'A',6,B,'%50\\%\\_小\\\\雨%']);
 assert.match(w.sql,/grade = \$3 AND cls = \$4 AND poem_id = \$5 AND research_id = \$6/);assert.match(w.sql,/ILIKE \$7 OR .*ILIKE \$7/);
 for(const bad of [{days:'0'},{days:'401'},{days:'x'},{grade:'7'},{cls:'a'},{cls:'AB'},{poem:'13'},{student:'s_1'},{q:'問'.repeat(51)},{fromDate:'2026-13-01'},{fromDate:'2026-10-11',toDate:'2026-10-10'},{grade:['1','2']}])
  assert(filtersFrom(bad,NOW).error,JSON.stringify(bad));
 assert.equal(filtersFrom({days:'400'},NOW).days,400);assert.equal(filtersFrom({q:'  '},NOW).q,undefined);
});

test('the chat log names each pupil from the account directory, lists pupils and keeps the reply',async()=>{
 const seen=[],log=await chatLog(chatPool(seen),filtersFrom({grade:'2'},NOW),MAP);
 assert.equal(log.available,true);assert.equal(log.questions,3);assert.equal(log.top[0].poemTitle,getPoem(6).title);
 assert.deepEqual(log.recent.map(r=>[r.name,r.login,r.classNo,r.question,r.inputMode,r.failed]),[['測試甲','t2a01',1,'第三問','typed',false],[null,null,null,'第二問','suggestion',true],['測試甲','t2a01',1,'第一問','voice',false]]);
 assert.equal(log.recent[1].suggested,true);assert.equal(log.recent[1].grade,3);assert.equal(log.recent[0].reply,'答');
 assert.deepEqual(log.students.map(p=>[p.student,p.name,p.count,p.failed,p.lastAt,p.poems.map(x=>x.title)]),[[B,'測試甲',2,0,3,[getPoem(6).title]],[A,null,1,1,2,[getPoem(4).title]]]);
 assert.deepEqual(log.classes,[{grade:2,cls:'A'},{grade:3,cls:'B'}]);
 assert(seen.filter(q=>!q.sql.includes('DISTINCT grade,cls')).every(q=>q.params[2]===2&&q.sql.includes('grade = $3')));
 assert.equal((await chatLog(null,filtersFrom({},NOW))).available,false);
 const c=await conversation(chatPool(),filtersFrom({student:B},NOW),MAP);
 assert.equal(c.student.name,'測試甲');assert.deepEqual(c.conversation.map(r=>r.question),['第一問','第三問']);
});

test('line readings count each scored line per pupil and poem, and the text search does not narrow them',async()=>{
 const seen=[],r=await readings(chatPool(seen),filtersFrom({grade:'2',q:'雨'},NOW),MAP);
 assert.equal(r.available,true);assert.equal(r.readings,11);
 const b=r.students.find(x=>x.student===B);assert.equal(b.name,'測試甲');assert.equal(b.total,9);assert.equal(b.failed,1);assert.equal(b.lastAt,6);
 assert.deepEqual(b.poems.map(p=>[p.title,p.total,p.lines.map(l=>[l.line,l.text,l.count,l.failed])]),[[getPoem(2).title,9,[[1,getPoem(2).lines[0].text,4,0],[2,getPoem(2).lines[1].text,5,1]]]]);
 assert.deepEqual(r.students.find(x=>x.student===A).poems.map(p=>p.id),[4]);
 const q=seen[0];assert.match(q.sql,/operation'='reading'/);assert.doesNotMatch(q.sql,/ILIKE/);assert.deepEqual(q.params.slice(2),[2]);
});

test('only the site administrator gets the log, the conversation or the Excel file',async()=>{
 const auth=require('../api/_lib/school-auth.cjs'),saved={requireActor:auth.requireActor,siteAdmin:auth.siteAdmin};
 let who={role:'teacher',login:'chan'};auth.requireActor=async()=>who;auth.siteAdmin=a=>a.login==='jasper';
 const h=createActivityLog({researchPool:()=>chatPool(),activity:()=>({summary:async()=>({available:true,teachers:[]})}),directory:async()=>({accounts:[{role:'student',researchId:B,displayName:'測試甲',login:'t2a01',grade:2,cls:'A',classNo:1}]}),now:()=>NOW});
 const call=async query=>{const res={statusCode:0,headers:{},body:null,setHeader(k,v){this.headers[k.toLowerCase()]=v;},json(b){this.body=b;return this;},send(b){this.body=b;return this;},end(b){this.body=b;return this;}};
  res.status=function(n){res.statusCode=n;return res;};await h({method:'GET',query,headers:{}},res);return res;};
 try{
  let r=await call({});assert.equal(r.statusCode,403);assert.doesNotMatch(JSON.stringify(r.body),/測試甲|第一問/);
  who={role:'teacher',login:'jasper'};
  r=await call({grade:'9'});assert.equal(r.statusCode,400);
  r=await call({view:'student'});assert.equal(r.statusCode,400);
  r=await call({});assert.equal(r.statusCode,200);assert.equal(r.body.schemaVersion,2);assert.equal(r.body.chats.recent[0].name,'測試甲');assert.equal(r.body.teachers.available,true);
  assert.equal(r.body.readings.students.length,2);
  r=await call({view:'student',student:B});assert.equal(r.statusCode,200);assert.equal(r.body.conversation.length,2);assert.equal(r.body.readingsAvailable,true);assert(r.body.readings.total>0);
  r=await call({view:'xlsx'});assert.equal(r.statusCode,200);assert.match(r.headers['content-type'],/spreadsheetml/);
  const ExcelJS=require('exceljs'),wb=new ExcelJS.Workbook();await wb.xlsx.load(r.body);
  const ws=wb.getWorksheet('對話紀錄');assert.equal(ws.rowCount,4);assert.equal(ws.getRow(2).getCell(5).value,'測試甲');assert.equal(ws.getRow(2).getCell(10).value,'第一問');
  assert.equal(wb.getWorksheet('學生統計').rowCount,3);
  const lines=wb.getWorksheet('朗讀測評次數');assert.equal(lines.rowCount,4);assert.equal(lines.getRow(2).getCell(4).value,'測試甲');assert.equal(lines.getRow(2).getCell(9).value,4);
 }finally{Object.assign(auth,saved);}
});

test('teachers never get chat text: the dashboard data and their research export leave it out',()=>{
 const pupil={id:'s_123456789012345678901234',researchId:'r_123456789012345678901234',role:'student',grade:2,cls:'A',displayName:'x',login:'x'};
 const at=Date.parse('2026-10-10T01:00:00.000Z');
 const stored=s.validateBatch({schemaVersion:1,batchId:'33333333-3333-4333-8333-333333333333',actorId:pupil.id,
  events:[event({poemId:2,clientAt:new Date(at).toISOString(),chat:{question:'秘密問題甲',reply:'秘密回答乙',inputMode:'typed'}})]},pupil,at,'server_verified').events[0];
 const f=s.filtersFrom({from:'2026-10-10',to:'2026-10-10'});
 assert.equal(s.matches(stored,f),true);
 const teacher=s.exportRows([stored],f).content,admin=s.exportRows([stored],f,{includeChat:true}).content;
 assert.doesNotMatch(teacher,/秘密/);assert.equal(JSON.parse(teacher).event.operation,'chat');
 assert.match(admin,/秘密問題甲/);assert.match(admin,/秘密回答乙/);
 assert.doesNotMatch(s.exportRows([stored],f,{format:'csv'}).content,/秘密/);
 assert.doesNotMatch(JSON.stringify(s.aggregateEvents([stored],f,{includeStudentDetails:true})),/秘密/);
 assert.equal(stored.event.chat.question,'秘密問題甲');
});
