'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const s=require('../api/_lib/research-store.cjs');
const sync=require('../deploy/research-sync.cjs');
const now=Date.parse('2026-09-20T08:00:00.000Z');
const actor={id:'s_123456789012345678901234',researchId:'r_123456789012345678901234',role:'student',grade:2,cls:'A',displayName:'Excluded',login:'Excluded'};
const event=(changes={})=>({eventId:randomUUID(),sessionId:randomUUID(),seq:0,clientAt:new Date(now).toISOString(),activeMs:0,poemId:2,
  activity:'challenge',type:'answer_submitted',appVersion:'test-v1',contentVersion:'poem-2-v1',...changes,context:{itemType:'sound',...changes.context}});
const input=events=>({schemaVersion:1,batchId:randomUUID(),actorId:actor.id,events});
const row=(changes={},at=now,source='client')=>s.validateBatch(input([event({...source==='server_verified'?{provider:'test',model:'test',providerVersion:'v1'}:{},...changes})]),actor,at,source).events[0];
const f={from:'2026-09-20',to:'2026-09-20',attempt:'latest'};

test('identity is bound to cookie actor; raw or impersonated fields never enter history',()=>{
  const good=s.validateBatch(input([event()]),actor,now);
  assert.equal(good.events[0].researchId,actor.researchId);
  assert.doesNotMatch(JSON.stringify(good),/Excluded|displayName|login|actorId/);
  assert.throws(()=>s.validateBatch({...input([event()]),actorId:'s_another'},actor,now),e=>e.code==='ACTOR_CHANGED'&&e.status===409);
  for(const forbidden of ['name','ip','audio','strokes','chatText','source','researchId','provider'])
    assert.throws(()=>s.validateBatch(input([event({[forbidden]:'secret'})]),actor,now),forbidden);
});
test('schema/ranges reject oversized batches, invalid dates, nonfinite metrics, duplicate events',()=>{
  const e=event();
  assert.throws(()=>s.validateBatch(input([e,e]),actor,now));
  assert.throws(()=>s.validateBatch(input(Array.from({length:51},()=>event())),actor,now));
  assert.throws(()=>s.validateEvent(event({clientAt:'2026-02-30T00:00:00.000Z'})));
  assert.throws(()=>s.validateEvent(event({metrics:{elapsedMs:Infinity}})));
  assert.throws(()=>s.validateEvent(event({metrics:{playbackRate:0}})));
  assert.throws(()=>s.validateEvent(event({metrics:{freeText:'not allowed'}})));
  assert.throws(()=>s.validateEvent(event({result:{status:'skipped',score:0}})));
  assert.doesNotThrow(()=>s.validateEvent(event({result:{status:'incorrect',score:0,correct:false},metrics:{lostEventCount:3,playbackRate:.8}})));
  assert.throws(()=>s.filtersFrom({to:'invalid'}),e=>e.status===400);
  assert.throws(()=>s.filtersFrom({from:'2026-01-01',to:'2026-09-20'}));
});
test('checksums detect changes; server words must belong to the poem and are never client accepted',()=>{
  const batch=s.validateBatch(input([event()]),actor,now);s.verifyStoredBatch(batch);
  batch.events[0].grade=4;assert.throws(()=>s.verifyStoredBatch(batch),e=>e.code==='BATCH_CHECKSUM');
  const server=event({type:'provider_result',provider:'tencent',model:'soe',operation:'reading',providerVersion:'v1',wordScores:[{index:0,char:'李',score:0}]});
  assert.doesNotThrow(()=>s.validateEvent(server,true));
  assert.throws(()=>s.validateEvent(server));
  assert.throws(()=>s.validateEvent({...server,wordScores:[{index:0,char:'X',score:80}]},true));
});
test('provider score dimensions retain finite decimals and zeros only on server-verified records',()=>{
  const metrics={accuracyScore:0,fluencyScore:83.25,completionScore:99.5,suggestedScore:61.75};
  const saved=row({type:'provider_result',operation:'reading',metrics},now,'server_verified');
  assert.deepEqual(saved.event.metrics,metrics);
  assert.deepEqual(JSON.parse(s.exportRows([saved],f).content).event.metrics,metrics);
  for(const invalid of [null,-1,101,Infinity,'80'])assert.throws(()=>row({type:'provider_result',operation:'reading',metrics:{accuracyScore:invalid}},now,'server_verified'));
  assert.throws(()=>s.validateEvent(event({metrics})));
});
function fakeDB({conflict=false,failAt=0}={}){
  const stored=new Map(),calls=[];let draft,count=0;
  const connection={release(){calls.push('RELEASE');},async query(sql,args=[]){
    calls.push(sql);
    if(sql==='BEGIN'){draft=new Map(stored);return {rows:[]};}
    if(sql==='ROLLBACK'){draft=null;return {rows:[]};}
    if(sql==='COMMIT'){stored.clear();for(const [k,v]of draft)stored.set(k,v);return {rows:[]};}
    if(sql.startsWith('INSERT INTO research_events')){
      if(++count===failAt)throw new Error('simulated failure');
      const key=[args[0],args[1],args[2]].join('/');if(draft.has(key))return {rowCount:0,rows:[]};
      draft.set(key,args[10]);return {rowCount:1,rows:[{event_id:args[1]}]};
    }
    if(sql.startsWith('SELECT event_checksum'))return {rows:[{event_checksum:conflict?'different':draft.get(args.join('/'))}]};
    return {rows:[]};
  }};
  return {stored,calls,async connect(){return connection;}};
}
test('PG batches commit atomically, retry idempotently, and never mutate a conflicting event',async()=>{
  const batch=s.validateBatch(input([event(),event()]),actor,now),db=fakeDB();
  assert.deepEqual(await s.appendPostgres(batch,db),{inserted:2,duplicates:0});
  assert.deepEqual(await s.appendPostgres(batch,db),{inserted:0,duplicates:2});
  assert.equal(db.stored.size,2);
  const failed=fakeDB({failAt:2});await assert.rejects(s.appendPostgres(batch,failed));assert.equal(failed.stored.size,0);assert.ok(failed.calls.includes('ROLLBACK'));
  const conflicting=fakeDB({conflict:true});await s.appendPostgres(batch,conflicting);await assert.rejects(s.appendPostgres(batch,conflicting),e=>e.code==='EVENT_ID_CONFLICT');
});
function memoryBlob(){
  const objects=new Map();return {objects,
    async put(path,body,options){assert.equal(options.access,'private');if(objects.has(path)&&!options.allowOverwrite)throw new Error('already exists');objects.set(path,body);return {pathname:path};},
    async get(path){if(!objects.has(path))return null;const bytes=Buffer.from(objects.get(path));return {statusCode:200,blob:{size:bytes.length},stream:new ReadableStream({start(c){c.enqueue(bytes);c.close();}})};}
  };
}
test('Blob acknowledges only durable immutable outbox writes and preserves the initial retry timestamp',async()=>{
  const client=memoryBlob(),body=input([event()]);
  const first=await s.ingest(body,actor,{now,storage:'blob_outbox',client});
  const retry=await s.ingest(body,actor,{now:now+1000,storage:'blob_outbox',client});
  assert.equal(client.objects.size,1);assert.equal(retry.serverReceivedAt,first.serverReceivedAt);
  await assert.rejects(s.ingest(body,actor,{now,storage:'blob_outbox',client:{put:async()=>{throw new Error('offline');}}}));
  await assert.rejects(s.ingest(body,actor,{now,storage:null}),e=>e.code==='RESEARCH_DISABLED');
});
test('stable challenge receipts reject changed answers and route cross-day retries into the current outbox hour',async()=>{
  const client=memoryBlob(),eventId=s.stableOutcomeId(actor.id,randomUUID());
  const answer=event({eventId,type:'provider_result',provider:'aiducation',model:'curriculum',providerVersion:'v1',operation:'challenge',result:{status:'correct',score:100,correct:true}});
  const body={...input([answer]),batchId:eventId};
  const options={now,source:'server_verified',storage:'blob_outbox',client,stableRequest:true};
  const first=await s.ingest(body,actor,options);
  const sameHour=await s.ingest(body,actor,{...options,now:now+1000});
  assert.equal(sameHour.serverReceivedAt,first.serverReceivedAt);assert.equal(client.objects.size,2);
  const retry=await s.ingest(body,actor,{...options,now:now+86400000});
  assert.equal(retry.serverReceivedAt,new Date(now+86400000).toISOString());assert.equal(client.objects.size,3);
  const transported=[...client.objects].filter(([name])=>name.includes('/outbox/')).map(([,value])=>s.verifyStoredBatch(JSON.parse(value)));
  assert.equal(transported[0].events[0].eventChecksum,transported[1].events[0].eventChecksum);
  assert.equal(transported[1].events[0].serverReceivedAt,retry.serverReceivedAt);
  const changed={...body,events:[{...answer,result:{status:'incorrect',score:0,correct:false}}]};
  await assert.rejects(s.ingest(changed,actor,options),error=>error.code==='EVENT_ID_CONFLICT'&&error.status===409);
  assert.equal(client.objects.size,3);
});
test('stable request intent alone is not acknowledged and a later retry finishes a failed outbox write',async()=>{
  const client=memoryBlob(),put=client.put;let failed=true;
  client.put=async(name,...args)=>{if(failed&&name.includes('/outbox/'))throw new Error('temporary outage');return put(name,...args);};
  const eventId=s.stableOutcomeId(actor.id,randomUUID()),body={...input([event({eventId,type:'provider_result',provider:'aiducation',model:'curriculum',providerVersion:'v1',operation:'challenge',result:{status:'correct',score:100}})]),batchId:eventId};
  const options={now,source:'server_verified',storage:'blob_outbox',client,stableRequest:true};
  await assert.rejects(s.ingest(body,actor,options));assert.equal(client.objects.size,1);
  failed=false;const completed=await s.ingest(body,actor,{...options,now:now+86400000});
  assert.equal(completed.accepted,true);assert.equal(completed.serverReceivedAt,new Date(now+86400000).toISOString());assert.equal(client.objects.size,2);
  assert.ok([...client.objects.keys()].some(name=>name.startsWith(s.NS+'/outbox/2026/09/21/08/')));
});
test('first/latest distinct attempts and real zero differ from null; client never becomes verified',()=>{
  const itemId='poem-2/item-1';
  const rows=[row({itemId,attemptId:randomUUID(),result:{status:'incorrect',score:0,correct:false}},now),
    row({itemId,attemptId:randomUUID(),result:{status:'correct',score:90,correct:true}},now+1000),
    row({itemId:'poem-2/item-2',attemptId:randomUUID(),result:{status:'skipped'}},now+2000)];
  const result=s.aggregateEvents(rows,f);
  assert.equal(result.students[0].first.clientReported.meanScore,0);
  assert.equal(result.students[0].latest.clientReported.meanScore,90);
  assert.equal(result.summary.clientReported.measuredN,1);
  assert.equal(result.summary.clientReported.unmeasuredN,1);
  assert.equal(result.summary.serverVerified.meanScore,null);
  assert.equal(result.summary.serverVerified.measuredN,0);
  assert.equal(result.summary.nAttempts,3);
});
test('monotonic duration rejects decreasing clocks, skips gaps and does not accumulate idle wall time',()=>{
  const sessionId=randomUUID();
  const rows=[row({sessionId,seq:0,activeMs:0}),row({sessionId,seq:1,activeMs:1000}),
    row({sessionId,seq:2,activeMs:800}),row({sessionId,seq:4,activeMs:6000})];
  const result=s.aggregateEvents(rows,f);
  assert.equal(result.summary.activeMs,1000);
  assert.equal(result.summary.nInvalidEvents,1);
  assert.ok(result.summary.qualityFlags.includes('non_monotonic_active_ms'));
  const restored=[row({sessionId,seq:0,activeMs:0}),row({sessionId,seq:1,activeMs:1000}),row({sessionId,seq:2,activeMs:800}),row({sessionId,seq:3,activeMs:1200}),row({sessionId,seq:4,activeMs:1500})];
  assert.equal(s.aggregateEvents(restored,f).summary.activeMs,1300);
  const badClock={...restored[1],qualityFlags:['client_clock_out_of_range']};
  assert.equal(s.aggregateEvents([restored[0],badClock,restored[3]],f).summary.activeMs,0);
});
test('feedback and generic completion cannot erase a measured answer or handwriting result',()=>{
  const attemptId=randomUUID(),itemId='p2-dictation-1',context={mode:'standard',itemType:'dictation'};
  const rows=[
    row({attemptId,itemId,context,result:{status:'incorrect',score:0,correct:false}}),
    row({attemptId,itemId,context,type:'feedback_shown',result:{status:'completed',score:null,correct:null}},now+1000),
    row({attemptId,itemId,context,type:'provider_result',operation:'handwriting',result:{status:'incorrect',score:0,correct:false}},now+500,'server_verified'),
    row({attemptId,itemId,context,type:'provider_result',operation:'challenge',result:{status:'completed',score:null,correct:null}},now+1500,'server_verified')
  ];
  const result=s.aggregateEvents(rows,f);
  for(const scope of [result.summary,result.students[0].first,result.students[0].latest]){
    for(const source of ['clientReported','serverVerified']){
      assert.equal(scope.byConstruct['writing.dictation'][source].meanScore,0);
      assert.equal(scope.byConstruct['writing.dictation'][source].measuredN,1);
      assert.equal(scope.byConstruct['writing.dictation'][source].unmeasuredN,0);
    }
  }
});
test('later failed provider retry retains the successful measurement for the same attempt but remains in raw history',()=>{
  const attemptId=randomUUID(),base={activity:'read',type:'provider_result',operation:'reading',itemId:'p2.l0',attemptId};
  const rows=[row({...base,result:{status:'completed',score:0},wordScores:[{index:0,char:'李',score:0}]},now,'server_verified'),
    row({...base,result:{status:'error',score:null},error:{code:'timeout',retryable:true}},now+1000,'server_verified')];
  const result=s.aggregateEvents(rows,f);assert.equal(result.summary.serverVerified.meanScore,0);assert.equal(result.summary.serverVerified.measuredN,1);
  assert.equal(result.readingWords[0].meanScore,0);assert.equal(s.exportRows(rows,f).manifest.totalMatched,2);
  const another=row({...base,attemptId:randomUUID(),result:{status:'unmeasured',score:null}},now+2000,'server_verified');
  assert.equal(s.aggregateEvents([...rows,another],f).summary.serverVerified.meanScore,null);
});
test('assessment constructs remain separate; games, report and chat completions never become accuracy',()=>{
  const reading=row({activity:'read',type:'feedback_shown',itemId:'p2.l0',attemptId:randomUUID(),result:{status:'completed',score:80}});
  const sound=row({itemId:'p2-sound-1',attemptId:randomUUID(),result:{status:'correct',score:100,correct:true}},now+1000);
  const processRows=[
    row({itemId:'p2-game',context:{itemType:'microgame'},result:{status:'correct',score:100,correct:true}},now+1500),
    row({type:'provider_result',operation:'challenge',context:{itemType:'microgame'},result:{status:'correct',score:100,correct:true}},now+2000,'server_verified'),
    row({type:'provider_result',operation:'report',result:{status:'completed',score:100}},now+2500,'server_verified'),
    row({activity:'chat',type:'provider_result',operation:'chat',result:{status:'completed',score:100}},now+3000,'server_verified')
  ];
  const result=s.aggregateEvents([reading,sound,...processRows],f);
  for(const scope of [result.summary,result.students[0],result.students[0].first,result.students[0].latest,result.byGrade[0],result.byClass[0],result.trend[0],result.summary.byMode.unspecified]){
    assert.equal(scope.clientReported.meanScore,null);
    assert.equal(scope.clientReported.mixedConstructs,true);
    assert.equal(scope.clientReported.measuredN,2);
    assert.equal(scope.serverVerified.measuredN,0);
    assert.equal(scope.byConstruct['reading.pronunciation'].clientReported.meanScore,80);
    assert.equal(scope.byConstruct['sound.recognition'].clientReported.meanScore,100);
    assert.equal(scope.byConstruct['writing.dictation'],undefined);
  }
  assert.equal(result.summary.nEvents,6);
});
test('first/latest selection includes construct and operation even when item and attempt IDs overlap',()=>{
  const itemId='p2-shared',attemptId=randomUUID();
  const rows=[
    row({itemId,attemptId,context:{itemType:'sound'},result:{status:'incorrect',score:0,correct:false}}),
    row({itemId,attemptId,context:{itemType:'dictation'},result:{status:'correct',score:100,correct:true}},now+1000),
    row({itemId,attemptId:randomUUID(),context:{itemType:'sound'},result:{status:'correct',score:100,correct:true}},now+2000)
  ];
  const result=s.aggregateEvents(rows,f);
  assert.equal(result.students[0].first.byConstruct['sound.recognition'].clientReported.meanScore,0);
  assert.equal(result.students[0].latest.byConstruct['sound.recognition'].clientReported.meanScore,100);
  assert.equal(result.students[0].first.byConstruct['writing.dictation'].clientReported.meanScore,100);
  assert.equal(result.summary.clientReported.measuredN,2);
});
test('verified character observations preserve zero, first/latest, line identity and unmeasured/review exclusions',()=>{
  const base={activity:'read',type:'provider_result',operation:'reading',context:{mode:'standard'},result:{status:'completed',score:80}};
  const rows=[
    row({...base,itemId:'p2.l0',attemptId:randomUUID(),wordScores:[{index:0,char:'李',score:0}]},now,'server_verified'),
    row({...base,itemId:'p2.l0',attemptId:randomUUID(),wordScores:[{index:0,char:'李',score:90}]},now+1000,'server_verified'),
    row({...base,itemId:'p2.l0',attemptId:randomUUID(),context:{mode:'review'},wordScores:[{index:0,char:'李',score:100}]},now+2000,'server_verified'),
    row({...base,itemId:'p2.l1',attemptId:randomUUID(),wordScores:[{index:0,char:'李',score:50}]},now+3000,'server_verified'),
    row({...base,itemId:'p2.l2',attemptId:randomUUID(),result:{status:'unmeasured',score:null}},now+4000,'server_verified')
  ];
  const first=s.aggregateEvents(rows,{...f,attempt:'first'}),latest=s.aggregateEvents(rows,f);
  const word=(data,line)=>data.readingWords.find(word=>word.itemId===line);
  assert.equal(word(first,'p2.l0').meanScore,0);assert.equal(word(first,'p2.l0').count,1);assert.equal(word(first,'p2.l0').below60Count,1);
  assert.equal(word(latest,'p2.l0').meanScore,90);assert.equal(word(latest,'p2.l0').below60Count,0);
  assert.equal(word(latest,'p2.l1').meanScore,50);assert.equal(word(latest,'p2.l1').count,1);
  assert.equal(word(latest,'p2.l2'),undefined);assert.equal(latest.readingWords.length,2);
  assert.equal(latest.students[0].readingWords,undefined);assert.equal(latest.readingWordSummary.cutoff,60);
  assert.equal(latest.readingWordSummary.interpretation,'character_scores_not_phoneme_diagnosis');
  const invalid={...rows[0],qualityFlags:['client_clock_out_of_range']};
  assert.deepEqual(s.aggregateEvents([invalid],f).readingWords,[]);
});
test('character observations cap only the teacher list, preserving all original export rows',()=>{
  const rows=Array.from({length:55},(_,i)=>row({activity:'read',type:'provider_result',operation:'reading',itemId:'p2.l'+i,attemptId:randomUUID(),result:{status:'completed',score:80},wordScores:[{index:0,char:'李',score:i}]},now,'server_verified'));
  const result=s.aggregateEvents(rows,f);
  assert.equal(result.readingWords.length,50);assert.equal(result.readingWordSummary.totalGroups,55);assert.equal(result.readingWordSummary.truncated,true);
  assert.equal(s.exportRows(rows,f).manifest.totalMatched,55);
});
test('787-student overview with all assessment constructs stays below the serverless response limit',()=>{
  const base=row({result:{status:'correct',score:100,correct:true}}), rows=[];
  for(let i=0;i<787;i++){
    for(const [kind,activity,type,itemId]of [['sound','challenge','answer_submitted','sound'],['dictation','writing','answer_submitted','dictation'],['match','challenge','answer_submitted','match'],['sequence','challenge','answer_submitted','sequence'],['scene-builder','challenge','answer_submitted','scene'],[undefined,'read','feedback_shown','p2.l0']]){
      rows.push({...base,researchId:'r_synthetic_'+i,grade:i%6+1,cls:String.fromCharCode(65+i%4),event:{...base.event,eventId:randomUUID(),sessionId:randomUUID(),activity,type,itemId,context:kind?{itemType:kind,mode:'standard'}:{mode:'standard'}}});
    }
  }
  const result=s.aggregateEvents(rows,f);
  assert.equal(result.students.length,787);
  assert.equal(result.students[0].byMode,undefined);
  assert.equal(result.students[0].first.byMode,undefined);
  assert.equal(result.students[0].latest.byMode,undefined);
  assert.ok(result.summary.byMode.standard.byConstruct['sound.recognition']);
  assert.equal(Object.keys(result.students[0].byConstruct).length,6);
  assert.ok(Buffer.byteLength(JSON.stringify(result))<4.5*1000000);
});
test('cohort filtering and pseudonymous export retain history; pagination refuses changed datasets',()=>{
  const rows=[row({itemId:'poem-2/item-1',result:{status:'incorrect',score:0}}),row({itemId:'poem-2/item-1',result:{status:'correct',score:100}},now+1000)];
  assert.equal(s.aggregateEvents(rows,{...f,grade:3}).coverage.nEvents,0);
  const first=s.exportRows(rows,f,{limit:1});assert.equal(first.manifest.totalMatched,2);assert.equal(first.manifest.nextCursor,1);
  assert.throws(()=>s.exportRows(rows,f,{limit:1,cursor:1}),e=>e.code==='EXPORT_SNAPSHOT_CHANGED');
  const second=s.exportRows(rows,f,{limit:1,cursor:1,snapshot:first.manifest.snapshotId});assert.equal(second.manifest.nextCursor,null);
  assert.notEqual(JSON.parse(first.content).event.eventId,JSON.parse(second.content).event.eventId);
  assert.throws(()=>s.exportRows([...rows,row()],f,{limit:1,cursor:1,snapshot:first.manifest.snapshotId}),e=>e.code==='EXPORT_SNAPSHOT_CHANGED');
  const csv=s.exportRows(rows,f,{format:'csv'});assert.match(csv.content,/,"0",/);assert.doesNotMatch(csv.content,/Excluded|login|displayName/);
  assert.equal(s.hash(csv.content),csv.manifest.sha256);
});
test('outbox replay persists no cursor after failure and skips already receipted objects',async()=>{
  const batch=s.validateBatch(input([event()]),actor,now),pathname=s.outboxPath(batch);const client=memoryBlob();
  client.objects.set(pathname,s.canonical(batch));client.list=async()=>({blobs:[{pathname,size:100}],hasMore:false});
  const calls=[];const db={async query(sql,args){calls.push(sql);if(sql.startsWith('SELECT value'))return {rows:[]};
    if(sql.startsWith('SELECT checksum'))return {rows:[{checksum:batch.checksum}]};return {rows:[]};}};
  const report=await sync.scanHour('2026-09-20T08',{db,client,deadline:now+1000,now:()=>now});
  assert.equal(report.complete,true);assert.equal(report.processed,1);assert.ok(calls.some(c=>c.startsWith('INSERT INTO research_sync_state')));
  const broken={...client,list:async()=>({blobs:[{pathname:'unexpected',size:10}],hasMore:false})};
  calls.length=0;await assert.rejects(sync.scanHour('2026-09-20T08',{db,client:broken,deadline:now+1000,now:()=>now}));
  assert.equal(calls.filter(c=>c.startsWith('INSERT')).length,0);
});
test('snapshot checksum failure stops teacher read rather than producing fabricated empty analytics',async()=>{
  const client=memoryBlob(),pathname=`${s.NS}/published/events/2026-09-20/2/A/${'a'.repeat(64)}.json`;
  client.objects.set(`${s.NS}/published/manifest.json`,JSON.stringify({schemaVersion:1,generatedAt:new Date(now).toISOString(),parts:[{date:'2026-09-20',grade:2,cls:'A',path:pathname,sha256:'a'.repeat(64),bytes:100,count:1}]}));
  client.objects.set(pathname,JSON.stringify({schemaVersion:1,events:[row()]}));
  await assert.rejects(s.readPublished(f,client),e=>e.code==='SNAPSHOT_CHECKSUM');
});
test('review/free outcomes and different content versions never silently replace independent first attempts',()=>{
  const itemId='poem-2/item-1';
  const rows=[row({itemId,attemptId:randomUUID(),context:{mode:'standard'},result:{status:'incorrect',score:0}},now),
    row({itemId,attemptId:randomUUID(),context:{mode:'review'},result:{status:'correct',score:100}},now+1000),
    row({itemId,contentVersion:'v2',attemptId:randomUUID(),context:{mode:'standard'},result:{status:'correct',score:60}},now+2000)];
  const result=s.aggregateEvents(rows,f);
  assert.equal(result.summary.clientReported.meanScore,30);
  assert.equal(result.summary.clientReported.measuredN,2);
  assert.equal(result.summary.practiceOutcomeN,1);
  assert.equal(result.summary.byMode.review.clientReported.measuredN,0);
  assert.throws(()=>s.validateEvent(event({response:{choiceId:'學生的自由原文'}})));
  assert.doesNotThrow(()=>s.validateEvent(event({type:'item_interacted',interaction:'option_selected',response:{choiceId:'choice-1'},context:{mode:'standard',optionOrder:['choice-2','choice-1']}})));
});
test('cohort snapshot selection avoids unrelated school-wide byte limits',async()=>{
  const client=memoryBlob(),good={schemaVersion:1,date:'2026-09-20',grade:2,cls:'A',events:[row()]};
  const sha=s.hash(s.canonical(good)),pathname=`${s.NS}/published/events/2026-09-20/2/A/${sha}.json`;
  client.objects.set(pathname,s.canonical(good));
  const other=Array.from({length:30},(_,i)=>({date:'2026-09-20',grade:6,cls:'B',path:`${s.NS}/published/events/2026-09-20/6/B/${String(i).padStart(64,'0')}.json`,sha256:String(i).padStart(64,'0'),count:5000,bytes:8000000}));
  client.objects.set(`${s.NS}/published/manifest.json`,JSON.stringify({schemaVersion:1,generatedAt:new Date(now).toISOString(),parts:[...other,{date:'2026-09-20',grade:2,cls:'A',path:pathname,sha256:sha,count:1,bytes:Buffer.byteLength(s.canonical(good))}]}));
  const result=await s.readPublished({...f,grade:2,cls:'A'},client);assert.equal(result.rows.length,1);
  await assert.rejects(s.readPublished(f,client),e=>e.status===413);
});
test('the runtime export dictionary exactly matches the versioned delivery dictionary',()=>{
  assert.deepEqual(s.DATA_DICTIONARY,require('../docs/research-data-dictionary.json'));
  assert.equal(s.exportRows([],f).dictionary.version,'research-v1');
});
test('day publication preserves cohorts in chunk metadata and hashes every immutable shard',async()=>{
  const client=memoryBlob(),base=row(),other={...row(),researchId:'r_987654321098765432109876',grade:3,cls:'B'};
  const db={async query(sql,args){if(sql.includes('SELECT DISTINCT grade,cls'))return {rows:[{grade:2,cls:'A'},{grade:3,cls:'B'}]};
    return {rows:args[1]===0?[{id:1,record:args[2]===2?base:other}]:[]};}};
  const parts=await sync.publishDay('2026-09-20',{db,client,deadline:now+1000,now:()=>now});
  assert.equal(parts.length,2);
  assert.match(parts[0].path,/\/2026-09-20\/2\/A\//);assert.match(parts[1].path,/\/2026-09-20\/3\/B\//);
  for(const part of parts){assert.equal(s.hash(client.objects.get(part.path)),part.sha256);assert.equal(part.count,1);}
  await assert.rejects(sync.publishDay('2026-09-20',{db,client,deadline:now-1,now:()=>now}),/SNAPSHOT_DEADLINE/);
});
test('republication reuses verified unchanged chunks and uploads only the changed tail',async()=>{
  const client=memoryBlob(),items=Array.from({length:251},(_,i)=>({id:i+1,record:row()}));
  const db={async query(sql,args){if(sql.includes('SELECT DISTINCT grade,cls'))return {rows:[{grade:2,cls:'A'}]};return {rows:items.filter(item=>item.id>args[1]).slice(0,250)};}};
  const prior=await sync.publishDay('2026-09-20',{db,client,deadline:now+1000,now:()=>now});
  assert.equal(prior.length,2);
  let puts=0,gets=0;
  const instrumented={...client,async put(...args){puts++;return client.put(...args);},async get(...args){gets++;return client.get(...args);}};
  const same=await sync.publishDay('2026-09-20',{db,client:instrumented,deadline:now+1000,now:()=>now,priorParts:prior});
  assert.deepEqual(same,prior);assert.equal(puts,0);assert.equal(gets,0);
  items.push({id:252,record:row()});
  const next=await sync.publishDay('2026-09-20',{db,client:instrumented,deadline:now+1000,now:()=>now,priorParts:prior});
  assert.equal(puts,1);assert.equal(gets,0);assert.deepEqual(next[0],prior[0]);assert.notEqual(next[1].sha256,prior[1].sha256);
  await assert.rejects(sync.publishDay('2026-09-20',{db,client:instrumented,deadline:now+1000,now:()=>now,priorParts:[{...prior[0],sha256:'a'.repeat(64)}]}),error=>error.code==='INVALID_MANIFEST');
});
test('first synchronization publishes a usable empty teacher manifest before any student event exists',async()=>{
  const client=memoryBlob(),states=new Map();
  client.list=async()=>({blobs:[],hasMore:false});
  const lock={release(){},async query(sql){return {rows:[{acquired:true}]};}};
  const db={async connect(){return lock;},async query(sql,args=[]){
    if(sql.startsWith('SELECT value'))return {rows:states.has(args[0])?[{value:states.get(args[0])}]:[]};
    if(sql.startsWith('INSERT INTO research_sync_state'))states.set(args[0],JSON.parse(args[1]));
    return {rows:[]};
  }};
  const result=await sync.synchronize({db,client,startDate:'2026-09-20',now:()=>now});
  assert.equal(result.ok,true);assert.equal(result.publishedEvents,0);assert.equal(result.sourceObjectsDeleted,false);
  const manifest=JSON.parse(client.objects.get(`${s.NS}/published/manifest.json`));
  assert.deepEqual(manifest.parts,[]);assert.equal(manifest.totalEvents,0);assert.ok(manifest.snapshot);
  const snapshot=await s.readPrivate(manifest.snapshot.path,{client});
  assert.equal(s.hash(s.canonical(snapshot)),manifest.snapshot.sha256);
  assert.equal(snapshot.analytics.coverage.nStudents,0);assert.equal(snapshot.analytics.summary.serverVerified.meanScore,null);
  const teacher=await s.readPublished(f,client);assert.deepEqual(teacher.rows,[]);
  const objects=client.objects.size;
  await sync.synchronize({db,client,startDate:'2026-09-20',now:()=>now});
  assert.equal(client.objects.size,objects);
});
test('oversized default analytics does not block manifest publication or filtered teacher data',async()=>{
  const client=memoryBlob(),states=new Map();client.list=async()=>({blobs:[],hasMore:false});
  const lock={release(){},async query(){return {rows:[{acquired:true}]};}};
  const tooMany=Array(s.MAX_READ_EVENTS+1).fill({record:row()});
  const db={async connect(){return lock;},async query(sql,args=[]){
    if(sql.startsWith('SELECT value'))return {rows:states.has(args[0])?[{value:states.get(args[0])}]:[]};
    if(sql.startsWith('INSERT INTO research_sync_state'))states.set(args[0],JSON.parse(args[1]));
    if(sql.startsWith('SELECT record FROM research_events'))return {rows:tooMany};
    return {rows:[]};
  }};
  const result=await sync.synchronize({db,client,startDate:'2026-09-20',now:()=>now});assert.equal(result.ok,true);
  const manifest=JSON.parse(client.objects.get(`${s.NS}/published/manifest.json`));
  assert.equal(manifest.snapshot,null);assert.equal(manifest.overview.status,'filter_required');
  assert.equal(manifest.overview.reason,'NARROW_DATE_OR_CLASS_FILTER');assert.ok(states.has('last_success'));
  const response={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  s.sendError(response,new s.ResearchError('NARROW_DATE_OR_CLASS_FILTER',413));
  assert.equal(response.code,413);assert.equal(response.body.suggestion,'FILTER_BY_CLASS_OR_SHORTER_DATE_RANGE');
});
test('API endpoints reject unauthenticated users, teachers cannot submit student telemetry, and anonymous exports never run',async t=>{
  const path=require('node:path'),Module=require('node:module'),esbuild=require('esbuild');
  const auth=require('../api/_lib/school-auth.cjs');
  function load(name){const filename=path.resolve(__dirname,'../api',name+'.js');
    const code=esbuild.buildSync({entryPoints:[filename],bundle:true,platform:'node',format:'cjs',write:false,external:['./_lib/*']}).outputFiles[0].text;
    const loaded=new Module(filename);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));loaded._compile(code,filename);return loaded.exports.default;
  }
  const requireActor=auth.requireActor,ingest=s.ingest,researchExport=s.researchExport;
  t.after(()=>{auth.requireActor=requireActor;s.ingest=ingest;s.researchExport=researchExport;});
  let protectedCalls=0; s.ingest=async()=>{protectedCalls++;};s.researchExport=async()=>{protectedCalls++;};
  const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;return this;},status(n){this.statusCode=n;return this;},json(data){this.body=data;return this;}});
  for(const name of ['research-events','teacher-analytics']){
    auth.requireActor=async()=>{throw new auth.AuthError(401,'AUTH_REQUIRED');};
    const res=response();await load(name)({method:name==='research-events'?'POST':'GET',query:{format:'jsonl'}},res);assert.equal(res.statusCode,401);
  }
  auth.requireActor=async(req,options)=>{assert.deepEqual(options.roles,['student']);assert.equal(options.csrf,true);throw new auth.AuthError(403,'ROLE_FORBIDDEN');};
  const res=response();await load('research-events')({method:'POST'},res);assert.equal(res.statusCode,403);assert.equal(protectedCalls,0);
});
