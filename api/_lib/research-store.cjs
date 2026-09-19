'use strict';
// Research namespace is independent of legacy latest-value student_data and TTS.
const crypto = require('node:crypto');
const blob = require('@vercel/blob');
const { Pool } = require('pg');
const { poems } = require('../../maanshan/poems.json');
// Embedded from docs/research-data-dictionary.json; tested for equality.
const DATA_DICTIONARY = {
  "version": "research-v1",
  "schemaVersion": 1,
  "scope": "Structured pseudonymous learning events only. Ethics approval scope must separately authorise any future raw-data collection.",
  "identity": "researchId is an independent stable random pseudonym. School account/name mapping is separately teacher-protected and excluded from research exports.",
  "fields": [
    {
      "name": "schemaVersion",
      "type": "integer",
      "meaning": "Strict event envelope schema; currently 1."
    },
    {
      "name": "researchId",
      "type": "string",
      "meaning": "Server-cookie-derived pseudonym; client actorId is verified then discarded."
    },
    {
      "name": "grade",
      "type": "integer 1..6",
      "meaning": "Authenticated cohort at receipt time."
    },
    {
      "name": "cls",
      "type": "A..Z",
      "meaning": "Authenticated class at receipt time."
    },
    {
      "name": "source",
      "type": "client | server_verified",
      "meaning": "Client observations are not verified scores. Server verification means a provider response reached our backend, not independent clinical or educational ground truth."
    },
    {
      "name": "serverReceivedAt",
      "type": "UTC ISO-8601",
      "meaning": "Server ingress timestamp; used for date filtering and outbox partitioning, preserved after retries/import."
    },
    {
      "name": "qualityFlags",
      "type": "enum array",
      "meaning": "Persisted ingress flags; additional sequence/duration flags are derived during aggregation without rewriting raw rows."
    },
    {
      "name": "eventChecksum",
      "type": "SHA-256",
      "meaning": "Canonical hash of researchId, source and event payload; receive timestamp is excluded to support retries."
    },
    {
      "name": "event.eventId",
      "type": "UUID",
      "meaning": "Stable event identity. PG uniqueness is researchId + eventId + source. Same identity with changed content fails."
    },
    {
      "name": "event.sessionId",
      "type": "UUID",
      "meaning": "Random browser learning session; not a device fingerprint."
    },
    {
      "name": "event.seq",
      "type": "integer 0..10000000",
      "meaning": "Client session sequence. Server outcomes have their own source and seq=0."
    },
    {
      "name": "event.clientAt",
      "type": "UTC ISO-8601",
      "meaning": "Untrusted device timestamp. Over five minutes ahead or thirty days behind receipt is flagged."
    },
    {
      "name": "event.activeMs",
      "type": "integer 0..21600000",
      "meaning": "Session-monotonic active time excluding hidden/idle periods. Aggregates sum only adjacent sequence deltas within the same activity; filtered/missing spans are a lower bound."
    },
    {
      "name": "event.poemId",
      "type": "integer 1..6 | null",
      "meaning": "Curriculum poem ID; null for navigation not associated with a poem."
    },
    {
      "name": "event.activity",
      "type": "enum",
      "meaning": "listen/read/animation/explore/challenge/writing/chat/navigation."
    },
    {
      "name": "event.type",
      "type": "enum",
      "meaning": "session_start/activity_start/activity_end/item_presented/attempt_started/answer_submitted/feedback_shown/hint_used/retry/playback_started/playback_ended/recording_started/recording_stopped/item_interacted/error; provider_result is server-only."
    },
    {
      "name": "event.interaction",
      "type": "optional enum",
      "meaning": "stroke_finished/stroke_undone/ink_cleared/option_selected/game_action/camera_rotate/camera_zoom/camera_reset/video_seek. No pointer coordinates."
    },
    {
      "name": "event.attemptId",
      "type": "optional UUID",
      "meaning": "Joins start, answer, feedback and backend outcome of one attempt."
    },
    {
      "name": "event.attemptNo",
      "type": "optional integer 1..1000",
      "meaning": "Client-reported attempt ordinal; not trusted as unique identity."
    },
    {
      "name": "event.itemId",
      "type": "optional token up to 80",
      "meaning": "Stable curriculum item ID. Resolve with contentVersion using archived question banks, not the current random question selection."
    },
    {
      "name": "event.appVersion",
      "type": "token up to 64",
      "meaning": "Frontend release identifier."
    },
    {
      "name": "event.contentVersion",
      "type": "token up to 64",
      "meaning": "Teaching-content version for reproducible item and answer-option interpretation."
    },
    {
      "name": "event.result",
      "type": "optional typed object",
      "meaning": "status, optional score 0..100 or null, optional correct boolean or null. Skipped/cancelled/unmeasured/error cannot carry measured scores."
    },
    {
      "name": "event.context",
      "type": "optional typed object",
      "meaning": "mode standard/advanced/review/free; itemType sound/dictation/microgame/match/sequence/scene-builder; position 0..200; total 1..200; optionOrder up to 30 stable tokens; sourceAttemptId UUID."
    },
    {
      "name": "event.response",
      "type": "optional typed object",
      "meaning": "choiceId token, or up to 30 placements {slotId,choiceId}; no free response text."
    },
    {
      "name": "event.hint",
      "type": "optional typed object",
      "meaning": "kind audio/pinyin/stroke/demo/explanation/reveal and count 1..10000."
    },
    {
      "name": "event.retryCount",
      "type": "optional integer 0..1000",
      "meaning": "Observed retries; absence is unrecorded rather than zero."
    },
    {
      "name": "event.metrics",
      "type": "optional finite numeric object",
      "meaning": "elapsedMs/playbackMs/watchedMs <=21600000; audioDurationMs/latencyMs <=600000; videoPositionMs <=3600000; playbackRate 0.25..4; strokeCount/eraseCount/hintCount <=10000; userCharacters/assistantCharacters <=20000; wordCount/correctCount/itemCount <=1000; lostEventCount <=1000000. Integers except playbackRate. Server-only accuracyScore/fluencyScore/completionScore/suggestedScore are finite provider score dimensions 0..100 and may be fractional; omit unavailable values. They are export provenance, not extra overall assessments."
    },
    {
      "name": "event.error",
      "type": "optional typed object",
      "meaning": "code network/timeout/permission_denied/audio_unavailable/provider_unavailable/invalid_response/storage_unavailable/unsupported/aborted/unknown, plus retryable boolean. No provider error text."
    },
    {
      "name": "event.provider/model/operation/providerVersion",
      "type": "server-only tokens",
      "meaning": "Verified backend execution provenance. Never accepted from client event endpoint."
    },
    {
      "name": "event.wordScores",
      "type": "server-only array up to 200",
      "meaning": "Unique integer index, one character from the poem, score and optional pronunciationScore/toneScore 0..100, optional status; excludes transcript/audio."
    }
  ],
  "missingness": {
    "nullOrAbsent": "Not measured/collected/available; do not convert to 0.",
    "zero": "A valid measured value when present; include in denominators.",
    "clientScore": "Browser-reported, potentially manipulated. Never merge into serverVerified score.",
    "serverScore": "Provider measurement confirmed server-side, not pedagogical ground truth.",
    "reviewFree": "Excluded from independent assessment means; count as practiceOutcomeN.",
    "unstarted": "Research events alone cannot show students with zero activity; join separately authorised school roster.",
    "invalid": "Clock/sequence problems remain in raw history and count as invalid in summaries; score summaries exclude flagged events.",
    "gap": "lostEventCount reports local queue loss; sequence gaps are not reconstructed as invented activity."
  },
  "aggregation": {
    "firstLatest": "Within filtered receipt dates, consolidate assessment results per researchId/poemId/activity/itemId/contentVersion/mode/construct/operation/attemptId; use latest eligible measurement inside each attempt, then earliest/latest observed attempt per item and construct. Missing attemptId falls back to eventId. Process feedback never replaces an assessment.",
    "nAttempts": "Distinct researchId+attemptId in all filtered events, regardless of first/latest choice; includes review/free. Units differ by activity: a reading recording versus a challenge round. Do not interpret a pooled count as comparable test attempts.",
    "completedN": "Count of activity_end events with completed status, not count of unique students or attempts.",
    "meanScore": "Within one construct and source, arithmetic mean across selected measured item outcomes, not weighted by duration. Missing scores are excluded and counted separately. Overall meanScore is null and mixedConstructs=true if multiple measured constructs are present; never pool pronunciation scores with binary task accuracy.",
    "date": "UTC serverReceivedAt, inclusive from/to calendar dates.",
    "sync": "Published snapshot time describes publication recency; status and watermark indicate backlog. Not a promise every client queued event has arrived.",
    "assessmentEvents": "Client reading feedback_shown for a poem line, or answer_submitted with a recognised task type; server provider_result operation reading/handwriting, or challenge with sound/match/sequence/scene-builder. Microgame, report/chat, ordinary feedback and generic dictation challenge acknowledgements are process-only, even if a score field is present.",
    "byConstruct": {
      "shape": "Every summary, including student first/latest and cohort/trend rows, has a sparse byConstruct object using the documented keys. Each present value has clientReported and serverVerified score summaries; absent constructs mean no eligible outcome, not zero. Only top-level summary includes byMode with nested byConstruct to avoid repeating mode details in every list row. Student detail uses its filtered top-level summary.byMode. mixedConstructs appears only on overall source scores.",
      "keys": {
        "reading.pronunciation": "Provider pronunciation score on a 0..100 scale; not a binary correctness rate.",
        "writing.dictation": "Target-character match, 0/100; handwriting provider outcome for verified source.",
        "sound.recognition": "Sound-choice correctness, 0/100.",
        "match.accuracy": "Matching-item correctness, 0/100.",
        "sequence.accuracy": "Sequence-item correctness, 0/100.",
        "scene_builder.accuracy": "Scene placement correctness, 0/100."
      }
    },
    "practiceOutcomeN": "Count of eligible assessment outcome events in review/free modes, excluded from independent assessment summaries. Process feedback and game completion do not add assessment outcomes.",
    "readingWords": "Top-level readingWords only: at most 50 groups from selected server_verified reading outcomes, excluding review/free and invalid records. Group by poemId/itemId/contentVersion/index/char. Each entry has count, meanScore and below60Count; zero is measured, absent word scores do not add samples. readingWordSummary declares cutoff=60, totalGroups, returnedGroups, truncated and character_scores_not_phoneme_diagnosis. Lower scores are practice observations, not a consonant/tone disorder diagnosis. The limit affects teacher display only; raw exports are complete.",
    "capacity": "Default analytics exceeding 100000 events or the snapshot byte bound does not block publication of the manifest and class/date chunks. The manifest marks overview.status=filter_required, and the API returns NARROW_DATE_OR_CLASS_FILTER with a class/date suggestion. This is not an empty dataset."
  },
  "export": {
    "default": "Pseudonymous JSONL or CSV; teacher authentication required.",
    "pagination": "Each first page provides snapshotId; subsequent cursor pages must provide it. Changed data returns 409 rather than silently duplicating/skipping rows.",
    "csv": "Core fields, CSV header on every page; remove duplicate header when concatenating. Full typed detail remains in JSONL.",
    "manifest": "schema/dictionary versions, filters, timestamps, record counts, nextCursor, snapshotId and content SHA-256.",
    "excluded": [
      "raw recordings",
      "handwriting coordinates",
      "chat text",
      "names",
      "school login",
      "IP address",
      "device fingerprint"
    ]
  }
};
const NS = 'mandarin-research-v1';
const MAX_BATCH_BYTES = 128 * 1024;
const MAX_READ_EVENTS = 100000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/;
const ACTIVITIES = ['listen', 'read', 'animation', 'explore', 'challenge', 'writing', 'chat', 'navigation'];
const TYPES = ['session_start','activity_start','activity_end','item_presented','attempt_started',
  'answer_submitted','feedback_shown','hint_used','retry','playback_started','playback_ended',
  'recording_started','recording_stopped','item_interacted','error'];
