'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const analysis=require('../api/_lib/teacher-analysis.cjs'),auth=require('../api/_lib/school-auth.cjs');
const {createHandler}=require('../api/_lib/teacher-assistant-handler.cjs');
const now=Date.parse('2026-09-20T10:00:00.000Z');
const teacher={id:'t_'+'a'.repeat(24),role:'teacher'};
const env={TEACHER_AI_MODEL:'deepseek-v4-pro',GPT_API_KEY:'synthetic-only-not-a-credential',GPT_API_BASE:'https://api.example.invalid'};
function dataset(){const score={measuredN:1,unmeasuredN:1,meanScore:0,correctN:0,incorrectN:1};return {
 schemaVersion:1,filters:{from:'2026-09-01',to:'2026-09-20',grade:2,poemId:2,cls:'A',attempt:'latest'},snapshotId:'synthetic-snapshot',generatedAt:new Date(now).toISOString(),rosterSummary:{totalStudents:2,withRecords:1,noRecords:1},
 analytics:{coverage:{nEvents:2,nStudents:1,nInvalidEvents:0},sync:{status:'current',lastImportedAt:new Date(now).toISOString(),lagMs:0},summary:{nEvents:2,nStudents:1,nAttempts:1,completedN:0,nInvalidEvents:0,practiceOutcomeN:0,byConstruct:{'reading.pronunciation':{serverVerified:score,clientReported:{...score,meanScore:100}}}},byGrade:[],byClass:[],trend:[],readingWords:[{char:'李',poemId:2,meanScore:0,count:1,below60Count:1}],students:[{researchId:'r_private-id',displayName:'PRIVATE_NAME',login:'PRIVATE_LOGIN'}]},
 students:[{researchId:'r_private-id',displayName:'PRIVATE_NAME',grade:2,cls:'A',classNo:1,stats:{private:'PRIVATE_STUDENT_CONTENT'}}]
};}
function validOutput(){return {lessonPlans:[{grades:[2],title:'聽讀練習',durationMinutes:20,objectives:['跟讀一句原詩'],materials:['平台示範聲音'],evidenceIds:['F001'],stages:[{title:'聽讀',minutes:10,teacher:'示範原句',students:'聆聽跟讀',check:'觀察字音'},{title:'練習',minutes:10,teacher:'安排原句朗讀',students:'錄音練習',check:'查看同類評測'}],differentiation:{support:'再聽一次',extension:'自己讀一次'},assessment:'用同一句再讀'}],title:'普通話學習概覽',overview:'現有資料有限，先觀察同類練習。',findings:[{title:'參與資料',evidenceIds:['F001','F002'],interpretation:'這是名冊及已收到記錄的觀察。'}],teachingActions:[{priority:'high',title:'下一課聽讀',evidenceIds:['F002'],steps:['先示範，再短句跟讀。']}],reviewPlan:[{title:'再次觀察',evidenceIds:['F002'],steps:['下一課收集同類朗讀記錄。']}],limitations:['未收到記錄不等於未有練習。']};}
function provider(output=validOutput()){return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:200,completion_tokens:150}}),{status:200,headers:{'Content-Type':'application/json'}});}
function memoryStore(){const data=new Map();return {data,async get(key){return data.has(key)?structuredClone(data.get(key)):null;},async cas(key,value,version){const old=data.get(key);if((old?.version??undefined)!==(version??undefined))return false;data.set(key,{value:structuredClone(value),version:String(Number(old?.version||0)+1)});return true;}};}
const followUp=()=>({students:[{researchId:'r_private-id',displayName:'PRIVATE_NAME',reasons:[{construct:'reading.pronunciation',score:0,source:'serverVerified'}]}],unstartedIds:[],absenceReliable:true,criteria:'same snapshot'});
function service(options={}){return analysis.createService({store:memoryStore(),env,now:()=>now,loadDataset:async()=>dataset(),buildFollowUp:followUp,fetchImpl:async()=>provider(),...options});}
function response(){return {statusCode:200,headers:{},setHeader(key,value){this.headers[key]=value;},status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};}

test('provider model is explicit and no missing-model fallback can silently select Flash',()=>{
 assert.throws(()=>analysis.modelConfig({...env,TEACHER_AI_MODEL:undefined}),error=>error.code==='AI_NOT_CONFIGURED');
 assert.equal(analysis.modelConfig(env).url,'https://api.example.invalid/v1/chat/completions');
 assert.equal(analysis.modelConfig({...env,GPT_API_BASE:'https://api.example.invalid/v1/'}).url,'https://api.example.invalid/v1/chat/completions');
 assert.throws(()=>analysis.modelConfig({...env,GPT_API_BASE:'http://localhost/'}));
});

test('LLM evidence whitelist excludes every identity and per-student record and preserves zero/source distinctions',()=>{
 const input=dataset();input.analytics.byGrade.push({grade:2,displayName:'PRIVATE_NAME',nStudents:1,byConstruct:input.analytics.summary.byConstruct});
 const payload=analysis.aggregateEvidence(input),serialized=JSON.stringify(payload);
 assert.doesNotMatch(serialized,/PRIVATE_|private-id|researchId|displayName|login/);
 assert.ok(payload.evidence.some(f=>f.label.endsWith('平均值')&&f.value===0&&f.source==='平台評分'));
 assert.ok(payload.evidence.some(f=>f.label.endsWith('平均值')&&f.value===100&&f.source==='練習回報'));
 assert.ok(payload.evidence.some(f=>f.label.endsWith('未測量')&&f.value===1));
});

