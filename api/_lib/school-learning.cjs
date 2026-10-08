'use strict';
const auth = require('./school-auth.cjs');
const research = require('./research-store.cjs');
const {getPoem} = require('./poems.js');
const challenges = require('./challenge-loader.cjs');
const grade = require('./writing-grade.cjs');
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
    return {poem, item, strokes: Array.isArray(req.body.ink) ? req.body.ink.length : 0};
  }
  return {poem};
}
// Server-only research detail (school48). Never shown to anyone, never changes a score;
// a builder that cannot prove its alignment returns undefined and the field is omitted.
const SERVICE_MS=['audioMs','prepareMs','connectMs','scoreMs'];
function cleanService(raw){
  try{
    if(!raw||typeof raw!=='object')return undefined;const out={};
    if(research.RELAYS.includes(raw.relay))out.relay=raw.relay;
    if(research.AUDIO_PATHS.includes(raw.audioPath))out.audioPath=raw.audioPath;
    if(raw.textMode===0||raw.textMode===1)out.textMode=raw.textMode;
    for(const key of SERVICE_MS)if(Number.isInteger(raw[key])&&raw[key]>=0&&raw[key]<=600000)out[key]=raw[key];
    if(Number.isInteger(raw.providerCode)&&raw.providerCode>=-1&&raw.providerCode<=999999999)out.providerCode=raw.providerCode;
    return Object.keys(out).length?out:undefined;
  }catch{return undefined;}
}
const han=text=>[...String(text||'')].filter(char=>/\p{Script=Han}/u.test(char));
const phoneName=value=>typeof value==='string'?value.trim().toLowerCase().replace(/ü/g,'v'):'';
const ratio=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100;
const ms=value=>{const n=typeof value==='number'&&Number.isFinite(value)?Math.round(value):NaN;return Number.isInteger(n)&&n>=0&&n<=600000?n:undefined;};
// Provider word list aligned to the reference line. Inserted words (MatchTag 1) carry no
// text, index or phones; any other word that does not match the next reference character
// voids the whole field rather than risk a misaligned record. Not a transcript.
function buildProviderWords(words,reference){
  try{
    if(!Array.isArray(words)||!reference?.line)return undefined;
    const chars=han(reference.line.text),simple=han(reference.line.simplified),out=[];let ref=0;
    for(let i=0;i<words.length&&i<40;i++){
      const w=words[i];if(!w||typeof w!=='object')return undefined;
      const text=String(w.word??w.Word??'');
      if(text&&!/^\p{Script=Han}$/u.test(text))continue;
      const rawTag=w.match_tag??w.MatchTag,tag=Number.isInteger(rawTag)?rawTag:0;
      if(tag<0||tag>4)return undefined;
      const entry={i};if(tag!==0)entry.m=tag;
      if(tag!==1){
        if(text&&ref<chars.length&&text!==chars[ref]&&text!==simple[ref])return undefined;
        if(ref<chars.length)entry.r=ref;ref++;
      }
      const a=w.pron_accuracy??w.PronAccuracy;if(ratio(a))entry.a=Math.round(a);
      const f=w.pron_fluency??w.PronFluency;if(ratio(f))entry.f=Math.round(f*100)/100;
      const b=ms(w.mem_begin_time??w.begin_time??w.MemBeginTime),e=ms(w.mem_end_time??w.end_time??w.MemEndTime);
      if(b!==undefined)entry.b=b;if(e!==undefined&&(b===undefined||e>=b))entry.e=e;
      if(tag!==1){
        const phones=(Array.isArray(w.phone_infos)?w.phone_infos:Array.isArray(w.PhoneInfos)?w.PhoneInfos:[]).slice(0,4).flatMap(p=>{
          if(!p||typeof p!=='object')return [];
          const s=phoneName(p.phone??p.Phone);if(!research.PHONE.test(s))return [];
          const phone={s},x=phoneName(p.reference_phone??p.ReferencePhone);if(research.PHONE.test(x)&&x!==s)phone.x=x;
          const pm=p.match_tag??p.MatchTag;if(Number.isInteger(pm)&&pm>=1&&pm<=4)phone.m=pm;
          const pa=p.pron_accuracy??p.PronAccuracy;if(ratio(pa))phone.a=Math.round(pa);
          return [phone];
        });
        if(phones.length)entry.ph=phones;
      }
      out.push(entry);
    }
    if(!out.length)return undefined;
    if(Buffer.byteLength(JSON.stringify(out))>1200){out.forEach(entry=>delete entry.ph);if(Buffer.byteLength(JSON.stringify(out))>1200)return undefined;}
    return out;
  }catch{return undefined;}
}
function outcomeFor(operation, payload, status, reference, elapsedMs, providerMetadata, extras={}) {
  const invalidPayload=!payload||typeof payload!=='object'||Array.isArray(payload);
  const error = status >= 400 || invalidPayload || !!payload?.error;
  const result = {status:error?'error':'completed',score:null,correct:null};
  const value = {operation, provider:operation==='reading'?'tencent-soe':operation==='handwriting'?'google-input-tools':'deepseek',
    model:operation==='reading'?'16k_zh':operation==='handwriting'?'zh-hant-t-i0-handwrit':'deepseek-flash',
    providerVersion:operation==='reading'?'eval1-coeff1.5-edb20260919':operation==='handwriting'?'upstream-unversioned':'poet-report-prompts-20260920',
    result, metrics:Number.isFinite(elapsedMs)&&elapsedMs>=0?{latencyMs:Math.min(600000,Math.round(elapsedMs))}:{}};
  if(['chat','report'].includes(operation)&&providerMetadata){
    for(const key of ['provider','model','providerVersion'])if(typeof providerMetadata[key]==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,79}$/.test(providerMetadata[key]))value[key]=providerMetadata[key];
  }
  try{const service=cleanService({...(extras?.service||{}),...(extras?.relay?{relay:extras.relay}:{})});if(service)value.service=service;}catch{}
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
    const providerWords=buildProviderWords(extras?.rawWords??payload.Words,reference);if(providerWords)value.providerWords=providerWords;
  } else if (operation === 'handwriting') {
    const candidates = (Array.isArray(payload.candidates) ? payload.candidates : []).filter(value => typeof value==='string'&&value.trim()).map(value => value.trim().normalize('NFC'));
    const acceptable = new Set([reference.item.target.char,...(reference.item.target.accept||[])].map(value=>value.normalize('NFC')));
    // The verdict the pupil saw (maanshan/writing-grade.mjs), including the component leniency.
    const verdict = grade.gradeCandidates(candidates, acceptable, {drawn: reference.strokes || 0, strokeOf: grade.strokeCount});
    result.correct = candidates.length ? verdict.correct : null;
    result.score = candidates.length ? verdict.correct?100:0 : null;
    result.status = candidates.length ? verdict.correct?'correct':'incorrect' : 'unmeasured';
    // Recognition detail for analysis only; the verdict above is unchanged.
    try{
      if(Number.isInteger(reference.strokes)&&reference.strokes>=0&&reference.strokes<=10000)value.metrics.strokeCount=reference.strokes;
      const recognition={candidateCount:Math.min(20,candidates.length),targetRank:candidates.slice(0,20).findIndex(candidate=>acceptable.has(candidate))+1};
      if(/^\p{Script=Han}$/u.test(candidates[0]||''))recognition.topCandidate=candidates[0];
      value.recognition=recognition;
    }catch{}
  } else if (operation === 'chat') value.metrics.assistantCharacters = Math.min(20000,String(payload.reply||'').length);
  // Report generation is a process event; client-supplied scores never become
  // a new server-verified assessment simply because an LLM produced advice.
  return value;
}
function withSchoolLearning(operation, handler) {
  return async (req,res) => {
    if(operation==='chat')require('./chat-stream.cjs').installChatStream(req,res);
    if (!auth.enabled() || req.method !== 'POST') return handler(req,res);
    const authStarted=performance.now();
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
    if(operation==='handwriting')res.setHeader('Server-Timing',`handwriting_auth;dur=${(performance.now()-authStarted).toFixed(1)}`);
    if (!reference || !auth.researchEligible(actor)) return handler(req,res);
    const originalJSON=res.json.bind(res), started=performance.now();
    // Server-only research detail: the relay path (no port) and what the provider handler left on res.researchExtras.
    const extrasFor=()=>{try{const raw=req.headers?.['x-school-relay'];const m=typeof raw==='string'&&/^(hop-)?(hk|gz):\d{4}$/.exec(raw);return {...(res.researchExtras&&typeof res.researchExtras==='object'?res.researchExtras:{}),relay:m?(m[1]||'')+m[2]:'none'};}catch{return {};}};
    let responseWork=null;
    res.json=body=>{
      if (responseWork) return res;
      const status=operation==='chat'&&res.chatOutcomeStatus||res.statusCode||200;
      responseWork=(async()=>{
        const recordStarted=performance.now();
        let recorded=false;
        try { recorded=(await research.recordVerifiedOutcome(req,outcomeFor(operation,body,status,reference,performance.now()-started,res.providerMetadata,extrasFor()))).recorded===true; }
        catch { /* The learner still receives the provider result and an explicit collection flag. */ }
        if(operation==='handwriting')res.setHeader('Server-Timing',[res.getHeader?.('Server-Timing'),`handwriting_record;dur=${(performance.now()-recordStarted).toFixed(1)}`].filter(Boolean).join(', '));
        return originalJSON({...body,researchRecorded:recorded});
      })();
      return res;
    };
    try { const value=await handler(req,res); if(responseWork)await responseWork; return value; }
    catch(error){
      if(responseWork){await responseWork;return res;}
      const timedOut=error?.name==='TimeoutError'||error?.code==='TIMEOUT';
      const outcome=outcomeFor(operation,{},timedOut?504:500,reference,performance.now()-started,res.providerMetadata,extrasFor());
      if(error?.name==='AbortError'){outcome.result.status='cancelled';outcome.error={code:'aborted',retryable:true};}
      let recorded=false;try{recorded=(await research.recordVerifiedOutcome(req,outcome)).recorded===true;}catch{}
      if(res.chatStreaming&&!res.chatSignal?.aborted){res.status(timedOut?504:500);return originalJSON({error:timedOut?'GPT timeout':'Chat service unavailable',researchRecorded:recorded});}
      throw error;
    }
    finally {res.json=originalJSON;}
  };
}
module.exports={withSchoolLearning,outcomeFor,referenceFor};
