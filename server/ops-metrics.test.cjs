'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const ops=require('../api/_lib/ops-metrics.cjs');

const HOUR=3600000,T=Date.parse('2026-10-12T03:30:00Z');

test('the last 24 hours: counts and timings from hourly buckets, older hours dropped',()=>{
  ops.reset();
  ops.record({route:'soe',method:'POST',status:200,totalMs:9000,now:T-25*HOUR});
  for(let i=0;i<10;i++)ops.record({route:'soe',method:'POST',status:200,totalMs:1000+i*100,now:T-20*HOUR});
  ops.record({route:'soe',method:'POST',status:504,totalMs:30000,now:T-2*HOUR});
  ops.record({route:'tts',method:'POST',status:200,totalMs:300,now:T-60000});
  const snap=ops.snapshot(T),day=snap.windows[1440];
  assert.equal(day.routes.soe.count,11,'the hour 25 hours ago is gone');
  assert.equal(day.routes.soe.s504,1);assert.equal(day.totals.count,12);
  assert.equal(day.routes.soe.p50Ms,1400);assert.equal(day.routes.tts.p50Ms,300);
  assert.equal(snap.windows[60].routes.soe,undefined,'the last hour only has tts');
  ops.reset();
});

test('saved once a minute and read back after a restart; a broken file starts from zero',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ops-')),file=path.join(dir,'ops.json');
  try{
    ops.reset();
    ops.record({route:'soe',method:'POST',status:200,totalMs:2000,relay:'hk:3101',now:T-10*60000});
    ops.record({route:'soe',method:'POST',status:502,totalMs:100,now:T-5*HOUR});
    assert.equal(ops.save(file,T),true);
    const before=ops.snapshot(T);
    ops.reset();
    assert.equal(ops.snapshot(T).windows[1440].totals.count,0,'a restart forgets');
    assert.equal(ops.load(file,T+60000),true);
    const after=ops.snapshot(T+60000);
    assert.deepEqual(after.windows[1440].totals,before.windows[1440].totals);
    assert.equal(after.windows[60].routes.soe.count,1);assert.equal(after.windows[60].relay['hk:3101'],1);
    assert.deepEqual(after.errors.map(e=>e.status),[502]);
    assert.equal(after.restoredAt,T);assert.equal(after.since,before.since);
    ops.record({route:'soe',method:'POST',status:200,totalMs:2500,now:T+90000});
    assert.equal(ops.snapshot(T+120000).windows[60].routes.soe.count,2,'new requests add to the restored ones');
    // Read back the next day: only what is still inside the windows.
    ops.reset();ops.load(file,T+23*HOUR);
    const later=ops.snapshot(T+23*HOUR);
    assert.equal(later.windows[60].totals.count,0);assert.equal(later.windows[1440].totals.count,1,'the request from 23 hours ago stays, the error from 28 hours ago is gone');
    ops.reset();
    fs.writeFileSync(file,'{not json');assert.equal(ops.load(file,T),false);
    fs.writeFileSync(file,JSON.stringify({version:1,savedAt:T,hours:[{hour:Math.floor(T/HOUR),routes:{'bad route':{count:5},soe:{count:-1,samples:['x',5]}}}]}));
    assert.equal(ops.load(file,T),true);
    assert.deepEqual(ops.snapshot(T).windows[1440].routes,{soe:{count:0,s5xx:0,s504:0,s408:0,s499:0,s4xx:0,p50Ms:5,p95Ms:5}},'only clean counts are read');
    assert.equal(ops.save(path.join(dir,'missing','ops.json'),T),false,'an unwritable place is ignored');
  }finally{ops.reset();fs.rmSync(dir,{recursive:true,force:true});}
});

test('after a restart the missing hours are read back from the service log',async()=>{
  ops.reset();
  const now=Date.now();ops.record({route:'tts',method:'POST',status:200,totalMs:300,now});
  const asked=[];
  const lines=[
    {at:now-30*HOUR,route:'soe',method:'POST',status:200,totalMs:1},          // older than a day
    {at:now-5*HOUR,route:'soe',method:'POST',status:200,totalMs:2000,relay:'hk:3101'},
    {at:now-5*HOUR,route:'soe',method:'POST',status:502,totalMs:100},
    {at:now-30*60000,route:'soe',method:'POST',status:200,totalMs:3000,relay:'hk:3102'},
    {at:now-20*60000,route:'school-auth',method:'GET',status:200,totalMs:5},   // looks like a cron heartbeat
    {at:now-10*60000,route:'school-auth',method:'GET',status:504,totalMs:30000},
    {at:now-60000,route:'bad route',method:'POST',status:200}];
  const added=await ops.backfill(async(from,until)=>{asked.push([from,until]);return lines;},now);
  assert.equal(asked.length,1);assert.equal(asked[0][0],now-24*HOUR);
  assert.equal(added,4,'three readings and one error');
  const snap=ops.snapshot(now);
  assert.equal(snap.windows[1440].routes.soe.count,3);assert.equal(snap.windows[1440].routes.soe.s5xx,1);
  assert.equal(snap.windows[60].routes.soe.count,1);assert.equal(snap.windows[60].relay['hk:3102'],1);
  assert.equal(snap.windows[1440].routes['school-auth'].s504,1,'heartbeat-like successes are skipped, errors are kept');
  assert.deepEqual(snap.errors.map(e=>e.status),[504,502],'newest first');
  assert.equal(snap.since,now-24*HOUR,'the whole day is now covered');
  assert.equal(await ops.backfill(async()=>{throw new Error('nothing to read');},now),0,'nothing missing any more');
  ops.reset();
});

test('the restart gap between the last save and the new start is filled once',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ops-')),file=path.join(dir,'ops.json');
  try{
    ops.reset();const now=Date.now();
    ops.record({route:'soe',method:'POST',status:200,totalMs:2000,now:now-3*60000});
    globalThis[ops.KEY].since=now-25*HOUR;ops.save(file,now-2*60000);
    ops.reset();ops.load(file,now);
    const asked=[];
    await ops.backfill(async(from,until)=>{asked.push([from,until]);return [{at:now-90000,route:'soe',method:'POST',status:200,totalMs:2500}];},now);
    assert.equal(asked.length,1);assert.equal(asked[0][0],now-2*60000);
    assert.equal(ops.snapshot(now).windows[60].routes.soe.count,2);
  }finally{ops.reset();fs.rmSync(dir,{recursive:true,force:true});}
});

test('journal lines: only the fixed fields of api lines are kept',()=>{
  const {parseLine}=require('./ops-journal.cjs');
  const line=m=>JSON.stringify({MESSAGE:m,__REALTIME_TIMESTAMP:'1760200000123456'});
  assert.deepEqual(parseLine(line('{"event":"api","route":"soe","method":"POST","status":200,"totalMs":2100,"relay":"hk:3101","bodyBytes":9}')),
    {at:1760200000123,route:'soe',method:'POST',status:200,totalMs:2100,relay:'hk:3101'});
  assert.equal(parseLine(line('Mandarin API listening on <server>:3100')),null);
  assert.equal(parseLine(line('{"event":"api","route":"Bad Route","status":200}')),null);
  assert.equal(parseLine('{broken'),null);
  assert.equal(parseLine(line('{"event":"api","route":"tts","method":"POST","status":200,"totalMs":-1,"relay":"x"}')).relay,null);
});