test('complete immutable report retains its exact private dataset while public response omits dataset; same facts reuse without billing',async()=>{
 let calls=0;const snapshot=dataset(),store=memoryStore(),s=service({store,loadDataset:async()=>snapshot,fetchImpl:async(url,options)=>{
  calls++;const request=JSON.parse(options.body);assert.equal(request.model,'deepseek-v4-pro');assert.equal(request.thinking.type,'disabled');assert.equal(request.response_format.type,'json_object');assert.doesNotMatch(options.body,/PRIVATE_|private-id/);return provider();
 }});
 const first=await s.generate({},snapshot.filters,teacher);assert.equal(first.cached,false);assert.equal(first.report.dataset,undefined);assert.equal(first.report.followUp.students[0].displayName,'PRIVATE_NAME');
 snapshot.generatedAt='2026-09-20T10:10:00.000Z';snapshot.analytics.sync.lagMs=600000;snapshot.analytics.sync.lastImportedAt=snapshot.generatedAt;
 const cached=await s.generate({},snapshot.filters,teacher);assert.equal(cached.cached,true);assert.equal(cached.reportId,first.reportId);assert.equal(calls,1);
 const full=await s.getReport(first.reportId);assert.equal(full.dataset.generatedAt,new Date(now).toISOString());assert.equal(full.dataset.students[0].displayName,'PRIVATE_NAME');
 assert.equal((await s.check(first.reportId)).report.dataset,undefined);
});

test('new selected-data snapshot creates a new report and completed-report corruption fails closed',async()=>{
 let calls=0;const input=dataset(),store=memoryStore(),s=service({store,loadDataset:async()=>input,fetchImpl:async()=>{calls++;return provider();}});
 const a=await s.generate({},input.filters,teacher);input.snapshotId='second-snapshot';const b=await s.generate({},input.filters,teacher);assert.notEqual(a.reportId,b.reportId);assert.equal(calls,2);
 const record=store.data.get('report/'+a.reportId.slice(3));record.value.report.analysis.overview='changed';await assert.rejects(s.getReport(a.reportId),error=>error.code==='REPORT_STORAGE_UNAVAILABLE');
});

test('shared CAS lease makes concurrent requests use one generation and only real pending work returns generating',async()=>{
 const store=memoryStore();let start,finish,calls=0;const started=new Promise(resolve=>start=resolve);
 const opts={store,fetchImpl:async()=>{calls++;start();await new Promise(resolve=>finish=resolve);return provider();}};
 const a=service(opts),b=service(opts),first=a.generate({},dataset().filters,teacher);await started;
 const pending=await b.generate({},dataset().filters,teacher);assert.equal(pending.status,'generating');assert.equal((await b.check(pending.reportId)).status,'generating');assert.equal(calls,1);
 finish();const done=await first;assert.equal((await b.getReport(done.reportId)).reportId,done.reportId);assert.equal(calls,1);
});

test('expired abandoned generation lease asks for regeneration and a new POST recovers it',async()=>{
 let clock=now;const store=memoryStore(),s=service({store,now:()=>clock});const first=await s.generate({},dataset().filters,teacher),key='report/'+first.reportId.slice(3);
 store.data.set(key,{version:'10',value:{schemaVersion:1,status:'pending',leaseId:'abandoned',leaseUntil:now-1}});
 await assert.rejects(s.check(first.reportId),error=>error.code==='ANALYSIS_RETRY_REQUIRED'&&error.status===409);
 const recovered=await s.generate({},dataset().filters,teacher);assert.equal(recovered.reportId,first.reportId);assert.equal(recovered.cached,false);
});

test('empty selected data makes no paid request and creates no report or quota object',async()=>{
 const input=dataset();input.analytics.coverage.nEvents=0;input.analytics.summary.nEvents=0;const store=memoryStore();let calls=0;
 const s=service({store,loadDataset:async()=>input,fetchImpl:async()=>{calls++;return provider();}});
 await assert.rejects(s.generate({},input.filters,teacher),error=>error.code==='NO_LEARNING_DATA'&&error.status===422);assert.equal(calls,0);assert.equal(store.data.size,0);
});

test('provider rate limit, timeout and invalid evidence remain honest failures without a fabricated report',async()=>{
 for(const [responseFactory,code,status]of [[async()=>new Response('private-provider-error',{status:429}),'AI_RATE_LIMITED',429],[async()=>{const error=new Error('private-timeout');error.name='TimeoutError';throw error;},'AI_TIMEOUT',504],[async()=>provider({...validOutput(),findings:[{title:'wrong',evidenceIds:['F99999'],interpretation:'made up'}]}),'AI_INVALID_RESPONSE',502]]){
  const store=memoryStore();let calls=0;const s=service({store,fetchImpl:async()=>{calls++;return responseFactory();}});
  await assert.rejects(s.generate({},dataset().filters,teacher),error=>error.code===code&&error.status===status);
  await assert.rejects(s.generate({},dataset().filters,teacher),error=>error.code===code);assert.equal(calls,1);
  const record=[...store.data].find(([key])=>key.startsWith('report/'))[1];assert.equal(record.value.status,'failed');assert.equal(record.value.report,undefined);assert.doesNotMatch(JSON.stringify(record),/private-provider-error|private-timeout/);
 }
});

