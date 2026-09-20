// Private recordings are kept in Guangzhou. IndexedDB is only the bounded
// pending-upload queue, separated by account and teacher practice generation.
const MAX_AUDIO = 1365400;
const DB_NAME = 'maanshan-private-recordings-v1';
const slot = value => `${value.poemId}-${value.lineIndex}`;
const newer = (a,b) => !b || a.recordedAt>b.recordedAt || a.recordedAt===b.recordedAt&&a.recordingId>b.recordingId;
const valid = value => value && Number.isInteger(value.poemId)&&value.poemId>=1&&value.poemId<=6&&
  Number.isInteger(value.lineIndex)&&value.lineIndex>=0&&value.lineIndex<8&&
  typeof value.recordingId==='string'&&/^[a-f0-9-]{36}$/.test(value.recordingId)&&Number.isSafeInteger(value.recordedAt);
function wavBlob(audio) {
  const binary=atob(audio),bytes=new Uint8Array(binary.length);
  for(let i=0;i<bytes.length;i++)bytes[i]=binary.charCodeAt(i);
  return new Blob([bytes],{type:'audio/wav'});
}
export function createRecordingQueue(indexedDB=globalThis.indexedDB) {
  let opening;
  function open() {
    if(!indexedDB)return Promise.reject(new Error('Recording queue unavailable'));
    return opening ||= new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB_NAME,1);
      request.onupgradeneeded=()=>{const store=request.result.createObjectStore('pending',{keyPath:'key'});store.createIndex('scope','scope');};
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
      request.onerror=()=>{opening=null;reject(request.error);};
    });
  }
  async function transact(mode,work) {
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('pending',mode),store=tx.objectStore('pending');let result;
      tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Recording queue unavailable'));
      work(store,value=>{result=value;});
    });
  }
  return {
    list(scope){return transact('readonly',(store,done)=>{const request=store.index('scope').getAll(scope);request.onsuccess=()=>done(request.result);});},
    put(scope,item){return transact('readwrite',(store,done)=>{
      const key=`${scope}:${slot(item)}`,request=store.get(key);
      request.onsuccess=()=>{if(newer(item,request.result?.item)){store.put({key,scope,item});done(true);}else done(false);};
    });},
    remove(scope,item){return transact('readwrite',store=>{
      const key=`${scope}:${slot(item)}`,request=store.get(key);
      request.onsuccess=()=>{if(request.result?.item?.recordingId===item.recordingId)store.delete(key);};
    });}
  };
}
export function createRecordingLibrary({enabled,actorId,learningEpoch,fetch:request,canUse=()=>true,
  onChange=()=>{},onEpochChanged=()=>{},onStorageError=()=>{},preparePayload=async value=>value,
  storage=createRecordingQueue(),online=()=>globalThis.navigator?.onLine!==false,
  timers=globalThis}={}) {
  const records=new Map(),pending=new Map(),controllers=new Set(),loadedPoems=new Map();
  const scope=`${actorId||'demo'}:${learningEpoch||'student'}`;
  let stopped=false,flushing=null,retryTimer=null,retryCount=0,hydrating=null;
  const active=()=>!stopped&&canUse();
  const identity={actorId,...(learningEpoch?{learningEpoch}:{})};
  const notify=()=>{if(active())onChange();};
  function remember(item,blob) {
    const key=slot(item),previous=records.get(key);
    if(!previous||newer(item,previous)||item.recordingId===previous.recordingId){records.set(key,{...item,blob:blob||previous?.recordingId===item.recordingId&&previous.blob||null});return true;}
    return false;
  }
  async function call(url,options={}) {
    if(!active())throw new Error('Recording session ended');
    const controller=new AbortController();controllers.add(controller);
    const timer=timers.setTimeout(()=>controller.abort(),18000);
    try{
      const response=await request(url,{...options,signal:controller.signal});
      // Headers are not completion: retain cancellation through the full body
      // read so a stalled stream cannot hold the outbox/session open forever.
      const data=await response.json();return {response,data};
    }
    finally{controllers.delete(controller);timers.clearTimeout(timer);}
  }
  function retry() {
    if(!active()||retryTimer||!pending.size)return;
    retryTimer=timers.setTimeout(()=>{retryTimer=null;void flush();},[1500,5000,15000,60000][Math.min(retryCount++,3)]);
    retryTimer?.unref?.();
  }
  async function flush() {
    if(!enabled||!active()||!online())return;
    if(flushing)return flushing;
    flushing=(async()=>{
      while(active()&&pending.size&&online()) {
        const item=pending.values().next().value;
        try {
          const payload=await preparePayload({...identity,...item});
          if(!active())return;
          const {response,data}=await call('/api/school-recordings/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
          if(!active())return;
          if(response.status===409&&data.code==='LEARNING_RESET'){stop();onEpochChanged();return;}
          if(!response.ok||!data.ok||data.userId!==actorId||!valid(data.recording)) {
            // Invalid/expired identities are never retried under another user.
            if([400,401,403,409,413,422].includes(response.status)){
              // Keep the private local copy: a rejected upload is not an
              // acknowledgement. A later fresh session can retry it once.
              if(pending.get(slot(item))?.recordingId===item.recordingId)pending.delete(slot(item));
              continue;
            }
            throw new Error('Recording upload unavailable');
          }
          await storage.remove(scope,item).catch(()=>{});
          if(pending.get(slot(item))?.recordingId===item.recordingId)pending.delete(slot(item));
          remember(data.recording);retryCount=0;notify();
        }catch {retry();return;}
      }
    })().finally(()=>{flushing=null;});
    return flushing;
  }
  async function save({poemId,lineIndex,recordingId,recordedAt,audio,blob}) {
    if(!active())return;
    const item={poemId,lineIndex,recordingId,recordedAt,audio};
    if(!valid(item)||typeof audio!=='string'||audio.length>MAX_AUDIO)return;
    if(!remember(item,blob))return;
    notify();
    if(!enabled)return;
    pending.set(slot(item),item);
    try {await storage.put(scope,item);}catch {if(active())onStorageError();}
    if(active())void flush();
  }
  async function hydrate({remote=true,poemId}={}) {
    if(!enabled||!active())return;
    if(hydrating)return hydrating.then(()=>hydrate({remote,poemId}));
    hydrating=(async()=>{
      // Load the local queue first so a slower server response cannot replace
      // a more recent recording captured before the page was refreshed.
      try {
        const queued=await storage.list(scope);if(!active())return;
        for(const row of queued.slice(0,48)) {
          const item=row.scope===scope&&row.item;
          if(valid(item)&&typeof item.audio==='string'&&item.audio.length<=MAX_AUDIO){
            const current=pending.get(slot(item));
            if(newer(item,current))pending.set(slot(item),item);
            if(newer(item,records.get(slot(item))))remember(item,wavBlob(item.audio));
          }
        }
        notify();
      }catch{}
      void flush();
      if(!remote||Date.now()-(loadedPoems.get(poemId||'all')||0)<60000)return;
      try {
        const {response,data}=await call('/api/school-recordings/?'+new URLSearchParams({action:'list',...identity,...(poemId?{poemId}:{})}));
        if(!active())return;
        if(response.status===409&&data.code==='LEARNING_RESET'){stop();onEpochChanged();return;}
        if(!response.ok||!data.ok||data.userId!==actorId||!Array.isArray(data.recordings))return;
        for(const item of data.recordings.slice(0,48))if(valid(item))remember(item);
        loadedPoems.set(poemId||'all',Date.now());
        notify();
      }catch{}
    })().finally(()=>{hydrating=null;});
    return hydrating;
  }
  function source(key) {
    if(!active())return null;
    const item=records.get(key);if(!item)return null;
    if(item.blob)return item.blob;
    return '/api/school-recordings/?'+new URLSearchParams({action:'audio',...identity,poemId:item.poemId,lineIndex:item.lineIndex,recordingId:item.recordingId});
  }
  function stop(){if(stopped)return;stopped=true;timers.clearTimeout(retryTimer);controllers.forEach(c=>c.abort());controllers.clear();records.clear();pending.clear();}
  return {save,hydrate,flush,source,stop,has:key=>active()&&records.has(key),pendingCount:()=>pending.size};
}
