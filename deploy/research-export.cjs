'use strict';
// Local administrator export. No HTTP route, Blob writes, or database mutations.
const fs=require('node:fs/promises');
const constants=require('node:fs').constants;
const path=require('node:path');
const crypto=require('node:crypto');
const store=require('../api/_lib/research-store.cjs');
const PAGE_SIZE=500;
const ROW_FIELDS=['schemaVersion','researchId','grade','cls','source','serverReceivedAt','qualityFlags','event','eventChecksum'];
const PUBLIC_COMPONENT=/^(public|www|wwwroot|htdocs|httpdocs|html|webroot|static|\.vercel|\.next)$/i;
const fail=code=>{throw new Error(code);};
function day(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
function filters(input={}){
  if(Object.keys(input).some(key=>!['from','to','grade','cls'].includes(key)))fail('INVALID_FILTER');
  const result={};
  for(const key of ['from','to'])if(input[key]!==undefined){if(!day(input[key]))fail('INVALID_DATE');result[key]=input[key];}
  if(result.from&&result.to&&result.from>result.to)fail('INVALID_DATE_ORDER');
  if(input.grade!==undefined){if(!/^[1-6]$/.test(String(input.grade)))fail('INVALID_GRADE');result.grade=Number(input.grade);}
  if(input.cls!==undefined){if(typeof input.cls!=='string'||!/^[A-Z]$/.test(input.cls))fail('INVALID_CLASS');result.cls=input.cls;}
  return result;
}
function parseArgs(argv){
  const args={};
  for(let i=0;i<argv.length;i+=2){
    const key=argv[i];if(!['--output','--from','--to','--grade','--cls'].includes(key)||!argv[i+1]||argv[i+1].startsWith('--')||Object.hasOwn(args,key.slice(2)))fail('INVALID_ARGUMENTS');
    args[key.slice(2)]=argv[i+1];
  }
  if(!args.output)fail('OUTPUT_REQUIRED');
  const {output,...requested}=args;return {output,filters:filters(requested)};
}
function beneath(file,root){const relative=path.relative(root,file);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));}
async function privateOutput(output){
  if(process.platform!=='linux')fail('PRIVATE_EXPORT_REQUIRES_LINUX');
  if(typeof output!=='string'||!path.isAbsolute(output)||output.includes('\0'))fail('ABSOLUTE_OUTPUT_REQUIRED');
  const resolved=path.resolve(output),parent=path.dirname(resolved),repo=await fs.realpath(path.resolve(__dirname,'..'));
  if(resolved===path.parse(resolved).root||resolved.split(path.sep).some(part=>PUBLIC_COMPONENT.test(part))||beneath(resolved,repo))fail('PUBLIC_OUTPUT_REJECTED');
  // Refuse symbolic-link ancestors instead of trusting a lexical public-path check.
  for(let cursor=parent;;cursor=path.dirname(cursor)){
    const stat=await fs.lstat(cursor);
    if(!stat.isDirectory()||stat.isSymbolicLink())fail('OUTPUT_ANCESTOR_REJECTED');
    if(cursor===path.parse(cursor).root)break;
  }
  const parentStat=await fs.stat(parent);
  if(parentStat.mode&0o022)fail('OUTPUT_PARENT_NOT_PRIVATE');
  if(parentStat.uid!==process.getuid()&&parentStat.uid!==0)fail('OUTPUT_PARENT_OWNER');
  await fs.mkdir(resolved,{mode:0o700}); // Existing directories/files are never reused.
  const stat=await fs.lstat(resolved);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o700||stat.uid!==process.getuid())fail('OUTPUT_PERMISSIONS');
  return resolved;
}
async function newFile(file){
  const handle=await fs.open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  await handle.chmod(0o600);return handle;
}
async function writeAll(handle,value){
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);let offset=0;
  while(offset<bytes.length){const {bytesWritten}=await handle.write(bytes,offset,bytes.length-offset,null);if(!bytesWritten)fail('OUTPUT_WRITE_FAILED');offset+=bytesWritten;}
  return bytes;
}
async function publish(file){
  const final=file.slice(0,-'.partial'.length);
  await fs.link(file,final); // Exclusive creation, never overwrite another file.
  await fs.unlink(file);return final;
}
async function syncDirectory(dir){const handle=await fs.open(dir,constants.O_RDONLY|constants.O_DIRECTORY);try{await handle.sync();}finally{await handle.close();}}
function checkRow(raw,requested){
  const row=raw.record;
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length!==ROW_FIELDS.length||Object.keys(row).some(key=>!ROW_FIELDS.includes(key)))fail('INVALID_STORED_ROW');
  if(row.schemaVersion!==1||typeof row.researchId!=='string'||!/^r_[a-zA-Z0-9_-]{8,80}$/.test(row.researchId)||row.researchId!==raw.research_id)fail('STORED_IDENTITY_MISMATCH');
  if(!['client','server_verified'].includes(row.source)||!Number.isInteger(row.grade)||row.grade<1||row.grade>6||typeof row.cls!=='string'||!/^[A-Z]$/.test(row.cls))fail('INVALID_STORED_COHORT');
  if(typeof row.serverReceivedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.serverReceivedAt)||!Number.isFinite(Date.parse(row.serverReceivedAt))||new Date(row.serverReceivedAt).toISOString()!==row.serverReceivedAt)fail('INVALID_RECEIVED_DATE');
  if(!Array.isArray(row.qualityFlags)||row.qualityFlags.some(flag=>flag!=='client_clock_out_of_range'))fail('INVALID_QUALITY_FLAGS');
  if(Buffer.byteLength(store.canonical(row))>store.MAX_BATCH_BYTES+32768)fail('STORED_ROW_TOO_LARGE');
  store.validateEvent(row.event,row.source==='server_verified');
  const calculated=store.hash(store.canonical({researchId:row.researchId,source:row.source,event:row.event}));
  if(row.eventChecksum!==calculated||raw.event_checksum!==calculated)fail('EVENT_CHECKSUM_MISMATCH');
  const receivedDay=row.serverReceivedAt.slice(0,10);
  if(requested.from&&receivedDay<requested.from||requested.to&&receivedDay>requested.to||requested.grade&&requested.grade!==row.grade||requested.cls&&requested.cls!==row.cls)fail('STORED_FILTER_MISMATCH');
  return row;
}
function pageQuery(requested,after){
  const values=[after],conditions=['id > $1::bigint'];
  for(const [key,column,sql] of [['from','received_at','>='],['to','received_at','<'],['grade','grade','='],['cls','cls','=']]){
    if(requested[key]===undefined)continue;values.push(requested[key]);
    const bound=key==='from'?`($${values.length}::date::timestamp AT TIME ZONE 'UTC')`:key==='to'?`(($${values.length}::date + 1)::timestamp AT TIME ZONE 'UTC')`:`$${values.length}`;
    conditions.push(`${column} ${sql} ${bound}`);
  }
  return {text:`SELECT id::text AS id,research_id,event_checksum,record FROM research_events WHERE ${conditions.join(' AND ')} ORDER BY id LIMIT ${PAGE_SIZE}`,values};
}
async function exportHistory({db,output,filters:input={},signal}={}){
  const requested=filters(input);signal?.throwIfAborted();
  const directory=await privateOutput(output),connection=await db.connect();
  const dataFile=path.join(directory,'events.jsonl.partial');
  let transaction=false,handle=null,count=0,bytes=0,pages=0,after='0',first=null,last=null,publishedManifest=null;
  const digest=crypto.createHash('sha256');
  try{
    await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');transaction=true;
    await connection.query("SET LOCAL TIME ZONE 'UTC'");
    await connection.query("SET LOCAL statement_timeout = '60s'");
    await connection.query("SET LOCAL idle_in_transaction_session_timeout = '5min'");
    const metadata=(await connection.query('SELECT transaction_timestamp() AS snapshot_at, pg_current_snapshot()::text AS snapshot_id')).rows[0];
    if(!metadata||!Number.isFinite(new Date(metadata.snapshot_at).getTime())||typeof metadata.snapshot_id!=='string')fail('SNAPSHOT_UNAVAILABLE');
    handle=await newFile(dataFile);
    for(;;){
      signal?.throwIfAborted();const query=pageQuery(requested,after);
      const result=await connection.query(query.text,query.values);
      if(!Array.isArray(result.rows)||result.rows.length>PAGE_SIZE)fail('INVALID_DATABASE_PAGE');
      if(!result.rows.length)break;pages++;
      for(const raw of result.rows){
        signal?.throwIfAborted();
        if(typeof raw.id!=='string'||! /^[1-9][0-9]*$/.test(raw.id)||BigInt(raw.id)<=BigInt(after)||BigInt(raw.id)>9223372036854775807n)fail('INVALID_DATABASE_CURSOR');
        const row=checkRow(raw,requested),line=await writeAll(handle,store.canonical(row)+'\n');
        digest.update(line);bytes+=line.length;count++;after=raw.id;
        if(first===null||row.serverReceivedAt<first)first=row.serverReceivedAt;
        if(last===null||row.serverReceivedAt>last)last=row.serverReceivedAt;
      }
    }
    await handle.sync();await handle.close();handle=null;signal?.throwIfAborted();
    await connection.query('COMMIT');transaction=false;
    const dictionary=Buffer.from(JSON.stringify(store.DATA_DICTIONARY,null,2)+'\n');
    const dictionaryFile=path.join(directory,'dictionary.json.partial');
    handle=await newFile(dictionaryFile);await writeAll(handle,dictionary);await handle.sync();await handle.close();handle=null;
    signal?.throwIfAborted();await publish(dataFile);await publish(dictionaryFile);await syncDirectory(directory);
    const manifest={schemaVersion:1,status:'complete',source:'local_postgres',generatedAt:new Date().toISOString(),
      snapshot:{at:new Date(metadata.snapshot_at).toISOString(),id:metadata.snapshot_id,isolation:'repeatable read',readOnly:true},
      filters:requested,range:{firstReceivedAt:first,lastReceivedAt:last},rowCount:count,pages,pageSize:PAGE_SIZE,
      files:[{name:'events.jsonl',bytes,sha256:digest.digest('hex')},{name:'dictionary.json',bytes:dictionary.length,sha256:store.hash(dictionary)}],
      validation:{eventSchema:'verified',eventChecksums:'verified against each record and stored column',researchIdentity:'verified against stored research_id',
        originalBatchChecksums:'not reverified: PostgreSQL stores event rows, not original batch envelopes; importer verifies batches before insertion'},
      scope:{identities:'pseudonymous researchId only; no roster lookup',sourceAndVersions:'preserved per event',studentAudio:false,handwritingCoordinates:false,chatText:false,sourceRowsDeleted:false}};
    const manifestFile=path.join(directory,'manifest.json.partial');handle=await newFile(manifestFile);
    await writeAll(handle,JSON.stringify(manifest,null,2)+'\n');await handle.sync();await handle.close();handle=null;
    signal?.throwIfAborted();publishedManifest=await publish(manifestFile);await syncDirectory(directory);
    return {ok:true,output:directory,rowCount:count,pages,manifest:'manifest.json'};
  }catch(error){
    if(transaction)await connection.query('ROLLBACK').catch(()=>{});
    if(publishedManifest)await fs.rename(publishedManifest,publishedManifest+'.partial').catch(()=>{});
    throw error;
  }
  finally{await handle?.close().catch(()=>{});connection.release();}
}
async function main(){
  const options=parseArgs(process.argv.slice(2)),controller=new AbortController();
  const cancel=()=>controller.abort(new Error('EXPORT_INTERRUPTED'));
  process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  const {Pool}=require('pg');const db=new Pool({...store.pgConfig(),max:1,statement_timeout:60000,application_name:'maanshan-research-export'});
  try{console.log(JSON.stringify(await exportHistory({...options,db,signal:controller.signal})));}
  finally{await db.end();process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({ok:false,error:'RESEARCH_EXPORT_FAILED',detail:/^[A-Z_]+$/.test(error.message)?error.message:'filesystem_database_or_validation_error',successfulManifest:false}));process.exitCode=1;});
module.exports={PAGE_SIZE,parseArgs,filters,privateOutput,checkRow,pageQuery,exportHistory};