test('per-teacher persisted quota limits new report generation while completed cache does not consume quota',async()=>{
 const input=dataset();let calls=0;const s=service({loadDataset:async()=>input,fetchImpl:async()=>{calls++;return provider();}});
 const first=await s.generate({},input.filters,teacher);await s.generate({},input.filters,teacher);assert.equal(calls,1);
 for(const snapshot of ['two','three']){input.snapshotId=snapshot;await s.generate({},input.filters,teacher);}
 input.snapshotId='four';await assert.rejects(s.generate({},input.filters,teacher),error=>error.code==='AI_RATE_LIMITED');assert.equal(calls,3);assert.equal((await s.getReport(first.reportId)).reportId,first.reportId);
});

test('private Blob store enforces namespace/private access, reads etags and honors CAS collisions',async()=>{
 const objects=new Map();let revision=0;
 const client={async get(path,options){assert.equal(options.access,'private');const item=objects.get(path);return item?{statusCode:200,blob:{etag:item.etag,size:Buffer.byteLength(item.body)},stream:new Response(item.body).body}:null;},async put(path,body,options){assert.ok(path.startsWith(analysis.NS+'/'));assert.equal(options.access,'private');assert.equal(options.addRandomSuffix,false);const prior=objects.get(path);if(prior&&options.ifMatch!==prior.etag||!prior&&options.allowOverwrite)throw new Error('already exists');objects.set(path,{body,etag:String(++revision)});return {pathname:path};}};
 const store=analysis.createBlobStore(client),key='report/'+'a'.repeat(64);assert.equal(await store.get(key),null);assert.equal(await store.cas(key,{status:'pending'}),true);
 const prior=await store.get(key);assert.equal(await store.cas(key,{status:'completed'},prior.version),true);assert.equal(await store.cas(key,{status:'wrong'},prior.version),false);assert.equal((await store.get(key)).value.status,'completed');
 await assert.rejects(store.get('../production'));
});

test('PostgreSQL report store uses only its own CAS table and never runtime DDL',async()=>{
 const calls=[],db={async query(sql,args){calls.push({sql,args});return sql.startsWith('SELECT')?{rows:[{value:{status:'pending'},version:'4'}]}:{rowCount:1};}},store=analysis.createPostgresStore(db),key='report/'+'a'.repeat(64);
 assert.equal((await store.get(key)).version,'4');assert.equal(await store.cas(key,{status:'pending'}),true);assert.equal(await store.cas(key,{status:'completed'},'4'),true);
 assert.ok(calls.every(call=>call.sql.includes('teacher_analysis_records')));assert.ok(calls.every(call=>!call.sql.startsWith('CREATE')));assert.ok(calls[2].sql.includes('version=$3'));assert.equal(calls[2].args[2],'4');
});

test('analysis endpoint requires teacher, POST CSRF, allows read-only GET without Origin and accepts filters only',async()=>{
 const permissions=[],fakeAuth={async requireActor(req,options){permissions.push(options);return teacher;},sendError:auth.sendError},fakeService={async generate(){return {ok:true,reportId:'ta_'+'a'.repeat(64),report:{}};},async check(){return {ok:true,status:'generating',reportId:'ta_'+'a'.repeat(64),retryAfterSeconds:3};}};
 const handler=createHandler({authModule:fakeAuth,analysisModule:fakeService}),post=response();await handler({method:'POST',body:{filters:dataset().filters}},post);assert.equal(post.statusCode,200);
 const get=response();await handler({method:'GET',headers:{},query:{tool:'analysis',reportId:'ta_'+'a'.repeat(64)}},get);assert.equal(get.statusCode,202);assert.equal(get.headers['Retry-After'],'3');assert.equal(permissions[0].csrf,true);assert.equal(permissions[1].csrf,false);assert.ok(permissions.every(p=>p.roles[0]==='teacher'));
 for(const body of [{filters:dataset().filters,summary:'forged'},{filters:{...dataset().filters,student:'r_private'}},{filters:dataset().filters,refresh:true}]){const res=response();await handler({method:'POST',body},res);assert.equal(res.statusCode,400);}
 const forbidden=createHandler({authModule:{...fakeAuth,requireActor:async()=>({id:'s_test',role:'student'})},analysisModule:fakeService}),res=response();await forbidden({method:'POST',body:{filters:{}}},res);assert.equal(res.statusCode,403);
 const noCsrf=createHandler({authModule:{...fakeAuth,requireActor:async()=>{throw new auth.AuthError(403,'CSRF_REJECTED');}},analysisModule:fakeService}),csrf=response();await noCsrf({method:'POST',body:{filters:{}}},csrf);assert.equal(csrf.statusCode,403);
});

test('normalized dataset filter errors retain 400 instead of becoming storage failures',async()=>{
 const {TeacherDataError}=require('../api/_lib/teacher-data.cjs');
 const handler=createHandler({authModule:{requireActor:async()=>teacher},analysisModule:{generate:async()=>{throw new TeacherDataError('INVALID_FILTERS',400);}}}),res=response();
 await handler({method:'POST',body:{filters:dataset().filters}},res);assert.equal(res.statusCode,400);assert.equal(res.body.code,'INVALID_FILTERS');assert.equal(res.body.retryable,false);
});

