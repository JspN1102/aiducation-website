'use strict';
// Guangzhou outbound HTTPS only. No public database listener or HTTP backdoor.
const crypto=require('node:crypto');
const blob=require('@vercel/blob');
const {Pool}=require('pg');
const store=require('../api/_lib/research-store.cjs');
const HOUR=3600000;
const hourOf=at=>new Date(Math.floor(at/HOUR)*HOUR).toISOString().slice(0,13);
const prefixOf=hour=>`${store.NS}/outbox/${hour.replaceAll('-','/').replace('T','/')}/`;
const PATH=new RegExp('^'+store.NS+'/outbox/\\d{4}/\\d{2}/\\d{2}/\\d{2}/r_[a-zA-Z0-9_-]{8,80}/[a-f0-9-]{36}-[a-f0-9]{64}\\.json$','i');
async function state(db,key){return (await db.query('SELECT value FROM research_sync_state WHERE key=$1',[key])).rows[0]?.value||null;}
async function saveState(db,key,value){await db.query(`INSERT INTO research_sync_state(key,value) VALUES($1,$2::jsonb)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=clock_timestamp()`,[key,JSON.stringify(value)]);}

async function scanHour(hour,{db,client=blob,deadline,maxObjects=100,now=Date.now}){
  const prefix=prefixOf(hour),saved=await state(db,'cursor/'+hour);let cursor=saved?.cursor||undefined;
  let processed=0,pages=0;
  while(now()<deadline&&processed<maxObjects){
    const listing=await client.list({prefix,cursor,limit:Math.min(100,maxObjects-processed),abortSignal:AbortSignal.timeout(12000)});
    if(!listing||!Array.isArray(listing.blobs)||listing.blobs.some(b=>typeof b.pathname!=='string'||!b.pathname.startsWith(prefix)||!PATH.test(b.pathname)||b.size>store.MAX_BATCH_BYTES+32768))throw new Error('INVALID_OUTBOX_LIST');
    if(listing.hasMore&&(!listing.cursor||listing.cursor===cursor))throw new Error('INVALID_OUTBOX_CURSOR');
    for(const item of listing.blobs){
      if(now()>=deadline)return {complete:false,processed,pages};
      const prior=(await db.query('SELECT checksum FROM research_outbox_receipts WHERE pathname=$1',[item.pathname])).rows[0];
      if(!prior){
        const batch=store.verifyStoredBatch(await store.readPrivate(item.pathname,{client,maxBytes:store.MAX_BATCH_BYTES+32768}));
        if(store.outboxPath(batch)!==item.pathname)throw new Error('OUTBOX_PATH_CHECKSUM');
        await store.appendPostgres(batch,db);
        // A crash between import and receipt replays idempotently. Never advance before durable import.
        await db.query('INSERT INTO research_outbox_receipts(pathname,checksum,event_count) VALUES($1,$2,$3) ON CONFLICT(pathname) DO NOTHING',[item.pathname,batch.checksum,batch.events.length]);
      }
      processed++;
    }
    pages++;
    cursor=listing.hasMore?listing.cursor:undefined;
    await saveState(db,'cursor/'+hour,{cursor:cursor||null,scanAt:new Date(now()).toISOString(),complete:!cursor});
    if(!cursor)return {complete:true,processed,pages};
  }
  return {complete:false,processed,pages};
}

