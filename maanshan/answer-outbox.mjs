import {createPersistentQueue} from './persistent-queue.mjs?v=20260920b';
// Only discrete curriculum answers are retried. Never repeat paid providers or
// retain audio, handwriting coordinates, chat text or recognizer candidates.
export function createAnswerOutbox({actorId,csrfToken,learningEpoch,enabled=true,storage,fetchImpl=globalThis.fetch,
  uuid=()=>crypto.randomUUID(),now=Date.now,onStatus=()=>{}}={}){
  if(storage===undefined){try{storage=globalThis.localStorage;}catch{storage=null;}}
  enabled=Boolean(enabled&&actorId&&csrfToken);
  let inFlight=null,stopped=false,retryAt=0,failures=0,lastStatus='pending',queue;
  const notify=value=>{lastStatus=value;try{onStatus(value,status());}catch{}};
  const status=()=>({...queue?.status(),enabled,stopped,retryAt,lastStatus});
  const isUuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
  const epoch=/^[a-f0-9]{32}$/.test(learningEpoch||'')?learningEpoch:null;
  queue=createPersistentQueue({prefix:'maanshan-answer-v1:'+(epoch?'epoch:'+epoch+':':'')+actorId+':',storage,notify,limit:1000,
    identify:item=>item.researchContext.requestId,
    valid:item=>item?.researchContext?.actorId===actorId&&isUuid(item.researchContext.requestId)&&Number.isFinite(Date.parse(item.researchContext.requestedAt))&&Number.isInteger(item.poemId)&&item.poemId>=1&&item.poemId<=6&&typeof item.itemId==='string'&&['correct','incorrect','skipped'].includes(item.status),
    compare:(a,b)=>a.researchContext.requestedAt.localeCompare(b.researchContext.requestedAt)});
  function enqueue(input){
    if(!enabled||stopped)return false;
    const context=input.researchContext||{};
    const researchContext=Object.fromEntries(['sessionId','attemptId','itemId','poemId','activity','appVersion','contentVersion','context'].filter(k=>context[k]!==undefined).map(k=>[k,context[k]]));
    Object.assign(researchContext,{actorId,requestId:uuid(),requestedAt:new Date(now()).toISOString()});
    const response={};
    if(typeof input.response?.choiceId==='string')response.choiceId=input.response.choiceId;
    if(Array.isArray(input.response?.placements))response.placements=input.response.placements.map(p=>({slotId:p.slotId,choiceId:p.choiceId}));
    const record={poemId:input.poemId,itemId:input.itemId,status:input.status,response,researchContext};
    if(new TextEncoder().encode(JSON.stringify(record)).length>16000)return false;
    const saved=queue.add(record);notify(saved?'queued':'queue_full');if(saved)void flush();return saved;
  }
  function flush({force=false,keepalive=false}={}){
    if(!enabled||stopped)return;
    if(inFlight)return inFlight;
    if(!force&&now()<retryAt)return;
    const selected=queue.recover().slice(0,keepalive?1:6);
    if(!selected.length){notify(queue.status().held?'records_held':'synced');return;}
    inFlight=Promise.resolve().then(async()=>{
      for(const record of selected){
        if(stopped)break;
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),16000);
        try{
          notify('syncing');
          const response=await fetchImpl('/api/challenge-result/',{method:'POST',credentials:'same-origin',keepalive,
            headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken,...(epoch?{'X-Learning-Epoch':epoch}:{})},body:JSON.stringify(record),signal:controller.signal});
          const result=await response.json().catch(()=>null),code=result?.code||result?.error;
          if(response.status===409&&code==='LEARNING_RESET'){stopped=true;notify('learning_reset');return;}
          if(response.status===422&&['POEM_GRADE_FORBIDDEN','RESEARCH_EXCLUDED'].includes(code)){queue.acknowledge([record.researchContext.requestId]);continue;}
          if([401,403].includes(response.status)||(response.status===409&&code==='ACTOR_CHANGED')){stopped=true;notify('session_changed');return;}
          if([400,409,413].includes(response.status)){queue.hold(record.researchContext.requestId,'answer_rejected');continue;}
          if(!response.ok||result?.ok!==true||result.researchRecorded!==true)throw Error('unconfirmed');
          queue.acknowledge([record.researchContext.requestId]);failures=0;retryAt=0;
        }catch{failures++;retryAt=now()+Math.min(60000,2000*2**Math.min(failures-1,5));notify('sync_pending');return;}
        finally{clearTimeout(timer);}
      }
      notify(queue.status().held?'records_held':queue.status().pending?'sync_pending':'synced');
    }).finally(()=>{inFlight=null;});
    return inFlight;
  }
  return {enqueue,flush,status,stop:()=>{stopped=true;}};
}
