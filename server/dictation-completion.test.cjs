'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ExcelJS=require('exceljs');
const research=require('../api/_lib/research-store.cjs'),{buildPracticeSummary}=require('../api/_lib/teacher-practice-summary.cjs');
const {buildDataset}=require('../api/_lib/teacher-data.cjs'),{buildXlsx}=require('../api/_lib/teacher-documents.cjs');
const FLOW='trace-dictation-v1',AT=Date.parse('2026-09-22T10:00:00Z'),person={researchId:'r_'+ 'a'.repeat(24),displayName:'測試學生',grade:6,cls:'A',classNo:1};
const attempt=randomUUID(),session=randomUUID();
function row({at=0,item='g6-d1',type='dictation',flow=true,operation='challenge',result={status:'completed',score:null,correct:null},traceCompleted=true,dictationCompleted=false}={}){
 const context={mode:'standard',itemType:type,position:3,total:5,...(flow?{flow:FLOW,traceCompleted,dictationCompleted}:{})};
 const event={eventId:randomUUID(),sessionId:session,attemptId:attempt,seq:0,activeMs:0,clientAt:new Date(AT+at).toISOString(),poemId:6,activity:type==='dictation'?'writing':'challenge',type:'provider_result',appVersion:'test',contentVersion:'test',itemId:item,operation,provider:'synthetic',model:'synthetic',providerVersion:'test',context,result};
 return{schemaVersion:1,...person,source:'server_verified',serverReceivedAt:event.clientAt,qualityFlags:[],event,eventChecksum:research.hash(research.canonical({researchId:person.researchId,source:'server_verified',event}))};
}
test('guided writing retains recognition outcomes but teacher summary records completion without a grade',()=>{
 const rows=[row({operation:'handwriting',result:{status:'incorrect',score:0,correct:false}}),row({at:1}),row({at:2,operation:'handwriting',result:{status:'correct',score:100,correct:true}}),row({at:3,dictationCompleted:true})];
 const before=JSON.stringify(rows),summary=buildPracticeSummary(rows);
 assert.equal(summary.completedN,1);assert.equal(summary.correctN,0);assert.equal(summary.measuredN,0);
 assert.deepEqual(summary.items.map(i=>[i.status,i.score,i.flow,i.traceCompleted,i.dictationCompleted]),[['completed',null,FLOW,true,true]]);
 assert.equal(JSON.stringify(rows),before,'the raw first wrong and corrected provider results are retained');
 const dataset=buildDataset({rows},[person],{grade:6,poemId:6,cls:'A',from:'2026-09-22',to:'2026-09-22',attempt:'latest'},AT+10);
 assert.equal(dataset.analytics.summary.byConstruct['writing.dictation'],undefined);
});
test('trace alone or a skipped independent task remains unfinished',()=>{
 for(const rows of [[row()], [row({operation:'handwriting',result:{status:'correct',score:100,correct:true}})], [row({result:{status:'skipped',score:null,correct:null}})]]){
  const summary=buildPracticeSummary(rows);assert.equal(summary.completedN,0);assert.equal(summary.correctN,0);assert.equal(summary.measuredN,0);assert.equal(summary.items[0].status,'incomplete');assert.equal(summary.items[0].score,null);
 }
});
test('a later interrupted guided attempt cannot erase a completed item',()=>{
 const completed=row({dictationCompleted:true}),partial=row({at:10});partial.event.attemptId=randomUUID();
 const summary=buildPracticeSummary([completed,partial]);assert.equal(summary.items[0].status,'completed');assert.equal(summary.items[0].attemptId,attempt);
});

test('late trace-only or skip receipts cannot undo completion within the same attempt',()=>{
 for(const result of [{status:'completed',score:null,correct:null},{status:'skipped',score:null,correct:null}]){
  const completed=row({at:10,dictationCompleted:true}),delayed=row({at:1,result});
  delayed.serverReceivedAt=new Date(AT+20).toISOString();
  for(const rows of [[completed,delayed],[delayed,completed]]){
   const before=JSON.stringify(rows),summary=buildPracticeSummary(rows),item=summary.items[0];
   assert.equal(item.status,'completed');assert.equal(item.dictationCompleted,true);assert.equal(item.traceCompleted,true);
   assert.equal(item.best.status,'completed');assert.equal(summary.completedN,1);assert.equal(summary.correctN,0);assert.equal(summary.measuredN,0);
   assert.equal(JSON.stringify(rows),before,'both arrival records stay in raw history');
  }
 }
});

