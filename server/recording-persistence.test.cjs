'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {gzipSync,gunzipSync}=require('node:zlib');
const auth=require('../api/_lib/school-auth.cjs');
const {createTeacherLearning}=require('../api/_lib/teacher-learning-reset.cjs');
const {createHandler,validateWav,MAX_WAV_BYTES,createPostgresRecordings}=require('../api/_lib/school-recordings.cjs');
const NOW=Date.parse('2026-09-21T06:00:00Z');
const student={id:'s_'+'1'.repeat(24),role:'student',grade:1,cls:'A'};
const other={id:'s_'+'2'.repeat(24),role:'student',grade:1,cls:'B'};
const teacher={id:'t_'+'3'.repeat(24),role:'teacher',grade:null,cls:null};
function wav(duration=1,seed=1){
 const b=Buffer.alloc(44+duration*32000);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);
 for(let i=44;i<b.length;i+=2)b.writeInt16LE(Math.round(Math.sin(i*seed*.05)*4000),i);return b;
}
function response(){return {headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;}};}
function fixture(){
 const rows=new Map(),authRows=new Map();let rev=0;
 const authStore={async get(k){return authRows.get(k)||null;},async cas(k,value,version){if(authRows.get(k)?.version!==version)throw new auth.Conflict();authRows.set(k,{value,version:String(++rev)});}};
 const service={...auth,async requireActor(req,options){if(!req.actor)throw new auth.AuthError(401,'AUTH_REQUIRED');if(options.csrf&&req.headers?.['x-csrf-token']!=='synthetic')throw new auth.AuthError(403,'CSRF_REJECTED');return req.actor;}};
 const learning=createTeacherLearning({service,store:()=>authStore,now:()=>NOW});
 const key=(a,e,p,l)=>[a,e,p,l].join(':');
 const store={
  async list(a,e,poems){return [...rows.values()].filter(r=>r.actor===a&&r.epoch===e&&poems.includes(r.poem_id));},
  async get(a,e,p,l,id){const r=rows.get(key(a,e,p,l));return r?.recording_id===id?r:null;},
  async put(a,e,r){const k=key(a,e,r.poem_id,r.line_index),old=rows.get(k);
   if(old?.recording_id===r.recording_id&&old.audio_sha256!==r.audio_sha256)throw new auth.AuthError(409,'RECORDING_CONFLICT');
   if(!old||old.recording_id!==r.recording_id&&(r.recorded_at>old.recorded_at||r.recorded_at===old.recorded_at&&r.recording_id>old.recording_id))rows.set(k,{...r,actor:a,epoch:e});
   return {row:rows.get(k),saved:rows.get(k).recording_id===r.recording_id};}
 };
 const handler=createHandler({service,learning,store:()=>store,now:()=>NOW});
 const input=(patch={})=>({actorId:student.id,poemId:1,lineIndex:0,recordingId:crypto.randomUUID(),recordedAt:NOW,audio:wav().toString('base64'),...patch});
 async function call(method,input,actor=student,headers={'x-csrf-token':'synthetic'}){const res=response();await handler({method,actor,headers,...(method==='POST'?{body:input}:{query:input})},res);return res;}
 return {rows,learning,input,call};
}
test('stores private audio, restores exact bytes after refresh, and is idempotent',async()=>{
 const f=fixture(),body=f.input(),uploaded=await f.call('POST',body);
 assert.equal(uploaded.statusCode,200);assert.equal(uploaded.body.saved,true);assert.equal(f.rows.size,1);
 assert.equal((await f.call('POST',body)).statusCode,200);assert.equal(f.rows.size,1);
 const listed=await f.call('GET',{action:'list',actorId:student.id});
 assert.equal(listed.body.recordings.length,1);assert.equal('audio' in listed.body.recordings[0],false);
 const audio=await f.call('GET',{action:'audio',actorId:student.id,poemId:'1',lineIndex:'0',recordingId:body.recordingId});
 assert.equal(audio.statusCode,200);assert.equal(audio.headers['Content-Type'],'audio/wav');assert.equal(audio.headers['Cache-Control'],'private, no-store');assert.deepEqual(audio.body,wav());
 assert(f.rows.values().next().value.audio_gzip.length<wav().length);
});
test('account, grade and CSRF isolation applies to metadata, uploads and playback',async()=>{
 const f=fixture(),body=f.input();await f.call('POST',body);
 assert.equal((await f.call('POST',body,null)).statusCode,401);
 assert.equal((await f.call('POST',body,student,{})).statusCode,403);
 assert.equal((await f.call('POST',body,other)).statusCode,409);
 assert.equal((await f.call('POST',f.input({poemId:2}))).statusCode,422);
 assert.deepEqual((await f.call('GET',{action:'list',actorId:other.id},other)).body.recordings,[]);
 assert.equal((await f.call('GET',{action:'audio',actorId:other.id,poemId:1,lineIndex:0,recordingId:body.recordingId},other)).statusCode,404);
 assert.equal((await f.call('GET',{action:'audio',actorId:student.id,poemId:1,lineIndex:0,recordingId:body.recordingId},other)).statusCode,409);
 assert.equal((await f.call('GET',{action:'list',actorId:student.id,studentId:other.id})).statusCode,400);
});
test('late old uploads cannot replace a newer recording, and an ID cannot change its audio',async()=>{
 const f=fixture(),first=f.input({recordedAt:NOW-2000}),second=f.input({recordedAt:NOW-1000,audio:wav(1,2).toString('base64')});
 await f.call('POST',second);const late=await f.call('POST',first);
 assert.equal(late.body.saved,false);assert.equal(late.body.recording.recordingId,second.recordingId);assert.equal(f.rows.size,1);
 assert.equal((await f.call('POST',{...second,audio:first.audio})).statusCode,409);
});
test('teacher reset hides earlier generation and rejects queued old uploads or old audio URLs',async()=>{
 const f=fixture(),body=f.input({actorId:teacher.id,learningEpoch:'initial'});await f.call('POST',body,teacher);
 const reset=await f.learning.reset({actor:teacher,headers:{'x-csrf-token':'synthetic'},body:{action:'reset_my_progress',confirm:true,learningEpoch:'initial',requestId:crypto.randomUUID()}});
 assert.equal((await f.call('POST',body,teacher)).body.code,'LEARNING_RESET');
 assert.equal((await f.call('GET',{action:'audio',actorId:teacher.id,learningEpoch:'initial',poemId:1,lineIndex:0,recordingId:body.recordingId},teacher)).body.code,'LEARNING_RESET');
 assert.deepEqual((await f.call('GET',{action:'list',actorId:teacher.id,learningEpoch:reset.learningEpoch},teacher)).body.recordings,[]);
 assert.equal((await f.call('POST',{...body,learningEpoch:reset.learningEpoch,recordingId:crypto.randomUUID()},teacher)).statusCode,200);
 assert.equal(f.rows.size,2); // Reset never deletes historical records.
});
test('strict audio bounds reject disguised files, oversized gzip and invalid timestamps',async()=>{
 const f=fixture();
 for(const patch of [{audio:Buffer.from('<html>bad</html>').toString('base64')},{audio:'!!!!'},{audioCompression:'brotli'},{lineIndex:4},{recordingId:'../path'},{recordedAt:NOW+300001},{audio:gzipSync(Buffer.alloc(MAX_WAV_BYTES+1)).toString('base64'),audioCompression:'gzip'}]){
  assert.equal((await f.call('POST',f.input(patch))).statusCode,400);
 }
 const corrupt=wav();corrupt.writeUInt32LE(44100,24);assert.throws(()=>validateWav(corrupt));
 const large=wav(32);assert.equal(validateWav(large),32000);
 assert.equal((await f.call('POST',f.input({audio:large.toString('base64')}))).statusCode,200);
 const small=wav(.25);assert.equal(validateWav(small),250);
 assert.equal((await f.call('POST',f.input({audio:gzipSync(wav()).toString('base64'),audioCompression:'gzip'}))).statusCode,200);
});
test('postgres write is atomic, schema is initialized once and queries bind private scope',async()=>{
 const calls=[],row={poem_id:1,line_index:0,recording_id:crypto.randomUUID(),recorded_at:NOW,audio_gzip:gzipSync(wav()),audio_sha256:crypto.createHash('sha256').update(wav()).digest('hex'),audio_bytes:wav().length,duration_ms:1000};
 const pool={async query(sql,args){calls.push({sql,args});if(sql.startsWith('INSERT'))return {rows:[row]};if(sql.includes('audio_gzip,audio_sha256'))return {rows:[row]};return {rows:[]};}};
 const store=createPostgresRecordings(pool);await Promise.all([store.list(student.id,'student',[1]),store.list(other.id,'student',[1])]);
 await store.put(student.id,'student',row);assert.equal((await store.get(student.id,'student',1,0,row.recording_id)).recording_id,row.recording_id);
 assert.equal(calls.filter(c=>c.sql.startsWith('CREATE')).length,1);
 const insert=calls.find(c=>c.sql.startsWith('INSERT'));assert.match(insert.sql,/ON CONFLICT\(actor_id,learning_epoch,poem_id,line_index\)/);assert.match(insert.sql,/EXCLUDED.recorded_at,EXCLUDED.recording_id/);assert.deepEqual(insert.args.slice(0,4),[student.id,'student',1,0]);
 assert.deepEqual(gunzipSync(insert.args[6]),wav());
});

