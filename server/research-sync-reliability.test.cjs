'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const store=require('../api/_lib/research-store.cjs'),sync=require('../deploy/research-sync.cjs');
const at=Date.parse('2026-09-20T02:00:00.000Z');
const actor={id:'s_synthetic_12345678',researchId:'r_synthetic_12345678',role:'student',grade:2,cls:'A'};
const batch=()=>store.validateBatch({schemaVersion:1,batchId:randomUUID(),actorId:actor.id,events:[{eventId:randomUUID(),sessionId:randomUUID(),seq:0,activeMs:0,clientAt:new Date(at).toISOString(),poemId:2,activity:'read',type:'feedback_shown',itemId:'p2.l0',appVersion:'test',contentVersion:'v1',result:{status:'completed',score:0}}]},actor,at);
function database(){
 const states=new Map(),receipts=new Map(),events=[];
 const lock={release(){},async query(){return {rows:[{acquired:true}]};}};
 return {states,receipts,events,async connect(){return lock;},async query(sql,args=[]){
  if(sql.startsWith('SELECT value FROM research_sync_state WHERE key=$1'))return {rows:states.has(args[0])?[{value:states.get(args[0])}]:[]};
  if(sql.startsWith('INSERT INTO research_sync_state')){states.set(args[0],JSON.parse(args[1]));return {rows:[]};}
  if(sql.startsWith('DELETE FROM research_sync_state')){for(const key of states.keys())if(sql.includes('LIKE')?key.startsWith(args[0].slice(0,-1)):key===args[0])states.delete(key);return {rows:[]};}
  if(sql.startsWith('SELECT checksum FROM'))return {rows:receipts.has(args[0])?[{checksum:receipts.get(args[0])}]:[]};
  if(sql.startsWith('INSERT INTO research_outbox_receipts')){receipts.set(args[0],args[1]);return {rows:[]};}
  if(sql.startsWith('SELECT key,value'))return {rows:[...states].filter(([key,value])=>key.startsWith('quarantine/')&&value.retryAfter<=args[0]).slice(0,args[1]).map(([key,value])=>({key,value}))};
  if(sql.startsWith('SELECT count(*) AS pending_objects')){const values=[...states].filter(([key])=>key.startsWith('quarantine/')).map(([,value])=>value);return {rows:[{pending_objects:values.length,integrity_issues:values.filter(value=>value.integrity).length,oldest_pending_at:values.map(value=>value.firstAt).sort()[0]||null,last_attempt_at:values.map(value=>value.lastAt).sort().at(-1)||null}]};}
  if(sql.startsWith('SELECT key,updated_at')){const keys=[...states.keys()].filter(key=>key.startsWith('dirty/'));return {rows:keys.map(key=>({key,updated_at:new Date(at),total_dirty:keys.length}))};}
  if(sql.startsWith('SELECT value FROM research_sync_state WHERE key LIKE'))return {rows:[...states].filter(([key])=>key.startsWith(args[0].slice(0,-1))).map(([,value])=>({value}))};
  if(sql.includes('SELECT DISTINCT grade,cls'))return {rows:events.length?[{grade:2,cls:'A'}]:[]};
  if(sql.startsWith('SELECT id,record'))return {rows:events.filter(value=>value.id>args[1]).slice(0,250)};
  if(sql.startsWith('SELECT record FROM'))return {rows:events.map(value=>({record:value.record}))};
  throw new Error('Unexpected synthetic database query');
 }};
}
function blob(){
 const objects=new Map(),reads=new Map(),listed=[];let active=0,peak=0;
 return {objects,reads,listed,get peak(){return peak;},async put(name,body,options){assert.equal(options.access,'private');if(objects.has(name)&&!options.allowOverwrite)throw new Error('already exists');objects.set(name,body);return {pathname:name};},
  async get(name){reads.set(name,(reads.get(name)||0)+1);active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,1));active--;if(!objects.has(name))return null;const bytes=Buffer.from(objects.get(name));return {statusCode:200,blob:{size:bytes.length},stream:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}})};},
  async list({prefix}){listed.push(prefix);return {blobs:[...objects].filter(([name])=>name.startsWith(prefix)).map(([pathname,body])=>({pathname,size:Buffer.byteLength(body)})),hasMore:false};}
 };
}
function importer(t,db){t.mock.method(store,'appendPostgres',async input=>{
 let inserted=0;store.verifyStoredBatch(input);
 for(const record of input.events){
  const prior=db.events.find(value=>value.record.researchId===record.researchId&&value.record.source===record.source&&value.record.event.eventId===record.event.eventId);
  if(prior){assert.equal(prior.record.eventChecksum,record.eventChecksum);continue;}
  db.events.push({id:db.events.length+1,record});inserted++;
 }
 if(inserted)db.states.set('dirty/'+input.serverReceivedAt.slice(0,10),{dirty:true});
 return {inserted,duplicates:input.events.length-inserted};
});}

