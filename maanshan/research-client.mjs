// Structured learning events, never raw speech, strokes, chat, IP or device IDs.
// Durable browser queues are partitioned by authenticated school account.
export const RESEARCH_APP_VERSION = 'school-research-20260920a';
export const RESEARCH_CONTENT_VERSION = 'edb-20260919b-challenge-20260919d';
const MAX_QUEUE = 5000, BATCH_SIZE = 32, MAX_BODY_BYTES = 48000;
const OPTIONAL = ['attemptId','itemId','attemptNo','hint','retryCount','result','error','metrics','context','response','interaction'];
export function createResearchTracker({actorId, csrfToken, storage,
  fetchImpl = globalThis.fetch, now = Date.now, monotonic = () => performance.now(),
  uuid = () => crypto.randomUUID(), visible = () => document.visibilityState !== 'hidden',
  onStatus = () => {}, enabled = true} = {}) {
  const key = 'maanshan-research-v1:' + actorId;
  const eventPrefix = key + ':event:';
  if(storage===undefined){try{storage=globalThis.localStorage;}catch{storage=null;onStatus('storage_unavailable');}}
  const sessionId = uuid();
  let seq = 0, activity = 'navigation', poemId = null, started = monotonic(), accounted = started;
  let lastInteraction = started, activeMs = 0, pending = [], inFlight = null, stopped = false, lost = 0, spanOpen = true;
  const volatile = new Map();
  if (!actorId || !csrfToken) enabled = false;
  // One key per event: two tabs can append or acknowledge concurrently without
  // rewriting each other's queue. Replayed events are idempotent at the server.
  function saveEvent(event) {
    try {
      if(!storage)throw new Error('no storage');
      storage.setItem(eventPrefix+event.eventId,JSON.stringify(event));volatile.delete(event.eventId);
    } catch { volatile.set(event.eventId,event);onStatus('storage_unavailable'); }
  }
  function recover() {
    if(!storage)return;
    try {
      const found=new Map();
      for(let index=0;index<storage.length;index++){
        const name=storage.key(index);
        if(!name?.startsWith(eventPrefix))continue;
        const event=JSON.parse(storage.getItem(name)||'null');
        if(event?.eventId&&name===eventPrefix+event.eventId)found.set(event.eventId,event);
      }
      for(const [id,event]of volatile)found.set(id,event);
      pending=[...found.values()].sort((a,b)=>a.clientAt.localeCompare(b.clientAt)||a.seq-b.seq);
    }catch{onStatus('storage_unavailable');}
  }
  if(enabled){
    try {
      const data=JSON.parse(storage?.getItem(key)||'null');
      if(data?.actorId===actorId&&Array.isArray(data.events)){
        for(const event of data.events)saveEvent(event);
        lost=Number(data.lost)||0;
        if(!volatile.size)storage.removeItem(key);
      }
    }catch{onStatus('storage_unavailable');}
    recover();
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
    if (pending.length >= MAX_QUEUE) { recover();if(pending.length>=MAX_QUEUE){lost++;onStatus('queue_full');return null;} }
    const event = {eventId:uuid(), sessionId, seq:seq++, clientAt:new Date(now()).toISOString(),
      activeMs:updateActive(), poemId, activity, type, appVersion:RESEARCH_APP_VERSION, contentVersion:RESEARCH_CONTENT_VERSION};
    for (const name of OPTIONAL) if (fields[name] !== undefined) event[name] = fields[name];
    if (fields.activity) event.activity = fields.activity;
    if (fields.poemId !== undefined) event.poemId = fields.poemId;
    pending.push(event); saveEvent(event);
    if (pending.length >= BATCH_SIZE) void flush();
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
  async function flush({keepalive = false} = {}) {
    if (!enabled || stopped) return;
    if (inFlight) return inFlight;
    recover();
    if(!pending.length)return;
    const events = [];
    const batchId = uuid();
    for (const event of pending.slice(0, BATCH_SIZE)) {
      const candidate = {schemaVersion:1, batchId, actorId, events:[...events,event]};
      if (new TextEncoder().encode(JSON.stringify(candidate)).length > MAX_BODY_BYTES) break;
      events.push(event);
    }
    if (!events.length) { onStatus('event_too_large'); return; }
    const ids = new Set(events.map(event => event.eventId));
    inFlight = (async () => {
      try {
        const response = await fetchImpl('/api/research-events/', {method:'POST', credentials:'same-origin', keepalive,
          headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},
          body:JSON.stringify({schemaVersion:1,batchId,actorId,events}), signal:AbortSignal.timeout(12000)});
        const data = await response.json().catch(() => null);
        if ([401,403,409].includes(response.status)) { stopped = true; onStatus('session_changed'); return; }
        if (!response.ok || data?.accepted !== true || data.batchId !== batchId || !Array.isArray(data.eventIds) ||
          data.eventIds.length !== ids.size || !data.eventIds.every(id => ids.has(id)) || new Set(data.eventIds).size !== ids.size) {
          onStatus(response.status === 400 ? 'schema_rejected' : 'sync_pending'); return;
        }
        for(const id of ids){volatile.delete(id);try{storage?.removeItem(eventPrefix+id);}catch{onStatus('storage_unavailable');}}
        pending = pending.filter(event => !ids.has(event.eventId)); onStatus('synced');
        if (lost && pending.length < MAX_QUEUE - 1) {
          const count = lost; lost = 0;
          emit('error', {error:{code:'storage_unavailable',retryable:false}, metrics:{lostEventCount:count}});
        }
      } catch { onStatus('sync_pending'); }
      finally { inFlight = null; }
    })();
    return inFlight;
  }
  function closeSpan() { if (!spanOpen) return; emit('activity_end', {metrics:{elapsedMs:Math.min(21600000,Math.round(monotonic()-started))}}); spanOpen = false; }
  function leave() { closeSpan(); return flush({keepalive:true}); }
  function visibilityChanged(hidden) { if (hidden) { updateActive(true); void leave(); } else if (!spanOpen) { started = accounted = lastInteraction = monotonic(); spanOpen = true; emit('activity_start'); void flush(); } }
  function stop() { stopped = true; }
  emit('session_start');
  return {emit, begin, touch, context, flush, leave, stop, visibilityChanged, sessionId,
    status:() => ({pending:pending.length,lost,stopped,enabled})};
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