async function libraryFixture({storage,actorId=student.id,epoch,fail=false}={}){
 const {createRecordingLibrary}=await import('../maanshan/recording-library.mjs');
 const queue=storage||new Map(),server=new Map(),requests=[];let failure=fail,allowed=true;
 const scope=`${actorId}:${epoch||'student'}`;
 const persistence={async list(s){return [...queue.values()].filter(r=>r.scope===s);},async put(s,item){queue.set(s+':'+item.poemId+'-'+item.lineIndex,{scope:s,item:structuredClone(item)});},async remove(s,item){const key=s+':'+item.poemId+'-'+item.lineIndex;if(queue.get(key)?.item.recordingId===item.recordingId)queue.delete(key);}};
 const fetch=async(url,options={})=>{requests.push({url,options});if(failure)throw new TypeError('Offline');if(options.method==='POST'){const body=JSON.parse(options.body);assert.equal(body.actorId,actorId);const value={...body};delete value.audio;server.set(value.poemId+'-'+value.lineIndex,value);return new Response(JSON.stringify({ok:true,userId:actorId,saved:true,recording:value}));}return new Response(JSON.stringify({ok:true,userId:actorId,recordings:[...server.values()]}));};
 const build=()=>createRecordingLibrary({enabled:true,actorId,learningEpoch:epoch,fetch,storage:persistence,canUse:()=>allowed});
 return {queue,scope,requests,server,build,fail(v){failure=v;},allow(v){allowed=v;}};
}
test('failed upload survives a refresh, replays locally then retries without a second assessment',async()=>{
 const f=await libraryFixture({fail:true}),library=f.build(),id=crypto.randomUUID(),item={poemId:1,lineIndex:0,recordingId:id,recordedAt:NOW,audio:wav().toString('base64'),blob:new Blob([wav()],{type:'audio/wav'})};
 await library.save(item);await library.flush();assert.equal(f.queue.size,1);library.stop();
 const refreshed=f.build();await refreshed.hydrate();assert.equal(refreshed.has('1-0'),true);assert.deepEqual(Buffer.from(await refreshed.source('1-0').arrayBuffer()),wav());
 f.fail(false);await refreshed.flush();assert.equal(f.queue.size,0);assert.equal(f.server.get('1-0').recordingId,id);
 refreshed.stop();const otherDevice=f.build();await otherDevice.hydrate();assert.equal(otherDevice.has('1-0'),true);assert.match(otherDevice.source('1-0'),/^\/api\/school-recordings\/\?action=audio&actorId=/);assert(f.requests.every(r=>!r.url.includes('/soe')));otherDevice.stop();
});
test('queued private audio never hydrates or uploads under another account or reset generation',async()=>{
 const shared=new Map(),a=await libraryFixture({storage:shared,fail:true}),library=a.build();await library.save({poemId:1,lineIndex:0,recordingId:crypto.randomUUID(),recordedAt:NOW,audio:wav().toString('base64')});await library.flush();library.stop();
 for(const person of [{actorId:other.id},{actorId:student.id,epoch:'a'.repeat(32)}]){
  const f=await libraryFixture({storage:shared,...person}),next=f.build();await next.hydrate();assert.equal(next.has('1-0'),false);assert(!f.requests.some(r=>r.options.method==='POST'));next.stop();
 }
 assert.equal(shared.size,1);
});
test('late metadata fetch cannot erase a new local recording and stopped sessions cannot replay',async()=>{
 const {createRecordingLibrary}=await import('../maanshan/recording-library.mjs');let resolveList;
 const old={poemId:1,lineIndex:0,recordingId:crypto.randomUUID(),recordedAt:NOW-1000},fresh={...old,recordingId:crypto.randomUUID(),recordedAt:NOW,audio:wav().toString('base64'),blob:new Blob([wav()])};
 const library=createRecordingLibrary({enabled:true,actorId:student.id,storage:{async list(){return [];},async put(){},async remove(){}},fetch:async(url,options={})=>options.method==='POST'?new Response(JSON.stringify({ok:true,userId:student.id,recording:fresh})):new Promise(resolve=>{resolveList=resolve;})});
 const hydration=library.hydrate();await new Promise(resolve=>setImmediate(resolve));await library.save(fresh);await library.flush();resolveList(new Response(JSON.stringify({ok:true,userId:student.id,recordings:[old]})));await hydration;
 assert.strictEqual(library.source('1-0'),fresh.blob);library.stop();assert.equal(library.source('1-0'),null);assert.equal(library.has('1-0'),false);
});
test('response headers never end the deadline: stalled JSON upload/list bodies time out or abort',async()=>{
 const {createRecordingLibrary}=await import('../maanshan/recording-library.mjs');
 const storage={async list(){return [];},async put(){},async remove(){}},bodyWaits=[];
 const fetch=async(_url,options)=>({ok:true,status:200,json:()=>new Promise((resolve,reject)=>{
  bodyWaits.push(options.signal);options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
 })});
 const shortTimers={setTimeout:(fn,ms)=>setTimeout(fn,ms===18000?20:ms),clearTimeout};
 const timed=createRecordingLibrary({enabled:true,actorId:student.id,fetch,storage,timers:shortTimers});
 await timed.save({poemId:1,lineIndex:0,recordingId:crypto.randomUUID(),recordedAt:NOW,audio:wav().toString('base64')});await timed.flush();
 assert.equal(bodyWaits[0].aborted,true);assert.equal(timed.pendingCount(),1);timed.stop();
 const stopped=createRecordingLibrary({enabled:true,actorId:student.id,fetch,storage});const load=stopped.hydrate();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(bodyWaits.at(-1).aborted,false);stopped.stop();await load;assert.equal(bodyWaits.at(-1).aborted,true);
});
