'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
const research=require('../api/_lib/research-store.cjs'),data=require('../api/_lib/teacher-data.cjs'),demo=require('../api/_lib/teacher-demo-data.cjs');
const auth=require('../api/_lib/school-auth.cjs');
const {createHandler:exportHandler}=require('../api/_lib/teacher-export-handler.cjs');
const {createHandler:analysisHandler}=require('../api/_lib/teacher-assistant-handler.cjs');
const actor={id:'t_scope_test',role:'teacher'},NOW=Date.parse('2026-09-21T12:00:00Z');
const response=()=>({headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;}});
function analyticsHandler(stubs){const file=path.join(__dirname,'../api/teacher-analytics.js'),compiled=esbuild.transformSync(fs.readFileSync(file,'utf8'),{format:'cjs',loader:'js'}),m={exports:{}};new Function('require','module','exports',compiled.code)(id=>Object.hasOwn(stubs,id)?stubs[id]:require(id.startsWith('.')?path.resolve(path.dirname(file),id):id),m,m.exports);return m.exports.default;}

test('poem filtering is optional for research and is applied in SQL and published-row matching',async()=>{
 const all=research.filtersFrom({from:'2026-09-01',to:'2026-09-21'}),f=research.filtersFrom({from:all.from,to:all.to,grade:'2',poemId:'2',cls:'A'});
 assert.equal(all.poemId,undefined);assert.equal(f.poemId,2);
 for(const poemId of ['0','7','2 OR 1=1',['2'],'02x'])assert.throws(()=>research.filtersFrom({poemId}));
 const row={serverReceivedAt:'2026-09-20T00:00:00.000Z',grade:2,cls:'A',event:{poemId:2}};
 assert.equal(research.matches(row,f),true);assert.equal(research.matches({...row,event:{poemId:6}},f),false);
 let query;await research.readPostgres(f,{query:async(sql,values)=>{query={sql,values};return {rows:[]};}});
 assert.match(query.sql,/poem_id=\$4/);assert.deepEqual(query.values,[f.from,f.to,2,2,'A']);
 const empty=research.aggregateEvents([],f);assert.deepEqual(empty.readingCharacterAnalysis.poems.map(p=>p.poemId),[2]);
 assert.notEqual(data.buildDataset({rows:[]},[],{...all,grade:2,poemId:2}).snapshotId,data.buildDataset({rows:[]},[],{...all,grade:2}).snapshotId);
});

test('teacher analytics rejects missing and cross-grade poem scope before reading storage',async()=>{
 let reads=0;
 const handler=analyticsHandler({'./_lib/school-auth.cjs':{...auth,requireActor:async()=>actor},'./_lib/research-store.cjs':{...research,analytics:async(filters,options)=>{reads++;assert.equal(filters.grade,2);assert.equal(filters.poemId,2);assert.equal(options.includeStudentDetails,true);return {studentDetails:{},filters};}}});
 for(const query of [{},{grade:'2'},{poemId:'2'},{grade:'2',poemId:'3'},{grade:'2',poemId:'2',format:'jsonl',cls:['A','B']}]){const res=response();await handler({method:'GET',query},res);assert.equal(res.statusCode,400);}
 assert.equal(reads,0);const res=response();await handler({method:'GET',query:{grade:'2',poemId:'2'}},res);assert.equal(res.statusCode,200);assert.equal(reads,1);
});

test('Excel and Word generation require a single grade and its poem before reading or paid requests',async()=>{
 let loaded=0,generated=0;
 const exporter=exportHandler({requireTeacher:async()=>actor,loadDataset:async()=>{loaded++;throw Error('unexpected');}});
 const assistant=analysisHandler({authModule:{...auth,requireActor:async()=>actor},analysisModule:{generate:async()=>{generated++;return {ok:true};}}});
 for(const filters of [{},{grade:2},{grade:2,poemId:3}]){
   let res=response();await exporter({method:'POST',body:{action:'xlsx',filters}},res);assert.equal(res.statusCode,400);
   res=response();await assistant({method:'POST',body:{filters}},res);assert.equal(res.statusCode,400);
 }
 assert.equal(loaded,0);assert.equal(generated,0);
 const res=response();await assistant({method:'POST',body:{filters:{grade:2,poemId:2,cls:'a'}}},res);assert.equal(res.statusCode,200);assert.equal(generated,1);
});

test('embedded student details equal independent student analysis including nulls and microgame exclusion',()=>{
 const filters={grade:2,poemId:2,cls:'A'},options={now:NOW},dataset=demo.createDemoDataset(filters,options);
 assert.equal(dataset.students.length,25);assert.equal(Object.keys(dataset.analytics.studentDetails).length,22);
 for(const number of [1,2,3,4]){
   const person=dataset.students.find(p=>p.classNo===number),embedded=dataset.analytics.studentDetails[person.researchId];
   const individual=demo.createDemoDataset({...filters,student:person.researchId},options).analytics;
   assert.deepEqual(embedded.readingCharacterAnalysis,individual.readingCharacterAnalysis);
   assert.deepEqual(embedded.practiceSummary,individual.practiceSummary);
   assert.ok(embedded.practiceSummary.items.filter(item=>item.type==='microgame').every(item=>item.status==='completed'&&item.score===null));
   assert.equal(embedded.practiceSummary.correctN,embedded.practiceSummary.items.filter(item=>item.type!=='microgame'&&item.status==='correct').length);
 }
 const absent=dataset.students.find(p=>p.classNo===25);assert.equal(dataset.analytics.studentDetails[absent.researchId],undefined);
});

test('cold demo generates only selected pupils and keeps event IDs stable when scope/order changes',()=>{
 const people=demo.demoRoster().filter(p=>p.classNo<=4),original=research.validateEvent,captured=[];
 research.validateEvent=(event,server)=>{captured.push({id:event.eventId,poemId:event.poemId});return original(event,server);};
 try{
   const options={now:NOW+86400000,roster:people};
   const first=demo.createDemoDataset({grade:2,poemId:2,cls:'A'},options);const classEvents=captured.splice(0);
   assert.ok(classEvents.length>0&&classEvents.length<400);assert.ok(classEvents.every(event=>event.poemId===2));
   demo.createDemoDataset({grade:2,poemId:2},options);const gradeEvents=captured.splice(0),ids=new Set(gradeEvents.map(e=>e.id));
   assert.equal(gradeEvents.length,classEvents.length*5);assert.ok(classEvents.every(e=>ids.has(e.id)));
   const individual=demo.createDemoDataset({grade:2,poemId:2,cls:'A',student:first.students[0].researchId},options);const individualEvents=captured.splice(0);
   assert.ok(individualEvents.length<classEvents.length);assert.ok(individualEvents.every(e=>ids.has(e.id)));
   const reversed=demo.createDemoDataset({grade:2,poemId:2,cls:'A'},{...options,roster:[...people].reverse()});const reversedEvents=captured.splice(0);
   assert.deepEqual(new Set(reversedEvents.map(e=>e.id)),new Set(classEvents.map(e=>e.id)));
   assert.equal(individual.students.length,1);assert.equal(reversed.analytics.coverage.nEvents,first.analytics.coverage.nEvents);
 }finally{research.validateEvent=original;}
});
