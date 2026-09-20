'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path'),ExcelJS=require('exceljs'),JSZip=require('jszip');
const research=require('../api/_lib/research-store.cjs'),auth=require('../api/_lib/school-auth.cjs');
const data=require('../api/_lib/teacher-data.cjs'),docs=require('../api/_lib/teacher-documents.cjs');
const {createHandler}=require('../api/_lib/teacher-export-handler.cjs');
const NOW=Date.parse('2026-09-20T10:00:00Z'),filters={grade:2,cls:'A',from:'2026-09-01',to:'2026-09-20',attempt:'latest'};
const teacher={id:'t_'+'a'.repeat(24),role:'teacher'};
function fixture(){
  const roster=[{researchId:'r_'+'1'.repeat(24),displayName:'=測試學生',grade:2,cls:'A',classNo:1,login:'DO_NOT_EXPORT_LOGIN'},
    {researchId:'r_'+'2'.repeat(24),displayName:'未測學生',grade:2,cls:'A',classNo:2},
    {researchId:'r_'+'3'.repeat(24),displayName:'其他班學生',grade:2,cls:'B',classNo:1}];
  const row=(score,at,operation='reading',person=roster[0])=>{
    const event={eventId:randomUUID(),sessionId:randomUUID(),attemptId:randomUUID(),seq:0,activeMs:0,clientAt:at,poemId:2,activity:operation==='reading'?'read':'writing',type:'provider_result',appVersion:'test',contentVersion:'test',itemId:operation==='reading'?'p2.l0':'g2.d1',operation,provider:'synthetic',model:'synthetic',providerVersion:'test',result:{status:score===null?'unmeasured':'completed',score,correct:null},context:{mode:'standard'},...(operation==='reading'?{wordScores:[{index:0,char:'李',score}]}:{})};
    return {schemaVersion:1,researchId:person.researchId,grade:person.grade,cls:person.cls,source:'server_verified',serverReceivedAt:at,qualityFlags:[],event,eventChecksum:research.hash(research.canonical({researchId:person.researchId,source:'server_verified',event}))};
  };
  const rows=[row(80,'2026-09-10T00:00:00.000Z'),row(0,'2026-09-11T00:00:00.000Z'),row(null,'2026-09-12T00:00:00.000Z','handwriting'),row(99,'2026-09-11T00:00:00.000Z','reading',roster[2])];
  const dataset=data.buildDataset({rows,source:'postgres'},roster,filters,NOW);
  const report={schemaVersion:1,reportId:'ta_'+'a'.repeat(64),createdAt:new Date(NOW).toISOString(),dataset,filters,snapshotId:dataset.snapshotId,evidence:[{id:'zero',label:'最近朗讀平均分',value:0,unit:'分'}],analysis:{lessonPlans:[{grades:[2],title:'聽讀練習',durationMinutes:20,objectives:['跟讀原詩'],materials:['平台示範'],stages:[{title:'聽讀',minutes:10,teacher:'示範',students:'跟讀',check:'聽字音'},{title:'練習',minutes:10,teacher:'指導',students:'錄音',check:'再觀察'}],differentiation:{support:'重聽',extension:'自讀'},assessment:'同句複查'}],title:'普通話學習分析',overview:'請按分項觀察學生。',findings:[{title:'朗讀需要跟進',evidenceIds:['zero'],interpretation:'可先安排示範及短句跟讀。'}],teachingActions:[{priority:'high',title:'下一課先聽讀',evidenceIds:['zero'],steps:['老師示範一句。','學生跟讀後再嘗試一次。']}],reviewPlan:[{title:'觀察聆聽後的朗讀',steps:['保留第一次和最近一次結果。'],evidenceIds:['zero']}],limitations:['本結果只涵蓋所選期間。']}};
  return {roster,rows,dataset,report};
}
function response(){return {headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;},send(value){this.body=value;return this;}};}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('dataset keeps all selected roster, exact scope, stable content identity, and separate zero/unmeasured first/latest',()=>{
  const f=fixture(),d=f.dataset;assert.deepEqual(d.rosterSummary,{totalStudents:2,withRecords:1,noRecords:1,unmatchedWithRecords:0});assert.equal(d.students.length,2);assert(!JSON.stringify(d).includes('DO_NOT_EXPORT_LOGIN'));assert(!JSON.stringify(d).includes('其他班學生'));
  const stats=d.students[0].stats;assert.equal(stats.first.byConstruct['reading.pronunciation'].serverVerified.meanScore,80);assert.equal(stats.latest.byConstruct['reading.pronunciation'].serverVerified.meanScore,0);assert.equal(stats.latest.byConstruct['writing.dictation'].serverVerified.meanScore,null);assert.equal(d.students[1].stats,null);
  assert.equal(data.buildDataset({rows:f.rows,source:'postgres'},f.roster,filters,NOW+1000).snapshotId,d.snapshotId);
  const changed=structuredClone(f.roster);changed[0].displayName='新姓名';assert.notEqual(data.buildDataset({rows:f.rows},changed,filters,NOW).snapshotId,d.snapshotId);
  const follow=data.buildFollowUp(d);assert.equal(follow.students.length,1);assert.equal(follow.students[0].reasons.length,1);assert.equal(follow.students[0].reasons[0].score,0);assert.equal(follow.unstartedIds.length,1);assert.equal(follow.absenceReliable,true);
});
test('one cached dataset is shared only after every caller is authorized; copies and snapshot stay consistent',async()=>{
  const f=fixture(),gate=deferred();let authCalls=0,rosterCalls=0,rowCalls=0,tick=NOW;
  const load=data.createDatasetLoader({requireTeacher:async req=>{authCalls++;return req.denied?null:teacher;},listAccounts:async()=>{rosterCalls++;return f.roster;},readRows:async()=>{rowCalls++;await gate.promise;return {rows:f.rows};},now:()=>tick,ttlMs:100});
  const first=load({},filters),second=load({},filters);gate.resolve();const [a,b]=await Promise.all([first,second]);assert.equal(authCalls,2);assert.equal(rosterCalls,1);assert.equal(rowCalls,1);assert.equal(a.snapshotId,b.snapshotId);a.students[0].displayName='mutated';assert.notEqual((await load({},filters)).students[0].displayName,'mutated');await assert.rejects(load({denied:true},filters),e=>e.status===403);
  tick+=101;assert.equal((await load({},filters)).snapshotId,b.snapshotId);assert.equal(rowCalls,2);
});
test('dataset timeout has bounded in-flight concurrency and a late completion cannot poison the next cache',async()=>{
  const f=fixture(),gate=deferred();let calls=0;
  const load=data.createDatasetLoader({requireTeacher:async()=>teacher,listAccounts:async()=>f.roster,readRows:async()=>{calls++;await gate.promise;return {rows:f.rows};},timeoutMs:15,maxEntries:1});
  await assert.rejects(load({},filters),e=>e.code==='EXPORT_TIMEOUT');await assert.rejects(load({},filters),e=>e.code==='EXPORT_TIMEOUT');assert.equal(calls,1);
  await assert.rejects(load({},{...filters,cls:'B'}),e=>e.code==='EXPORT_BUSY');gate.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal((await load({},filters)).students.length,2);assert.equal(calls,2);
});
test('real Excel includes six formatted worksheets, literal names, selected roster and separate numeric zero/null',async()=>{
  const f=fixture(),buffer=await docs.buildXlsx(f.dataset);assert.equal(buffer.subarray(0,2).toString(),'PK');const wb=new ExcelJS.Workbook();await wb.xlsx.load(buffer);assert.deepEqual(wb.worksheets.map(sheet=>sheet.name),['概覽','學生明細','分項表現','每日趨勢','字音重點','說明']);
  const students=wb.getWorksheet('學生明細');assert.equal(students.getCell('D2').value,'=測試學生');assert.equal(students.rowCount,3);assert.equal(students.getCell('F2').value,0);assert.equal(students.getCell('G2').value,null);assert.equal(students.getCell('F3').value,null);assert.match(students.getCell('L2').value,/朗讀發音 0 分（伺服器評測，1 筆）/);assert.match(students.getCell('L3').value,/未見紀錄/);assert.equal(students.getCell('N1').value,'嘗試數');assert.equal(students.views[0].xSplit,4);const score=wb.getWorksheet('分項表現');assert.equal(score.rowCount,3);assert.equal(score.getCell('G2').value,0);assert.equal(score.getCell('J2').value,80);assert.equal(score.getCell('L2').value,0);assert.equal(score.getCell('G3').value,null);assert.equal(score.getCell('I3').value,1);assert.equal(score.getCell('N3').value,'未測');
  for(const sheet of wb.worksheets){assert.equal(sheet.views[0].state,'frozen');assert(sheet.autoFilter);sheet.eachRow(row=>row.eachCell(cell=>assert.notEqual(cell.type,ExcelJS.ValueType.Formula)));}
  const zip=await JSZip.loadAsync(buffer);for(const [name,file]of Object.entries(zip.files))if(name.startsWith('xl/worksheets/')&&name.endsWith('.xml'))assert(!/<f[ >]/.test(await file.async('string')));
  const folder=process.env.TEACHER_DOCUMENT_EVIDENCE_DIR;if(folder){fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'synthetic-teacher.xlsx'),buffer);}
});
test('empty class learning data still exports its entire selected roster without invented scores',async()=>{
  const f=fixture(),dataset=data.buildDataset({rows:[]},f.roster,filters,NOW),wb=new ExcelJS.Workbook();await wb.xlsx.load(await docs.buildXlsx(dataset));const students=wb.getWorksheet('學生明細');assert.equal(students.rowCount,3);assert.equal(students.getCell('F2').value,null);assert.match(students.getCell('L2').value,/未見紀錄/);assert.equal(wb.getWorksheet('分項表現').rowCount,1);assert.equal(dataset.rosterSummary.noRecords,2);
});
test('Excel quick view never substitutes client scores and detail separates both sources without empty permutations',async()=>{
  const f=fixture(),client=structuredClone(f.rows[0]);client.source='client';client.event.type='feedback_shown';client.event.eventId=randomUUID();client.event.result.score=95;client.eventChecksum=research.hash(research.canonical({researchId:client.researchId,source:client.source,event:client.event}));
  for(const [rows,expectedScore,expectedDetailRows]of [[[...f.rows,client],0,4],[[client],null,2]]){
    const dataset=data.buildDataset({rows},f.roster,filters,NOW),wb=new ExcelJS.Workbook();await wb.xlsx.load(await docs.buildXlsx(dataset));const students=wb.getWorksheet('學生明細'),scores=wb.getWorksheet('分項表現');assert.equal(students.getCell('F2').value,expectedScore);assert.equal(scores.rowCount,expectedDetailRows);
    const reading=scores.getRows(2,scores.rowCount-1).filter(row=>row.getCell(5).value==='朗讀發音');assert(reading.some(row=>row.getCell(6).value==='學生端回報'&&row.getCell(7).value===95));if(expectedScore===null)assert.match(students.getCell('L2').value,/僅有學生端回報，尚無伺服器有效評測/);else assert(reading.some(row=>row.getCell(6).value==='伺服器評測'&&row.getCell(7).value===0));
  }
});
test('real editable Word uses persisted snapshot, exact evidence/support identities, and has no forced cover page',async()=>{
  const f=fixture(),buffer=await docs.buildDocx(f.report),zip=await JSZip.loadAsync(buffer),xml=await zip.file('word/document.xml').async('string');
  for(const text of ['學習概況','主要發現','教學建議','後續跟進','附錄：學生跟進參考','資料範圍與限制','=測試學生','未測學生','最近朗讀平均分：0 分'])assert(xml.includes(text),text);
  assert((await zip.file('docProps/core.xml').async('string')).includes(f.dataset.snapshotId));assert(!xml.includes('課後反思'));assert(!xml.includes('授課日期'));assert(!xml.includes('其他班學生'));assert(!xml.includes('DO_NOT_EXPORT_LOGIN'));assert(!xml.includes('w:type="page"'));assert(xml.includes('<w:tbl>'));assert(!Object.keys(zip.files).some(name=>name.includes('vbaProject')));
  const folder=process.env.TEACHER_DOCUMENT_EVIDENCE_DIR;if(folder){fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'synthetic-teacher.docx'),buffer);}
});
test('export handler enforces teacher+CSRF, rejects client report text, and reportId exports never reload live data',async()=>{
  const f=fixture();let requireCalls=0,liveCalls=0;const handler=createHandler({requireTeacher:async req=>{requireCalls++;if(req.denied)throw new auth.AuthError(403,'CSRF_REJECTED');return teacher;},loadDataset:async()=>{liveCalls++;return f.dataset;},getReport:async()=>f.report});
  let res=response();await handler({method:'POST',denied:true,body:{action:'xlsx'}},res);assert.equal(res.statusCode,403);assert.equal(liveCalls,0);
  res=response();await handler({method:'POST',body:{action:'docx',reportId:f.report.reportId,content:'client text'}},res);assert.equal(res.statusCode,400);
  for(const action of ['docx','xlsx']){res=response();await handler({method:'POST',body:{action,reportId:f.report.reportId}},res);assert.equal(res.statusCode,200);assert(Buffer.isBuffer(res.body));assert.match(res.headers['Content-Disposition'],/filename\*=UTF-8''/);assert.equal(res.headers['X-Data-Snapshot'],f.dataset.snapshotId);assert.equal(res.headers['Cache-Control'],'private, no-store');}
  assert.equal(liveCalls,0);assert.equal(requireCalls,4);
});
test('timed out document generation keeps concurrency bounded until its worker settles',async()=>{
  const f=fixture(),gate=deferred();let renders=0;const handler=createHandler({requireTeacher:async()=>teacher,loadDataset:async()=>f.dataset,xlsx:async()=>{renders++;await gate.promise;return Buffer.from('PK');},timeoutMs:10,maxConcurrent:1});
  let res=response();await handler({method:'POST',body:{action:'xlsx',filters}},res);assert.equal(res.statusCode,504);
  res=response();await handler({method:'POST',body:{action:'xlsx',filters}},res);assert.equal(res.statusCode,429);assert.equal(renders,1);gate.resolve();await new Promise(resolve=>setImmediate(resolve));
  res=response();await handler({method:'POST',body:{action:'xlsx',filters}},res);assert.equal(res.statusCode,200);assert.equal(renders,2);
});