test('intent-only failure recovers after the historical watermark passes and repeated transport preserves the first imported row',async t=>{
 const db=database(),client=blob(),put=client.put;importer(t,db);let failed=true;
 client.put=async(name,...args)=>{if(failed&&name.includes('/outbox/'))throw new Error('temporary outage');return put(name,...args);};
 const eventId=store.stableOutcomeId(actor.id,randomUUID()),body={schemaVersion:1,batchId:eventId,actorId:actor.id,events:[{
  eventId,sessionId:randomUUID(),seq:0,activeMs:0,clientAt:new Date(at).toISOString(),poemId:2,activity:'challenge',type:'provider_result',
  itemId:'p2.sound.1',appVersion:'test',contentVersion:'v1',provider:'aiducation',model:'curriculum',providerVersion:'v1',operation:'challenge',result:{status:'correct',score:100,correct:true},context:{itemType:'sound'}
 }]};
 const options={now:at,source:'server_verified',storage:'blob_outbox',stableRequest:true,client};
 await assert.rejects(store.ingest(body,actor,options),/temporary outage/);
 assert.equal(client.objects.size,1);assert.equal([...client.objects.keys()].some(name=>name.includes('/outbox/')),false);
 const originalIntent=[...client.objects.values()][0],recoveredAt=at+86400000;
 // Normal operation has sealed the original day. It will never list that hour again.
 db.states.set('watermark',{nextHour:'2026-09-21T00'});failed=false;
 const receipt=await store.ingest(body,actor,{...options,now:recoveredAt});
 assert.equal(receipt.serverReceivedAt,new Date(recoveredAt).toISOString());
 const result=await sync.synchronize({db,client,startDate:'2026-09-20',now:()=>recoveredAt});
 assert.equal(result.status,'current');assert.equal(result.publishedEvents,1);assert.equal(db.events.length,1);assert.equal(db.receipts.size,1);
 assert.ok(client.listed.includes(sync.prefixOf('2026-09-21T02')));assert.ok(client.listed.every(prefix=>!prefix.includes('/2026/09/20/')));
 const firstRow=structuredClone(db.events[0].record);
 assert.equal(firstRow.serverReceivedAt,receipt.serverReceivedAt);assert.equal(firstRow.event.clientAt,new Date(at).toISOString());
 assert.equal([...client.objects].find(([name])=>name.includes('/requests/'))[1],originalIntent);
 await sync.synchronize({db,client,startDate:'2026-09-20',now:()=>recoveredAt});
 assert.equal(db.events.length,1);assert.equal(db.receipts.size,1);
 // A further next-day retry gets a new transport receipt; it never replaces the PG row/date.
 const laterAt=recoveredAt+86400000;db.states.set('watermark',{nextHour:'2026-09-22T00'});
 const replay=await store.ingest(body,actor,{...options,now:laterAt});
 assert.equal(replay.serverReceivedAt,new Date(laterAt).toISOString());
 const replayed=await sync.synchronize({db,client,startDate:'2026-09-20',now:()=>laterAt});
 assert.equal(replayed.publishedEvents,1);assert.equal(db.events.length,1);assert.equal(db.receipts.size,2);assert.deepEqual(db.events[0].record,firstRow);
});

