'use strict';
const {poems}=require('../../maanshan/poems.json');
const han=value=>[...value].filter(char=>/\p{Script=Han}/u.test(char));
const measured=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100;

// Receives only quality-checked, selected server reading outcomes. Keep one
// chosen recording per learner and poem line even across content versions;
// never carry an older character score into a newer unmeasured recording.
function buildCharacterAnalysis(outcomes,filters={}){
  const catalog=poems.filter(poem=>(filters.grade===undefined||Number(filters.grade)===poem.grade)&&(filters.poemId===undefined||Number(filters.poemId)===poem.id));
  const selected=new Map();
  for(const row of outcomes){
    const event=row.event,poem=catalog.find(item=>item.id===event.poemId);
    const match=/^p([1-6])\.l(\d+)$/.exec(event.itemId||'');
    if(!poem||row.grade!==poem.grade||!match||Number(match[1])!==poem.id||!poem.lines[Number(match[2])])continue;
    const key=JSON.stringify([row.researchId,event.poemId,Number(match[2])]),previous=selected.get(key);
    if(!previous||(filters.attempt==='first'?row.serverReceivedAt<previous.serverReceivedAt:row.serverReceivedAt>previous.serverReceivedAt))selected.set(key,row);
  }
  const groups=new Map();
  for(const row of selected.values()){
    const event=row.event,poem=catalog.find(item=>item.id===event.poemId),lineIndex=Number(event.itemId.split('.l')[1]);
    const line=poem.lines[lineIndex],chars=han(line.text),simple=han(line.simplified||line.text),seen=new Set();
    for(const word of event.wordScores||[]){
      if(!Number.isInteger(word.index)||seen.has(word.index)||!chars[word.index]||![chars[word.index],simple[word.index]].includes(word.char)||!measured(word.score))continue;
      seen.add(word.index);
      const key=JSON.stringify([poem.id,lineIndex,word.index]);
      const group=groups.get(key)||{total:0,count:0};group.total+=word.score;group.count++;groups.set(key,group);
    }
  }
  return {source:'server_verified',cutoff:80,attempt:filters.attempt||'latest',unit:'one_selected_recording_per_student_line',poems:catalog.map(poem=>({
    poemId:poem.id,grade:poem.grade,title:poem.title,author:poem.author,
    lines:poem.lines.map((line,lineIndex)=>({lineIndex,text:line.text,punctuation:line.punctuation||'',words:han(line.text).map((char,index)=>{
      const group=groups.get(JSON.stringify([poem.id,lineIndex,index]));
      return {index,char,pinyin:line.pinyin?.[index]||'',meanScore:group?group.total/group.count:null,count:group?.count||0};
    })}))
  }))};
}
module.exports={buildCharacterAnalysis};