test('a provider returning another model is rejected, never silently labelled as the selected model',async()=>{
 await assert.rejects(analysis.requestAnalysis(analysis.aggregateEvidence(dataset()),analysis.modelConfig(env),{fetchImpl:async()=>new Response(JSON.stringify({model:'deepseek-flash',choices:[{message:{content:JSON.stringify(validOutput())}}]}))}),error=>error.code==='AI_MODEL_MISMATCH');
});

test('provider contract refuses truncated/non-JSON/oversized replies and does not leak provider content',async()=>{
 for(const response of [new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:JSON.stringify(validOutput())}}]})),new Response(JSON.stringify({choices:[{message:{content:'private raw provider failure'}}]})),new Response('x'.repeat(140000))])await assert.rejects(analysis.requestAnalysis(analysis.aggregateEvidence(dataset()),analysis.modelConfig(env),{fetchImpl:async()=>response}),error=>error.code==='AI_INVALID_RESPONSE'&&!error.message.includes('private'));
});

test('whole-school summaries retain all 31 classes and six grades in the focused provider evidence',async()=>{
 const input=dataset(),constructs=['reading.pronunciation','writing.dictation','sound.recognition','match.accuracy','sequence.accuracy','scene_builder.accuracy'];
 delete input.filters.grade;delete input.filters.cls;
 const full={nEvents:1200,nStudents:24,nAttempts:100,completedN:30,nInvalidEvents:0,practiceOutcomeN:20,byConstruct:Object.fromEntries(constructs.map(key=>[key,{serverVerified:{measuredN:24,unmeasuredN:2,meanScore:70},clientReported:{measuredN:24,unmeasuredN:2,meanScore:71}}]))};
 input.analytics.summary=full;input.analytics.byGrade=Array.from({length:6},(_,i)=>({...full,grade:i+1}));
 input.analytics.byClass=Array.from({length:31},(_,i)=>({...full,grade:Math.floor(i/6)+1,cls:String.fromCharCode(65+i%6)}));
 const payload=analysis.aggregateEvidence(input);
 assert(Buffer.byteLength(JSON.stringify(payload))<160*1024);
 assert.equal(payload.detailLevel,'school_and_grades_with_class_participation');
 for(const row of input.analytics.byClass)assert(payload.evidence.some(f=>f.scope===row.grade+row.cls+'班'));
 assert.equal(payload.curriculum.length,6);
 let sent;
 const generated=await analysis.requestAnalysis(payload,analysis.modelConfig(env),{fetchImpl:async(url,options)=>{sent=JSON.parse(JSON.parse(options.body).messages[1].content);return provider(validOutput());}});
 assert(generated.analysis.overview);
 for(const row of input.analytics.byClass)assert(sent.evidence.some(f=>f.scope===row.grade+row.cls+'班'));
 for(let grade=1;grade<=6;grade++){
  for(const construct of ['朗讀字音評分','默寫辨識準確度','辨音答題準確度'])assert(sent.evidence.some(f=>f.scope===grade+'年級'&&f.label===construct+'：有效測量'));
 }
 assert.equal(sent.curriculum.length,6);assert.equal(sent.teachingFocus.length,6);assert.equal(sent.interpretationRules,undefined);
 assert(!sent.evidence.some(f=>f.label.endsWith('：平均值')&&!f.label.startsWith('朗讀')));
});

module.exports={dataset,validOutput};

test('provider punctuation repair preserves strings and evidence, but never admits truncated or unsupported output',async()=>{
 const input=analysis.aggregateEvidence(dataset()),valid=validOutput(),broken=JSON.stringify(valid).replace('"limitations":', '"limitations" ');
 const respond=(content,finish_reason='stop')=>new Response(JSON.stringify({model:env.TEACHER_AI_MODEL,choices:[{finish_reason,message:{content}}]}));
 const result=await analysis.requestAnalysis(input,analysis.modelConfig(env),{fetchImpl:async()=>respond(broken)});
 const mismatch=JSON.stringify(valid).replace('"steps":["下一課收集同類朗讀記錄。"]','"steps":["下一課收集同類朗讀記錄。"}');
 const recovered=await analysis.requestAnalysis(input,analysis.modelConfig(env),{fetchImpl:async()=>respond(mismatch)});
 assert.equal(recovered.syntaxRepaired,true);assert.deepEqual(recovered.analysis,analysis.validateAnalysis(valid,input.evidence));
 assert.equal(result.syntaxRepaired,true);assert.deepEqual(result.analysis,analysis.validateAnalysis(valid,input.evidence));
 await assert.rejects(analysis.requestAnalysis(input,analysis.modelConfig(env),{fetchImpl:async()=>respond(broken,'length')}),e=>e.code==='AI_INVALID_RESPONSE');
 const bad=broken.replaceAll('F001','F99999');
 await assert.rejects(analysis.requestAnalysis(input,analysis.modelConfig(env),{fetchImpl:async()=>respond(bad)}),e=>e.code==='AI_INVALID_RESPONSE');
 await assert.rejects(analysis.requestAnalysis(input,analysis.modelConfig(env),{fetchImpl:async()=>respond('{"title":"no report"}')}),e=>e.code==='AI_INVALID_RESPONSE');
});