async function publishDay(day,{db,client=blob,now=Date.now,deadline,priorParts=[]}){
  // Keyset pagination preserves all events. Content-addressed chunks are immutable.
  const known=new Map(store.validatePublishedParts(priorParts).filter(part=>part.date===day).map(part=>[part.path,part]));
  const parts=[];
  const cohorts=(await db.query(`SELECT DISTINCT grade,cls FROM research_events
    WHERE received_at >= ($1::date::timestamp AT TIME ZONE 'UTC') AND received_at < (($1::date + 1)::timestamp AT TIME ZONE 'UTC') ORDER BY grade,cls`,[day])).rows;
  for(const cohort of cohorts){
  let afterId=0;
  while(true){
    if(now()>=deadline)throw new Error('SNAPSHOT_DEADLINE');
    const result=await db.query(`SELECT id,record FROM research_events
      WHERE received_at >= ($1::date::timestamp AT TIME ZONE 'UTC') AND received_at < (($1::date + 1)::timestamp AT TIME ZONE 'UTC') AND id > $2 AND grade=$3 AND cls=$4
      ORDER BY id LIMIT 250`,[day,afterId,cohort.grade,cohort.cls]);
    if(!result.rows.length)break;
    const value={schemaVersion:1,date:day,grade:cohort.grade,cls:cohort.cls,events:result.rows.map(r=>r.record)};
    const bytes=store.canonical(value),sha256=store.hash(bytes),pathname=`${store.NS}/published/events/${day}/${cohort.grade}/${cohort.cls}/${sha256}.json`;
    if(Buffer.byteLength(bytes)>8*1024*1024)throw new Error('SNAPSHOT_CHUNK_LIMIT');
    const published=known.get(pathname);
    if(published&&(published.count!==value.events.length||published.bytes!==Buffer.byteLength(bytes)))throw new Error('PUBLISHED_CHUNK_METADATA_CONFLICT');
    // A verified manifest references a previously durable immutable object. Its
    // identical hash can be reused without another failed put and network get.
    if(!published){
      try{await client.put(pathname,bytes,{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json',abortSignal:AbortSignal.timeout(12000)});}
      catch(error){if(!(error instanceof blob.BlobPreconditionFailedError)&&!/already exists/i.test(String(error?.message)))throw error;
        const prior=await store.readPrivate(pathname,{client,maxBytes:8*1024*1024});if(store.hash(store.canonical(prior))!==sha256)throw new Error('SNAPSHOT_CHUNK_CONFLICT');}
    }
    parts.push({date:day,grade:cohort.grade,cls:cohort.cls,path:pathname,sha256,bytes:Buffer.byteLength(bytes),count:value.events.length});
    afterId=Number(result.rows.at(-1).id);
    if(parts.length>10000)throw new Error('SNAPSHOT_PARTITION_LIMIT');
  }
  }
  return parts;
}
async function synchronize({db,client=blob,startDate,now=Date.now,maxSeconds=90,maxObjects=150}={}){
  if(!/^\d{4}-\d\d-\d\d$/.test(startDate||'')||!Number.isFinite(Date.parse(startDate)))throw new Error('RESEARCH_START_DATE_REQUIRED');
  if(maxSeconds<1||maxSeconds>180||maxObjects<1||maxObjects>500)throw new Error('INVALID_RUN_BOUNDS');
  const begun=now(),deadline=begun+maxSeconds*1000,lock=await db.connect();
  let locked=false;
  try{
    locked=(await lock.query('SELECT pg_try_advisory_lock(704202601) AS acquired')).rows[0].acquired;
    if(!locked)return {ok:true,skipped:'already_running'};
    const initial=hourOf(Date.parse(startDate)),old=await state(db,'watermark');let watermark=old?.nextHour||initial;
    if(watermark<initial)throw new Error('START_DATE_CHANGED_FORWARD');
    const runs=[];
    const sealedBefore=hourOf(begun-2*HOUR),importDeadline=begun+maxSeconds*650;
    // Reserve progress for sealed history and time for publication, even during heavy current traffic.
    for(let count=0;count<3&&watermark<sealedBefore&&now()<begun+maxSeconds*250;count++){
      const result=await scanHour(watermark,{db,client,deadline:begun+maxSeconds*250,maxObjects,now});runs.push({hour:watermark,hot:false,...result});
      if(!result.complete)break;
      watermark=hourOf(Date.parse(watermark+':00:00.000Z')+HOUR);
      await saveState(db,'watermark',{nextHour:watermark});
    }
    // Revisit only recent mutable partitions; sealed history uses a persisted watermark.
    for(const offset of [0,1,2]){
      if(now()>=importDeadline)break;
      const hour=hourOf(begun-offset*HOUR);if(hour<initial)continue;
      runs.push({hour,hot:true,...await scanHour(hour,{db,client,deadline:importDeadline,maxObjects,now})});
    }
    for(let count=0;count<3&&watermark<sealedBefore&&now()<importDeadline;count++){
      const result=await scanHour(watermark,{db,client,deadline:importDeadline,maxObjects,now});runs.push({hour:watermark,hot:false,...result});
      if(!result.complete)break;
      watermark=hourOf(Date.parse(watermark+':00:00.000Z')+HOUR);
      await saveState(db,'watermark',{nextHour:watermark});
    }
    // Raw PG remains authoritative. Publication is separate and never acknowledges ingest.
    const prior=await store.readPrivate(`${store.NS}/published/manifest.json`,{client})||{schemaVersion:1,parts:[]};
    if(prior.schemaVersion!==1||!Array.isArray(prior.parts))throw new Error('INVALID_PUBLISHED_MANIFEST');
    store.validatePublishedParts(prior.parts);
    const dirty=(await db.query("SELECT key,updated_at,count(*) OVER() AS total_dirty FROM research_sync_state WHERE key LIKE 'dirty/%' ORDER BY key LIMIT 7")).rows;
    let parts=prior.parts,publishedDays=0;
    for(const item of dirty){
      if(now()>=deadline-10000)break;
      const day=item.key.slice(6),fresh=await publishDay(day,{db,client,deadline,now,priorParts:parts});
      parts=parts.filter(p=>p.date!==day).concat(fresh);publishedDays++;
      // Do not clear until the manifest referencing the complete chunks is durable.
    }
    const generatedAt=new Date(now()).toISOString();
    let snapshot=null;
    const defaultFilters=store.filtersFrom({},now());
    try{
      const rows=await store.readPostgres(defaultFilters,db);
      const stableAt=rows.length?rows.reduce((a,r)=>r.serverReceivedAt>a?r.serverReceivedAt:a,rows[0].serverReceivedAt):defaultFilters.to+'T00:00:00.000Z';
      const value={schemaVersion:1,analytics:store.aggregateEvents(rows,defaultFilters,{generatedAt:stableAt,source:'postgres'})};
      const body=store.canonical(value),sha256=store.hash(body),pathname=`${store.NS}/published/analytics/${sha256}.json`;
      if(Buffer.byteLength(body)>8*1024*1024)throw new store.ResearchError('NARROW_DATE_OR_CLASS_FILTER',413);
      if(prior.snapshot?.sha256!==sha256){
        try{await client.put(pathname,body,{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json',abortSignal:AbortSignal.timeout(12000)});}
        catch(error){if(!(error instanceof blob.BlobPreconditionFailedError)&&!/already exists/i.test(String(error?.message)))throw error;
          const saved=await store.readPrivate(pathname,{client,maxBytes:8*1024*1024});if(store.hash(store.canonical(saved))!==sha256)throw new Error('ANALYTICS_CHECKSUM');}
      }
      snapshot={path:pathname,sha256,filters:defaultFilters,bytes:Buffer.byteLength(body)};
    }catch(error){if(!(error instanceof store.ResearchError)||error.status!==413)throw error;}
    const manifest={schemaVersion:1,dictionaryVersion:'research-v1',generatedAt,watermark,snapshot,
      overview:{status:snapshot?'ready':'filter_required',filters:defaultFilters,maxEvents:store.MAX_READ_EVENTS,...snapshot?{}:{reason:'NARROW_DATE_OR_CLASS_FILTER'}},
      status:watermark<sealedBefore||runs.some(r=>!r.complete)||publishedDays<Number(dirty[0]?.total_dirty||0)||
        runs.filter(r=>r.hot).length<[0,1,2].filter(offset=>hourOf(begun-offset*HOUR)>=initial).length?'catching_up':'current',parts:parts.sort((a,b)=>a.date.localeCompare(b.date)||a.path.localeCompare(b.path)),
      totalEvents:parts.reduce((n,p)=>n+p.count,0),source:'guangzhou_postgres',firstDate:startDate};
    if(Buffer.byteLength(store.canonical(manifest))>2*1024*1024)throw new Error('MANIFEST_LIMIT');
    await client.put(`${store.NS}/published/manifest.json`,store.canonical(manifest),{access:'private',addRandomSuffix:false,allowOverwrite:true,contentType:'application/json',abortSignal:AbortSignal.timeout(12000)});
    for(const item of dirty.slice(0,publishedDays))await db.query('DELETE FROM research_sync_state WHERE key=$1 AND updated_at=$2',[item.key,item.updated_at]);
    const result={ok:true,generatedAt,watermark,status:manifest.status,publishedDays,publishedEvents:manifest.totalEvents,
      processedObjects:runs.reduce((n,r)=>n+r.processed,0),scannedHours:runs.length,elapsedMs:now()-begun,
      sourceObjectsDeleted:false,rawHistory:'append_only_postgres',publicDatabaseListener:false};
    await saveState(db,'last_success',result);return result;
  }finally{if(locked)await lock.query('SELECT pg_advisory_unlock(704202601)').catch(()=>{});lock.release();}
}
async function main(){
  if(process.env.RESEARCH_SYNC_ENABLE!=='1'||process.env.RESEARCH_ENABLED!=='1')throw new Error('RESEARCH_SYNC_DISABLED');
  const db=new Pool({...store.pgConfig(),max:3});
  try{console.log(JSON.stringify(await synchronize({db,startDate:process.env.RESEARCH_START_DATE})));}
  finally{await db.end();}
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({ok:false,error:'RESEARCH_SYNC_FAILED',detail:/^[A-Z_]+$/.test(error.message)?error.message:'storage_or_validation_error'}));process.exitCode=1;});
module.exports={hourOf,prefixOf,scanHour,publishDay,synchronize};
