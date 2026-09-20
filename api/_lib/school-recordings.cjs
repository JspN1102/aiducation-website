'use strict';
const crypto = require('node:crypto');
const {promisify} = require('node:util');
const {gzip, gunzip} = require('node:zlib');
const auth = require('./school-auth.cjs');
const teacherLearning = require('./teacher-learning-reset.cjs');
const zip = promisify(gzip), unzip = promisify(gunzip);
const MAX_WAV_BYTES = 44 + 32000 * 32;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SCHEMA = `CREATE TABLE IF NOT EXISTS school_recordings (
  actor_id varchar(30) NOT NULL, learning_epoch varchar(32) NOT NULL,
  poem_id smallint NOT NULL CHECK(poem_id BETWEEN 1 AND 6),
  line_index smallint NOT NULL CHECK(line_index BETWEEN 0 AND 7),
  recording_id uuid NOT NULL, recorded_at bigint NOT NULL,
  audio_gzip bytea NOT NULL CHECK(octet_length(audio_gzip) <= 1025000),
  audio_sha256 char(64) NOT NULL, audio_bytes integer NOT NULL CHECK(audio_bytes BETWEEN 8044 AND 1024044),
  duration_ms integer NOT NULL CHECK(duration_ms BETWEEN 250 AND 32000),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(actor_id,learning_epoch,poem_id,line_index)
)`;
const META = 'poem_id,line_index,recording_id,recorded_at,audio_bytes,duration_ms';
const fail = (status, code) => { throw new auth.AuthError(status, code); };
function metadata(row) {
  return {poemId:row.poem_id,lineIndex:row.line_index,recordingId:row.recording_id,
    recordedAt:Number(row.recorded_at),bytes:row.audio_bytes,durationMs:row.duration_ms};
}
function validateWav(bytes) {
  // Only the exact mono PCM WAV emitted by encodeRecording is accepted. There
  // are no arbitrary file names, external URLs, executable formats or codecs.
  if (!Buffer.isBuffer(bytes) || bytes.length < 8044 || bytes.length > MAX_WAV_BYTES ||
    bytes.toString('ascii',0,4)!=='RIFF' || bytes.toString('ascii',8,12)!=='WAVE' ||
    bytes.toString('ascii',12,16)!=='fmt ' || bytes.readUInt32LE(16)!==16 ||
    bytes.readUInt16LE(20)!==1 || bytes.readUInt16LE(22)!==1 || bytes.readUInt32LE(24)!==16000 ||
    bytes.readUInt32LE(28)!==32000 || bytes.readUInt16LE(32)!==2 || bytes.readUInt16LE(34)!==16 ||
    bytes.toString('ascii',36,40)!=='data' || bytes.readUInt32LE(4)!==bytes.length-8 ||
    bytes.readUInt32LE(40)!==bytes.length-44 || (bytes.length-44)%2) fail(400,'INVALID_RECORDING');
  return Math.round((bytes.length-44)/32);
}
function createPostgresRecordings(pool) {
  let ready;
  const ensure = () => ready ||= pool.query(SCHEMA).catch(error=>{ready=null;throw error;});
  return {
    async list(actorId,epoch,poemIds) {
      await ensure();
      return (await pool.query(`SELECT ${META} FROM school_recordings WHERE actor_id=$1 AND learning_epoch=$2 AND poem_id=ANY($3::int[]) ORDER BY poem_id,line_index`,[actorId,epoch,poemIds])).rows;
    },
    async get(actorId,epoch,poemId,lineIndex,recordingId) {
      await ensure();
      return (await pool.query(`SELECT ${META},audio_gzip,audio_sha256 FROM school_recordings WHERE actor_id=$1 AND learning_epoch=$2 AND poem_id=$3 AND line_index=$4 AND recording_id=$5`,[actorId,epoch,poemId,lineIndex,recordingId])).rows[0] || null;
    },
    async put(actorId,epoch,row) {
      await ensure();
      // Retry-safe and ordered by capture time, not by upload completion. A
      // delayed older upload can never overwrite a newer completed reading.
      const args=[actorId,epoch,row.poem_id,row.line_index,row.recording_id,row.recorded_at,row.audio_gzip,row.audio_sha256,row.audio_bytes,row.duration_ms];
      const rows=(await pool.query(`INSERT INTO school_recordings(actor_id,learning_epoch,poem_id,line_index,recording_id,recorded_at,audio_gzip,audio_sha256,audio_bytes,duration_ms)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(actor_id,learning_epoch,poem_id,line_index) DO UPDATE SET
          recording_id=EXCLUDED.recording_id,recorded_at=EXCLUDED.recorded_at,audio_gzip=EXCLUDED.audio_gzip,
          audio_sha256=EXCLUDED.audio_sha256,audio_bytes=EXCLUDED.audio_bytes,duration_ms=EXCLUDED.duration_ms,updated_at=CURRENT_TIMESTAMP
        WHERE school_recordings.recording_id<>EXCLUDED.recording_id AND
          (EXCLUDED.recorded_at,EXCLUDED.recording_id)>(school_recordings.recorded_at,school_recordings.recording_id)
        RETURNING ${META},audio_sha256`,args)).rows;
      if(rows[0])return {row:rows[0],saved:true};
      const current=(await pool.query(`SELECT ${META},audio_sha256 FROM school_recordings WHERE actor_id=$1 AND learning_epoch=$2 AND poem_id=$3 AND line_index=$4`,args.slice(0,4))).rows[0];
      if(!current)throw new Error('Recording write unavailable');
      if(current.recording_id===row.recording_id&&current.audio_sha256!==row.audio_sha256)fail(409,'RECORDING_CONFLICT');
      return {row:current,saved:current.recording_id===row.recording_id};
    }
  };
}
const stores = new WeakMap();
function runtimeStore() {
  const pool=auth.getStore().pool;
  if(!pool)fail(503,'RECORDING_UNAVAILABLE');
  if(!stores.has(pool))stores.set(pool,createPostgresRecordings(pool));
  return stores.get(pool);
}
function createHandler({service=auth,learning=teacherLearning,store=runtimeStore,now=Date.now}={}) {
  return async function recordings(req,res) {
    res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie');res.setHeader('X-Content-Type-Options','nosniff');
    try {
      if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false,error:'Method not allowed'});
      const actor=await service.requireActor(req,{roles:['student','teacher'],csrf:req.method==='POST'});
      if(!actor)fail(403,'AUTH_DISABLED');
      const input=req.method==='POST'?req.body:req.query;
      if(!input||typeof input!=='object'||Array.isArray(input)||input.actorId!==actor.id)fail(409,'ACTOR_CHANGED');
      if(input.learningEpoch!==undefined&&typeof input.learningEpoch!=='string')fail(400,'INVALID_REQUEST');
      const scope=await learning.scope(actor,{forSave:true,learningEpoch:input.learningEpoch});
      const epoch=scope.learningEpoch||'student';
      if(req.method==='GET'&&input.action==='list') {
        if(Object.keys(input).some(key=>!['action','actorId','learningEpoch','poemId'].includes(key)))fail(400,'INVALID_REQUEST');
        let poemIds=service.allowedPoemIds(actor);
        if(input.poemId!==undefined){const poemId=Number(input.poemId);if(!Number.isInteger(poemId))fail(400,'INVALID_REQUEST');service.assertPoemAccess(actor,poemId);poemIds=[poemId];}
        const rows=await store().list(actor.id,epoch,poemIds);
        return res.status(200).json({ok:true,userId:actor.id,learningEpoch:scope.learningEpoch,recordings:rows.map(metadata)});
      }
      const poemId=Number(input.poemId),lineIndex=Number(input.lineIndex);
      if(!Number.isInteger(poemId)||!Number.isInteger(lineIndex)||!UUID.test(input.recordingId||''))fail(400,'INVALID_RECORDING');
      const poem=service.assertPoemAccess(actor,poemId);
      if(lineIndex<0||lineIndex>=poem.lines.length)fail(400,'INVALID_RECORDING');
      if(req.method==='GET') {
        if(input.action!=='audio'||Object.keys(input).some(key=>!['action','actorId','learningEpoch','poemId','lineIndex','recordingId'].includes(key)))fail(400,'INVALID_REQUEST');
        const row=await store().get(actor.id,epoch,poemId,lineIndex,input.recordingId);
        if(!row)fail(404,'RECORDING_NOT_FOUND');
        const bytes=await unzip(row.audio_gzip,{maxOutputLength:MAX_WAV_BYTES});validateWav(bytes);
        if(crypto.createHash('sha256').update(bytes).digest('hex')!==row.audio_sha256)throw new Error('Recording checksum invalid');
        res.setHeader('Content-Type','audio/wav');res.setHeader('Content-Length',String(bytes.length));
        res.setHeader('Content-Disposition','inline; filename="reading.wav"');
        return res.status(200).send(bytes);
      }
      if(Object.keys(input).some(key=>!['actorId','learningEpoch','poemId','lineIndex','recordingId','recordedAt','audio','audioCompression'].includes(key))||
        !Number.isSafeInteger(input.recordedAt)||input.recordedAt<1577836800000||input.recordedAt>now()+300000||
        typeof input.audio!=='string'||input.audio.length>Math.ceil(MAX_WAV_BYTES/3)*4||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.audio)||
        ![undefined,'gzip'].includes(input.audioCompression))fail(400,'INVALID_RECORDING');
      let bytes=Buffer.from(input.audio,'base64');
      if(input.audioCompression==='gzip'){try{bytes=await unzip(bytes,{maxOutputLength:MAX_WAV_BYTES});}catch{fail(400,'INVALID_RECORDING');}}
      const duration=validateWav(bytes),hash=crypto.createHash('sha256').update(bytes).digest('hex');
      const result=await store().put(actor.id,epoch,{poem_id:poemId,line_index:lineIndex,recording_id:input.recordingId,recorded_at:input.recordedAt,
        audio_gzip:await zip(bytes,{level:3}),audio_sha256:hash,audio_bytes:bytes.length,duration_ms:duration});
      return res.status(200).json({ok:true,userId:actor.id,saved:result.saved,recording:metadata(result.row)});
    } catch(error) {return auth.sendError(res,error);}
  };
}
module.exports={MAX_WAV_BYTES,SCHEMA,validateWav,createPostgresRecordings,createHandler};
