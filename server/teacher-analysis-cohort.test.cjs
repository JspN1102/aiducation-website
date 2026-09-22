'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const analysis=require('../api/_lib/teacher-analysis.cjs');
const studentLearning=require('../api/_lib/student-learning-reset.cjs');
const epoch='c'.repeat(32),teacher={id:'t_'+'a'.repeat(24),role:'teacher'};
const env={TEACHER_AI_MODEL:'deepseek-v4-pro',GPT_API_KEY:'synthetic-test-only',GPT_API_BASE:'https://example.invalid'};
const cohort={version:1,role:'student',epoch,previousEpoch:null,resetAt:'2026-09-22T10:00:00.000Z'};
function dataset(learningEpoch=epoch){return {
 schemaVersion:1,learningEpoch,snapshotId:'cohort-'+(learningEpoch||'initial'),filters:{grade:2,poemId:2,cls:'A',attempt:'latest',from:'2026-09-01',to:'2026-09-22'},
 rosterSummary:{totalStudents:2,withRecords:1,noRecords:1},students:[],
 analytics:{coverage:{nEvents:2,nStudents:1},summary:{nEvents:2,nStudents:1,nAttempts:1},sync:{status:'current'},byGrade:[],byClass:[],trend:[]}
};}
function output(){return {
 lessonPlans:[{grades:[2],title:'聽讀練習',durationMinutes:20,objectives:['跟讀一句原詩'],materials:['平台示範聲音'],evidenceIds:['F001'],stages:[{title:'聽讀',minutes:10,teacher:'示範原句',students:'聆聽跟讀',check:'觀察字音'},{title:'練習',minutes:10,teacher:'安排原句朗讀',students:'錄音練習',check:'查看同類評測'}],differentiation:{support:'再聽一次',extension:'自己讀一次'},assessment:'用同一句再讀'}],
 title:'普通話學習概覽',overview:'現有資料有限，先觀察同類練習。',findings:[{title:'參與資料',evidenceIds:['F001','F002'],interpretation:'這是名冊及已收到記錄的觀察。'}],teachingActions:[{priority:'high',title:'下一課聽讀',evidenceIds:['F002'],steps:['先示範，再短句跟讀。']}],reviewPlan:[{title:'再次觀察',evidenceIds:['F002'],steps:['下一課收集同類朗讀記錄。']}],limitations:['未收到記錄不等於未有練習。']
};}
function provider(value=output()){return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:10,completion_tokens:10}}),{status:200});}
const storedEpoch=value=>value.learningEpoch??value.report?.dataset?.learningEpoch??value.draftReport?.dataset?.learningEpoch??value.task?.dataset?.learningEpoch??'initial';
function memoryStore(background=false){
 const data=new Map(),writes=[];
 const store={data,writes,async get(key){return data.has(key)?structuredClone(data.get(key)):null;},async cas(key,value,version){const prior=data.get(key);if((prior?.version??undefined)!==(version??undefined))return false;data.set(key,{value:structuredClone(value),version:String(Number(prior?.version||0)+1)});writes.push(key);return true;}};
 if(background)store.pending=async(at,learningEpoch)=>[...data].filter(([key,row])=>key.startsWith('report/')&&row.value.status==='pending'&&row.value.background&&!(row.value.leaseUntil>at)&&!(row.value.retryAt>at)&&(learningEpoch===undefined||storedEpoch(row.value)===learningEpoch)).slice(0,1).map(([key,row])=>({key,...structuredClone(row)}));
 return store;
}
function service(options={}){return analysis.createService({store:memoryStore(),env,loadDataset:async()=>dataset(),buildFollowUp:()=>({students:[],unstartedIds:[]}),fetchImpl:async()=>provider(),...options});}
function activate(t){t.mock.method(studentLearning,'current',async()=>cohort);}

test('current cohort synchronous lease remains pollable and completes once without being archived',async t=>{
 activate(t);const store=memoryStore();let begin,finish,calls=0;
 const begun=new Promise(resolve=>begin=resolve),svc=service({store,fetchImpl:async()=>{calls++;begin();await new Promise(resolve=>finish=resolve);return provider();}});
 const work=svc.generate({},dataset().filters,teacher);await begun;
 const key=[...store.data.keys()].find(key=>key.startsWith('report/')),id='ta_'+key.slice(7);
 assert.equal((await svc.check(id)).status,'generating');
 finish();await work;assert.equal((await svc.getReport(id)).dataset.learningEpoch,epoch);
 assert.equal((await svc.generate({},dataset().filters,teacher)).cached,true);assert.equal(calls,1);
});

test('current cohort synchronous quality revision preserves ownership through its temporary lease',async t=>{
 activate(t);let calls=0;const svc=service({fetchImpl:async()=>{calls++;const value=output();if(calls===1)value.findings[0].title='朗讀表現較低';return provider(value);}});
 const draft=await svc.generate({},dataset().filters,teacher);assert.equal(draft.nextAction,'continue');
 assert.equal((await svc.check(draft.reportId)).status,'generating');
 const complete=await svc.continueReport(draft.reportId,teacher);
 assert.equal(complete.report.qualityReview.passed,true);assert.equal((await svc.getReport(draft.reportId)).dataset.learningEpoch,epoch);assert.equal(calls,2);
});

