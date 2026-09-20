'use strict';
// Back up completed private report snapshots. Never print report contents.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const blob=require('@vercel/blob');
const analysis=require('../api/_lib/teacher-analysis.cjs');
const research=require('../api/_lib/research-store.cjs');

async function run({output,client=blob,now=()=>new Date().toISOString()}={}){
  if(!output||!path.isAbsolute(output))throw new Error('Absolute private index path required');
  const parent=path.dirname(output),info=fs.lstatSync(parent);
  if(!info.isDirectory()||info.isSymbolicLink()||(process.platform!=='win32'&&(info.mode&0o077)))throw new Error('Private backup directory required');
  if(fs.existsSync(output))throw new Error('Existing index is preserved');
  const directory=path.join(parent,'teacher-reports');
  fs.mkdirSync(directory,{mode:0o700});
  const prefix=analysis.NS+'/report/',store=analysis.createBlobStore(client),seen=new Set(),files=[];
  let cursor,bytes=0,listed=0;
  do{
    const page=await client.list({prefix,limit:100,cursor,abortSignal:AbortSignal.timeout(12000)});
    if(!Array.isArray(page.blobs))throw new Error('Invalid report listing');
    for(const item of page.blobs){
      const id=item.pathname.slice(prefix.length);
      if(!/^[a-f0-9]{64}\.json$/.test(id)||!item.pathname.startsWith(prefix)||seen.has(id)||item.size>12*1024*1024)throw new Error('Invalid report object');
      seen.add(id);if(++listed>10000)throw new Error('Report backup object bound exceeded');
      const stored=await store.get('report/'+id.slice(0,-5));
      if(!stored?.value)throw new Error('Listed report unavailable');
      const value=stored.value;
      if(!['pending','failed','completed'].includes(value.status))throw new Error('Invalid report status');
      if(value.status!=='completed')continue;
      if(value.report?.reportId!=='ta_'+id.slice(0,-5)||research.hash(research.canonical(value.report))!==value.reportChecksum)throw new Error('Invalid report checksum');
      const content=research.canonical(value);bytes+=Buffer.byteLength(content);
      if(bytes>256*1024*1024)throw new Error('Report backup size bound exceeded');
      fs.writeFileSync(path.join(directory,id),content,{flag:'wx',mode:0o600});
      files.push({path:'teacher-reports/'+id,bytes:Buffer.byteLength(content),sha256:crypto.createHash('sha256').update(content).digest('hex')});
    }
    const next=page.hasMore?page.cursor:undefined;
    if(page.hasMore&&(!next||next===cursor))throw new Error('Invalid report pagination');
    cursor=next;
  }while(cursor);
  fs.writeFileSync(output,JSON.stringify({format:'maanshan-teacher-report-backup-v1',exportedAt:now(),files,listedObjects:listed,completedReports:files.length,sourceDeleted:false}),{flag:'wx',mode:0o600});
  return {ok:true,operation:'private-teacher-report-backup',reports:files.length,bytes,sourceDeleted:false};
}
if(require.main===module){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--export-output'){console.error('Use --export-output ABSOLUTE_PRIVATE_PATH');process.exitCode=1;}
  else run({output:args[1]}).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('Private teacher report backup incomplete; source preserved.');process.exitCode=1;});
}
module.exports={run};
