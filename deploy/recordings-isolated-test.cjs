'use strict';
// A transaction-local temporary table shadows the real table. No account,
// recording, school progress or research row is changed by this check.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {gzipSync,gunzipSync}=require('node:zlib');
const {Pool}=require('pg');
const {SCHEMA,createPostgresRecordings}=require('../api/_lib/school-recordings.cjs');
(async()=>{
 const pool=new Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT)||5432,user:process.env.DB_USER,password:process.env.DB_PASS||process.env.DB_PASSWORD,database:process.env.DB_NAME,max:1});
 const client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query(SCHEMA.replace('CREATE TABLE IF NOT EXISTS','CREATE TEMP TABLE')+' ON COMMIT DROP');
  const store=createPostgresRecordings(client),a='s_'+'1'.repeat(24),b='s_'+'2'.repeat(24),now=Date.now(),bytes=Buffer.alloc(8044);
  const row={poem_id:1,line_index:0,recording_id:crypto.randomUUID(),recorded_at:now,audio_gzip:gzipSync(bytes),audio_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),audio_bytes:8044,duration_ms:250};
  assert.equal((await store.put(a,'student',row)).saved,true);assert.equal((await store.put(a,'student',row)).saved,true);
  assert.equal((await store.list(a,'student',[1])).length,1);assert.equal((await store.list(b,'student',[1])).length,0);
  assert.equal(await store.get(b,'student',1,0,row.recording_id),null);
  assert.deepEqual(gunzipSync((await store.get(a,'student',1,0,row.recording_id)).audio_gzip),bytes);
  const fresh={...row,recording_id:crypto.randomUUID(),recorded_at:now+1};await store.put(a,'student',fresh);
  assert.equal((await store.put(a,'student',row)).saved,false);
  assert.equal((await store.list(a,'student',[1]))[0].recording_id,fresh.recording_id);
  await assert.rejects(store.put(a,'student',{...fresh,audio_sha256:'0'.repeat(64)}),e=>e.code==='RECORDING_CONFLICT');
  await store.put(a,'a'.repeat(32),row);assert.equal((await store.list(a,'b'.repeat(32),[1])).length,0);
  assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM school_recordings')).rows[0].n,2);
  console.log(JSON.stringify({ok:true,checks:11,temporaryTableOnly:true,productionWrites:0}));
 }finally{await client.query('ROLLBACK');client.release();await pool.end();}
})().catch(()=>{console.error('Isolated recording database check failed');process.exitCode=1;});