test('quality review persists an undisclosed draft, one leased model revision uses the same dataset, and cache never bills again',async()=>{
 const store=memoryStore();let calls=0,loads=0,release,started;const begun=new Promise(r=>started=r);
 const flawed={...validOutput(),overview:'學生朗讀表現中等。'};
 const svc=service({store,loadDataset:async()=>{loads++;return dataset();},fetchImpl:async(url,options)=>{
  calls++;const body=JSON.parse(options.body);
  if(calls===1)return provider(flawed);
  assert.equal(body.messages.length,4);assert.equal(body.messages[2].role,'assistant');assert.match(body.messages[3].content,/最小必要修正/);assert.match(body.messages[3].content,/不從零重寫/);assert.deepEqual(JSON.parse(body.messages[2].content).findings,flawed.findings);assert.doesNotMatch(options.body,/PRIVATE_NAME|PRIVATE_LOGIN|r_private/);started();await new Promise(r=>release=r);return provider();
 }});
 const initial=await svc.generate({},dataset().filters,teacher);assert.equal(initial.nextAction,'continue');assert.equal(initial.report,undefined);
 assert.equal((await svc.check(initial.reportId)).nextAction,'continue');assert.equal(calls,1);
 await assert.rejects(svc.getReport(initial.reportId),e=>e.code==='REPORT_NOT_READY');
 await assert.rejects(svc.continueReport(initial.reportId,{id:'student',role:'student'}),e=>e.status===403);
 const revision=svc.continueReport(initial.reportId,teacher);await begun;
 const concurrent=await svc.continueReport(initial.reportId,teacher);assert.equal(concurrent.status,'generating');assert.equal(calls,2);
 release();const done=await revision;assert.equal(done.report.qualityReview.passed,true);assert.equal(done.report.qualityReview.revisions,1);assert.equal(done.report.analysis.title,'2年級A班普通話教研報告');
 assert.equal(loads,1);assert.equal((await svc.continueReport(initial.reportId,teacher)).cached,true);assert.equal(calls,2);
 assert.equal((await svc.getReport(initial.reportId)).dataset.students[0].displayName,'PRIVATE_NAME');
});
test('a revision still violating content rules never becomes an exportable report',async()=>{
 let calls=0;const store=memoryStore(),svc=service({store,fetchImpl:async()=>{calls++;return provider({...validOutput(),overview:'整體能力中等。'});}});
 const first=await svc.generate({},dataset().filters,teacher);assert.equal(first.nextAction,'continue');
 await assert.rejects(svc.continueReport(first.reportId,teacher),e=>e.code==='AI_REPORT_QUALITY');assert.equal(calls,2);
 await assert.rejects(svc.getReport(first.reportId),e=>e.code==='AI_REPORT_QUALITY');
 await assert.rejects(svc.continueReport(first.reportId,teacher),e=>e.code==='AI_REPORT_QUALITY');assert.equal(calls,2);
 const failed=store.data.get('report/'+first.reportId.slice(3)).value;
 assert.equal(failed.promptVersion,analysis.PROMPT_VERSION);
 assert.deepEqual(failed.qualityIssues,[{code:'UNSUPPORTED_ABILITY_LEVEL',path:'overview'}]);
 assert.doesNotMatch(JSON.stringify(failed),/整體能力|PRIVATE_|draftReport|evidenceIds/);
});

test('narrative evidence distinguishes unique completed students, paired learning observations and character-average thresholds',()=>{
 const input=dataset(),score=value=>({measuredN:1,meanScore:value}),person=(reading,writing,completedN)=>({rosterMatched:true,stats:{nEvents:4,completedN,latest:{byConstruct:{'reading.pronunciation':{serverVerified:score(reading)},'writing.dictation':{serverVerified:score(writing)}}}}});
 input.students=[person(45,90,4),person(50,55,2),person(90,40,0)];input.rosterSummary={totalStudents:3,withRecords:3,noRecords:0};
 input.analytics.readingCharacterAnalysis={poems:[{grade:2,poemId:2,title:'贈汪倫',lines:[{lineIndex:0,words:[{char:'舟',meanScore:72,count:3},{char:'乘',meanScore:88,count:2}]}]}]};
 const p=analysis.aggregateEvidence(input);assert.equal(p.reportStyle,'narrative-teaching-review');
 assert.equal(p.evidence.find(f=>f.label==='有活動完成紀錄的名冊學生').value,2);
 const paired=p.evidence.find(f=>f.label.startsWith('朗讀字音評分與默寫辨識準確度：'));
 assert.deepEqual(paired.value,{bothMeasuredStudents:3,bothBelow60Students:1,leftBelow60Students:2,rightBelow60Students:2,leftOnlyBelow60Students:1,rightOnlyBelow60Students:1,neitherBelow60Students:0});
 assert.deepEqual(p.teachingGroups[0],{evidenceId:paired.id,domains:['朗讀字音評分','默寫辨識準確度'],bothMeasuredStudents:3,groups:[{count:1,focus:['朗讀字音評分']},{count:1,focus:['默寫辨識準確度']},{count:1,focus:['朗讀字音評分','默寫辨識準確度']}]});
 assert.deepEqual(p.evidence.find(f=>f.label==='全詩逐字平均的觀察範圍').value,{measuredPositions:2,meanBelow80Positions:1});
 assert.deepEqual(p.evidence.find(f=>f.label==='「舟」逐字平均').value,{meanScore:72,measuredStudents:3});
 assert.deepEqual(p.teachingFocus[0].readingLines,[{lineNumber:1,text:'李白乘舟將欲行',observeCharacters:['舟']}]);
 assert.deepEqual(p.teachingFocus[0].writingCharacters,['舟']);
 assert.doesNotMatch(JSON.stringify(p),/researchId|displayName|PRIVATE_/);
});

