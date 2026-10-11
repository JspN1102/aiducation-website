'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const auth=require('../api/_lib/school-auth.cjs');
const research=require('../api/_lib/research-store.cjs');
const quota=require('../api/_lib/chat-quota.cjs');
const {withSchoolLearning}=require('../api/_lib/school-learning.cjs');

// In-memory stand-in for student_chat_daily with the same conditional upsert.
function fakePool(){
  const rows=new Map(),pool={rows,queries:0,fail:false,async query(sql,params){
    pool.queries++;if(pool.fail)throw new Error('down');
    if(sql===quota.SCHEMA)return {rows:[]};
    const [day,id]=params,key=day+'|'+id;
    if(/^INSERT INTO student_chat_daily/.test(sql)){const n=rows.get(key)||0;if(n>=params[3])return {rows:[]};rows.set(key,n+1);return {rows:[{n:n+1}]};}
    if(/^UPDATE student_chat_daily SET n=n-1/.test(sql)){const n=rows.get(key)||0;if(n>0)rows.set(key,n-1);return {rows:[]};}
    throw new Error('unexpected '+sql);
  }};
  return pool;
}
const pupil={id:'s_'+'b'.repeat(24),role:'student',grade:2};
const HK=(date,time)=>Date.parse(date+'T'+time+'+08:00');

test('20 questions a day; the 21st is refused; the day turns at 06:00 Hong Kong time',async()=>{
  const pool=fakePool();let t=HK('2026-10-12','07:30');
  const q=quota.createChatQuota({pool:()=>pool,now:()=>t});
  for(let i=1;i<=20;i++){const r=await q.take(pupil);assert.equal(r.allowed,true);assert.equal(r.remaining,20-i);}
  assert.equal((await q.take(pupil)).allowed,false);
  t=HK('2026-10-13','05:59');assert.equal((await q.take(pupil)).allowed,false,'still the same day before 06:00');
  t=HK('2026-10-13','06:00');assert.equal((await q.take(pupil)).allowed,true,'fresh at 06:00');
  assert.equal(quota.chatDay(HK('2026-10-13','05:59')),'2026-10-12');
  assert.equal(quota.chatDay(HK('2026-10-13','06:00')),'2026-10-13');
});

test('teachers, test accounts and an unreachable database are not limited; refund gives one back',async()=>{
  const pool=fakePool(),q=quota.createChatQuota({pool:()=>pool,now:()=>HK('2026-10-12','09:00'),limit:1});
  assert.equal((await q.take({id:'t_x',role:'teacher'})).limited,false);
  assert.equal((await q.take({...pupil,isTest:true})).limited,false);
  const first=await q.take(pupil);assert.equal(first.allowed,true);
  assert.equal((await q.take(pupil)).allowed,false);
  await first.refund();await first.refund();
  assert.equal((await q.take(pupil)).allowed,true,'refund returns exactly one');
  pool.fail=true;assert.equal((await q.take({...pupil,id:'s_'+'c'.repeat(24)})).limited,false);
  assert.equal((await quota.createChatQuota({pool:()=>null}).take(pupil)).limited,false);
});

function response(){const headers={};return {headers,statusCode:200,setHeader(k,v){headers[k.toLowerCase()]=v;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}
test('chat route: the 21st question gets CHAT_DAILY_LIMIT without reaching the poet; failures are given back',async t=>{
  t.mock.method(auth,'enabled',()=>true);t.mock.method(auth,'requireActor',async()=>pupil);
  t.mock.method(research,'recordVerifiedOutcome',async()=>({recorded:true}));
  const pool=fakePool(),q=quota.createChatQuota({pool:()=>pool,now:()=>HK('2026-10-12','10:00'),limit:2});
  t.mock.method(quota,'take',actor=>q.take(actor));
  let calls=0,fail=false;
  const handler=withSchoolLearning('chat',async(req,res)=>{calls++;if(fail)return res.status(502).json({error:'Chat service unavailable'});return res.json({reply:'好問題'});});
  const ask=async()=>{const res=response();await handler({method:'POST',headers:{},body:{poemId:2,messages:[{role:'user',content:'你好'}],researchContext:{actorId:pupil.id,poemId:2}}},res);return res;};
  fail=true;const failed=await ask();assert.equal(failed.statusCode,502);
  assert.equal(pool.rows.get('2026-10-12|'+pupil.id),0,'a failed answer does not count');
  fail=false;
  assert.equal((await ask()).body.reply,'好問題');
  const second=await ask();assert.equal(second.body.reply,'好問題');assert.equal(second.headers['x-chat-remaining'],'0');
  const refused=await ask();
  assert.equal(refused.statusCode,429);assert.equal(refused.body.code,'CHAT_DAILY_LIMIT');assert.equal(refused.body.retryable,false);
  assert.equal(calls,3,'the refused question never reaches the poet');
});
