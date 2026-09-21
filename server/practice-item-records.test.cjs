'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const modules=Promise.all([import('../maanshan/challenge-state.mjs'),import('../maanshan/challenge-data.mjs'),import('../maanshan/learning-snapshot.mjs')]);
async function fixture(){const [state,data,snapshot]=await modules;return{...state,...snapshot,set:data.CHALLENGE_SETS['zao-chun']};}
function answer(f,attempt,index,status,at){const now=Date.now;Date.now=()=>at;try{assert(f.recordAnswer(attempt,f.set,index,{status,...index===0&&status==='correct'?{response:{gameCompleted:true}}:{}}));}finally{Date.now=now;}}
function repeat(f,previous){const next=f.newAttempt(f.set,{previous,seed:'repeat'});next.itemIds=[...previous.itemIds];next.orders=structuredClone(previous.orders);return next;}

test('five completed items survive a new round; two reanswers update only those latest items and preserve per-item best',async()=>{
 const f=await fixture(),first=f.newAttempt(f.set,{seed:'full'});
 for(let i=0;i<5;i++)answer(f,first,i,'correct',1000+i);
 const second=repeat(f,first);
 assert(second.resultArchive.every(record=>!record.itemRecords),'the per-item ledger is stored once, not repeated in each archived round');
 assert.equal(f.challengeSummary(second,f.set).answered,0,'new round itself is untouched');
 assert.equal(f.practiceRecordSummary(second,f.set).answered,5,'opening does not clear stored outcomes');
 answer(f,second,0,'correct',2000);answer(f,second,1,'incorrect',2001);
 const latest=f.practiceRecordSummary(second,f.set),best=f.practiceRecordSummary(second,f.set,{which:'best'});
 assert.equal(latest.answered,5);assert.equal(latest.correct,4);assert.equal(best.correct,5);
 for(let i=2;i<5;i++)assert.equal(latest.answers.find(a=>a.itemId===first.itemIds[i]).attemptId,first.attemptId);
 assert.equal(latest.answers.find(a=>a.itemId===first.itemIds[1]).attemptId,second.attemptId);
 assert.equal(f.challengeSummary(second,f.set).answered,2,'progress belongs only to the actual round');
 const restored=f.readAttempt(f.compactLearningSnapshot({challenge:second}).challenge,f.set);
 assert.equal(f.practiceRecordSummary(restored,f.set).correct,4);assert.equal(f.practiceRecordSummary(restored,f.set,{which:'best'}).correct,5);
 const third=f.newAttempt(f.set,{previous:restored,seed:'third'});
 assert.equal(f.practiceRecordSummary(third,f.set).correct,4,'an unfinished previous round still contributes its two answers');
});

test('skipped repeated items and unanswered shuffled items do not synthesize replacement results',async()=>{
 const f=await fixture(),first=f.newAttempt(f.set,{seed:'skip-source'});
 for(let i=0;i<5;i++)answer(f,first,i,'correct',1000+i);
 const second=repeat(f,first);answer(f,second,0,'skipped',2000);
 assert.equal(f.practiceRecordSummary(second,f.set).correct,5);assert.equal(f.challengeSummary(second,f.set).answers[0].status,'skipped');
 const novel=f.newAttempt(f.set,{previous:second,seed:'new-ids'});
 assert.equal(f.practiceRecordSummary(novel,f.set).answers.length,5);
 const inherited=new Set(first.itemIds);assert(f.practiceRecordSummary(novel,f.set).answers.every(a=>inherited.has(a.itemId)));
});

test('legacy archived rounds migrate and cross-device merge retains each actual latest answer independent of snapshot order',async()=>{
 const f=await fixture(),first=f.newAttempt(f.set,{seed:'legacy'});
 for(let i=0;i<5;i++)answer(f,first,i,'correct',1000+i);
 const legacy={...first};delete legacy.itemRecords;
 const left=repeat(f,legacy);answer(f,left,0,'correct',2000);answer(f,left,1,'incorrect',2001);
 const right=repeat(f,legacy);answer(f,right,0,'correct',3000);
 const merged=f.mergeChallengeRecords(right,left,f.set),reverse=f.mergeChallengeRecords(left,right,f.set);
 for(const saved of [merged,reverse]){
  const latest=f.practiceRecordSummary(saved,f.set);assert.equal(latest.answered,5);assert.equal(latest.correct,4);
  assert.equal(latest.answers.find(a=>a.itemId===first.itemIds[0]).attemptId,right.attemptId);
  assert.equal(latest.answers.find(a=>a.itemId===first.itemIds[1]).attemptId,left.attemptId);
 }
 const oldRound=f.newAttempt(f.set,{previous:legacy,seed:'old-client'});delete oldRound.itemRecords;
 assert.equal(f.practiceRecordSummary(oldRound,f.set).answered,5,'completed legacy archive supplies the missing ledger');
});

test('free/review attempts and invalid ledger entries cannot invent original assessment grades',async()=>{
 const f=await fixture(),first=f.newAttempt(f.set,{seed:'review'});
 for(let i=0;i<5;i++)answer(f,first,i,i===1?'incorrect':'correct',1000+i);
 const review=f.newReviewAttempt(f.set,first,{seed:'review-correct'});answer(f,review,0,'correct',3000);
 assert.equal(f.practiceRecordSummary(review,f.set).correct,4);
 const bad=structuredClone(first);bad.itemRecords.fake={latest:{itemId:'fake',status:'correct',submittedAt:5000,attemptId:'invalid'}};
 assert.equal(f.practiceRecordSummary(bad,f.set).answered,5);
 const output=f.compactLearningSnapshot({challenge:{...first,itemRecords:{...first.itemRecords,extra:{latest:{itemId:'extra',status:'correct',submittedAt:10,attemptId:'x',candidates:['PRIVATE'],response:{private:true}}}}}});
 assert(!JSON.stringify(output).includes('PRIVATE'));assert(!JSON.stringify(output).includes('private'));
});
