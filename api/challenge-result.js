const auth = require('./_lib/school-auth.cjs');
const research = require('./_lib/research-store.cjs');
const {getPoem} = require('./_lib/poems.js');
const loader = require('./_lib/challenge-loader.cjs');

module.exports = async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  if(!auth.enabled())return res.status(404).json({error:'Not found'});
  try{
    const actor=await auth.requireActor(req,{roles:['student','teacher'],csrf:true});
    const body=req.body,context=body?.researchContext;
    if(!body||typeof body!=='object'||Buffer.byteLength(JSON.stringify(body))>16000)return res.status(400).json({error:'Invalid answer'});
    if(context?.actorId!==actor.id)return res.status(409).json({code:'ACTOR_CHANGED',error:'Account changed'});
    let stable={};
    if(context.requestId!==undefined||context.requestedAt!==undefined){
      const at=context.requestedAt;
      if(typeof at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at)||!Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at||Date.parse(at)>Date.now()+300000)return res.status(400).json({code:'INVALID_REQUEST_IDENTITY',error:'Invalid request identity'});
      try{stable={eventId:research.stableOutcomeId(actor.id,context.requestId),clientAt:at,stableBatch:true};}
      catch{return res.status(400).json({code:'INVALID_REQUEST_IDENTITY',error:'Invalid request identity'});}
    }
    const poem=getPoem(body.poemId,null);
    if(!poem||context.poemId!==poem.id||context.itemId!==body.itemId)return res.status(400).json({error:'Invalid item'});
    auth.assertPoemAccess(actor,poem.id);
    const {CHALLENGE_SETS,CHALLENGE_VERSION}=await loader.load(),set=CHALLENGE_SETS[poem.slug];
    const item=(set.bank||set.items).find(item=>item.id===body.itemId);
    const flow=context.context?.flow==='trace-dictation-v1';
    if(!item||!(['correct','incorrect','skipped'].includes(body.status)||flow&&body.status==='completed'))return res.status(400).json({error:'Invalid answer'});
    if(flow&&(item.type!=='dictation'||context.context.traceCompleted!==true||typeof context.context.dictationCompleted!=='boolean'||context.context.dictationCompleted!==(body.status==='correct')))return res.status(400).json({error:'Invalid writing completion'});
    let correct=null,status=body.status==='skipped'?'skipped':'completed',verifiedResponse;
    if(body.status!=='skipped'&&item.type==='sound'){
      const choice=body.response?.choiceId;
      if(!item.options.some(option=>option.id===choice))return res.status(400).json({error:'Invalid choice'});
      correct=choice===item.answerId;status=correct?'correct':'incorrect';
      verifiedResponse={choiceId:choice};
    }else if(body.status!=='skipped'&&['match','sequence','scene-builder'].includes(item.type)){
      const placements=body.response?.placements;
      const slots=item.type==='scene-builder'?Object.keys(item.answer):item.slots.map(slot=>slot.id);
      if(!Array.isArray(placements)||placements.length!==slots.length||placements.some(p=>!p||typeof p!=='object'||!slots.includes(p.slotId)||typeof p.choiceId!=='string')||new Set(placements.map(p=>p.slotId)).size!==slots.length)return res.status(400).json({error:'Invalid placements'});
      if(placements.some(p=>item.type==='scene-builder'?!item.layers.find(layer=>layer.id===p.slotId)?.choices.some(choice=>choice.id===p.choiceId):!item.cards.some(card=>card.id===p.choiceId)))return res.status(400).json({error:'Invalid choice'});
      if(item.type!=='scene-builder'&&new Set(placements.map(p=>p.choiceId)).size!==placements.length)return res.status(400).json({error:'Duplicate choice'});
      const answer=Object.fromEntries(placements.map(p=>[p.slotId,p.choiceId]));
      correct=item.type==='scene-builder'?Object.entries(item.answer).every(([key,value])=>answer[key]===value):item.slots.every(slot=>answer[slot.id]===slot.accepts);
      status=correct?'correct':'incorrect';
      verifiedResponse={placements:slots.map(slotId=>({slotId,choiceId:answer[slotId]}))};
    }
    // A completed game is not an exam score. Dictation accuracy is captured
    // directly from the recognizer, not trusted from this browser summary.
    context.context={...(context.context||{}),itemType:item.type};
    context.activity=item.type==='dictation'?'writing':'challenge';
    if(!auth.researchEligible(actor))return res.status(200).json({ok:true,researchRecorded:false,researchExcluded:true,result:{status,score:correct===null?null:correct?100:0,correct}});
    const saved=await research.recordVerifiedOutcome(req,{...stable,provider:'aiducation',model:'curriculum-answer-key',operation:'challenge',providerVersion:'challenge-v'+CHALLENGE_VERSION+'-20260919d',
      result:{status,score:correct===null?null:correct?100:0,correct},...(verifiedResponse?{response:verifiedResponse}:{})});
    if(!saved.recorded){
      const conflict=['EVENT_ID_CONFLICT','BATCH_ID_CONFLICT','ACTOR_CHANGED'].includes(saved.reason);
      const invalid=saved.invalidRequest===true&&saved.reason==='INVALID_EVENT';
      return res.status(conflict?409:invalid?400:503).json({ok:false,researchRecorded:false,code:saved.reason||'outcome_storage_unavailable',error:conflict?'Recorded answer conflict':invalid?'Invalid answer context':'Answer persistence pending',retryable:!conflict&&!invalid});
    }
    return res.status(200).json({ok:true,researchRecorded:saved.recorded,result:{status,score:correct===null?null:correct?100:0,correct}});
  }catch(error){return auth.sendError(res,error);}
};