test('teaching groups contain only observed nonempty disjoint groups and exclude missing scores',()=>{
 const input=dataset(),metric=value=>({measuredN:value===null?0:1,meanScore:value});
 const person=(reading,writing)=>({rosterMatched:true,stats:{nEvents:2,latest:{byConstruct:{'reading.pronunciation':{serverVerified:metric(reading)},'writing.dictation':{serverVerified:metric(writing)}}}}});
 input.students=[person(45,90),person(50,80),person(90,40),person(80,80),person(30,null)];
 const payload=analysis.aggregateEvidence(input),pair=payload.evidence.find(f=>f.label.endsWith('：同一批學生觀察'));
 assert.deepEqual(pair.value,{bothMeasuredStudents:4,bothBelow60Students:0,leftBelow60Students:2,rightBelow60Students:1,leftOnlyBelow60Students:2,rightOnlyBelow60Students:1,neitherBelow60Students:1});
 assert.deepEqual(payload.teachingGroups[0].groups,[{count:2,focus:['朗讀字音評分']},{count:1,focus:['默寫辨識準確度']}]);
 assert.doesNotMatch(JSON.stringify(payload.teachingGroups),/researchId|displayName|PRIVATE_/);
});

test('selected teaching lines retain their original poem numbers when the focus skips a line',async()=>{
 const input=dataset();input.filters={...input.filters,grade:6,poemId:6};
 input.analytics.readingCharacterAnalysis={poems:[{grade:6,poemId:6,title:'初春小雨',lines:[
  {lineIndex:0,words:[{char:'天',meanScore:68.9,count:20},{char:'潤',meanScore:68.9,count:20}]},
  {lineIndex:1,words:[{char:'看',meanScore:68.9,count:20}]},
  {lineIndex:2,words:[{char:'一',meanScore:68.9,count:20},{char:'處',meanScore:68.9,count:20}]}
 ]}]};
 const p=analysis.aggregateEvidence(input);
 assert.deepEqual(p.teachingFocus[0].readingLines,[{lineNumber:1,text:'天街小雨潤如酥',observeCharacters:['天','潤']},{lineNumber:3,text:'最是一年春好處',observeCharacters:['一','處']}]);
 await analysis.requestAnalysis(p,analysis.modelConfig(env),{fetchImpl:async(_url,options)=>{
  const request=JSON.parse(options.body),sent=JSON.parse(request.messages[1].content);
  assert.deepEqual(sent.teachingFocus[0].readingLines.map(line=>line.lineNumber),[1,3]);
  assert.match(request.messages[0].content,/「第一、第三句」或「上述兩句」/);assert.match(request.messages[0].content,/「有X人完成」/);return provider();
 }});
});

test('empty groups and character prevalence trigger one targeted revision before report export',async()=>{
 const input=dataset(),metric=value=>({measuredN:1,meanScore:value});
 input.filters={...input.filters,grade:6,poemId:6};
 input.students=[[45,90],[90,40]].map(([reading,writing])=>({rosterMatched:true,stats:{nEvents:2,latest:{byConstruct:{'reading.pronunciation':{serverVerified:metric(reading)},'writing.dictation':{serverVerified:metric(writing)}}}}}));
 input.analytics.readingCharacterAnalysis={poems:[{grade:6,poemId:6,title:'初春小雨',lines:[{lineIndex:0,words:[{char:'潤',meanScore:68.9,count:2}]}]}]};
 const flawed=validOutput();flawed.overview='這些字音的問題具有普遍性。';flawed.teachingActions=[{title:'分組練習',priority:'high',evidenceIds:['F001'],steps:['朗讀與默寫可分成三組；兩項皆低於60分的學生，先做聽辨再寫字。']}];
 let calls=0;const store=memoryStore(),svc=service({store,loadDataset:async()=>input,fetchImpl:async(url,options)=>{
  calls++;const body=JSON.parse(options.body),payload=JSON.parse(body.messages[1].content);
  assert.equal(payload.teachingGroups[0].groups.length,2);assert(payload.teachingGroups[0].groups.every(group=>group.focus.length===1));
  if(calls===1)return provider(flawed);
  assert.match(body.messages[3].content,/EMPTY_LEARNING_GROUP/);assert.match(body.messages[3].content,/UNSUPPORTED_CHARACTER_PREVALENCE/);
  const revised=validOutput();revised.overview='下一課先共同跟讀原句，再逐一聽取，安排仍需鞏固的學生再讀。';revised.teachingActions[0].steps=['朗讀需要鞏固的學生先聽原句再讀；書寫需要鞏固的學生練寫「潤」，教師分別聽取和檢查，再調整下次練習。'];revised.limitations=[];
  return provider(revised);
 }});
 const pending=await svc.generate({},input.filters,teacher);assert.equal(pending.nextAction,'continue');assert.equal(pending.report,undefined);
 await assert.rejects(svc.getReport(pending.reportId),error=>error.code==='REPORT_NOT_READY');
 const result=await svc.continueReport(pending.reportId,teacher);assert.equal(result.report.qualityReview.revisions,1);assert.deepEqual(result.report.analysis.limitations,[]);
 assert.doesNotMatch(JSON.stringify(result.report.analysis),/普遍性|三組|兩項皆低|不足以|不能推斷/);
 assert.equal((await svc.generate({},input.filters,teacher)).cached,true);assert.equal(calls,2);
});

