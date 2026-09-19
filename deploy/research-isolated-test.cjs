'use strict';
// This harness refuses normal TCP or production database names.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Pool}=require('pg');
const store=require('../api/_lib/research-store.cjs');
async function run({socket,port=65439}={}){
  if(typeof socket!=='string'||!socket.startsWith('/var/tmp/')||!socket.endsWith('/socket')||!socket.includes('/work-'))throw new Error('ISOLATED_SOCKET_REQUIRED');
  const db=new Pool({host:socket,port,user:'postgres',database:'restore_check',max:4,connectionTimeoutMillis:3000,statement_timeout:10000});
  const actor={id:'s_123456789012345678901234',researchId:'r_123456789012345678901234',role:'student',grade:2,cls:'A'};
  const make=(eventId=randomUUID(),score=0)=>({eventId,sessionId:randomUUID(),seq:0,activeMs:0,poemId:2,activity:'read',type:'answer_submitted',appVersion:'isolated-test',contentVersion:'v1',clientAt:new Date().toISOString(),result:{status:'completed',score}});
  const batch=events=>store.validateBatch({schemaVersion:1,batchId:randomUUID(),actorId:actor.id,events},actor);
  try{
    await db.query(fs.readFileSync(path.join(__dirname,'research-schema.sql'),'utf8'));
    const initial=batch([make()]);
    const results=await Promise.all([store.appendPostgres(initial,db),store.appendPostgres(initial,db)]);
    assert.equal(results.reduce((n,r)=>n+r.inserted,0),1);
    assert.equal(results.reduce((n,r)=>n+r.duplicates,0),1);
    assert.equal(Number((await db.query('SELECT count(*) FROM research_events')).rows[0].count),1);
    const conflicting=structuredClone(initial.events[0].event);conflicting.result.score=90;
    await assert.rejects(store.appendPostgres(batch([make(),conflicting]),db),e=>e.code==='EVENT_ID_CONFLICT');
    assert.equal(Number((await db.query('SELECT count(*) FROM research_events')).rows[0].count),1);
    await assert.rejects(db.query('UPDATE research_events SET seq=1'),e=>e.code==='55000');
    await assert.rejects(db.query('DELETE FROM research_events'),e=>e.code==='55000');
    assert.equal((await db.query("SELECT count(*) FROM research_sync_state WHERE key LIKE 'dirty/%'")).rows[0].count,'1');
    const saved=(await db.query('SELECT record FROM research_events')).rows[0].record;
    assert.equal(saved.event.result.score,0);assert.equal(saved.researchId,actor.researchId);
    assert.ok(!JSON.stringify(saved).includes(actor.id));
    return {ok:true,checks:9,transport:'isolated_private_unix_socket',productionDatabaseTouched:false,
      covers:['real_concurrent_idempotency','batch_conflict_rollback','append_only_update_delete','atomic_dirty_marker','pseudonymous_zero_score_roundtrip']};
  }finally{await db.end();}
}
if(require.main===module)run({socket:process.argv[2]}).then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('RESEARCH_ISOLATED_CHECK_FAILED');process.exitCode=1;});
module.exports={run};
