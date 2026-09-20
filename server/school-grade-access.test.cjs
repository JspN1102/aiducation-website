'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
const auth=require('../api/_lib/school-auth.cjs'),studentStore=require('../api/_lib/student-store.js');
const actor={id:'s_'+'a'.repeat(24),researchId:'r_'+'b'.repeat(24),role:'student',grade:2,cls:'A',displayName:'Synthetic student'};
function response(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}
function loadHandler(name,stubs){const file=path.join(__dirname,'../api',name),compiled=esbuild.transformSync(fs.readFileSync(file,'utf8'),{format:'cjs',loader:'js'}),m={exports:{}};new Function('require','module','exports',compiled.code)(id=>Object.hasOwn(stubs,id)?stubs[id]:require(id.startsWith('.')?path.resolve(path.dirname(file),id):id),m,m.exports);return m.exports.default;}
function dependencies(person,extra={}){return {'./_lib/school-auth.cjs':{...auth,enabled:()=>true,requireActor:async()=>person,...extra},'./_lib/student-store.js':{...studentStore,mode:()=>false},'@vercel/blob':{get:async()=>assert.fail('unexpected Blob read')}};}

test('save rejects cross-grade and self-granted capability; teacher/test progress remains owned by authenticated identity',async()=>{
 let writes=0,lastArgs;const db={isDbReady:()=>true,execute:async(_sql,args)=>{writes++;lastArgs=args;return {rowCount:1};}};
 const body={studentId:actor.id,poemId:6,section:'reading',payload:{learningState:{reading:[]}},isTest:true,learningScope:'all-grades',grade:6,cls:'Z'};
 const student=loadHandler('maanshan-save.js',{...dependencies(actor),'./_lib/db.js':db}),denied=response();await student({method:'POST',body:{...body}},denied);assert.equal(denied.statusCode,422);assert.equal(denied.body.retryable,false);assert.equal(writes,0);
 const own=response();await student({method:'POST',body:{...body,poemId:2}},own);assert.equal(own.statusCode,200);assert.equal(lastArgs[0],actor.id);assert.equal(lastArgs[2],2);assert.equal(lastArgs[3],'A');
 for(const learner of [{...actor,isTest:true,learningScope:'all-grades'},{...actor,id:'t_'+'c'.repeat(24),role:'teacher',grade:null,cls:null}]){
  const handler=loadHandler('maanshan-save.js',{...dependencies(learner),'./_lib/db.js':db});
  for(let poemId=1;poemId<=6;poemId++){const res=response();await handler({method:'POST',body:{...body,studentId:learner.id,poemId}},res);assert.equal(res.statusCode,200);assert.equal(lastArgs[0],learner.id);assert.equal(lastArgs[2],poemId);assert.equal(lastArgs[3],learner.cls||'T');}
 }
});

test('progress GET filters old other-grade history without deleting it and teachers/test accounts see only their own six poems',async()=>{
 const historical=Array.from({length:6},(_,i)=>({poem_id:i+1,section:'reading',payload:{testGrade:i+1}}));
 for(const learner of [actor,{...actor,isTest:true,learningScope:'all-grades'},{...actor,id:'t_'+'c'.repeat(24),role:'teacher',grade:null,cls:null}]){
  let reads=0;
  const pool={query:async(sql,args)=>{reads++;assert.match(sql,/^SELECT/);assert(!/DELETE|UPDATE/.test(sql));assert.equal(args[0],learner.id);assert.deepEqual(args[3],auth.allowedPoemIds(learner));return {rows:structuredClone(historical)};}};
  const handler=loadHandler('school-auth.js',dependencies(learner,{getStore:()=>({pool})})),res=response();await handler({method:'GET',query:{action:'progress',grade:6,isTest:true}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.userId,learner.id);assert.deepEqual(Object.keys(res.body.poems).map(Number),auth.allowedPoemIds(learner));assert.equal(reads,1);assert.equal(historical.length,6);
 }
});

test('legacy teacher data excludes private teacher and test-account progress by official student roster',async()=>{
 const teacher={id:'t_'+'c'.repeat(24),role:'teacher'},rows=[{student_id:actor.id,name:'Student',section:'reading',payload:{totalScore:70},updated_at:'2026-09-20'},{student_id:'s_'+'d'.repeat(24),name:'Test',section:'reading',payload:{totalScore:100},updated_at:'2026-09-20'},{student_id:teacher.id,name:'Teacher',section:'reading',payload:{totalScore:100},updated_at:'2026-09-20'}];
 const handler=loadHandler('maanshan-data.js',{...dependencies(teacher,{listAccounts:async()=>[actor]}),'./_lib/db.js':{isDbReady:()=>true,query:async()=>rows}}),res=response();await handler({method:'GET',query:{grade:'2',cls:'A',poemId:'2'}},res);assert.equal(res.statusCode,200);assert.equal(res.body.stats.total,1);assert.equal(res.body.stats.avg,70);assert.deepEqual(res.body.students.map(p=>p.id),[actor.id]);
});
