const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const store=require('../api/_lib/research-store.cjs');
const {PAGE_SIZE,parseArgs,checkRow,exportHistory}=require('../deploy/research-export.cjs');
const linux={skip:process.platform!=='linux'?'private filesystem checks require Linux':false};
function record(n=0){
  const event={eventId:randomUUID(),sessionId:randomUUID(),seq:n,clientAt:'2026-09-20T00:00:00.000Z',activeMs:n,
    poemId:2,activity:'challenge',type:'answer_submitted',appVersion:'app-v1',contentVersion:'content-v1',
    itemId:'game.farewell.beat.0',context:{mode:'standard',itemType:'microgame'},response:{choiceId:'left'},result:{status:'correct',score:null,correct:true}};
  const row={schemaVersion:1,researchId:'r_abcdefgh123',grade:2,cls:'A',source:'client',serverReceivedAt:event.clientAt,qualityFlags:[],event,
    eventChecksum:store.hash(store.canonical({researchId:'r_abcdefgh123',source:'client',event}))};
  return {id:String(9007199254740992n+BigInt(n)),research_id:row.researchId,event_checksum:row.eventChecksum,record:row};
}
function database(rows,{failPage,abort}={}){
  const queries=[],cursors=[];let reads=0,released=false,connected=false;
  const connection={async query(text,values){queries.push(text);
    if(text.startsWith('SELECT transaction_timestamp'))return {rows:[{snapshot_at:'2026-09-20T01:00:00.000Z',snapshot_id:'30:40:'}]};
    if(text.startsWith('SELECT id::text')){
      assert.ok(queries.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));assert.ok(text.endsWith('ORDER BY id LIMIT 500'));cursors.push(values[0]);reads++;
      if(reads===failPage)throw new Error('synthetic failure');
      const page=rows.filter(row=>BigInt(row.id)>BigInt(values[0])).slice(0,PAGE_SIZE);
      if(abort&&reads===2)abort.abort(new Error('EXPORT_INTERRUPTED'));
      return {rows:page};
    }
    assert.ok(/^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)/.test(text),'unexpected SQL');return {rows:[]};
  },release(){released=true;}};
  return {queries,cursors,async connect(){connected=true;return connection;},get released(){return released;},get connected(){return connected;}};
}
async function workspace(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'research-export-test-'));await fs.chmod(base,0o700);t.after(async()=>{assert.ok(base.startsWith(path.join(os.tmpdir(),'research-export-test-')));await fs.rm(base,{recursive:true,force:true});});return base;}
test('CLI accepts an unbounded historical period with explicit private output',()=>{
  assert.deepEqual(parseArgs(['--output','/home/ubuntu/private/export-1','--from','2020-01-01','--to','2026-12-31','--grade','2','--cls','A']),{output:'/home/ubuntu/private/export-1',filters:{from:'2020-01-01',to:'2026-12-31',grade:2,cls:'A'}});
  assert.throws(()=>parseArgs(['--from','2026-01-01']),/OUTPUT_REQUIRED/);
  assert.throws(()=>parseArgs(['--output','/tmp/x','--from','2026-02-30']),/INVALID_DATE/);
  assert.throws(()=>parseArgs(['--output','/tmp/x','--grade','2 OR 1=1']),/INVALID_GRADE/);
  assert.throws(()=>parseArgs(['--output','/tmp/x','--output','/tmp/y']),/INVALID_ARGUMENTS/);
});
test('strict stored records reject extra identity fields and independent checksum corruption',()=>{
  assert.equal(checkRow(record(),{}).source,'client');
  const name=record();name.record.login='not-permitted';assert.throws(()=>checkRow(name,{}),/INVALID_STORED_ROW/);
  const changed=record();changed.record.event.response.choiceId='right';assert.throws(()=>checkRow(changed,{}),/EVENT_CHECKSUM_MISMATCH/);
  const column=record();column.event_checksum='0'.repeat(64);assert.throws(()=>checkRow(column,{}),/EVENT_CHECKSUM_MISMATCH/);
  const identity=record();identity.research_id='r_other12345';assert.throws(()=>checkRow(identity,{}),/STORED_IDENTITY_MISMATCH/);
});
test('streams more than two pages with exact bigint cursors, hashes and private modes',linux,async t=>{
  const base=await workspace(t),output=path.join(base,'export'),rows=Array.from({length:1203},(_,i)=>record(i)),db=database(rows);
  rows[600].record.source='server_verified';
  Object.assign(rows[600].record.event,{type:'provider_result',provider:'tencent',model:'soe',operation:'reading',providerVersion:'v1'});
  rows[600].event_checksum=rows[600].record.eventChecksum=store.hash(store.canonical({researchId:rows[600].research_id,source:'server_verified',event:rows[600].record.event}));
  const result=await exportHistory({db,output,filters:{from:'2020-01-01',to:'2030-01-01',grade:2,cls:'A'}});
  assert.equal(result.rowCount,1203);assert.equal(result.pages,3);assert.ok(db.released);
  assert.deepEqual(db.cursors,['0',rows[499].id,rows[999].id,rows[1202].id]);
  const manifest=JSON.parse(await fs.readFile(path.join(output,'manifest.json'),'utf8'));
  assert.equal(manifest.status,'complete');assert.equal(manifest.snapshot.readOnly,true);assert.equal(manifest.snapshot.isolation,'repeatable read');
  assert.ok(manifest.validation.originalBatchChecksums.startsWith('not reverified'));
  assert.equal((await fs.stat(output)).mode&0o777,0o700);
  for(const file of manifest.files){const data=await fs.readFile(path.join(output,file.name));assert.equal(store.hash(data),file.sha256);assert.equal(data.length,file.bytes);assert.equal((await fs.stat(path.join(output,file.name))).mode&0o777,0o600);}
  assert.equal((await fs.stat(path.join(output,'manifest.json'))).mode&0o777,0o600);
  const exported=(await fs.readFile(path.join(output,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(exported,rows.map(row=>row.record));
  assert.equal((await fs.readdir(output)).some(name=>name.endsWith('.partial')),false);
  assert.ok(db.queries.includes('COMMIT'));assert.ok(!db.queries.includes('ROLLBACK'));
});
test('query failure and interruption leave partial output without success or source changes',linux,async t=>{
  const base=await workspace(t),rows=Array.from({length:501},(_,i)=>record(i));
  for(const kind of ['query','abort']){
    const controller=new AbortController(),output=path.join(base,kind),db=database(rows,kind==='query'?{failPage:2}:{abort:controller});
    await assert.rejects(exportHistory({db,output,signal:controller.signal}));
    assert.ok(db.released);assert.ok(db.queries.includes('ROLLBACK'));
    const files=await fs.readdir(output);assert.ok(files.includes('events.jsonl.partial'));assert.ok(!files.includes('manifest.json'));
    assert.equal((await fs.readFile(path.join(output,'events.jsonl.partial'),'utf8')).trim().split('\n').length,500);
  }
});
test('corrupt data cannot be labelled complete',linux,async t=>{
  const base=await workspace(t),output=path.join(base,'bad'),row=record();row.record.eventChecksum='f'.repeat(64);
  const db=database([row]);await assert.rejects(exportHistory({db,output}),/EVENT_CHECKSUM_MISMATCH/);
  assert.ok(db.queries.includes('ROLLBACK'));assert.ok(!(await fs.readdir(output)).includes('manifest.json'));
});
test('existing destinations, public paths, symlink ancestors and writable parents fail closed',linux,async t=>{
  const base=await workspace(t),db=database([]),existing=path.join(base,'existing');await fs.mkdir(existing,{mode:0o700});
  await fs.writeFile(path.join(existing,'sentinel'),'preserve');
  await assert.rejects(exportHistory({db,output:existing}),error=>error.code==='EEXIST');
  await assert.rejects(exportHistory({db,output:path.join(base,'www','export')}),/PUBLIC_OUTPUT_REJECTED/);
  const alias=path.join(base,'alias');await fs.symlink(existing,alias);
  await assert.rejects(exportHistory({db,output:path.join(alias,'export')}),/OUTPUT_ANCESTOR_REJECTED/);
  const shared=path.join(base,'shared');await fs.mkdir(shared,{mode:0o777});await fs.chmod(shared,0o777);
  await assert.rejects(exportHistory({db,output:path.join(shared,'export')}),/OUTPUT_PARENT_NOT_PRIVATE/);
  assert.equal(await fs.readFile(path.join(existing,'sentinel'),'utf8'),'preserve');assert.equal(db.connected,false);
});