test('finishing an unfinished guided item in review updates teacher completion without adding a review grade',()=>{
 const skipped=row({result:{status:'skipped',score:null,correct:null}}),finished=row({at:10,dictationCompleted:true}),recognition=row({at:9,operation:'handwriting',result:{status:'correct',score:100,correct:true}});
 const reviewId=randomUUID();
 for(const value of [finished,recognition]){value.event.attemptId=reviewId;value.event.context.mode='review';value.event.context.sourceAttemptId=attempt;}
 const oldWriting=row({at:11,item:'old-review',flow:false,operation:'handwriting',result:{status:'correct',score:100,correct:true}}),oldSound=row({at:12,item:'sound-review',type:'sound',flow:false,result:{status:'correct',score:100,correct:true}});
 for(const value of [oldWriting,oldSound]){value.event.attemptId=reviewId;value.event.context.mode='review';value.event.context.sourceAttemptId=attempt;}
 const rows=[skipped,finished,recognition,oldWriting,oldSound],before=JSON.stringify(rows),summary=buildPracticeSummary(rows);
 assert.equal(summary.items.length,1);assert.equal(summary.items[0].status,'completed');assert.equal(summary.items[0].traceCompleted,true);assert.equal(summary.items[0].dictationCompleted,true);
 assert.equal(summary.completedN,1);assert.equal(summary.correctN,0);assert.equal(summary.measuredN,0);assert.equal(summary.items[0].score,null);assert.equal(JSON.stringify(rows),before);
});
test('sound choices and historical independent dictation keep their original grading',()=>{
 const rows=[row({dictationCompleted:true}),row({item:'sound',type:'sound',flow:false,result:{status:'incorrect',score:0,correct:false}}),row({item:'old-write',flow:false,operation:'handwriting',result:{status:'correct',score:100,correct:true}})];
 const summary=buildPracticeSummary(rows);assert.equal(summary.completedN,3);assert.equal(summary.correctN,1);assert.equal(summary.measuredN,2);assert.equal(summary.items.find(i=>i.itemId==='sound').score,0);assert.equal(summary.items.find(i=>i.itemId==='old-write').status,'correct');
});
test('new research metadata is strict and cannot reinterpret another task as tracing',()=>{
 assert.equal(research.validateEvent(row({dictationCompleted:true}).event,true).context.flow,FLOW);
 for(const overrides of [{type:'sound'},{traceCompleted:false,dictationCompleted:true}])assert.throws(()=>research.validateEvent(row(overrides).event,true));
});
test('cross-device snapshot preserves completion and first wrong independently',async()=>{
 const state=await import('../maanshan/challenge-state.mjs'),{CHALLENGE_SETS}=await import('../maanshan/challenge-data.mjs'),{compactLearningSnapshot}=await import('../maanshan/learning-snapshot.mjs');
 const set=CHALLENGE_SETS['zao-chun'],saved=state.newAttempt(set,{seed:'completion-only'}),items=state.attemptItems(saved,set),index=items.findIndex(item=>item.type==='dictation');
 for(let i=0;i<index;i++)state.recordAnswer(saved,set,i,{status:'skipped'});
 state.recordAnswer(saved,set,index,{status:'incorrect',flow:FLOW,traceCompleted:true,dictationCompleted:false});
 saved.writingCorrections={[items[index].id]:{status:'corrected'}};
 const compact=compactLearningSnapshot({challenge:saved}),restored=state.readAttempt(compact.challenge,set),summary=state.practiceRecordSummary(restored,set);
 assert.equal(restored.answers[index].status,'incorrect');assert.equal(restored.answers[index].traceCompleted,true);assert.equal(restored.answers[index].flow,FLOW);
 assert.equal(summary.answers[0].dictationCompleted,true);assert.equal(summary.answers[0].status,'incorrect');assert.equal(summary.correct,0);
});

