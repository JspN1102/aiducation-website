// Structured learning events, never raw speech, strokes, chat, IP or device IDs.
// Durable browser queues are partitioned by authenticated school account.
import {createPersistentQueue} from './persistent-queue.mjs?v=20260920b';
export const RESEARCH_APP_VERSION = 'school-research-20260922-school22';
export const RESEARCH_CONTENT_VERSION = 'edb-20260919b-challenge-20260919d';
const MAX_QUEUE = 5000, BATCH_SIZE = 32, MAX_BODY_BYTES = 48000, MAX_BATCHES = 4;
const OPTIONAL = ['attemptId','itemId','attemptNo','hint','retryCount','result','error','metrics','context','response','interaction'];
export function createResearchTracker({actorId, csrfToken, learningEpoch, storage,
  fetchImpl = globalThis.fetch, now = Date.now, monotonic = () => performance.now(),
  uuid = () => crypto.randomUUID(), visible = () => document.visibilityState !== 'hidden',
  onStatus = () => {}, enabled = true} = {}) {
  const epoch = /^[a-f0-9]{32}$/.test(learningEpoch || '') ? learningEpoch : null;
  const key = 'maanshan-research-v1:' + actorId + (epoch ? ':epoch:' + epoch : '');
  const eventPrefix = key + ':event:';
  if(storage===undefined){try{storage=globalThis.localStorage;}catch{storage=null;}}
  const sessionId = uuid();
  let seq = 0, activity = 'navigation', poemId = null, started = monotonic(), accounted = started;
  let lastInteraction = started, activeMs = 0, inFlight = null, stopped = false, lost = 0, spanOpen = true;
  let failures=0,retryAt=0,lastSyncedAt=null,lastStatus='pending',queue,batchCeiling=BATCH_SIZE;
  function notify(state) {lastStatus=state;try{onStatus(state,status());}catch{}}
  function status(){return {...(queue?.status()||{pending:0,held:0,volatile:0,storageAvailable:Boolean(storage)}),lost,stopped,enabled,lastStatus,lastSyncedAt,retryAt};}
  if (!actorId || !csrfToken) enabled = false;
  queue=createPersistentQueue({prefix:eventPrefix,storage,limit:MAX_QUEUE,notify,
    identify:event=>event.eventId,
    valid:event=>event&&typeof event==='object'&&/^[a-f0-9-]{36}$/i.test(event.eventId||'')&&typeof event.clientAt==='string'&&Number.isFinite(Date.parse(event.clientAt))&&Number.isInteger(event.seq),
    compare:(a,b)=>a.clientAt.localeCompare(b.clientAt)||a.seq-b.seq});
  if(enabled){
    try {
      const data=JSON.parse(storage?.getItem(key)||'null');
      if(data?.actorId===actorId&&Array.isArray(data.events)){
        let migrated=true;for(const event of data.events)migrated=queue.add(event)&&migrated;
        lost=Number(data.lost)||0;
        if(migrated&&!queue.status().volatile)storage.removeItem(key);
      }
    }catch{notify('storage_unavailable');}
  }
  function updateActive(wasVisible = visible()) {
    const tick = monotonic();
    if (wasVisible) activeMs += Math.max(0, Math.min(tick, lastInteraction + 60000) - accounted);
    accounted = tick;
    return Math.round(Math.min(activeMs, 21600000));
  }
  function touch() { updateActive(); lastInteraction = monotonic(); }
  function emit(type, fields = {}) {
    if (!enabled || stopped) return null;
    const event = {eventId:uuid(), sessionId, seq:seq++, clientAt:new Date(now()).toISOString(),
      activeMs:updateActive(), poemId, activity, type, appVersion:RESEARCH_APP_VERSION, contentVersion:RESEARCH_CONTENT_VERSION};
    for (const name of OPTIONAL) if (fields[name] !== undefined) event[name] = fields[name];
    if (fields.activity) event.activity = fields.activity;
    if (fields.poemId !== undefined) event.poemId = fields.poemId;
    if(!queue.add(event)){lost++;notify('queue_full');return null;}
    notify('queued');
    if (queue.status().pending >= BATCH_SIZE) void flush();
    return event;
  }
  function begin(nextActivity, nextPoemId) {
    closeSpan();
    activity = nextActivity; poemId = nextPoemId;
    started = accounted = lastInteraction = monotonic(); spanOpen = true;
    emit('activity_start');
  }
  function context(fields = {}) {
    return {actorId, sessionId, attemptId:fields.attemptId || uuid(), itemId:fields.itemId || 'activity', poemId:fields.poemId??poemId,
      activity:fields.activity || activity, appVersion:RESEARCH_APP_VERSION, contentVersion:RESEARCH_CONTENT_VERSION,
      ...(fields.context ? {context:fields.context} : {})};
  }
  function flush({keepalive = false, force = false} = {}) {
    if (!enabled || stopped) return;
    if (inFlight) return inFlight;
    if(!force&&now()<retryAt)return;
    const selected=queue.recover().slice(0,keepalive?BATCH_SIZE:BATCH_SIZE*MAX_BATCHES);
    if(!selected.length){notify(queue.status().held?'records_held':'synced');return;}
    // Select a fixed snapshot. Events emitted during this upload stay queued.
    inFlight=Promise.resolve().then(async()=>{
      let remaining=selected,calls=0,ceiling=batchCeiling;
      while(remaining.length&&!stopped&&calls<(keepalive?1:MAX_BATCHES)){
        const events=[],batchId=uuid();
        for(const event of remaining.slice(0,ceiling)){
          if(new TextEncoder().encode(JSON.stringify({schemaVersion:1,batchId,actorId,events:[...events,event]})).length>MAX_BODY_BYTES)break;
          events.push(event);
        }
        if(!events.length){queue.hold(remaining[0].eventId,'event_too_large');remaining=remaining.slice(1);continue;}
        const ids=new Set(events.map(event=>event.eventId));
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
        try{
          calls++;notify('syncing');
          const response=await fetchImpl('/api/research-events/',{method:'POST',credentials:'same-origin',keepalive,
            headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken,...(epoch?{'X-Learning-Epoch':epoch}:{})},body:JSON.stringify({schemaVersion:1,batchId,actorId,events}),signal:controller.signal});
          const data=await response.json().catch(()=>null),code=data?.code||data?.error;
          if(response.status===409&&code==='LEARNING_RESET'){stopped=true;notify('learning_reset');return;}
          if([401,403].includes(response.status)||(response.status===409&&!['EVENT_ID_CONFLICT','BATCH_ID_CONFLICT'].includes(code))){stopped=true;notify('session_changed');return;}
          if([400,413].includes(response.status)||(response.status===422&&['POEM_GRADE_FORBIDDEN','RESEARCH_EXCLUDED'].includes(code))||(response.status===409&&['EVENT_ID_CONFLICT','BATCH_ID_CONFLICT'].includes(code))){
            if(events.length>1){batchCeiling=ceiling=Math.max(1,Math.floor(events.length/2));continue;}
            if(response.status===422)queue.acknowledge([events[0].eventId]);
            else queue.hold(events[0].eventId,response.status===409?'record_conflict':'schema_rejected');
            remaining=remaining.slice(1);batchCeiling=ceiling=BATCH_SIZE;
            continue;
          }
          if(!response.ok||data?.accepted!==true||data.batchId!==batchId||!Array.isArray(data.eventIds)||data.eventIds.length!==ids.size||!data.eventIds.every(id=>ids.has(id))||new Set(data.eventIds).size!==ids.size)throw Error('unconfirmed');
          queue.acknowledge(ids);remaining=remaining.slice(events.length);batchCeiling=ceiling=BATCH_SIZE;
          failures=0;retryAt=0;lastSyncedAt=now();
        }catch{
          failures++;retryAt=now()+Math.min(60000,1500*2**Math.min(failures-1,6));notify('sync_pending');return;
        }finally{clearTimeout(timer);}
      }
      if(lost&&queue.status().pending<MAX_QUEUE-1){const count=lost;lost=0;emit('error',{error:{code:'storage_unavailable',retryable:false},metrics:{lostEventCount:count}});}
      notify(queue.status().held?'records_held':queue.status().pending?'sync_pending':'synced');
    }).finally(()=>{inFlight=null;});
    return inFlight;
  }
  function closeSpan() { if (!spanOpen) return; emit('activity_end', {metrics:{elapsedMs:Math.min(21600000,Math.round(monotonic()-started))}}); spanOpen = false; }
  function leave() { closeSpan(); return flush({keepalive:true}); }
  function visibilityChanged(hidden) { if (hidden) { updateActive(true); void leave(); } else if (!spanOpen) { started = accounted = lastInteraction = monotonic(); spanOpen = true; emit('activity_start'); void flush(); } }
  function stop() { stopped = true; }
  emit('session_start');
  return {emit, begin, touch, context, flush, leave, stop, visibilityChanged, sessionId,
    status};
}
export function attachResearchLifecycle(tracker, scope = globalThis) {
  const controller = new AbortController();
  const options = {passive:true,signal:controller.signal};
  for (const event of ['pointerdown','keydown','scroll']) scope.document.addEventListener(event, () => tracker.touch(), options);
  scope.document.addEventListener('visibilitychange', () => tracker.visibilityChanged(scope.document.visibilityState === 'hidden'), options);
  scope.addEventListener('online', () => void tracker.flush(), options);
  scope.addEventListener('pagehide', () => void tracker.leave(), options);
  let errorBudget=8;
  scope.addEventListener('unhandledrejection',event=>{if(errorBudget-->0)tracker.emit('error',{itemId:'client.unhandled',error:{code:researchErrorCode(event.reason),retryable:false}});},options);
  scope.addEventListener('error',()=>{if(errorBudget-->0)tracker.emit('error',{itemId:'client.runtime',error:{code:'unknown',retryable:false}});},options);
  const timer = setInterval(() => void tracker.flush(), 15000);
  return () => { clearInterval(timer); controller.abort(); tracker.stop(); };
}
export function researchErrorCode(error) {
  if (['NotAllowedError','SecurityError'].includes(error?.name)) return 'permission_denied';
  if (['TimeoutError'].includes(error?.name) || error?.code === 'TIMEOUT') return 'timeout';
  if (error?.name === 'AbortError') return 'aborted';
  if (error instanceof TypeError || ['NETWORK','OFFLINE'].includes(error?.code)) return 'network';
  if (error?.code === 'AUDIO_UNSUPPORTED') return 'unsupported';
  if (error?.code === 'SERVICE' || error?.code === 'BUSY') return 'provider_unavailable';
  return 'unknown';
}
