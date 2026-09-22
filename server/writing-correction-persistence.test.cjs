'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mergePracticePayload}=require('../api/_lib/practice-progress.cjs');
async function fixture(){
 const [state,data,snapshot]=await Promise.all([import('../maanshan/challenge-state.mjs'),import('../maanshan/challenge-data.mjs'),import('../maanshan/learning-snapshot.mjs')]);
 const set=data.CHALLENGE_SETS['zao-chun'],attempt=state.newAttempt(set,{seed:'correction-persistence'}),items=state.attemptItems(attempt,set),index=items.findIndex(item=>item.type==='dictation');
 for(let i=0;i<=index;i++)state.recordAnswer(attempt,set,i,{status:i===index?'incorrect':i===0?'skipped':'correct'});
 attempt.cursor=index;
 return{state,snapshot,set,attempt,items,index,id:items[index].id};
}
test('correction survives compact snapshot, JSON storage, server merge and prepare without changing the first grade',async()=>{
 const {state,snapshot,set,attempt,id,index}=await fixture(),first=structuredClone(attempt.answers[index]);
 attempt.writingCorrections={[id]:{status:'corrected',recognized:'DO_NOT_UPLOAD',candidates:['DO_NOT_UPLOAD'],strokes:[[[1]]]},unknown:{status:'corrected'}};
 const compact=snapshot.compactLearningSnapshot({challenge:attempt});
 assert.deepEqual(compact.challenge.writingCorrections,{[id]:{status:'corrected'}});assert.doesNotMatch(JSON.stringify(compact),/DO_NOT_UPLOAD|strokes|candidates/);
 const stored=JSON.parse(JSON.stringify({learningState:compact})),merged=await mergePracticePayload(stored,{},6),restored=state.prepareAttempt(set,merged.learningState.challenge);
 assert.equal(restored.writingCorrections[id].status,'corrected');assert.deepEqual(restored.answers[index],first);assert.equal(state.practiceRecordSummary(restored,set).answers.find(a=>a.itemId===id).status,'incorrect');
});
test('same-round stale save cannot erase correction but another round cannot inherit the unlock',async()=>{
 const {state,snapshot,set,attempt,id,index}=await fixture(),stale=structuredClone(attempt);
 attempt.writingCorrections={[id]:{status:'corrected'}};
 const merged=await mergePracticePayload({learningState:snapshot.compactLearningSnapshot({challenge:stale})},{learningState:snapshot.compactLearningSnapshot({challenge:attempt})},6);
 assert.equal(merged.learningState.challenge.writingCorrections[id].status,'corrected');assert.equal(merged.learningState.challenge.answers[index].status,'incorrect');
 const other=structuredClone(stale);other.attemptId=crypto.randomUUID();
 assert.deepEqual(state.mergeChallengeRecords(other,attempt,set).writingCorrections,{});
 const olderSkip=structuredClone(stale);olderSkip.writingCorrections={[id]:{status:'skipped'}};
 assert.equal(state.mergeChallengeRecords(olderSkip,attempt,set).writingCorrections[id].status,'corrected');
});
test('unknown, unattempted, sound and failed corrections never unlock dictation',async()=>{
 const {state,set,attempt,id,items}=await fixture();
 attempt.writingCorrections={[id]:{status:'incorrect'},[items[1].id]:{status:'corrected'},[items.at(-1).id]:{status:'corrected'},unknown:{status:'skipped'}};
 assert.deepEqual(state.prepareAttempt(set,attempt).writingCorrections,{});
 attempt.writingCorrections={[id]:{status:'skipped'}};
 assert.deepEqual(state.prepareAttempt(set,attempt).writingCorrections,{[id]:{status:'skipped'}});
});