const ERRORS = ['network','timeout','permission_denied','audio_unavailable','provider_unavailable',
  'invalid_response','storage_unavailable','unsupported','aborted','unknown'];
const STATUS = ['correct','incorrect','completed','skipped','cancelled','unmeasured','error'];
const METRICS = { elapsedMs:21600000,playbackMs:21600000,audioDurationMs:600000,playbackRate:4,
  strokeCount:10000,eraseCount:10000,hintCount:10000,userCharacters:20000,assistantCharacters:20000,
  latencyMs:600000,wordCount:1000,correctCount:1000,itemCount:1000,watchedMs:21600000,videoPositionMs:3600000,lostEventCount:1000000,
  accuracyScore:100,fluencyScore:100,completionScore:100,suggestedScore:100 };
const PROVIDER_SCORE_METRICS=['accuracyScore','fluencyScore','completionScore','suggestedScore'];
const canonical = value => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v)))
    : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
class ResearchError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
function fail(code = 'INVALID_EVENT', status = 400) { throw new ResearchError(code, status); }
function object(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(value,k))) fail();
}
function integer(value, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) fail(); }
function token(value, max) { if (typeof value !== 'string' || value.length > max || !TOKEN.test(value)) fail(); }
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) fail(); }
function iso(value) { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function resultValid(result) {
  object(result, ['status','score','correct'], ['status']);
  if (!STATUS.includes(result.status)) fail();
  if (result.score !== undefined && result.score !== null && (typeof result.score !== 'number' || !Number.isFinite(result.score) || result.score < 0 || result.score > 100)) fail();
  if (result.correct !== undefined && result.correct !== null && typeof result.correct !== 'boolean') fail();
  if (['skipped','cancelled','unmeasured','error'].includes(result.status) &&
      (result.score != null || result.correct != null)) fail();
}
function validateEvent(event, server = false) {
  object(event, ['eventId','sessionId','seq','clientAt','activeMs','poemId','activity','type',
    'appVersion','contentVersion','attemptId','itemId','attemptNo','hint','retryCount','result','error','metrics','context','response','interaction',
    ...(server ? ['provider','model','operation','providerVersion','wordScores'] : [])],
  ['eventId','sessionId','seq','clientAt','activeMs','poemId','activity','type','appVersion','contentVersion']);
  uuid(event.eventId); uuid(event.sessionId); integer(event.seq,0,10000000); integer(event.activeMs,0,21600000);
  if (!iso(event.clientAt) || !ACTIVITIES.includes(event.activity) || !(server ? [...TYPES,'provider_result'] : TYPES).includes(event.type)) fail();
  if (event.poemId !== null) integer(event.poemId,1,6);
  token(event.appVersion,64); token(event.contentVersion,64);
  if (event.attemptId !== undefined) uuid(event.attemptId);
  if (event.itemId !== undefined) token(event.itemId,80);
  if (event.attemptNo !== undefined) integer(event.attemptNo,1,1000);
  if (event.retryCount !== undefined) integer(event.retryCount,0,1000);
  if(event.interaction!==undefined&&!['stroke_finished','stroke_undone','ink_cleared','option_selected','game_action','camera_rotate','camera_zoom','camera_reset','video_seek'].includes(event.interaction))fail();
  if (event.result !== undefined) resultValid(event.result);
  if (event.hint !== undefined) {
    object(event.hint,['kind','count'],['kind','count']);
    if (!['audio','pinyin','stroke','demo','explanation','reveal'].includes(event.hint.kind)) fail();
    integer(event.hint.count,1,10000);
  }
  if (event.error !== undefined) {
    object(event.error,['code','retryable'],['code','retryable']);
    if (!ERRORS.includes(event.error.code) || typeof event.error.retryable !== 'boolean') fail();
  }
  if (event.metrics !== undefined) {
    object(event.metrics,Object.keys(METRICS));
    for (const [key,value] of Object.entries(event.metrics)) {
      if (key === 'playbackRate') { if (typeof value !== 'number' || !Number.isFinite(value) || value < .25 || value > 4) fail(); }
      else if(PROVIDER_SCORE_METRICS.includes(key)){if(!server||typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)fail();}
      else integer(value,0,METRICS[key]);
    }
  }
  if(event.context!==undefined){
    object(event.context,['mode','itemType','position','total','optionOrder','sourceAttemptId']);
    if(event.context.mode!==undefined&&!['standard','advanced','review','free'].includes(event.context.mode))fail();
    if(event.context.itemType!==undefined&&!['sound','dictation','microgame','match','sequence','scene-builder'].includes(event.context.itemType))fail();
    if(event.context.position!==undefined)integer(event.context.position,0,200);
    if(event.context.total!==undefined)integer(event.context.total,1,200);
    if(event.context.optionOrder!==undefined){if(!Array.isArray(event.context.optionOrder)||event.context.optionOrder.length>30)fail();event.context.optionOrder.forEach(v=>token(v,80));}
    if(event.context.sourceAttemptId!==undefined)uuid(event.context.sourceAttemptId);
  }
  if(event.response!==undefined){
    object(event.response,['choiceId','placements']);
    if(event.response.choiceId!==undefined)token(event.response.choiceId,80);
    if(event.response.placements!==undefined){if(!Array.isArray(event.response.placements)||event.response.placements.length>30)fail();
      for(const placement of event.response.placements){object(placement,['slotId','choiceId'],['slotId','choiceId']);token(placement.slotId,80);token(placement.choiceId,80);}}
  }
  if (server) {
    for (const key of ['provider','model','operation','providerVersion']) token(event[key],80);
    if (event.wordScores !== undefined) {
      if (!Array.isArray(event.wordScores) || event.wordScores.length > 200) fail();
      const characters = new Set(poems.find(p => p.id === event.poemId)?.lines.flatMap(l => [...l.text]) || []);
      const seen = new Set();
      for (const word of event.wordScores) {
        object(word,['index','char','score','pronunciationScore','toneScore','status'],['index','char','score']);
        integer(word.index,0,199);
        if (seen.has(word.index) || !characters.has(word.char)) fail();
        seen.add(word.index);
        for (const key of ['score','pronunciationScore','toneScore']) {
          if (word[key] !== undefined && (typeof word[key] !== 'number' || !Number.isFinite(word[key]) || word[key] < 0 || word[key] > 100)) fail();
        }
        if (word.status !== undefined && !STATUS.includes(word.status)) fail();
      }
    }
  }
  return JSON.parse(canonical(event));
}
function validateBatch(input, actor, now = Date.now(), source = 'client') {
  object(input,['schemaVersion','batchId','actorId','events'],['schemaVersion','batchId','actorId','events']);
  if (input.schemaVersion !== 1) fail('SCHEMA_VERSION');
  uuid(input.batchId);
  if (!actor || actor.role !== 'student' || input.actorId !== actor.id) fail('ACTOR_CHANGED',409);
  if (typeof actor.researchId !== 'string' || !/^r_[a-zA-Z0-9_-]{8,80}$/.test(actor.researchId)) fail('IDENTITY_UNAVAILABLE',503);
  integer(actor.grade,1,6);
  if (typeof actor.cls !== 'string' || !/^[A-Z]$/.test(actor.cls)) fail('IDENTITY_UNAVAILABLE',503);
  if (!Array.isArray(input.events) || input.events.length < 1 || input.events.length > 50 || Buffer.byteLength(JSON.stringify(input)) > MAX_BATCH_BYTES) fail('BATCH_TOO_LARGE',413);
  const ids = new Set();
  const events = input.events.map(raw => {
    const event = validateEvent(raw,source === 'server_verified');
    if (ids.has(event.eventId)) fail('DUPLICATE_EVENT_IN_BATCH'); ids.add(event.eventId);
    const qualityFlags = [];
    if (Date.parse(event.clientAt) > now + 300000 || Date.parse(event.clientAt) < now - 30 * 86400000) qualityFlags.push('client_clock_out_of_range');
    return {schemaVersion:1,researchId:actor.researchId,grade:actor.grade,cls:actor.cls,source,
      serverReceivedAt:new Date(now).toISOString(),qualityFlags,event,
      eventChecksum:hash(canonical({researchId:actor.researchId,source,event}))};
  });
  const batch = {schemaVersion:1,batchId:input.batchId,serverReceivedAt:new Date(now).toISOString(),events};
  return {...batch,checksum:hash(canonical(batch))};
}
function verifyStoredBatch(batch) {
  object(batch,['schemaVersion','batchId','serverReceivedAt','events','checksum'],['schemaVersion','batchId','serverReceivedAt','events','checksum']);
  const {checksum,...unsigned} = batch;
  if (checksum !== hash(canonical(unsigned)) || batch.schemaVersion !== 1 || !iso(batch.serverReceivedAt)) fail('BATCH_CHECKSUM');
  uuid(batch.batchId);
  if (!Array.isArray(batch.events) || !batch.events.length || batch.events.length > 50 || Buffer.byteLength(canonical(batch)) > MAX_BATCH_BYTES + 32768) fail('BATCH_TOO_LARGE');
  const ids = new Set();
  for (const row of batch.events) {
    object(row,['schemaVersion','researchId','grade','cls','source','serverReceivedAt','qualityFlags','event','eventChecksum'],
      ['schemaVersion','researchId','grade','cls','source','serverReceivedAt','qualityFlags','event','eventChecksum']);
    if (row.schemaVersion !== 1 || !/^r_[a-zA-Z0-9_-]{8,80}$/.test(row.researchId) ||
        !['client','server_verified'].includes(row.source) || row.serverReceivedAt !== batch.serverReceivedAt ||
        !Array.isArray(row.qualityFlags) || row.qualityFlags.some(f => f !== 'client_clock_out_of_range')) fail();
    integer(row.grade,1,6); if (!/^[A-Z]$/.test(row.cls)) fail();
    validateEvent(row.event,row.source === 'server_verified');
    if (ids.has(row.event.eventId)) fail(); ids.add(row.event.eventId);
    if (row.eventChecksum !== hash(canonical({researchId:row.researchId,source:row.source,event:row.event}))) fail('EVENT_CHECKSUM');
  }
  return batch;
}
function pgConfig(env = process.env) {
  if (!['postgres','postgresql'].includes(env.DB_DRIVER) || !['localhost','127.0.0.1','::1','/var/run/postgresql'].includes(env.DB_HOST)) fail('RESEARCH_STORAGE_UNAVAILABLE',503);
  return {host:env.DB_HOST,port:Number(env.DB_PORT)||5432,user:env.DB_USER,password:env.DB_PASS||env.DB_PASSWORD,
    database:env.DB_NAME,max:2,connectionTimeoutMillis:5000,statement_timeout:15000,application_name:'maanshan-research'};
}
let pool;
function getPool() { if (!pool) { pool = new Pool(pgConfig()); pool.on('error',()=>{}); } return pool; }
function mode(env=process.env) { return env.RESEARCH_ENABLED === '1' ? (env.STUDENT_STORE === 'blob' ? 'blob_outbox' : 'postgres') : null; }
function outboxPath(batch) {
  const identity = hash(canonical(batch.events.map(r => r.eventChecksum)));
  return `${NS}/outbox/${batch.serverReceivedAt.slice(0,13).replaceAll('-','/').replace('T','/')}/${batch.events[0].researchId}/${batch.batchId}-${identity}.json`;
}
async function readPrivate(pathname, {client=blob,maxBytes=2*1024*1024,signal=AbortSignal.timeout(12000)} = {}) {
  const response = await client.get(pathname,{access:'private',useCache:false,abortSignal:signal});
  if (!response) return null;
  if (response.statusCode !== 200 || !response.stream || response.blob?.size > maxBytes) { await response.stream?.cancel(); fail('SNAPSHOT_UNAVAILABLE',503); }
  const reader=response.stream.getReader(),chunks=[];let bytes=0;
  try { while(true) { signal.throwIfAborted(); const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;
    if(bytes>maxBytes)fail('READ_LIMIT',413);chunks.push(Buffer.from(part.value)); } }
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function appendPostgres(batch, db=getPool()) {
  verifyStoredBatch(batch);
  const connection=await db.connect();let inserted=0,duplicates=0;
  try {
    await connection.query('BEGIN');
    await connection.query("SET LOCAL lock_timeout = '5s'");
    for(const row of batch.events){
      const added=await connection.query(`INSERT INTO research_events
        (research_id,event_id,source,session_id,seq,received_at,grade,cls,poem_id,activity,event_checksum,record)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
        ON CONFLICT (research_id,event_id,source) DO NOTHING RETURNING event_id`,
      [row.researchId,row.event.eventId,row.source,row.event.sessionId,row.event.seq,row.serverReceivedAt,row.grade,row.cls,row.event.poemId,row.event.activity,row.eventChecksum,JSON.stringify(row)]);
      if(added.rowCount){inserted++;continue;}
      const prior=(await connection.query('SELECT event_checksum FROM research_events WHERE research_id=$1 AND event_id=$2 AND source=$3',[row.researchId,row.event.eventId,row.source])).rows[0];
      if(prior?.event_checksum!==row.eventChecksum)fail('EVENT_ID_CONFLICT',409);
      duplicates++;
    }
    if(inserted){
      for(const day of new Set(batch.events.map(r=>r.serverReceivedAt.slice(0,10))))
        await connection.query(`INSERT INTO research_sync_state(key,value) VALUES($1,'{"dirty":true}'::jsonb)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=clock_timestamp()`,['dirty/'+day]);
    }
    await connection.query('COMMIT');return {inserted,duplicates};
  }catch(error){await connection.query('ROLLBACK').catch(()=>{});throw error;}
  finally{connection.release();}
}
async function appendBlob(batch, client=blob,signal=AbortSignal.timeout(10000)) {
  const pathname=outboxPath(batch);
  try { await client.put(pathname,canonical(batch),{access:'private',addRandomSuffix:false,allowOverwrite:false,
    contentType:'application/json',abortSignal:signal}); }
  catch(error){
    if(!(error instanceof blob.BlobPreconditionFailedError)&&!/already exists/i.test(String(error?.message)))throw error;
    const prior=verifyStoredBatch(await readPrivate(pathname,{client,maxBytes:MAX_BATCH_BYTES+32768,signal}));
    if(canonical(prior.events.map(r=>r.eventChecksum))!==canonical(batch.events.map(r=>r.eventChecksum)))fail('BATCH_ID_CONFLICT',409);
    return prior.serverReceivedAt;
  }
  return batch.serverReceivedAt;
}
async function ingest(input,actor,{now=Date.now(),source='client',storage=mode(),db,client=blob,signal}={}) {
  if(!storage)fail('RESEARCH_DISABLED',503);
  const batch=validateBatch(input,actor,now,source);
  let received=batch.serverReceivedAt;
  if(storage==='postgres')await appendPostgres(batch,db||getPool());
  else if(storage==='blob_outbox')received=await appendBlob(batch,client,signal);
  else fail('RESEARCH_STORAGE_UNAVAILABLE',503);
  return {schemaVersion:1,accepted:true,durable:storage,batchId:batch.batchId,eventIds:batch.events.map(r=>r.event.eventId),serverReceivedAt:received};
}
async function recordVerifiedOutcome(req,input) {
  if(!mode())return {recorded:false,reason:'disabled'};
  try {
    const auth=require('./school-auth.cjs');
    const actor=await auth.requireActor(req,{roles:['student'],csrf:true});
    if(!actor)return {recorded:false,reason:'auth_disabled'};
    const context=req.body?.researchContext;
    if(!context || context.actorId!==actor.id)return {recorded:false,reason:'ACTOR_CHANGED'};
    const {eventId=crypto.randomUUID(),sessionId,attemptId,itemId,poemId,activity,appVersion,contentVersion,
      provider,model,operation,providerVersion='unspecified',result,error,metrics,wordScores,context:eventContext}={...context,...input};
    const event={eventId,sessionId,seq:0,clientAt:new Date().toISOString(),activeMs:0,poemId,activity,
      type:'provider_result',appVersion,contentVersion,provider,model,operation,providerVersion};
    for(const [key,value] of Object.entries({attemptId,itemId,result,error,metrics,wordScores,context:eventContext}))if(value!==undefined)event[key]=value;
    await ingest({schemaVersion:1,batchId:crypto.randomUUID(),actorId:actor.id,events:[event]},actor,{source:'server_verified',signal:AbortSignal.timeout(3000)});
    return {recorded:true,eventId};
  }catch(error){return {recorded:false,reason:error instanceof ResearchError?error.code:'outcome_storage_unavailable'};}
}
function filtersFrom(query={},now=Date.now()) {
  object(query,['grade','cls','from','to','activity','student','attempt','format','cursor','limit','snapshot']);
  const to=query.to||new Date(now).toISOString().slice(0,10);
  if(typeof to!=='string'||!/^\d{4}-\d\d-\d\d$/.test(to)||!Number.isFinite(Date.parse(to)))fail('INVALID_DATE');
  const from=query.from||new Date(Date.parse(to)-29*86400000).toISOString().slice(0,10);
  for(const date of [from,to])if(typeof date!=='string'||!/^\d{4}-\d\d-\d\d$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail('INVALID_DATE');
  if(from>to || Date.parse(to)-Date.parse(from)>30*86400000)fail('DATE_RANGE_MAX_31_DAYS');
  const f={from,to,attempt:query.attempt||'latest'};
  if(!['first','latest'].includes(f.attempt))fail('INVALID_ATTEMPT_FILTER');
  if(query.grade!==undefined){if(typeof query.grade!=='string'||!/^[1-6]$/.test(query.grade))fail();f.grade=Number(query.grade);}
  if(query.cls!==undefined){if(typeof query.cls!=='string'||!/^[A-Za-z]$/.test(query.cls))fail();f.cls=query.cls.toUpperCase();}
  if(query.activity!==undefined){if(!ACTIVITIES.includes(query.activity))fail();f.activity=query.activity;}
  if(query.student!==undefined){if(typeof query.student!=='string'||!/^r_[a-zA-Z0-9_-]{8,80}$/.test(query.student))fail();f.student=query.student;}
  return f;
}
function matches(row,f) { return row.serverReceivedAt.slice(0,10)>=f.from&&row.serverReceivedAt.slice(0,10)<=f.to&&
  (f.grade===undefined||row.grade===f.grade)&&(!f.cls||row.cls===f.cls)&&(!f.activity||row.event.activity===f.activity)&&(!f.student||row.researchId===f.student); }
const CONSTRUCTS=['reading.pronunciation','writing.dictation','sound.recognition','match.accuracy','sequence.accuracy','scene_builder.accuracy'];
const ITEM_CONSTRUCTS={dictation:'writing.dictation',sound:'sound.recognition',match:'match.accuracy',sequence:'sequence.accuracy','scene-builder':'scene_builder.accuracy'};
function constructFor(row){
  const e=row.event;
  if(!e.result)return null;
  if(row.source==='server_verified'){
    if(e.type!=='provider_result')return null;
    if(e.operation==='reading')return 'reading.pronunciation';
    if(e.operation==='handwriting')return 'writing.dictation';
    // A challenge acknowledgement for handwriting or a game is process data.
    // Only the handwriting provider can provide its verified measurement.
    if(e.operation==='challenge'&&e.context?.itemType!=='dictation')return ITEM_CONSTRUCTS[e.context?.itemType]||null;
    return null;
  }
  if(row.source!=='client')return null;
  if(e.activity==='read'&&e.type==='feedback_shown'&&/^p[1-6]\.l\d+$/.test(e.itemId||''))return 'reading.pronunciation';
  if(e.type==='answer_submitted'&&['challenge','writing'].includes(e.activity))return ITEM_CONSTRUCTS[e.context?.itemType]||null;
  return null;
}
function selectedOutcomes(rows,which,source){
  const attempts=new Map();
  for(const row of rows){const construct=constructFor(row);if(row.source!==source||!construct||['review','free'].includes(row.event.context?.mode))continue;
    const e=row.event,key=canonical([row.researchId,e.poemId,e.activity,e.itemId||'',e.contentVersion,e.context?.mode||'unspecified',construct,e.operation||'client',e.attemptId||e.eventId]);
    let entry=attempts.get(key);if(!entry)attempts.set(key,entry={first:row.serverReceivedAt,last:row.serverReceivedAt,row});
    if(row.serverReceivedAt>=entry.last){entry.last=row.serverReceivedAt;entry.row=row;}
    if(row.serverReceivedAt<entry.first)entry.first=row.serverReceivedAt;
  }
  const items=new Map();
  for(const a of attempts.values()){const row=a.row,e=row.event,key=canonical([row.researchId,e.poemId,e.activity,e.itemId||'',e.contentVersion,e.context?.mode||'unspecified',constructFor(row),e.operation||'client']);const prior=items.get(key);
    if(!prior||(which==='first'?a.first<prior.first:a.first>prior.first))items.set(key,a);}
  return [...items.values()].map(a=>a.row);
}
function scoreSummary(selected,includeMixed=true){
  const measured=selected.filter(r=>typeof r.event.result.score==='number');
  const mixedConstructs=new Set(measured.map(constructFor)).size>1;
  return {measuredN:measured.length,unmeasuredN:selected.length-measured.length,
    meanScore:measured.length&&!mixedConstructs?Math.round(measured.reduce((n,r)=>n+r.event.result.score,0)/measured.length*10)/10:null,...includeMixed?{mixedConstructs}:{},
    correctN:selected.filter(r=>r.event.result.correct===true).length,incorrectN:selected.filter(r=>r.event.result.correct===false).length};
}
function assessmentSummary(rows,which){
  const selected={clientReported:selectedOutcomes(rows,which,'client'),serverVerified:selectedOutcomes(rows,which,'server_verified')};
  const present=new Set(Object.values(selected).flatMap(items=>items.map(constructFor)));
  return {...Object.fromEntries(Object.entries(selected).map(([source,items])=>[source,scoreSummary(items)])),
    byConstruct:Object.fromEntries(CONSTRUCTS.filter(construct=>present.has(construct)).map(construct=>[construct,Object.fromEntries(Object.entries(selected).map(([source,items])=>[source,scoreSummary(items.filter(row=>constructFor(row)===construct),false)]))]))};
}
function modeSummaries(rows,which){return Object.fromEntries(['standard','advanced','review','free','unspecified'].map(mode=>{
  const matching=rows.filter(r=>(r.event.context?.mode||'unspecified')===mode);
  return [mode,{nOutcomeEvents:matching.filter(r=>r.event.result).length,...assessmentSummary(matching,which)}];
}));}
function qualityAndDuration(rows){
  const sessions=new Map(),flags=new Map();let activeMs=0;
  const identity=row=>row.researchId+'/'+row.source+'/'+row.event.eventId;
  for(const row of rows){if(row.qualityFlags.length)flags.set(identity(row),new Set(row.qualityFlags));if(row.source!=='client')continue;
    const key=row.researchId+'/'+row.event.sessionId;if(!sessions.has(key))sessions.set(key,[]);sessions.get(key).push(row);}
  for(const session of sessions.values()){
    session.sort((a,b)=>a.event.seq-b.event.seq||a.serverReceivedAt.localeCompare(b.serverReceivedAt));let last=null;
    for(const row of session){const e=row.event;const invalid=[];
      if(last&&e.seq===last.seq)invalid.push('duplicate_session_sequence');
      if(last&&e.activeMs<last.activeMs)invalid.push('non_monotonic_active_ms');
      if(invalid.length){if(!flags.has(identity(row)))flags.set(identity(row),new Set());invalid.forEach(f=>flags.get(identity(row)).add(f));}
      else if(last&&e.seq===last.seq+1&&e.activity===last.activity)activeMs+=Math.max(0,e.activeMs-last.activeMs);
      last=e;
    }
  }
  return {activeMs,flags,nInvalidEvents:flags.size,qualityFlags:[...new Set([...flags.values()].flatMap(s=>[...s]))]};
}
function summarize(rows,which='latest',includeModes=false){
  const quality=qualityAndDuration(rows),valid=rows.filter(r=>!quality.flags.has(r.researchId+'/'+r.source+'/'+r.event.eventId));
  return {nEvents:rows.length,nStudents:new Set(rows.map(r=>r.researchId)).size,
    nAttempts:new Set(rows.filter(r=>r.event.attemptId).map(r=>r.researchId+'/'+r.event.attemptId)).size,
    completedN:rows.filter(r=>r.event.type==='activity_end'&&r.event.result?.status==='completed').length,
    activeMs:quality.activeMs,nInvalidEvents:quality.nInvalidEvents,qualityFlags:quality.qualityFlags,
    ...assessmentSummary(valid,which),
    practiceOutcomeN:valid.filter(r=>constructFor(r)&&['review','free'].includes(r.event.context?.mode)).length,
    ...includeModes?{byMode:modeSummaries(valid,which)}:{}};
}
function readingWordSummary(rows,which){
  const quality=qualityAndDuration(rows);
  const valid=rows.filter(row=>!quality.flags.has(row.researchId+'/'+row.source+'/'+row.event.eventId));
  const outcomes=selectedOutcomes(valid,which,'server_verified').filter(row=>constructFor(row)==='reading.pronunciation');
  const groups=new Map(),cutoff=60,limit=50;
  for(const row of outcomes){const e=row.event;
    for(const word of e.wordScores||[]){
      if(typeof word.score!=='number'||!Number.isFinite(word.score))continue;
      const key=canonical([e.poemId,e.itemId||'',e.contentVersion,word.index,word.char]);
      if(!groups.has(key))groups.set(key,{poemId:e.poemId,itemId:e.itemId||'',contentVersion:e.contentVersion,index:word.index,char:word.char,count:0,total:0,below60Count:0});
      const group=groups.get(key);group.count++;group.total+=word.score;if(word.score<cutoff)group.below60Count++;
    }
  }
  const sorted=[...groups.values()].map(({total,...group})=>({...group,meanScore:Math.round(total/group.count*10)/10})).sort((a,b)=>b.below60Count-a.below60Count||a.meanScore-b.meanScore||b.count-a.count||a.poemId-b.poemId||a.itemId.localeCompare(b.itemId)||a.index-b.index||a.contentVersion.localeCompare(b.contentVersion));
  return {readingWords:sorted.slice(0,limit),readingWordSummary:{cutoff,totalGroups:sorted.length,returnedGroups:Math.min(limit,sorted.length),truncated:sorted.length>limit,source:'server_verified',interpretation:'character_scores_not_phoneme_diagnosis'}};
}
function aggregateEvents(all,f,{generatedAt=new Date().toISOString(),source='postgres',lastImportedAt=null,syncStatus}={}){
  const rows=all.filter(r=>matches(r,f));rows.sort((a,b)=>a.serverReceivedAt.localeCompare(b.serverReceivedAt)||a.event.eventId.localeCompare(b.event.eventId));
  const group=key=>{const buckets=new Map();for(const row of rows){const k=key(row);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(row);}return buckets;};
  const students=[...group(r=>r.researchId)].map(([researchId,items])=>({researchId,grade:items.at(-1).grade,cls:items.at(-1).cls,
    ...summarize(items,f.attempt),first:summarize(items,'first'),latest:summarize(items,'latest'),lastSeenAt:items.at(-1).serverReceivedAt}));
  return {schemaVersion:1,dictionaryVersion:'research-v1',generatedAt,source,filters:f,
    sync:{status:syncStatus||(source==='postgres'?'direct':lastImportedAt?'published':'unavailable'),lastImportedAt,
      lagMs:lastImportedAt?Math.max(0,Date.now()-Date.parse(lastImportedAt)):null},
    coverage:{nStudents:students.length,nEvents:rows.length,nInvalidEvents:summarize(rows).nInvalidEvents,rosterIncluded:false},
    summary:summarize(rows,f.attempt,true),students,
    byGrade:[...group(r=>r.grade)].map(([grade,items])=>({grade,...summarize(items,f.attempt)})),
    byClass:[...group(r=>r.grade+'/'+r.cls)].map(([,items])=>({grade:items[0].grade,cls:items[0].cls,...summarize(items,f.attempt)})),
    trend:[...group(r=>r.serverReceivedAt.slice(0,10))].map(([date,items])=>({date,...summarize(items,f.attempt)})),
    ...readingWordSummary(rows,f.attempt),
    missingness:{scoreNullMeans:'not_measured',zeroScoreIsMeasured:true,clientScoresAreVerified:false,reviewAndFreeExcludedFromAssessment:true,
      sourceClock:'server_received_at',duration:'monotonic session activeMs deltas in selected events; lower bound if gaps or filter boundaries',
      roster:'Only students with events; merge authenticated school roster for not-started students',
      omitted:{rawAudio:true,handwritingCoordinates:true,chatText:true,names:true,ipOrFingerprint:true}}};
}
async function readPostgres(f,db=getPool()){
  const values=[f.from,f.to],where=['received_at >= $1::date','received_at < $2::date + interval \'1 day\''];
  for(const [key,column] of [['grade','grade'],['cls','cls'],['activity','activity'],['student','research_id']])if(f[key]!==undefined){values.push(f[key]);where.push(column+'=$'+values.length);}
  const rows=(await db.query('SELECT record FROM research_events WHERE '+where.join(' AND ')+' ORDER BY received_at,event_id LIMIT '+(MAX_READ_EVENTS+1),values)).rows;
  if(rows.length>MAX_READ_EVENTS)fail('NARROW_DATE_OR_CLASS_FILTER',413);
  return rows.map(r=>r.record);
}
function validatePublishedParts(parts){
  if(!Array.isArray(parts)||parts.length>10000)fail('INVALID_MANIFEST',503);
  const seen=new Set();
  for(const part of parts){
    if(!part||!/^\d{4}-\d\d-\d\d$/.test(part.date)||!Number.isInteger(part.grade)||part.grade<1||part.grade>6||!/^[A-Z]$/.test(part.cls)||!/^[a-f0-9]{64}$/.test(part.sha256))fail('INVALID_MANIFEST',503);
    const expected=`${NS}/published/events/${part.date}/${part.grade}/${part.cls}/${part.sha256}.json`;
    if(part.path!==expected||seen.has(part.path))fail('INVALID_MANIFEST',503);
    seen.add(part.path);integer(part.count,0,5000);integer(part.bytes,1,8*1024*1024);
  }
  return parts;
}
async function readPublished(f,client=blob){
  const manifest=await readPrivate(`${NS}/published/manifest.json`,{client});
  if(!manifest||manifest.schemaVersion!==1||!iso(manifest.generatedAt)||!Array.isArray(manifest.parts))fail('ANALYTICS_PENDING_SYNC',503);
  const needed=validatePublishedParts(manifest.parts).filter(p=>p.date>=f.from&&p.date<=f.to&&(f.grade===undefined||p.grade===f.grade)&&(!f.cls||p.cls===f.cls));let total=0,bytes=0;
  for(const part of needed){total+=part.count;bytes+=part.bytes;}
  if(total>MAX_READ_EVENTS||bytes>64*1024*1024)fail('NARROW_DATE_OR_CLASS_FILTER',413);
  const rows=[];
  for(const part of needed){const chunk=await readPrivate(part.path,{client,maxBytes:8*1024*1024});
    if(!chunk||hash(canonical(chunk))!==part.sha256||chunk.schemaVersion!==1||chunk.events.length!==part.count)fail('SNAPSHOT_CHECKSUM',503);
    rows.push(...chunk.events);}
  return {rows,lastImportedAt:manifest.generatedAt,manifest};
}
async function analytics(f){
  if(!mode())fail('RESEARCH_DISABLED',503);
  if(mode()==='postgres')return aggregateEvents(await readPostgres(f),f);
  const manifest=await readPrivate(`${NS}/published/manifest.json`);
  if(manifest?.overview?.status==='filter_required'&&canonical(manifest.overview.filters)===canonical(f))fail('NARROW_DATE_OR_CLASS_FILTER',413);
  if(manifest?.snapshot&&canonical(manifest.snapshot.filters)===canonical(f)){
    const ref=manifest.snapshot;
    if(!new RegExp('^'+NS+'/published/analytics/[a-f0-9]{64}\\.json$').test(ref.path))fail('INVALID_MANIFEST',503);
    const snapshot=await readPrivate(ref.path,{maxBytes:8*1024*1024});
    if(hash(canonical(snapshot))!==ref.sha256||snapshot.schemaVersion!==1)fail('SNAPSHOT_CHECKSUM',503);
    return {...snapshot.analytics,generatedAt:manifest.generatedAt,source:'published_snapshot',
      sync:{status:manifest.status,lastImportedAt:manifest.generatedAt,lagMs:Math.max(0,Date.now()-Date.parse(manifest.generatedAt))}};
  }
  const data=await readPublished(f);return aggregateEvents(data.rows,f,{source:'published_snapshot',lastImportedAt:data.lastImportedAt,syncStatus:data.manifest.status});
}
function exportRows(rows,f,{format='jsonl',cursor=0,limit=5000,snapshot}={}){
  integer(cursor,0,MAX_READ_EVENTS);integer(limit,1,5000);
  const selected=rows.filter(r=>matches(r,f)).sort((a,b)=>a.serverReceivedAt.localeCompare(b.serverReceivedAt)||a.event.eventId.localeCompare(b.event.eventId));
  const snapshotId=hash(canonical(selected.map(r=>[r.researchId,r.source,r.event.eventId,r.eventChecksum])));
  if(cursor>0&&snapshot!==snapshotId)fail('EXPORT_SNAPSHOT_CHANGED',409);
  const page=selected.slice(cursor,cursor+limit),next=cursor+page.length<selected.length?cursor+page.length:null;
  const manifest={schemaVersion:1,dictionaryVersion:'research-v1',filters:f,source:'structured_events',
    returned:page.length,totalMatched:selected.length,nextCursor:next,snapshotId,generatedAt:new Date().toISOString(),
    identity:'pseudonymous researchId; no school login or name',scoreTruth:'source identifies client-reported vs server-verified',
    dateBasis:'serverReceivedAt',missingness:'absent/null means not measured; score 0 is measured'};
  if(format==='jsonl'){const lines=page.map(r=>canonical(r));const content=lines.join('\n')+(lines.length?'\n':'');return {manifest:{...manifest,sha256:hash(content)},content,dictionary:DATA_DICTIONARY};}
  if(format!=='csv')fail('INVALID_EXPORT_FORMAT');
  const columns=['researchId','grade','cls','source','eventId','sessionId','seq','serverReceivedAt','clientAt','poemId','activity','type','attemptId','itemId','appVersion','contentVersion','activeMs','status','score','correct'];
  const escape=value=>{let text=value==null?'':String(value);if(/^[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  const lines=page.map(row=>{const flat={...row,...row.event,...row.event.result};return columns.map(k=>escape(flat[k])).join(',');});
  const content=columns.join(',')+'\r\n'+lines.join('\r\n')+(lines.length?'\r\n':'');
  return {manifest:{...manifest,columns,sha256:hash(content),detail:'CSV core fields; JSONL preserves all typed metrics, quality flags, and word scores'},content,dictionary:DATA_DICTIONARY};
}
async function researchExport(f,options){
  if(!mode())fail('RESEARCH_DISABLED',503);
  const rows=mode()==='postgres'?await readPostgres(f):(await readPublished(f)).rows;
  return exportRows(rows,f,options);
}
function sendError(res,error){const safe=error instanceof ResearchError?error:new ResearchError('RESEARCH_STORAGE_UNAVAILABLE',503);return res.status(safe.status).json({error:safe.code,schemaVersion:1,...safe.code==='NARROW_DATE_OR_CLASS_FILTER'?{suggestion:'FILTER_BY_CLASS_OR_SHORTER_DATE_RANGE',maxEvents:MAX_READ_EVENTS,maxSelectedDays:31}:{}});}
module.exports={NS,MAX_BATCH_BYTES,MAX_READ_EVENTS,ACTIVITIES,TYPES,ERRORS,STATUS,METRICS,DATA_DICTIONARY,ResearchError,canonical,hash,
  validateEvent,validateBatch,verifyStoredBatch,pgConfig,getPool,mode,outboxPath,readPrivate,appendPostgres,appendBlob,
  ingest,recordVerifiedOutcome,filtersFrom,matches,aggregateEvents,validatePublishedParts,readPostgres,readPublished,analytics,exportRows,researchExport,sendError};
