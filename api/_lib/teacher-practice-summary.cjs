'use strict';
const {poems}=require('../../maanshan/poems.json');
const TYPES=new Set(['sound','dictation','microgame','match','sequence','scene-builder']);
function buildPracticeSummary(rows){
 const rounds=new Map();
 for(const row of rows){const event=row.event;if(!event.attemptId||!['challenge','writing'].includes(event.activity)||!TYPES.has(event.context?.itemType)||['review','free'].includes(event.context?.mode))continue;
  const key=JSON.stringify([row.researchId,event.poemId,event.attemptId]);let round=rounds.get(key);
  if(!round)rounds.set(key,round={poemId:event.poemId,attemptId:event.attemptId,firstAt:row.serverReceivedAt,lastAt:row.serverReceivedAt,rows:[]});
  round.firstAt=round.firstAt<row.serverReceivedAt?round.firstAt:row.serverReceivedAt;round.lastAt=round.lastAt>row.serverReceivedAt?round.lastAt:row.serverReceivedAt;round.rows.push(row);
 }
 const ordered=[...rounds.values()].sort((a,b)=>a.firstAt.localeCompare(b.firstAt)||a.lastAt.localeCompare(b.lastAt));
 if(!ordered.length)return null;
 const records=new Map();let total=null,latest=null;
 for(const round of ordered){
 const items=new Map();
 for(const row of round.rows.sort((a,b)=>a.serverReceivedAt.localeCompare(b.serverReceivedAt))){const event=row.event;if(!event.itemId||event.itemId==='challenge-summary')continue;
  if(Number.isInteger(event.context.total)&&event.context.total>0&&event.context.total<=30)total=Math.max(total||0,event.context.total);
  let item=items.get(event.itemId);if(!item)items.set(event.itemId,item={itemId:event.itemId,type:event.context.itemType,position:null,ack:null,assessment:null,submitted:false,observed:false});
  if(Number.isInteger(event.context.position)&&event.context.position>=1&&event.context.position<=30)item.position=event.context.position;
  if(row.source==='client'&&event.type==='answer_submitted'){item.submitted=true;item.submittedAt=row.serverReceivedAt;}
  if(row.source!=='server_verified'||event.type!=='provider_result')continue;
  item.observed=true;item.observedAt=row.serverReceivedAt;
  if(event.operation==='challenge'){item.ack=event.result;item.ackAt=row.serverReceivedAt;}
  if(item.type!=='microgame'&&['challenge','handwriting'].includes(event.operation)&&typeof event.result?.correct==='boolean'){item.assessment=event.result;item.assessmentAt=row.serverReceivedAt;}
 }
 for(const item of items.values()){
  const status=item.ack?.status==='skipped'?'skipped':item.assessment?item.assessment.correct?'correct':'incorrect':item.type==='microgame'&&['completed','correct','incorrect'].includes(item.ack?.status)?'completed':item.observed||item.submitted?'unmeasured':'unanswered';
  const key=JSON.stringify([round.poemId,item.itemId]),prior=records.get(key);
  // Merely displaying a new round, or leaving a repeated prompt unanswered,
  // is not a new outcome for that item. A skip retains an earlier answer too.
  if(['unanswered','skipped','unmeasured'].includes(status)&&prior&&['correct','incorrect','completed'].includes(prior.status))continue;
  if(status==='unanswered'&&prior)continue;
  const updatedAt=['correct','incorrect'].includes(status)?item.assessmentAt:status==='completed'||status==='skipped'?item.ackAt:item.observedAt||item.submittedAt||round.lastAt;
  const result={itemId:item.itemId,type:item.type,position:item.position,status,score:item.assessment&&status!=='skipped'?item.assessment.score:null,attemptId:round.attemptId,poemId:round.poemId,updatedAt};
  const rank=value=>value?.status==='correct'?3:value?.status==='completed'?2:value?.status==='incorrect'?1:0;
  const previousBest=prior?.best;
  result.best=previousBest&&rank(previousBest)>rank(result)?previousBest:{status:result.status,score:result.score,attemptId:result.attemptId,updatedAt:result.updatedAt};
  if(prior&&['correct','incorrect','completed'].includes(prior.status)&&updatedAt<prior.updatedAt){prior.best=result.best;continue;}
  records.set(key,result);
  if(!['unanswered','skipped'].includes(status)&&(!latest||updatedAt>latest.lastAt))latest={...round,lastAt:updatedAt};
 }
 }
 latest ||= ordered.at(-1);
 const all=[...records.values()].filter(item=>item.poemId===latest.poemId),answered=all.filter(item=>item.status!=='unanswered');
 const actual=(answered.length?answered:all).sort((a,b)=>(a.position??99)-(b.position??99)||a.itemId.localeCompare(b.itemId));
 // A skipped prompt is visible to the teacher, but it was left unfinished and
 // therefore must not inflate the completed-practice count.
 const completed=actual.filter(item=>['correct','incorrect','completed'].includes(item.status));
 return {poemId:latest.poemId,title:poems.find(poem=>poem.id===latest.poemId)?.title||'古詩',scope:'per-item',attemptId:latest.attemptId,updatedAt:latest.lastAt,total:Math.max(total||0,actual.length)||null,completedN:completed.length,correctN:actual.filter(item=>item.status==='correct').length,measuredN:actual.filter(item=>['correct','incorrect'].includes(item.status)).length,items:actual};
}
module.exports={buildPracticeSummary};
