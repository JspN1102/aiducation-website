'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mergePracticePayload,restorePracticeHistory}=require('../api/_lib/practice-progress.cjs');
async function fixture(){
 const [state,data]=await Promise.all([import('../maanshan/challenge-state.mjs'),import('../maanshan/challenge-data.mjs')]);
 const set=data.CHALLENGE_SETS['zao-chun'],first=state.newAttempt(set,{seed:'progress-full'});
 for(let index=0;index<5;index++)state.recordAnswer(first,set,index,{status:'correct',...index===0?{response:{gameCompleted:true}}:{}});
 first.answers.forEach((answer,index)=>answer.submittedAt=1000+index);delete first.itemRecords;
 const next=state.newAttempt(set,{previous:first,seed:'progress-partial'});next.itemIds=[...first.itemIds];next.orders=structuredClone(first.orders);
 for(let index=0;index<2;index++)state.recordAnswer(next,set,index,{status:index?'incorrect':'correct',...index===0?{response:{gameCompleted:true}}:{}});
 next.answers.forEach((answer,index)=>answer.submittedAt=2000+index);delete next.itemRecords;
 const stale=state.newAttempt(set,{previous:first,seed:'progress-stale'});delete stale.itemRecords;delete stale.resultArchive;
 return{state,set,first,next,stale};
}
test('server payload merge retains unredone results and zero scores without overwriting latest reading or current round',async()=>{
 const {state,set,first,next,stale}=await fixture();
 const full={learningState:{challenge:first},totalScore:80};
 const partial=await mergePracticePayload({learningState:{challenge:next},totalScore:92},full,6);
 assert.equal(partial.challenge.answered,5);assert.equal(partial.challenge.correct,4);assert.equal(partial.totalScore,92);
 assert.equal(partial.learningState.challenge.answers.length,2);
 const merged=await mergePracticePayload({learningState:{challenge:stale},totalScore:93},partial,6);
 assert.equal(merged.challenge.answered,5);assert.equal(merged.challenge.correct,4);assert.equal(merged.learningState.challenge.answers.length,0);
 assert.equal(state.practiceRecordSummary(merged.learningState.challenge,set,{which:'best'}).correct,5);
 assert.equal(merged.learningState.challenge.attemptId,stale.attemptId);assert.equal(merged.totalScore,93);
});
test('PostgreSQL history restoration is read-only and scoped to the authenticated learning namespace and poem',async()=>{
 const {first,next,stale}=await fixture(),calls=[];
 const pool={async query(sql,params){calls.push({sql,params});return{rows:[{poem_id:6,challenge:next},{poem_id:1,challenge:first},{poem_id:6,challenge:first}]};}};
 const progress={6:{reading:{totalScore:91,learningState:{reading:[{index:0,score:91}],challenge:stale}},writing:{untouched:true}}};
 await restorePracticeHistory(pool,{studentId:'teacher-epoch-synthetic',grade:null,cls:'T',poemIds:[6]},progress);
 assert.equal(calls.length,1);assert.match(calls[0].sql,/^SELECT/);assert.doesNotMatch(calls[0].sql,/\b(INSERT|DELETE|UPDATE)\b/);
 assert.deepEqual(calls[0].params,['teacher-epoch-synthetic',null,'T',[6]]);
 assert.match(calls[0].sql,/jsonb_array_length/,'the most complete actual attempt survives a later stale save');
 assert.equal(progress[6].reading.challenge.answered,5);assert.equal(progress[6].reading.challenge.correct,4);
 assert.equal(progress[6].reading.totalScore,91);assert.deepEqual(progress[6].writing,{untouched:true});
 assert.equal(progress[6].reading.learningState.challenge.answers.length,0);assert.equal(progress[1],undefined);
});
test('history restoration with no allowed poems performs no query and unrelated payloads remain unchanged',async()=>{
 const payload={totalScore:90},progress={6:{reading:payload}};
 assert.equal(await mergePracticePayload(payload,{totalScore:2},6),payload);
 assert.equal(await mergePracticePayload(payload,{learningState:{challenge:{}}},99),payload);
 assert.equal(await restorePracticeHistory({query(){assert.fail('unexpected query');}},{poemIds:[]},progress),progress);
});