test('failed current cohort synchronous report returns its provider error and can retry after cooldown',async t=>{
 activate(t);let clock=Date.now(),calls=0;const store=memoryStore(),svc=service({store,now:()=>clock,fetchImpl:async()=>{calls++;return calls===1?new Response('{}',{status:500}):provider();}});
 await assert.rejects(svc.generate({},dataset().filters,teacher),error=>error.code==='AI_UNAVAILABLE');
 const key=[...store.data.keys()].find(key=>key.startsWith('report/')),id='ta_'+key.slice(7);
 await assert.rejects(svc.check(id),error=>error.code==='AI_UNAVAILABLE');
 clock+=31000;const done=await svc.generate({},dataset().filters,teacher);assert.equal(done.reportId,id);assert.equal(calls,2);
});

test('current cohort background terminal failure remains retryable after cooldown',async t=>{
 activate(t);let clock=Date.now(),calls=0;const store=memoryStore(true),svc=service({store,now:()=>clock,fetchImpl:async()=>{calls++;return calls===1?new Response('{}',{status:200}):provider();}});
 const queued=await svc.generate({},dataset().filters,teacher,{background:true});
 await assert.rejects((await svc.claimPending())(),error=>error.code==='AI_INVALID_RESPONSE');
 await assert.rejects(svc.check(queued.reportId),error=>error.code==='AI_INVALID_RESPONSE');
 clock+=31000;assert.equal((await svc.generate({},dataset().filters,teacher,{background:true})).reportId,queued.reportId);
 await(await svc.claimPending())();assert.equal((await svc.getReport(queued.reportId)).dataset.learningEpoch,epoch);assert.equal(calls,2);
});

test('archived pending tasks stay byte-identical while current cohort tasks continue through the same worker',async t=>{
 let current=null;t.mock.method(studentLearning,'current',async()=>current);
 const store=memoryStore(true),input=dataset(undefined);delete input.learningEpoch;input.snapshotId='legacy';let calls=0;
 const svc=service({store,loadDataset:async()=>structuredClone(input),fetchImpl:async()=>{calls++;return provider();}});
 const old=await svc.generate({},input.filters,teacher,{background:true}),oldKey='report/'+old.reportId.slice(3);
 // A pre-upgrade persisted task has no top-level cohort metadata.
 delete store.data.get(oldKey).value.learningEpoch;const oldBytes=JSON.stringify(store.data.get(oldKey));
 current=cohort;Object.assign(input,dataset());const fresh=await svc.generate({},input.filters,teacher,{background:true});
 await(await svc.claimPending())();assert.equal((await svc.getReport(fresh.reportId)).dataset.learningEpoch,epoch);
 assert.equal(await svc.claimPending(),null);assert.equal(calls,1);assert.equal(JSON.stringify(store.data.get(oldKey)),oldBytes);
 await assert.rejects(svc.getReport(old.reportId),error=>error.code==='REPORT_ARCHIVED');
});

test('claim refuses an archived task returned by a store even before modifying its lease',async t=>{
 activate(t);let writes=0,calls=0;
 const record={key:'report/'+'a'.repeat(64),version:'1',value:{status:'pending',background:true,stage:'queued',leaseUntil:0,task:{dataset:{snapshotId:'old'}}}};
 const before=JSON.stringify(record),store={pending:async()=>[record],get:async()=>record,cas:async()=>{writes++;return true;}};
 const svc=service({store,fetchImpl:async()=>{calls++;return provider();}});
 assert.equal(await svc.claimPending(),null);assert.equal(writes,0);assert.equal(calls,0);assert.equal(JSON.stringify(record),before);
});

test('PostgreSQL pending query excludes old cohorts before selecting its one worker job',async()=>{
 const queries=[],store=analysis.createPostgresStore({query:async(sql,values)=>{queries.push({sql,values});return{rows:[]};}});
 await store.pending(123,epoch);
 assert.deepEqual(queries[0].values,['report/%',123,epoch]);
 assert.match(queries[0].sql,/learningEpoch.*\$3.*ORDER BY.*LIMIT 1/);
 assert.match(queries[0].sql,/task,dataset,learningEpoch/);
 await store.pending(123);assert.equal(queries[1].values.length,2);
});

test('demo reports retain their independent namespace after formal student reset',async t=>{
 activate(t);let calls=0;const store=memoryStore(true),svc=service({namespace:analysis.NS+'-demo',store,loadDataset:async()=>{const data=dataset();delete data.learningEpoch;return data;},fetchImpl:async()=>{calls++;return provider();}});
 const job=await svc.generate({},dataset().filters,teacher,{background:true});
 await(await svc.claimPending())();assert.equal((await svc.getReport(job.reportId)).dataset.learningEpoch,undefined);assert.equal(calls,1);
});