test('wrong-question review omits completed guided writing but retains unfinished skipped writing',async()=>{
 const state=await import('../maanshan/challenge-state.mjs'),{CHALLENGE_SETS}=await import('../maanshan/challenge-data.mjs');
 const set=CHALLENGE_SETS['zao-chun'],saved=state.newAttempt(set,{seed:'guided-review'}),items=state.attemptItems(saved,set);
 const dictations=items.filter(item=>item.type==='dictation');assert.equal(dictations.length,2);
 const completedId=dictations[0].id,skippedId=dictations[1].id;
 for(let index=0;index<items.length;index++){
  const item=items[index];
  const answer=item.id===completedId?{status:'incorrect',flow:FLOW,traceCompleted:true,dictationCompleted:false}
   :item.id===skippedId?{status:'skipped',flow:FLOW,traceCompleted:true,dictationCompleted:false}
    :item.type==='microgame'?{status:'correct',response:{gameCompleted:true}}:{status:'incorrect'};
  assert(state.recordAnswer(saved,set,index,answer));
 }
 saved.writingCorrections={[completedId]:{status:'corrected'},[skippedId]:{status:'skipped'}};
 const review=state.newReviewAttempt(set,saved,{seed:'unfinished-only'});assert(review);
 assert(!review.itemIds.includes(completedId),'a corrected learning task must not be assigned again as a wrong answer');
 assert(review.itemIds.includes(skippedId),'an unfinished skipped learning task remains available for practice');
 assert(review.itemIds.some(id=>items.find(item=>item.id===id).type==='sound'),'independent sound mistakes remain in the review');
 assert.equal(saved.answers.find(answer=>answer.itemId===completedId).status,'incorrect','review planning preserves the raw first independent error');
});

