'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {run}=require('../deploy/teacher-reports-backup.cjs');
const analysis=require('../api/_lib/teacher-analysis.cjs'),research=require('../api/_lib/research-store.cjs');
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'teacher-backup-'));fs.chmodSync(directory,0o700);t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return {directory,output:path.join(directory,'reports.index.json')};}
function clientFor(records){let gets=0;return {
 list:async()=>({blobs:Object.keys(records).map(id=>({pathname:analysis.NS+'/report/'+id+'.json',size:100})),hasMore:false}),
 get:async name=>{gets++;const id=name.split('/').at(-1).replace('.json',''),content=JSON.stringify(records[id]);return {statusCode:200,stream:new ReadableStream({start(c){c.enqueue(Buffer.from(content));c.close();}}),blob:{etag:'v1',size:Buffer.byteLength(content)}};},get gets(){return gets;}
};}
test('completed teacher snapshots are backed up privately with verifiable bytes; pending reports stay pending',async t=>{
 const f=fixture(t),id='a'.repeat(64),report={schemaVersion:1,reportId:'ta_'+id,dataset:{students:[{displayName:'Synthetic only'}]}};
 const client=clientFor({[id]:{status:'completed',report,reportChecksum:research.hash(research.canonical(report))},['b'.repeat(64)]:{status:'pending'}});
 const result=await run({...f,client});assert.equal(result.reports,1);assert.equal(result.sourceDeleted,false);
 const index=JSON.parse(fs.readFileSync(f.output));assert.equal(index.listedObjects,2);
 const content=fs.readFileSync(path.join(f.directory,index.files[0].path));assert.equal(research.hash(content),index.files[0].sha256);
 if(process.platform!=='win32')assert.equal(fs.statSync(f.output).mode&0o077,0);
 await assert.rejects(run({...f,client}),/Existing index/);
});
test('corrupted report snapshot never receives a completed backup index',async t=>{
 const f=fixture(t),id='a'.repeat(64),client=clientFor({[id]:{status:'completed',report:{reportId:'ta_'+id},reportChecksum:'bad'}});
 await assert.rejects(run({...f,client}),/checksum/);assert.equal(fs.existsSync(f.output),false);
});
test('report pagination cannot silently accept a repeated cursor',async t=>{
 const f=fixture(t),client={list:async()=>({blobs:[],hasMore:true,cursor:'same'})};
 await assert.rejects(run({...f,client}),/pagination/);assert.equal(fs.existsSync(f.output),false);
});
