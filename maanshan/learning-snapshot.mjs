// Cross-device current progress is separate from append-only research history.
// Do not upload recursive local archives or recognizer candidate text.
const ATTEMPT_KEYS=['version','attemptId','seed','startedAt','selection','schedule','mode','variant','cursor','itemIds','history','orders','completedAt','reviewPending'];
function attemptSnapshot(value,depth=0){
  if(!value||typeof value!=='object'||depth>1)return null;
  const result=Object.fromEntries(ATTEMPT_KEYS.filter(key=>value[key]!==undefined).map(key=>[key,structuredClone(value[key])]));
  result.answers=(value.answers||[]).slice(0,5).map(answer=>Object.fromEntries(['itemId','status','correct','submittedAt','response'].filter(key=>answer[key]!==undefined).map(key=>[key,structuredClone(answer[key])])));
  if(value.sourceAttempt&&depth===0)result.sourceAttempt=attemptSnapshot(value.sourceAttempt,1);
  if(value.itemRecords&&typeof value.itemRecords==='object'){
    result.itemRecords={};
    for(const [id,record]of Object.entries(value.itemRecords).slice(0,256)){
      if(!id||id.length>128||['__proto__','constructor','prototype'].includes(id))continue;
      const entry={};
      for(const kind of ['latest','best'])if(record?.[kind]&&record[kind].itemId===id){
        entry[kind]=Object.fromEntries(['itemId','type','focus','status','correct','submittedAt','attemptId','mode'].filter(key=>record[kind][key]!==undefined).map(key=>[key,structuredClone(record[kind][key])]));
      }
      if(Object.keys(entry).length)result.itemRecords[id]=entry;
    }
  }
  // Reviewed games use compact discrete states, never ink trajectories.
  if(value.gameDrafts&&JSON.stringify(value.gameDrafts).length<=16000)result.gameDrafts=structuredClone(value.gameDrafts);
  return result;
}
export function compactLearningSnapshot(state){
  return {reading:structuredClone(state.reading||[]),challenge:attemptSnapshot(state.challenge),exploration:state.exploration?structuredClone(state.exploration):null};
}