test('guided completion from review persists into the next round without rewriting the original skip',async()=>{
 const state=await import('../maanshan/challenge-state.mjs'),{CHALLENGE_SETS}=await import('../maanshan/challenge-data.mjs'),{compactLearningSnapshot}=await import('../maanshan/learning-snapshot.mjs');
 const set=CHALLENGE_SETS['zao-chun'],saved=state.newAttempt(set,{seed:'review-finish'}),items=state.attemptItems(saved,set),target=items.find(item=>item.type==='dictation');
 for(let index=0;index<items.length;index++){
  const item=items[index],answer=item.id===target.id?{status:'skipped',flow:FLOW,traceCompleted:true,dictationCompleted:false}
   :item.type==='dictation'?{status:'correct',flow:FLOW,traceCompleted:true,dictationCompleted:true}
    :item.type==='microgame'?{status:'correct',response:{gameCompleted:true}}:{status:'correct'};
  assert(state.recordAnswer(saved,set,index,answer));
 }
 saved.writingCorrections={[target.id]:{status:'skipped'}};
 const review=state.newReviewAttempt(set,saved,{seed:'finish-skipped'});assert.deepEqual(review.itemIds,[target.id]);
 assert(state.recordAnswer(review,set,0,{status:'correct',flow:FLOW,traceCompleted:true,dictationCompleted:true}));
 const summary=state.practiceRecordSummary(review,set),completed=summary.answers.find(answer=>answer.itemId===target.id);
 assert(completed);assert.equal(completed.dictationCompleted,true);assert.equal(completed.traceCompleted,true);assert.equal(completed.flow,FLOW);
 assert.equal(review.sourceAttempt.answers.find(answer=>answer.itemId===target.id).status,'skipped');assert.equal(saved.answers.find(answer=>answer.itemId===target.id).status,'skipped');
 const next=state.newAttempt(set,{previous:review,seed:'after-guided-review'}),snapshot=compactLearningSnapshot({challenge:next}),restored=state.readAttempt(snapshot.challenge,set),persisted=state.practiceRecordSummary(restored,set).answers.find(answer=>answer.itemId===target.id);
 assert(persisted);assert.equal(persisted.dictationCompleted,true);assert.equal(persisted.flow,FLOW);
});
test('teacher list labels guided writing completed or unfinished while retaining sound outcomes',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../maanshan/teacher-dashboard.mjs'),'utf8'),render=vm.runInNewContext(`(${source.slice(source.indexOf('function studentPracticeBody('),source.indexOf('function studentLearningBody('))})`,{esc:value=>String(value??''),shown:value=>String(value??0)});
 const summary=buildPracticeSummary([row({dictationCompleted:true}),row({item:'unfinished'}),row({item:'sound',type:'sound',flow:false,result:{status:'incorrect',score:0,correct:false}})]),html=render({practiceSummary:summary});
 assert.match(html,/描紅與聽寫/);assert.match(html,/>完成<\/strong>/);assert.match(html,/>未完成<\/strong>/);assert.match(html,/再試一次/);
});
test('Excel shows guided completion counts and does not turn tracing into 100 points',async()=>{
 const rows=[row({dictationCompleted:true}),row({item:'unfinished'})],dataset=buildDataset({rows},[person],{grade:6,poemId:6,cls:'A',from:'2026-09-22',to:'2026-09-22',attempt:'latest'},AT+10),workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(await buildXlsx(dataset));const sheet=workbook.getWorksheet('學生明細');
 assert.equal(sheet.getCell('G1').value,'描紅與聽寫');assert.equal(sheet.getCell('G2').value,'完成 1 / 2 題');assert.equal(sheet.getCell('H2').value,'完成 1 / 5 題；答對 0 題');
});
test('answer endpoint accepts an unscored trace process receipt only for the new dictation flow',async t=>{
 const auth=require('../api/_lib/school-auth.cjs'),handler=require('../api/challenge-result.js'),{CHALLENGE_SETS}=await import('../maanshan/challenge-data.mjs');
 const learner={id:'s_'+ 'b'.repeat(24),role:'student',grade:6,cls:'A',researchId:person.researchId};
 t.mock.method(auth,'enabled',()=>true);t.mock.method(auth,'requireActor',async()=>learner);const stored=[];
 t.mock.method(research,'recordVerifiedOutcome',async(req,outcome)=>{stored.push({context:structuredClone(req.body.researchContext.context),result:outcome.result});return{recorded:true};});
 const item=CHALLENGE_SETS['zao-chun'].bank.find(i=>i.type==='dictation'),sound=CHALLENGE_SETS['zao-chun'].bank.find(i=>i.type==='sound');
 const base={poemId:6,itemId:item.id,status:'completed',researchContext:{actorId:learner.id,poemId:6,itemId:item.id,context:{mode:'standard',itemType:'dictation',flow:FLOW,traceCompleted:true,dictationCompleted:false}}};
 const response=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}});
 const accepted=response();await handler({method:'POST',body:structuredClone(base)},accepted);assert.equal(accepted.statusCode,200);assert.deepEqual(stored[0].result,{status:'completed',score:null,correct:null});assert.equal(stored[0].context.dictationCompleted,false);
 for(const edit of [body=>{delete body.researchContext.context.flow;},body=>{body.researchContext.context.traceCompleted=false;},body=>{body.researchContext.context.dictationCompleted=true;},body=>{body.itemId=sound.id;body.researchContext.itemId=sound.id;body.researchContext.context.itemType='sound';}]){
  const body=structuredClone(base);edit(body);const denied=response();await handler({method:'POST',body},denied);assert.equal(denied.statusCode,400);
 }
 assert.equal(stored.length,1);
});
test('queued trace process completion survives reload without being relabelled skipped',async()=>{
 const {createAnswerOutbox}=await import('../maanshan/answer-outbox.mjs'),memory=new Map(),storage={get length(){return memory.size;},key:i=>[...memory.keys()][i],getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
 const options={actorId:'s_'+ 'c'.repeat(24),csrfToken:'synthetic',storage},input={poemId:6,itemId:'g6-d1',status:'completed',researchContext:{sessionId:session,attemptId:attempt,activity:'writing',appVersion:'test',contentVersion:'test',context:{mode:'standard',itemType:'dictation',flow:FLOW,traceCompleted:true,dictationCompleted:false}}};
 const first=createAnswerOutbox({...options,fetchImpl:async()=>{throw Error('offline');}});assert.equal(first.enqueue(input),true);await first.flush();assert.equal(first.status().pending,1);first.stop();
 const sent=[],second=createAnswerOutbox({...options,fetchImpl:async(url,request)=>{sent.push(JSON.parse(request.body));return{ok:true,status:200,json:async()=>({ok:true,researchRecorded:true})};}});await second.flush();
 assert.equal(sent.length,1);assert.equal(sent[0].status,'completed');assert.deepEqual(sent[0].researchContext.context,input.researchContext.context);assert.equal(second.status().pending,0);
 const invalid=createAnswerOutbox({...options,fetchImpl:async()=>assert.fail('invalid trace reached network')});assert.equal(invalid.enqueue({...input,researchContext:{...input.researchContext,context:{mode:'standard',itemType:'sound'}}}),false);invalid.stop();
});