test('v15 retains exactly one paired cohort and whole-class follow-up totals',async()=>{
 const input=dataset(),metric=value=>({measuredN:value===null?0:1,meanScore:value});
 input.filters={...input.filters,grade:6,poemId:6};
 input.students=[[45,90,40],[45,80,90],[90,40,90],[null,40,90]].map(([reading,writing,sound])=>({rosterMatched:true,stats:{nEvents:3,latest:{byConstruct:{'reading.pronunciation':{serverVerified:metric(reading)},'writing.dictation':{serverVerified:metric(writing)},'sound.recognition':{serverVerified:metric(sound)}}}}}));
 const payload=analysis.aggregateEvidence(input);
 assert.equal(analysis.PROMPT_VERSION,'teacher-analysis-v15-clear-references');
 assert.equal(payload.evidence.filter(f=>f.label.endsWith('：同一批學生觀察')).length,3,'keep every paired fact in the stored audit evidence');
 assert.equal(payload.teachingGroups.length,1);assert.deepEqual(payload.teachingGroups[0].domains,['朗讀字音評分','辨音答題準確度']);
 await analysis.requestAnalysis(payload,analysis.modelConfig(env),{fetchImpl:async(_url,options)=>{
  const body=JSON.parse(options.body),provided=JSON.parse(body.messages[1].content);
  assert.equal(provided.teachingGroups.length,1);
  const pairFacts=provided.evidence.filter(f=>f.label.endsWith('：同一批學生觀察'));assert.equal(pairFacts.length,1);assert.equal(pairFacts[0].id,provided.teachingGroups[0].evidenceId);
  assert.equal(provided.evidence.find(f=>f.label==='默寫辨識準確度：個人平均低於60分的名冊學生').value,2,'the missing-reading pupil remains in whole-class dictation follow-up');
  assert.match(body.messages[0].content,/整篇報告的交集/);assert.match(body.messages[0].content,/這類解釋數據局限的句子整句省略/);
  return provider();
 }});
});

test('the actual defensive sentence triggers a private single revision that deletes it rather than restating it',async()=>{
 const flawed=validOutput();flawed.findings=[{title:'先跟讀再個別聽取',evidenceIds:['F001'],interpretation:'逐字平均分是全班整體表現的參考，不能直接推論每個人都錯，因此個別聽取是必要的。'}];flawed.limitations=[];
 let calls=0;const store=memoryStore(),svc=service({store,fetchImpl:async(_url,options)=>{
  calls++;const body=JSON.parse(options.body);
  if(calls===1)return provider(flawed);
  assert.match(body.messages[3].content,/REPORT_DEFENSIVE_LANGUAGE/);assert.match(body.messages[3].content,/刪除整句/);assert.match(body.messages[3].content,/第三項只寫全班實際跟進人數及教法/);
  const repaired={...flawed,findings:[{...flawed.findings[0],interpretation:'全班跟讀原句後，教師逐一聽取，讓仍需鞏固的學生再讀一次。'}]};return provider(repaired);
 }});
 const pending=await svc.generate({},dataset().filters,teacher);assert.equal(pending.report,undefined);assert.equal(pending.nextAction,'continue');
 await assert.rejects(svc.getReport(pending.reportId),e=>e.code==='REPORT_NOT_READY');
 const done=await svc.continueReport(pending.reportId,teacher);assert.equal(done.report.qualityReview.revisions,1);assert.equal(done.report.promptVersion,'teacher-analysis-v15-clear-references');
 assert.doesNotMatch(done.report.analysis.findings[0].interpretation,/參考|推論|不能|局限/);
 assert.equal((await svc.generate({},dataset().filters,teacher)).cached,true);assert.equal(calls,2);
});
test('continuation is a teacher-CSRF POST and accepts only a report identity',async()=>{
 let continued=0;const handler=createHandler({authModule:{requireActor:async(req,options)=>{assert.equal(options.csrf,true);return teacher;}},analysisModule:{continueReport:async(id,actor)=>{continued++;assert.equal(id,'ta_'+'a'.repeat(64));assert.equal(actor,teacher);return {ok:true,status:'generating',reportId:id,retryAfterSeconds:3};}}});
 const res=response();await handler({method:'POST',body:{reportId:'ta_'+'a'.repeat(64)}},res);assert.equal(res.statusCode,202);assert.equal(continued,1);
 const bad=response();await handler({method:'POST',body:{reportId:'ta_'+'a'.repeat(64),analysis:validOutput()}},bad);assert.equal(bad.statusCode,400);assert.equal(continued,1);
});

test('compressed private Blob reads use the stored entity tag for conditional revision writes',async()=>{
 let match;
 const client={get:async()=>({statusCode:200,blob:{etag:'W/"stored-revision"',size:0},stream:new Response('{"status":"pending"}').body}),put:async(key,body,options)=>{match=options.ifMatch;if(match!=='"stored-revision"')throw new Error('already exists');}};
 const store=analysis.createBlobStore(client),key='report/'+'b'.repeat(64),prior=await store.get(key);
 assert.equal(prior.value.status,'pending');assert.equal(await store.cas(key,{status:'completed'},prior.version),true);assert.equal(match,'"stored-revision"');
});