test('bad outbox is durably isolated while healthy events publish; original object is retained and retry can recover',async t=>{
 const db=database(),client=blob(),bad=batch(),good=batch(),badPath=store.outboxPath(bad),goodPath=store.outboxPath(good);
 const corrupt=structuredClone(bad);corrupt.checksum='0'.repeat(64);
 client.objects.set(badPath,store.canonical(corrupt));client.objects.set(goodPath,store.canonical(good));importer(t,db);
 const result=await sync.synchronize({db,client,startDate:'2026-09-20',now:()=>at});
 assert.equal(result.status,'attention');assert.equal(result.integrity.pendingObjects,1);assert.equal(result.integrity.integrityIssues,1);assert.equal(result.publishedEvents,1);
 assert.equal(db.events.length,1);assert.equal(db.receipts.size,1);assert.equal(client.objects.get(badPath),store.canonical(corrupt));
 const manifest=JSON.parse(client.objects.get(store.NS+'/published/manifest.json'));assert.equal(manifest.status,'attention');assert.equal(manifest.totalEvents,1);
 await sync.scanHour('2026-09-20T02',{db,client,deadline:at+10000,now:()=>at});assert.equal(client.reads.get(badPath),1);
 client.objects.set(badPath,store.canonical(bad));
 const retries=await sync.retryQuarantined({db,client,deadline:at+7200000+10000,now:()=>at+7200000});
 assert.equal(retries,1);assert.equal(db.events.length,2);assert.equal(db.receipts.size,2);assert.equal((await sync.integritySummary(db)).pendingObjects,0);
 assert.ok(client.objects.has(badPath));
});

test('outbox downloads use at most three parallel requests and acknowledge only complete durable pages',async t=>{
 const db=database(),client=blob();importer(t,db);
 for(let i=0;i<7;i++){const value=batch();client.objects.set(store.outboxPath(value),store.canonical(value));}
 const result=await sync.scanHour('2026-09-20T02',{db,client,deadline:at+10000,now:()=>at});
 assert.equal(result.complete,true);assert.equal(result.processed,7);assert.equal(db.events.length,7);assert.equal(client.peak,3);
 assert.equal(db.states.get('cursor/2026-09-20T02').complete,true);
});

test('partial day publication resumes uploaded checkpoints without failed put/get loops',async()=>{
 const db=database(),client=blob();db.events.push(...Array.from({length:251},(_,index)=>({id:index+1,record:batch().events[0]})));
 let clock=at,puts=0;const originalPut=client.put;
 client.put=async(...args)=>{puts++;const result=await originalPut(...args);clock=at+20000;return result;};
 await assert.rejects(sync.publishDay('2026-09-20',{db,client,deadline:at+10000,now:()=>clock}),/SNAPSHOT_DEADLINE/);
 assert.equal(puts,1);assert.equal([...db.states.keys()].filter(key=>key.startsWith('published/')).length,1);
 client.put=async(...args)=>{puts++;return originalPut(...args);};
 const parts=await sync.publishDay('2026-09-20',{db,client,deadline:at+10000,now:()=>at});
 assert.equal(parts.length,2);assert.equal(puts,2);assert.equal(client.reads.size,0);
});

test('published shard reads preserve order and enforce three-request concurrency',async()=>{
 const client=blob(),parts=[],expected=[];
 for(let i=0;i<7;i++){const record=batch().events[0],value={schemaVersion:1,date:'2026-09-20',grade:2,cls:'A',events:[record]},body=store.canonical(value),sha=store.hash(body),pathname=store.NS+'/published/events/2026-09-20/2/A/'+sha+'.json';client.objects.set(pathname,body);parts.push({date:'2026-09-20',grade:2,cls:'A',path:pathname,sha256:sha,bytes:Buffer.byteLength(body),count:1});expected.push(record.event.eventId);}
 client.objects.set(store.NS+'/published/manifest.json',JSON.stringify({schemaVersion:1,generatedAt:new Date(at).toISOString(),parts}));
 const result=await store.readPublished({from:'2026-09-20',to:'2026-09-20'},client);
 assert.deepEqual(result.rows.map(row=>row.event.eventId),expected);assert.equal(client.peak,3);
});
