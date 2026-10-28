// Cross-device current progress is separate from append-only research history.
// Do not upload recursive local archives or recognizer candidate text.
const ATTEMPT_KEYS=['version','attemptId','seed','startedAt','selection','schedule','mode','variant','cursor','itemIds','history','orders','completedAt','reviewPending'];
function attemptSnapshot(value,depth=0){
  if(!value||typeof value!=='object'||depth>1)return null;
  const result=Object.fromEntries(ATTEMPT_KEYS.filter(key=>value[key]!==undefined).map(key=>[key,structuredClone(value[key])]));
  result.answers=(value.answers||[]).slice(0,7).map(answer=>Object.fromEntries(['itemId','status','correct','submittedAt','response','flow','traceCompleted','dictationCompleted'].filter(key=>answer[key]!==undefined).map(key=>[key,structuredClone(answer[key])])));
  // Correction unlocks travel with this round only; recognizer text and first
  // assessment answers remain separate from this compact progress marker.
  if(value.writingCorrections&&typeof value.writingCorrections==='object'){
    result.writingCorrections={};
    for(const answer of result.answers){
      const id=answer.itemId,status=value.writingCorrections[id]?.status;
      if(typeof id==='string'&&id.length<=128&&!['__proto__','constructor','prototype'].includes(id)&&answer.status!=='correct'&&['corrected','skipped'].includes(status))result.writingCorrections[id]={status};
    }
  }
  if(value.sourceAttempt&&depth===0)result.sourceAttempt=attemptSnapshot(value.sourceAttempt,1);
  if(value.itemRecords&&typeof value.itemRecords==='object'){
    result.itemRecords={};
    for(const [id,record]of Object.entries(value.itemRecords).slice(0,256)){
      if(!id||id.length>128||['__proto__','constructor','prototype'].includes(id))continue;
      const entry={};
      for(const kind of ['latest','best'])if(record?.[kind]&&record[kind].itemId===id){
        entry[kind]=Object.fromEntries(['itemId','type','focus','status','correct','submittedAt','attemptId','mode','flow','traceCompleted','dictationCompleted'].filter(key=>record[kind][key]!==undefined).map(key=>[key,structuredClone(record[kind][key])]));
      }
      if(Object.keys(entry).length)result.itemRecords[id]=entry;
    }
  }
  // Reviewed games use compact discrete states, never ink trajectories.
  if(value.gameDrafts&&JSON.stringify(value.gameDrafts).length<=16000)result.gameDrafts=structuredClone(value.gameDrafts);
  return result;
}
export function compactLearningSnapshot(state){
  return {reading:structuredClone(state.reading||[]),challenge:attemptSnapshot(state.challenge),exploration:state.exploration?structuredClone(state.exploration):null,
    // school69 self-check counts: recordings since the last check and checks so far.
    ...(state.selfCheck?{selfCheck:{reads:Number(state.selfCheck.reads)||0,checks:Number(state.selfCheck.checks)||0,gifts:Number(state.selfCheck.gifts)||0,lines:Number(state.selfCheck.lines)||0}}:{}),
    // school74 每日溫故: when it was offered, and the two games' compact states.
    ...(warmupSnapshot(state.warmup)?{warmup:warmupSnapshot(state.warmup)}:{}),
    // school74 study log: the study day each line was last read (tried) and first read >=80 (good).
    ...(studySnapshot(state.study)?{study:studySnapshot(state.study)}:{})};
}
const DAY=/^\d{4}-\d\d-\d\d$/;
function studySnapshot(value){
  if(!value||typeof value!=='object')return null;
  const result={tried:{},good:{}};let any=false;
  for(const key of ['tried','good'])for(const [line,day] of Object.entries(value[key]||{}))
    if(/^\d{1,3}$/.test(line)&&Number(line)<200&&DAY.test(day)){result[key][line]=day;any=true;}
  return any?result:null;
}
// tried keeps the later day, good the earlier one.
export function mergeStudy(local,remote){
  const mine=studySnapshot(local),theirs=studySnapshot(remote);
  if(!mine||!theirs)return mine||theirs||local;
  const result={tried:{...mine.tried},good:{...mine.good}};
  for(const [line,day] of Object.entries(theirs.tried))if(!result.tried[line]||day>result.tried[line])result.tried[line]=day;
  for(const [line,day] of Object.entries(theirs.good))if(!result.good[line]||day<result.good[line])result.good[line]=day;
  return result;
}
function warmupSnapshot(value){
  if(!value||typeof value!=='object'||typeof value.offeredAt!=='string'||value.offeredAt.length>40)return null;
  const result={offeredAt:value.offeredAt};
  for(const kind of ['spot','rule'])if(value[kind]&&typeof value[kind]==='object'&&JSON.stringify(value[kind]).length<=2000)result[kind]=structuredClone(value[kind]);
  return result;
}
// The offer stays made once either device made it; a finished game stays finished.
export function mergeWarmup(local,remote){
  const mine=warmupSnapshot(local),theirs=warmupSnapshot(remote);
  if(!mine||!theirs)return mine||theirs||local;
  const result={offeredAt:mine.offeredAt<theirs.offeredAt?mine.offeredAt:theirs.offeredAt};
  for(const kind of ['spot','rule']){const value=mine[kind]?.completed?mine[kind]:theirs[kind]?.completed?theirs[kind]:mine[kind]||theirs[kind];if(value)result[kind]=value;}
  return result;
}
