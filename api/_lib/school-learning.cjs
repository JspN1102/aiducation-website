'use strict';
const auth = require('./school-auth.cjs');
const research = require('./research-store.cjs');
const {getPoem} = require('./poems.js');
const challenges = require('./challenge-loader.cjs');
const score = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;

async function referenceFor(req, operation) {
  const context = req.body?.researchContext;
  if (!context) return null;
  const poem = getPoem(context.poemId, null);
  if (!poem || (req.body.poemId !== undefined && req.body.poemId !== poem.id)) throw new auth.AuthError(400, 'INVALID_LEARNING_CONTEXT');
  if (operation === 'reading') {
    const match = /^p([1-6])\.l(\d+)$/.exec(context.itemId || '');
    const line = match && Number(match[1]) === poem.id ? poem.lines[Number(match[2])] : null;
    if (!line || req.body.refText !== line.simplified) throw new auth.AuthError(400, 'INVALID_LEARNING_CONTEXT');
    context.activity='read';
    return {poem, line};
  }
  if (operation === 'handwriting') {
    const {CHALLENGE_SETS} = await challenges.load();
    const set = CHALLENGE_SETS[poem.slug];
    const item = (set?.bank || set?.items || []).find(item => item.id === context.itemId);
    if (!item || item.type !== 'dictation') throw new auth.AuthError(400, 'INVALID_LEARNING_CONTEXT');
    context.activity='writing';
    context.context={...(context.context||{}),itemType:'dictation'};
    return {poem, item};
  }
  return {poem};
}
function outcomeFor(operation, payload, status, reference, elapsedMs) {
  const invalidPayload=!payload||typeof payload!=='object'||Array.isArray(payload);
  const error = status >= 400 || invalidPayload || !!payload?.error;
  const result = {status:error?'error':'completed',score:null,correct:null};
  const value = {operation, provider:operation==='reading'?'tencent-soe':operation==='handwriting'?'google-input-tools':'deepseek',
    model:operation==='reading'?'16k_zh':operation==='handwriting'?'zh-hant-t-i0-handwrit':'deepseek-flash',
    providerVersion:operation==='reading'?'eval1-coeff1.5-edb20260919':operation==='handwriting'?'upstream-unversioned':'poet-report-prompts-20260920',
    result, metrics:Number.isFinite(elapsedMs)&&elapsedMs>=0?{latencyMs:Math.min(600000,Math.round(elapsedMs))}:{}};
  if (error) { value.error={code:status===504?'timeout':status===429||status>=500?'provider_unavailable':'invalid_response',retryable:status>=500||status===429}; return value; }
  if (operation === 'reading') {
    result.score = score(payload.SuggestedScore) ?? score(payload.PronAccuracy);
    for(const [field,key]of Object.entries({PronAccuracy:'accuracyScore',PronFluency:'fluencyScore',PronCompletion:'completionScore',SuggestedScore:'suggestedScore'})){
      const measured=score(payload[field]);if(measured!==null)value.metrics[key]=measured;
    }
    result.status = result.score === null ? 'unmeasured' : 'completed';
    const chars = [...reference.line.text].filter(char => /\p{Script=Han}/u.test(char));
    const simplified = [...reference.line.simplified].filter(char => /\p{Script=Han}/u.test(char));
    value.wordScores = (Array.isArray(payload.Words)?payload.Words:[]).flatMap((word,index) => {
      const value=score(word.PronAccuracy);
      if (index>=chars.length || value===null || ![chars[index],simplified[index]].includes(word.Word)) return [];
      return [{index,char:chars[index],score:value,pronunciationScore:value}];
    });
    value.metrics.wordCount = value.wordScores.length;
  } else if (operation === 'handwriting') {
    const first = Array.isArray(payload.candidates) ? payload.candidates.find(value => typeof value==='string'&&value.trim())?.trim().normalize('NFC') : null;
    const acceptable = [reference.item.target.char,...(reference.item.target.accept||[])].map(value=>value.normalize('NFC'));
    result.correct = first ? acceptable.includes(first) : null;
    result.score = first ? result.correct?100:0 : null;
    result.status = first ? result.correct?'correct':'incorrect' : 'unmeasured';
  } else if (operation === 'chat') value.metrics.assistantCharacters = Math.min(20000,String(payload.reply||'').length);
  // Report generation is a process event; client-supplied scores never become
  // a new server-verified assessment simply because an LLM produced advice.
  return value;
}
function withSchoolLearning(operation, handler) {
  return async (req,res) => {
    if (!auth.enabled() || req.method !== 'POST') return handler(req,res);
    res.setHeader('Cache-Control','private, no-store');
    let actor, reference;
    try {
      actor=await auth.requireActor(req,{roles:['student','teacher'],csrf:true});
      if (req.body?.researchContext && req.body.researchContext.actorId !== actor.id) throw new auth.AuthError(409,'ACTOR_CHANGED');
      const requestedPoem=req.body?.poemId??req.body?.researchContext?.poemId;
      const poem=auth.assertPoemAccess(actor,requestedPoem);
      if(operation==='reading'&&!poem.lines.some(line=>line.simplified===req.body?.refText))throw new auth.AuthError(400,'INVALID_LEARNING_CONTEXT');
      reference=await referenceFor(req,operation);
      if(operation==='chat'&&req.body)req.body.grade=poem.grade;
      if(operation==='report'&&req.body)req.body.studentGrade=poem.grade;
    } catch(error) { return auth.sendError(res,error); }
    if (!reference || !auth.researchEligible(actor)) return handler(req,res);
    const originalJSON=res.json.bind(res), started=performance.now();
    let responseWork=null;
    res.json=body=>{
      if (responseWork) return res;
      const status=res.statusCode||200;
      responseWork=(async()=>{
        let recorded=false;
        try { recorded=(await research.recordVerifiedOutcome(req,outcomeFor(operation,body,status,reference,performance.now()-started))).recorded===true; }
        catch { /* The learner still receives the provider result and an explicit collection flag. */ }
        return originalJSON({...body,researchRecorded:recorded});
      })();
      return res;
    };
    try { const value=await handler(req,res); if(responseWork)await responseWork; return value; }
    catch(error){
      if(responseWork){await responseWork;return res;}
      const timedOut=error?.name==='TimeoutError'||error?.code==='TIMEOUT';
      const outcome=outcomeFor(operation,{},timedOut?504:500,reference,performance.now()-started);
      if(error?.name==='AbortError'){outcome.result.status='cancelled';outcome.error={code:'aborted',retryable:true};}
      try{await research.recordVerifiedOutcome(req,outcome);}catch{}
      throw error;
    }
    finally {res.json=originalJSON;}
  };
}
module.exports={withSchoolLearning,outcomeFor,referenceFor};
