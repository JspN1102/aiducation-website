'use strict';
const {poems}=require('../../maanshan/poems.json');
let loaded;
const modules=()=>loaded||(loaded=Promise.all([import('../../maanshan/challenge-state.mjs'),import('../../maanshan/challenge-data.mjs')]));

async function mergePracticePayload(incoming,previous,poemId){
 const fresh=incoming?.learningState?.challenge,old=previous?.learningState?.challenge;
 if(!fresh&&!old)return incoming;
 const [state,data]=await modules(),poem=poems.find(item=>item.id===Number(poemId)),set=poem&&data.CHALLENGE_SETS[poem.slug];
 if(!set)return incoming;
 const challenge=state.mergeChallengeRecords(fresh||old,old,set);
 return {...incoming,challenge:state.practiceRecordSummary(challenge,set),learningState:{...incoming?.learningState,challenge}};
}

// PostgreSQL already keeps the original per-save rows. Read one snapshot per
// actual attempt, preferring its most complete snapshot, so a stale tablet save cannot hide results from another
// device. Only the small practice portion is selected, not recordings/words.
async function restorePracticeHistory(pool,{studentId,grade,cls,poemIds},progress){
 if(!pool||!Array.isArray(poemIds)||!poemIds.length)return progress;
 const rows=(await pool.query(`SELECT DISTINCT ON (poem_id,payload #>> '{learningState,challenge,attemptId}')
   poem_id,payload #> '{learningState,challenge}' AS challenge
   FROM student_data WHERE student_id=$1 AND ($2::int IS NULL OR grade=$2) AND cls=$3 AND poem_id=ANY($4::int[])
   AND section='reading' AND jsonb_typeof(payload #> '{learningState,challenge}')='object'
   AND payload #>> '{learningState,challenge,attemptId}' IS NOT NULL
   ORDER BY poem_id,payload #>> '{learningState,challenge,attemptId}',
   CASE WHEN jsonb_typeof(payload #> '{learningState,challenge,answers}')='array' THEN jsonb_array_length(payload #> '{learningState,challenge,answers}') ELSE 0 END DESC,
   updated_at DESC,id DESC`,[studentId,grade,cls,poemIds])).rows;
 for(const row of rows){
   if(!poemIds.includes(row.poem_id)||!row.challenge)continue;
   const section=(progress[row.poem_id]||={}),reading=section.reading||{};
   section.reading=await mergePracticePayload(reading,{learningState:{challenge:row.challenge}},row.poem_id);
 }
 return progress;
}
module.exports={mergePracticePayload,restorePracticeHistory};
