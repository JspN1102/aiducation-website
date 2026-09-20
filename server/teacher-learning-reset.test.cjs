'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const auth=require('../api/_lib/school-auth.cjs');
const {createTeacherLearning}=require('../api/_lib/teacher-learning-reset.cjs');
const teacher={id:'t_'+'a'.repeat(24),role:'teacher'},student={id:'s_'+'b'.repeat(24),role:'student'};
function fixture(){
 const rows=new Map();let revision=0;
 const store={async get(key){return structuredClone(rows.get(key)||null);},async cas(key,value,expected){if(rows.get(key)?.version!==expected)throw new auth.Conflict();rows.set(key,{value:structuredClone(value),version:String(++revision)});}};
 const service={async requireActor(req,{roles,csrf}){if(!req.actor)throw new auth.AuthError(401,'AUTH_REQUIRED');if(!roles.includes(req.actor.role))throw new auth.AuthError(403,'ROLE_FORBIDDEN');if(csrf&&req.csrf!==true)throw new auth.AuthError(403,'CSRF_REJECTED');return req.actor;}};
 return{rows,store,learning:createTeacherLearning({service,store:()=>store,now:()=>Date.parse('2026-09-21T10:00:00Z')})};
}
const request=(overrides={})=>({actor:teacher,csrf:true,body:{action:'reset_my_progress',confirm:true,learningEpoch:'initial',requestId:crypto.randomUUID()},...overrides});
const rejects=(promise,status,code)=>assert.rejects(promise,error=>error.status===status&&error.code===code);
test('initial teacher scope uses existing storage while student scope never touches reset metadata',async()=>{
 const f=fixture();assert.deepEqual(await f.learning.scope(teacher),{studentId:teacher.id,learningEpoch:'initial'});
 assert.deepEqual(await f.learning.scope(student),{studentId:student.id});assert.equal(f.rows.size,0);
 assert.deepEqual(await f.learning.scope(teacher,{forSave:true}),{studentId:teacher.id,learningEpoch:'initial'});
 assert.equal((await f.learning.withState({authenticated:true,user:teacher})).learningEpoch,'initial');
 assert.equal('learningEpoch' in await f.learning.withState({authenticated:true,user:student}),false);
});
test('reset requires teacher authentication, CSRF, explicit confirmation and a strict self-only body',async()=>{
 const f=fixture();await rejects(f.learning.reset(request({actor:null})),401,'AUTH_REQUIRED');
 await rejects(f.learning.reset(request({actor:student})),403,'ROLE_FORBIDDEN');await rejects(f.learning.reset(request({csrf:false})),403,'CSRF_REJECTED');
 for(const fields of [{confirm:false},{confirm:'true'},{learningEpoch:undefined},{requestId:'bad'},{studentId:student.id},{grade:1},{targetId:teacher.id}]){
  const req=request();Object.assign(req.body,fields);await rejects(f.learning.reset(req),400,'INVALID_REQUEST');
 }assert.equal(f.rows.size,0);
});
test('reset preserves old data, changes only own private namespace, and never emits research events',async()=>{
 const f=fixture(),legacy=new Map([[teacher.id,{reading:93}],[student.id,{reading:81}]]),other={...teacher,id:'t_'+'c'.repeat(24)};
 const before=await f.learning.scope(teacher),result=await f.learning.reset(request()),after=await f.learning.scope(teacher);
 assert.equal(result.userId,teacher.id);assert.equal(before.studentId,teacher.id);assert.match(after.studentId,/^v_[a-f0-9]{28}$/);assert.equal(after.learningEpoch,result.learningEpoch);
 assert.deepEqual(legacy.get(teacher.id),{reading:93});assert.deepEqual(legacy.get(student.id),{reading:81});assert.equal(legacy.has(after.studentId),false);
 assert.equal((await f.learning.scope(other)).studentId,other.id);assert.deepEqual([...f.rows.keys()],['learning/'+teacher.id]);
 await rejects(f.learning.scope(teacher,{forSave:true}),409,'LEARNING_RESET');await rejects(f.learning.scope(teacher,{forSave:true,learningEpoch:'initial'}),409,'LEARNING_RESET');
 assert.equal((await f.learning.scope(teacher,{forSave:true,learningEpoch:result.learningEpoch})).studentId,after.studentId);
 // A save already admitted before reset remains in its historical namespace.
 legacy.set(before.studentId,{reading:99});assert.equal(legacy.has(after.studentId),false);
});
test('a retry is idempotent and competing resets cannot clear a newer generation',async()=>{
 const f=fixture(),req=request(),results=await Promise.all([f.learning.reset(req),f.learning.reset(structuredClone(req))]);assert.deepEqual(results[0],results[1]);
 assert.deepEqual(await f.learning.reset(req),results[0]);await rejects(f.learning.reset(request()),409,'LEARNING_RESET');
 const next=request();next.body.learningEpoch=results[0].learningEpoch;const second=await f.learning.reset(next);assert.notEqual(second.learningEpoch,results[0].learningEpoch);
 await rejects(f.learning.reset(req),409,'LEARNING_RESET');
});
test('corrupt reset metadata fails closed rather than restoring old progress',async()=>{
 const f=fixture();f.rows.set('learning/'+teacher.id,{version:'1',value:{epoch:'garbage'}});
 await assert.rejects(f.learning.scope(teacher),/Invalid learning generation/);
});
test('Blob key boundary accepts only teacher learning metadata',async()=>{
 const requested=[];const store=auth.createBlobStore({get:async key=>{requested.push(key);return null;}});
 await store.get('learning/'+teacher.id);assert.equal(requested.length,1);
 for(const key of ['learning/'+student.id,'learning/../directory/current','learning/'+teacher.id+'/student'])await assert.rejects(store.get(key),/Invalid auth key/);
 assert.equal(requested.length,1);
});
