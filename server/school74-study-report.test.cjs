'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const study=require('../scripts/school74-study-report.cjs');

test('paired comparison gives Student t and a two-sided p',()=>{
  const r=study.paired([1,2,3,4,5,6,7,8,9,10,-1]);
  assert.equal(r.pupils,11);assert.equal(r.df,10);
  // t(10)=2.0 has p=.0734; check the incomplete beta through a known value.
  assert.match(r.p,/^p(=|<)/);
  const t2=study.paired([2,0,2,0,2,0,2,0,2,0,2]);assert.ok(t2.t>0);
});

test('a synthetic export becomes arm means, within-pupil differences and counts only',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'s74-study-'));
  const rows=[];let n=0;
  const read=(who,line,day,score,demoArm,pinyinArm)=>{
    const attemptId='a'+(n++),clientAt=day+'T03:00:00.000Z',itemId='p4.l'+line;
    rows.push({researchId:who,source:'client',event:{type:'attempt_started',activity:'read',attemptId,itemId,clientAt,context:{lineIndex:line,demoArm,pinyinArm}}});
    rows.push({researchId:who,source:'server_verified',event:{type:'provider_result',activity:'read',operation:'reading',attemptId,itemId,clientAt,result:{score}}});
    return attemptId;
  };
  for(const [who,bump] of [['r1',10],['r2',6],['r3',8]]){
    read(who,0,'2026-11-02',60+bump,'attempt-first','kept');read(who,1,'2026-11-02',60,'open','kept');
    read(who,0,'2026-11-02',99,'attempt-first','kept'); // a second try the same day is not the day score
    read(who,0,'2026-11-03',80,'attempt-first','faded');read(who,1,'2026-11-03',75,'open','kept');
  }
  const a=read('r1',2,'2026-11-02',50,'open','ineligible');
  rows.push({researchId:'r1',source:'client',event:{type:'answer_submitted',activity:'read',attemptId:a,itemId:'p4.l2.selfcheck',clientAt:'2026-11-02T03:01:00.000Z',response:{choiceId:'c1'}}});
  rows.push({researchId:'r2',source:'client',event:{type:'item_presented',activity:'challenge',itemId:'p4.warmup.spot',clientAt:'2026-11-03T03:00:00.000Z'}});
  rows.push({researchId:'r2',source:'client',event:{type:'answer_submitted',activity:'challenge',itemId:'p4.warmup.spot',clientAt:'2026-11-03T03:01:00.000Z',result:{status:'correct'}}});
  fs.writeFileSync(path.join(dir,'events.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const r=study.report(await study.readExport(dir));
  assert.equal(r.pupils,3);assert.equal(r.readingLineDays,13);
  const same=r.demoArm.sameDay['attempt-first minus open'];
  assert.equal(same.pupils,3);
  assert.equal(r.demoArm.sameDay.arms['attempt-first'].lineDays,6);
  assert.equal(r.demoArm.laterDays.arms['attempt-first'].meanScore,80);
  assert.equal(r.pinyinArm.laterDays['faded minus kept'].meanDiff,5);
  assert.deepEqual(r.selfCheck,{c1:{answers:1,scored:1,meanScore:50}});
  assert.deepEqual(r.warmup,{pupils:1,poems:1,shown:{spot:1},answered:{'spot correct':1}});
  assert.ok(!JSON.stringify(r).includes('r1'),'no research ids in the output');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('the study day starts at 06:00 Hong Kong',()=>{
  assert.equal(study.studyDay('2026-11-02T21:59:00.000Z'),'2026-11-02');
  assert.equal(study.studyDay('2026-11-02T22:00:00.000Z'),'2026-11-03');
});
