'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDemoDataset,demoRoster}=require('../api/_lib/teacher-demo-data.cjs');
const {buildXlsx}=require('../api/_lib/teacher-documents.cjs');
const ExcelJS=require('exceljs');
const NOW=Date.parse('2026-09-20T10:00:00.000Z'),options={now:NOW};
test('demo roster is exactly 775 clearly fictional students in 31 classes, no credentials',()=>{
  const roster=demoRoster();assert.equal(roster.length,775);assert.equal(new Set(roster.map(p=>p.grade+p.cls)).size,31);assert.equal(new Set(roster.map(p=>p.researchId)).size,775);
  assert(roster.every(p=>p.displayName.startsWith('示範學生 ')&&p.id.startsWith('s_demo_')&&p.researchId.startsWith('r_demo_')&&p.demo));
  for(const forbidden of ['password','login','email','phone'])assert(roster.every(p=>!(forbidden in p)));
  roster[0].displayName='changed';assert.notEqual(demoRoster()[0].displayName,'changed');
});

test('authorized school roster supplies names and classes while identities and results stay simulated',()=>{
 const real=[{id:'real-student-alpha',researchId:'r_real_alpha',role:'student',displayName:'測試陳同學',grade:2,cls:'B',classNo:1,login:'private-login',password:'private-password'},
 {id:'real-student-beta',researchId:'r_real_beta',role:'student',displayName:'測試李同學',grade:2,cls:'B',classNo:2},
 {id:'teacher',role:'teacher',displayName:'測試老師'}];
 const roster=demoRoster(real);assert.equal(roster.length,2);assert.deepEqual(roster.map(p=>p.displayName),['測試陳同學','測試李同學']);
 assert(roster.every(p=>p.researchId.startsWith('r_demo_')&&p.id.startsWith('s_demo_')));
 assert(!JSON.stringify(roster).includes('private-'));assert(!JSON.stringify(roster).includes('r_real_'));
 const dataset=createDemoDataset({grade:2,cls:'B'},{...options,roster:real});assert.equal(dataset.students.length,2);assert.equal(dataset.rosterSummary.totalStudents,2);assert.equal(dataset.analytics.source,'synthetic_demo');assert(dataset.students.every(p=>p.displayName.startsWith('測試')));assert.equal(dataset.rosterSummary.unmatchedWithRecords,0);
 const renamed=real.map(p=>({...p,displayName:p.displayName+'新'}));const next=createDemoDataset({grade:2,cls:'B'},{...options,roster:renamed});assert.notEqual(next.snapshotId,dataset.snapshotId);assert(next.students.every(p=>p.displayName.endsWith('新')));
 assert.equal(real[0].displayName,'測試陳同學');assert.equal(createDemoDataset({grade:2,cls:'B'},{...options,roster:[]}).students.length,0);
});
test('full-scale demo uses real aggregate schema with sources, dates, missingness and no invalid events',()=>{
  const data=createDemoDataset({},options);
  assert.equal(data.schemaVersion,1);assert.equal(data.demo,true);assert.equal(data.analytics.demo,true);assert.equal(data.analytics.source,'synthetic_demo');assert.match(data.snapshotId,/^[a-f0-9]{64}$/);
  assert.equal(data.rosterSummary.totalStudents,775);assert.equal(data.rosterSummary.withRecords,682);assert.equal(data.rosterSummary.noRecords,93);assert.equal(data.rosterSummary.unmatchedWithRecords,0);
  assert(data.analytics.coverage.nEvents>30000&&data.analytics.coverage.nEvents<100000);assert.equal(data.analytics.coverage.nInvalidEvents,0);assert.equal(data.analytics.byGrade.length,6);assert.equal(data.analytics.byClass.length,31);assert(data.analytics.trend.length>=28);assert.equal(data.filters.from,'2026-08-22');assert.equal(data.filters.to,'2026-09-20');
  assert(data.analytics.summary.activeMs>0);assert(data.analytics.summary.completedN>0);assert(data.analytics.summary.practiceOutcomeN>0);assert(data.analytics.readingWords.length>20);
  for(const construct of ['reading.pronunciation','writing.dictation','sound.recognition','match.accuracy','sequence.accuracy','scene_builder.accuracy'])assert(data.analytics.summary.byConstruct[construct]?.serverVerified.measuredN>0,construct);
  assert(data.analytics.summary.byConstruct['reading.pronunciation'].clientReported.measuredN>0);assert(data.analytics.summary.byConstruct['reading.pronunciation'].serverVerified.unmeasuredN>0);
});
test('grade/class/student/activity/date filtering and first/latest are genuine and stable',()=>{
  const one=createDemoDataset({grade:2,cls:'a'},options);assert.equal(one.students.length,25);assert(one.students.every(p=>p.grade===2&&p.cls==='A'));assert.equal(one.rosterSummary.noRecords,3);
  const zero=one.students.find(p=>p.classNo===1),nullScore=one.students.find(p=>p.classNo===2),clientOnly=one.students.find(p=>p.classNo===3),absent=one.students.find(p=>p.classNo===25);
  assert.equal(zero.stats.latest.byConstruct['reading.pronunciation'].serverVerified.meanScore,0);assert.equal(nullScore.stats.latest.byConstruct['reading.pronunciation'].serverVerified.meanScore,null);assert.equal(absent.stats,null);
  assert.equal(clientOnly.stats.latest.byConstruct['reading.pronunciation'].serverVerified.measuredN,0);assert(clientOnly.stats.latest.byConstruct['reading.pronunciation'].clientReported.measuredN>0);
  assert(one.students.some(p=>p.stats?.first.byConstruct['reading.pronunciation'].serverVerified.meanScore!==p.stats?.latest.byConstruct['reading.pronunciation'].serverVerified.meanScore));
  const individual=createDemoDataset({student:zero.researchId,activity:'read'},options);assert.equal(individual.students.length,1);assert.deepEqual(Object.keys(individual.analytics.summary.byConstruct),['reading.pronunciation']);
  const latestDay=createDemoDataset({grade:2,cls:'A',from:'2026-09-20',to:'2026-09-20'},options);assert(latestDay.analytics.trend.every(day=>day.date==='2026-09-20'));assert(latestDay.analytics.coverage.nEvents<one.analytics.coverage.nEvents);
  const outside=createDemoDataset({from:'2026-01-01',to:'2026-01-02',grade:2,cls:'A'},options);assert.equal(outside.rosterSummary.noRecords,25);assert.equal(outside.analytics.coverage.nEvents,0);
  const first=createDemoDataset({grade:2,cls:'A',attempt:'first'},options);assert.notEqual(first.snapshotId,one.snapshotId);
});
test('same-day snapshots are repeatable and defensive; day rollover is domain separated',()=>{
  const a=createDemoDataset({grade:1,cls:'A'},options),id=a.snapshotId;a.students[0].displayName='poison';a.analytics.summary.nEvents=-1;
  const b=createDemoDataset({grade:1,cls:'A'},{now:NOW+10000});assert.equal(b.snapshotId,id);assert.notEqual(b.students[0].displayName,'poison');assert(b.analytics.summary.nEvents>0);
  const c=createDemoDataset({grade:1,cls:'A'},{now:NOW+86400000});assert.notEqual(c.snapshotId,id);assert.equal(c.filters.to,'2026-09-21');
  assert.throws(()=>createDemoDataset({grade:7},options));assert.throws(()=>createDemoDataset({from:'2026-01-01',to:'2026-09-20'},options));assert.throws(()=>createDemoDataset({unknown:true},options));
});
test('real XLSX can export a full demo class with explicit fictional names and null distinct from zero',async()=>{
  const dataset=createDemoDataset({grade:2,cls:'A'},options),buffer=await buildXlsx(dataset),wb=new ExcelJS.Workbook();await wb.xlsx.load(buffer);
  assert.equal(buffer.subarray(0,2).toString(),'PK');assert.equal(wb.worksheets.length,6);const sheet=wb.getWorksheet('學生明細');assert.equal(sheet.rowCount,26);assert.match(sheet.getCell('D2').value,/示範學生/);assert.equal(sheet.getCell('F2').value,0);assert.equal(sheet.getCell('F3').value,null);
});
