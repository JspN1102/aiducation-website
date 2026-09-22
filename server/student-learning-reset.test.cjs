'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const auth=require('../api/_lib/school-auth.cjs');
const studentLearning=require('../api/_lib/student-learning-reset.cjs');
const teacherLearning=require('../api/_lib/teacher-learning-reset.cjs');
const research=require('../api/_lib/research-store.cjs');
const student={id:'s_'+'a'.repeat(24),role:'student'},other={id:'s_'+'b'.repeat(24),role:'student'};
const cohort={version:1,role:'student',epoch:'c'.repeat(32),previousEpoch:null,resetAt:'2026-09-22T10:00:00.123Z'};
function fixture(){let value=null;const reads=[];const store={async get(key){reads.push(key);return value?{value:structuredClone(value),version:'1'}:null;}};return{reads,store,set:v=>{value=v;},learning:studentLearning.createStudentLearning({store:()=>store,enabled:()=>true})};}
test('student reset changes progress namespace while retaining all legacy data and independent account scopes',async()=>{
 const f=fixture(),old=new Map([[student.id,{reading:[83]}]]);
 assert.deepEqual(await f.learning.scope(student),{studentId:student.id});
 f.set(cohort);const scope=await f.learning.scope(student);
 assert.match(scope.studentId,/^v_[a-f0-9]{28}$/);assert.equal(scope.learningEpoch,cohort.epoch);
 assert.equal(old.has(scope.studentId),false);assert.deepEqual(old.get(student.id),{reading:[83]});
 assert.notEqual((await f.learning.scope(other)).studentId,scope.studentId);
 for(const epoch of [undefined,'initial','student','d'.repeat(32)])await assert.rejects(f.learning.scope(student,{forSave:true,learningEpoch:epoch}),e=>e.code==='LEARNING_RESET');
 assert.deepEqual(await f.learning.scope(student,{forSave:true,learningEpoch:cohort.epoch}),scope);
});
test('header and queued body generations must agree; teachers and read-only requests are unaffected',async()=>{
 const f=fixture();f.set(cohort);
 await assert.rejects(f.learning.requireEpoch({method:'POST',headers:{}},student),e=>e.code==='LEARNING_RESET');
 await assert.rejects(f.learning.requireEpoch({method:'POST',headers:{'x-learning-epoch':cohort.epoch},body:{learningEpoch:'old'}},student),e=>e.code==='LEARNING_RESET');
 await f.learning.requireEpoch({method:'POST',headers:{'x-learning-epoch':cohort.epoch}},student);
 await f.learning.requireEpoch({method:'GET',headers:{}},student);
 await f.learning.requireEpoch({method:'POST',headers:{}},{role:'teacher'});
});
test('student state, progress, and existing recording scope use the same current epoch',async()=>{
 const f=fixture();f.set(cohort);
 const learning=teacherLearning.createTeacherLearning({service:{enabled:()=>true},store:()=>f.store});
 const state=await learning.withState({authenticated:true,user:student});
 assert.equal(state.learningEpoch,cohort.epoch);
 assert.deepEqual(await learning.scope(student,{forSave:true,learningEpoch:state.learningEpoch}),await f.learning.scope(student));
});
test('corrupt cohort metadata fails closed and disabled legacy site never reads school storage',async()=>{
 const f=fixture();f.set({...cohort,epoch:'invalid'});await assert.rejects(f.learning.current(),/Invalid student learning generation/);
 const disabled=studentLearning.createStudentLearning({enabled:()=>false,store:()=>{throw Error('must not read');}});
 assert.equal(await disabled.current(),null);assert.deepEqual(await disabled.scope(student),{studentId:student.id});
});
test('formal teacher research reads have a precise reset cutoff without deleting history',async t=>{
 t.mock.method(studentLearning,'current',async()=>cohort);
 const queries=[],db={query:async(sql,values)=>{queries.push({sql,values});return{rows:[]};}};
 const result=await research.readPostgres({from:'2026-09-01',to:'2026-09-22',grade:1,poemId:1},db);
 assert.deepEqual(result,[]);assert.match(queries[0].sql,/received_at >= \$3::timestamptz/);
 assert.equal(queries[0].values[2],cohort.resetAt);assert.doesNotMatch(queries[0].sql,/DELETE|UPDATE|TRUNCATE/);
});
test('previous teacher Word reports stay stored but cannot be restored as current cohort reports',async t=>{
 t.mock.method(studentLearning,'current',async()=>cohort);
 const analysis=require('../api/_lib/teacher-analysis.cjs');
 const record={value:{status:'completed',report:{dataset:{snapshotId:'old'}}}};
 const service=analysis.createService({store:{get:async()=>record,cas:async()=>assert.fail('archive must not mutate stored report')}});
 await assert.rejects(service.check('ta_'+'d'.repeat(64)),e=>e.code==='REPORT_ARCHIVED'&&e.status===409);
 await assert.rejects(service.getReport('ta_'+'d'.repeat(64)),e=>e.code==='REPORT_ARCHIVED');
 assert.equal(record.value.report.dataset.snapshotId,'old');
});