test('teacher prose prompt accepts no limitations, keeps the provider model, and reserves demo marking for the document header',async()=>{
 const input=dataset();input.demo=true;const output={...validOutput(),overview:'本班2人，已有1人的練習紀錄。下一課先聽《贈汪倫》的首句，再分句跟讀。',limitations:[]};let request;
 const result=await analysis.requestAnalysis(analysis.aggregateEvidence(input),analysis.modelConfig(env),{fetchImpl:async(url,options)=>{request=JSON.parse(options.body);return provider(output);}});
 assert.deepEqual(result.analysis.limitations,[]);assert.equal(request.model,env.TEACHER_AI_MODEL);
 assert.match(request.messages[0].content,/文件頁首由系統加一次/);assert.match(request.messages[0].content,/"limitations":\[\]/);
 assert.match(request.messages[0].content,/資深教師/);assert.match(request.messages[0].content,/普通話/);assert.match(request.messages[0].content,/整體評價→主要發現→教學建議/);
 assert.doesNotMatch(request.messages[0].content,/\?{3,}|\uFFFD/);
 assert.doesNotMatch(request.messages[0].content,/概覽首句必須寫|必要限制。單班/);
 const omitted={...output};delete omitted.limitations;assert.deepEqual(analysis.validateAnalysis(omitted,analysis.aggregateEvidence(input).evidence).limitations,[]);
 const oneParagraph=structuredClone(output);oneParagraph.teachingActions[0].steps=oneParagraph.teachingActions[0].steps[0];oneParagraph.reviewPlan[0].steps=oneParagraph.reviewPlan[0].steps[0];
 const accepted=analysis.validateAnalysis(oneParagraph,analysis.aggregateEvidence(input).evidence);
 assert.deepEqual(accepted.teachingActions[0].steps,output.teachingActions[0].steps);assert.deepEqual(accepted.reviewPlan[0].steps,output.reviewPlan[0].steps);
});

test('provider reference completion fixes a uniquely supported count without rewriting prose or adding ungrounded facts',async()=>{
 const p=analysis.aggregateEvidence(dataset());
 p.evidence.push({id:'F999',label:'朗讀字音評分：個人平均低於60分的名冊學生',value:8,unit:'人',scope:'所選範圍',source:'平台評分'});
 const output=validOutput();output.findings=[{title:'跟進朗讀',evidenceIds:['F001'],interpretation:'朗讀個人平均低於60分的有8人，宜個別聽取原句。另有99人需要跟進。'}];
 const result=await analysis.requestAnalysis(p,analysis.modelConfig(env),{fetchImpl:async()=>provider(output)});
 assert.equal(result.analysis.findings[0].interpretation,output.findings[0].interpretation);
 assert.deepEqual(result.analysis.findings[0].evidenceIds,['F001','F999']);
 assert(require('../api/_lib/teacher-report-quality.cjs').inspectAnalysis(result.analysis,{...p,reportStyle:'narrative-teaching-review'}).some(issue=>issue.code==='UNSUPPORTED_REPORTED_NUMBER'));
});

test('completed v7, v13 and v14 reports cannot satisfy the v15 teacher-prose generation cache',async()=>{
 const research=require('../api/_lib/research-store.cjs'),input=dataset(),payload=analysis.aggregateEvidence(input),store=memoryStore();
 const dataFingerprint=research.hash(research.canonical({snapshotId:input.snapshotId,payload}));
 const oldIds=['teacher-analysis-v7-reviewed-demo','teacher-analysis-v13-observed-groups','teacher-analysis-v14-focused-prose'].map(promptVersion=>{
  const oldId='ta_'+research.hash(research.canonical({dataFingerprint,model:env.TEACHER_AI_MODEL,provider:analysis.modelConfig(env).url,promptVersion}));
  store.data.set('report/'+oldId.slice(3),{version:'1',value:{status:'completed',report:{reportId:oldId,analysis:{overview:'Old technical report'}}}});return oldId;
 });
 let calls=0;const svc=service({store,fetchImpl:async()=>{calls++;return provider({...validOutput(),limitations:[]});}}),result=await svc.generate({},input.filters,teacher);
 assert(oldIds.every(oldId=>result.reportId!==oldId));assert.equal(result.cached,false);assert.equal(calls,1);assert.equal(result.report.promptVersion,analysis.PROMPT_VERSION);
});

test('technical or repetitive demo prose is revised without releasing the draft as a report',async()=>{
 const input=dataset();input.demo=true;let calls=0;
 const svc=service({loadDataset:async()=>input,fetchImpl:async()=>{calls++;return provider(calls===1?{...validOutput(),overview:'以下全部是模擬資料。伺服器核實的測量不能推斷聲母、韻母或聲調錯誤。'}:{...validOutput(),overview:'本班2人，已有1人的練習紀錄。先安排原句聽讀，再了解另一位學生的練習情況。',limitations:[]});}});
 const first=await svc.generate({},input.filters,teacher);assert.equal(first.nextAction,'continue');assert.equal(first.report,undefined);
 await assert.rejects(svc.getReport(first.reportId),e=>e.code==='REPORT_NOT_READY');
 const done=await svc.continueReport(first.reportId,teacher);assert.equal(done.report.qualityReview.passed,true);assert.equal(calls,2);
 assert.doesNotMatch(JSON.stringify(done.report.analysis),/伺服器|模擬|不能推斷/);assert.deepEqual(done.report.analysis.limitations,[]);
});
