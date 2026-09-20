'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const handler=require('../api/teacher-tools.js'),auth=require('../api/_lib/school-auth.cjs'),research=require('../api/_lib/research-store.cjs');
const demo=require('../api/_lib/teacher-demo-data.cjs'),analysis=require('../api/_lib/teacher-analysis.cjs');
const ExcelJS=require('exceljs');
const actor={id:'t_demo_route_unit',role:'teacher'};
const response=()=>({headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;}});
async function withAuth(run){
 const previous=auth.requireActor,previousList=auth.listAccounts,permissions=[];
 auth.listAccounts=async()=>demo.demoRoster();
 auth.requireActor=async(req,options)=>{permissions.push(options);if(req.denied)throw new auth.AuthError(req.denied,'DENIED_TEST');return req.student?{id:'s_demo_student',role:'student'}:actor;};
 try{return await run(permissions);}finally{auth.requireActor=previous;auth.listAccounts=previousList;}
}
test('real demo multiplexer rejects anonymous/student and requires CSRF on both paid and export POSTs',async()=>withAuth(async permissions=>{
 for(const [tool,body]of [['demo-data',undefined],['demo-analysis',{filters:{}}],['demo-export',{action:'xlsx',filters:{}}]])for(const mode of ['anonymous','student','csrf']){
  const res=response(),req={method:tool==='demo-data'?'GET':'POST',query:{tool,kind:'analytics'},body,...mode==='student'?{student:true}:{denied:mode==='anonymous'?401:403}};
  await handler(req,res);assert.equal(res.statusCode,mode==='anonymous'?401:403);assert.equal(res.headers['Cache-Control'],'private, no-store');assert(!Buffer.isBuffer(res.body));assert(!res.body.students);
 }
 assert(permissions.every(p=>p.roles.includes('teacher')));
 assert(permissions.filter(p=>p.csrf!==undefined).every(p=>p.csrf===true));
}));
test('actual demo GET and student lookup are isolated, bounded JSON, and accept every synthetic research ID',async()=>withAuth(async()=>{
 const oldPg=research.readPostgres,oldPublished=research.readPublished;research.readPostgres=research.readPublished=async()=>{throw new Error('PRODUCTION_READ_FORBIDDEN');};
 try{
  let res=response();await handler({method:'GET',query:{tool:'demo-data',kind:'roster'}},res);assert.equal(res.statusCode,200);assert.equal(res.body.students.length,775);assert.equal(res.body.demo,true);assert.deepEqual(res.body.teachers,[]);
  for(const p of res.body.students)assert.doesNotThrow(()=>research.filtersFrom({student:p.researchId}));
  const person=res.body.students.find(p=>p.grade===2&&p.cls==='A'&&p.classNo===1);
  res=response();await handler({method:'GET',query:{tool:'demo-data',kind:'analytics'}},res);assert.equal(res.statusCode,200);assert.equal(res.body.demo,true);assert.equal(res.body.coverage.nStudents,682);assert.equal(res.body.byClass.length,31);assert(Buffer.byteLength(JSON.stringify(res.body))<4*1024*1024);assert.match(res.body.demoNotice,/模擬資料/);assert.equal(res.headers.Vary,'Cookie');
  res=response();await handler({method:'GET',query:{tool:'demo-data',kind:'analytics',student:person.researchId,grade:'2',cls:'A'}},res);assert.equal(res.statusCode,200);assert.equal(res.body.students.length,1);assert.equal(res.body.students[0].researchId,person.researchId);assert.equal(res.body.students[0].latest.byConstruct['reading.pronunciation'].serverVerified.meanScore,0);
  for(const query of [{kind:'roster',student:person.researchId},{kind:'analytics',student:'r_short'},{kind:'analytics',from:'2026-01-01',to:'2026-09-20'},{kind:'analytics',grade:'9'}]){res=response();await handler({method:'GET',query:{tool:'demo-data',...query}},res);assert.equal(res.statusCode,400);assert.notEqual(res.body.code,'DEMO_UNAVAILABLE');}
 }finally{research.readPostgres=oldPg;research.readPublished=oldPublished;}
}));
test('demo export is a real teacher-only XLSX with explicit simulated title/filename and scoped roster',async()=>withAuth(async()=>{
 const res=response();await handler({method:'POST',query:{tool:'demo-export'},body:{action:'xlsx',filters:{grade:2,cls:'A'}}},res);assert.equal(res.statusCode,200);assert(Buffer.isBuffer(res.body));assert.equal(res.body.subarray(0,2).toString(),'PK');assert.match(decodeURIComponent(res.headers['Content-Disposition']),/模擬_/);assert.match(res.headers['Content-Type'],/spreadsheetml/);assert.match(res.headers['X-Data-Snapshot'],/^[a-f0-9]{64}$/);
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(res.body);assert.deepEqual(wb.worksheets.map(sheet=>sheet.name),['學生明細']);assert.match(wb.title,/模擬/);assert.equal(wb.getWorksheet('學生明細').rowCount,26);assert.match(String(wb.getWorksheet('學生明細').getCell('D2').value),/示範學生/);assert.equal(wb.getWorksheet('學生明細').getCell('P1').value,'跟進提示');
}));
test('real Blob and PostgreSQL adapters keep identical demo/formal report keys in separate namespaces',async()=>{
 const objects=new Map();let tick=0;const client={async get(key){const r=objects.get(key);return r?{statusCode:200,blob:{etag:r.version,size:Buffer.byteLength(r.body)},stream:new Response(r.body).body}:null;},async put(key,body,options){const old=objects.get(key);if(old&&options.ifMatch!==old.version)throw new Error('already exists');objects.set(key,{body,version:String(++tick)});return {};}};
 const formal=analysis.createBlobStore(client),synthetic=analysis.createBlobStore(client,analysis.NS+'-demo'),key='report/'+'e'.repeat(64);
 await formal.cas(key,{formal:true},null);assert.equal(await synthetic.get(key),null);await synthetic.cas(key,{demo:true},null);assert.deepEqual((await formal.get(key)).value,{formal:true});assert.deepEqual((await synthetic.get(key)).value,{demo:true});assert.deepEqual([...objects.keys()].sort(),[analysis.NS+'-demo/'+key+'.json',analysis.NS+'/'+key+'.json'].sort());
 const queries=[],db={async query(sql,args){queries.push({sql,args});return sql.startsWith('SELECT')?{rows:[]}:{rowCount:1};}};const pg=analysis.createPostgresStore(db,'demo/');await pg.get(key);await pg.cas(key,{demo:true},null);assert(queries.every(c=>c.args[0]==='demo/'+key));assert(queries.every(c=>c.sql.includes('teacher_analysis_records')&&!c.sql.includes('research_events')));
});
