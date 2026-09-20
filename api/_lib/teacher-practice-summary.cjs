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
 const latest=[...rounds.values()].sort((a,b)=>b.firstAt.localeCompare(a.firstAt)||b.lastAt.localeCompare(a.lastAt))[0];
 if(!latest)return null;
 const items=new Map();let total=null;
 for(const row of latest.rows){const event=row.event;if(!event.itemId||event.itemId==='challenge-summary')continue;
  if(Number.isInteger(event.context.total)&&event.context.total>0&&event.context.total<=30)total=Math.max(total||0,event.context.total);
  let item=items.get(event.itemId);if(!item)items.set(event.itemId,item={itemId:event.itemId,type:event.context.itemType,position:null,ack:null,assessment:null,submitted:false,observed:false});
  if(Number.isInteger(event.context.position)&&event.context.position>=1&&event.context.position<=30)item.position=event.context.position;
  if(row.source==='client'&&event.type==='answer_submitted')item.submitted=true;
  if(row.source!=='server_verified'||event.type!=='provider_result')continue;
  item.observed=true;
  if(event.operation==='challenge')item.ack=event.result;
  if(item.type!=='microgame'&&['challenge','handwriting'].includes(event.operation)&&typeof event.result?.correct==='boolean')item.assessment=event.result;
 }
 const actual=[...items.values()].map((item,index)=>{
  const status=item.ack?.status==='skipped'?'skipped':item.assessment?item.assessment.correct?'correct':'incorrect':item.type==='microgame'&&['completed','correct','incorrect'].includes(item.ack?.status)?'completed':item.observed||item.submitted?'unmeasured':'unanswered';
  return {itemId:item.itemId,type:item.type,position:item.position,status,score:item.assessment&&status!=='skipped'?item.assessment.score:null,order:index};
 }).sort((a,b)=>(a.position??99)-(b.position??99)||a.order-b.order).map(({order,...item})=>item);
 // A skipped prompt is visible to the teacher, but it was left unfinished and
 // therefore must not inflate the completed-practice count.
 const completed=actual.filter(item=>['correct','incorrect','completed'].includes(item.status));
 return {poemId:latest.poemId,title:poems.find(poem=>poem.id===latest.poemId)?.title||'古詩',attemptId:latest.attemptId,updatedAt:latest.lastAt,total,completedN:completed.length,correctN:actual.filter(item=>item.status==='correct').length,measuredN:actual.filter(item=>['correct','incorrect'].includes(item.status)).length,items:actual};
}
module.exports={buildPracticeSummary};
