'use strict';
// AI聊天次數: each question to the AI 詩人 gets a kind after it is answered; gibberish never
// leaves the server; teachers get counts, plus the words and reply of ⚠ questions only (school71).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const auth=require('../api/_lib/school-auth.cjs');
const topics=require('../api/_lib/chat-topics.cjs');
const {createChatLog,createChatConcerns,filters}=require('../api/_lib/chat-log-handler.cjs');
const backfill=require('../deploy/chat-topics-backfill.cjs');

const A='r_aaaaaaaaaaaaaaaaaaaaaaaa',B='r_bbbbbbbbbbbbbbbbbbbbbbbb',RESET='2026-10-03T05:17:00.000Z';
const NOW=Date.parse('2026-10-13T04:00:00.000Z'),AT=Date.parse('2026-10-13T02:00:00.000Z');
const ACCOUNTS=[{role:'student',researchId:B,displayName:'測試甲',login:'t2a01',grade:2,cls:'A',classNo:1}];
const EVENT='3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f',WORDS='合成測試句子',REPLY='合成詩人回覆';

function pool(seen=[]){
 const client={async query(sql,params){if(/^(BEGIN|SET|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};seen.push({sql,params});
   if(sql.includes('LEFT JOIN chat_topics'))return {rows:[{research_id:B,grade:2,cls:'A',topic:'meaning',concern:null,n:4},{research_id:B,grade:2,cls:'A',topic:'invalid',concern:null,n:2},
     {research_id:B,grade:2,cls:'A',topic:'offtopic',concern:'abuse',n:1},{research_id:B,grade:2,cls:'A',topic:null,concern:null,n:3},{research_id:A,grade:3,cls:'B',topic:'poet',concern:null,n:5}]};
   if(sql.includes('t.concern IS NOT NULL'))return {rows:[{at:AT,research_id:B,poem:2,grade:2,cls:'A',question:WORDS,reply:REPLY,topic:'offtopic',concern:'abuse'}]};
   return {rows:[]};},release(){}};
 return {query:async sql=>{seen.push({sql});return {rows:[]};},connect:async()=>client};
}
async function withActor(who,run){const saved=auth.requireActor;auth.requireActor=async()=>who;try{return await run();}finally{auth.requireActor=saved;}}
function caller(h){
 return async query=>{const res={statusCode:0,headers:{},body:null,setHeader(k,v){this.headers[k.toLowerCase()]=v;},json(b){this.body=b;return this;}};
  res.status=n=>{res.statusCode=n;return res;};await h({method:'GET',query,headers:{}},res);return res;};
}
const deps=seen=>({researchPool:()=>pool(seen),directory:async()=>({accounts:ACCOUNTS}),cohort:async()=>RESET,now:()=>NOW});

test('gibberish, emoji, digits and random letters are 無效輸入 without a DeepSeek call',async()=>{
 for(const s of ['Dxgbsgdx123.🎶🎶😎😎❤️','😎😎❤️','123456','asdfghjkl','qqqq','  ','。。。','啊啊啊啊'])assert.equal(topics.gibberish(s),true,s);
 for(const s of ['床前明月光是甚麼意思？','李白是誰','hello','how old are you','鵝'])assert.equal(topics.gibberish(s),false,s);
 topics._reset();let calls=0;
 const r=await topics.classify('Dxgbsgdx123.🎶🎶😎😎❤️','詠鵝',{fetchImpl:async()=>{calls++;}});
 assert.deepEqual(r,{topic:'invalid',concern:null,model:'local'});assert.equal(calls,0);
});

test('the reply is read leniently and only the listed kinds are kept',()=>{
 assert.deepEqual(topics.parse('{"topic":"meaning","concern":"none"}'),{topic:'meaning',concern:null});
 assert.deepEqual(topics.parse('好的：{"topic":"offtopic","concern":"bully"} 完'),{topic:'offtopic',concern:'bully'});
 assert.deepEqual(topics.parse('{"topic":"POET"}'),{topic:'poet',concern:null});
 for(const garbled of ['unrelated','of topic','of','oftext','off-topic'])assert.deepEqual(topics.parse(`{"topic":"${garbled}","concern":"other"}`),{topic:'offtopic',concern:'other'},garbled);
 for(const bad of ['','meaning','{"topic":"weather"}','{topic:meaning}'])assert.equal(topics.parse(bad),null,bad);
});

test('one small DeepSeek call with the chat key; same words are asked once; failure is 未分類',async()=>{
 const saved={...process.env};Object.assign(process.env,{GPT_API_BASE:'https://provider.invalid/v1',GPT_API_KEY:'synthetic',POET_CHAT_MODEL:'deepseek-flash'});delete process.env.CHAT_TOPIC_MODEL;
 try{
  topics._reset();const sent=[];
  const fetchImpl=async(url,init)=>{sent.push({url,body:JSON.parse(init.body)});return {ok:true,json:async()=>({model:'deepseek-flash',choices:[{message:{content:'{"topic":"pronounce","concern":"none"}'}}]})};};
  assert.deepEqual(await topics.classify('「鵝」怎樣讀？','詠鵝',{fetchImpl}),{topic:'pronounce',concern:null,model:'deepseek-flash'});
  await topics.classify('「鵝」怎樣讀？','詠鵝',{fetchImpl});
  assert.equal(sent.length,1);assert.equal(sent[0].url,'https://provider.invalid/v1/chat/completions');
  assert.equal(sent[0].body.model,'deepseek-flash');assert.equal(sent[0].body.temperature,0);assert(sent[0].body.max_tokens<=64);
  assert.equal(await topics.classify('另一句',null,{fetchImpl:async()=>({ok:false})}),null);
  assert.equal(await topics.classify('再一句',null,{fetchImpl:async()=>{throw new Error('down');}}),null);
  delete process.env.GPT_API_KEY;topics._reset();
  assert.equal(await topics.classify('沒有密鑰',null,{fetchImpl}),null);
 }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});

test('classifyLater saves one row per chat event and never throws into the chat',async()=>{
 topics._reset();const seen=[];
 const db={query:async(sql,params)=>{seen.push({sql,params});return {rows:[]};}};
 assert.equal(await topics.classifyLater({eventId:EVENT,question:'😎😎',poemTitle:'詠鵝'},{pool:()=>db}),true);
 const insert=seen.find(x=>x.sql.includes('INSERT INTO chat_topics'));assert.deepEqual(insert.params,[EVENT,'invalid',null,'local']);
 assert.match(seen[0].sql,/CREATE TABLE IF NOT EXISTS chat_topics/);
 assert.equal(await topics.classifyLater({eventId:'not-a-uuid',question:'x'},{pool:()=>db}),false);
 assert.equal(await topics.classifyLater({eventId:EVENT,question:'x'},{pool:()=>null}),false);
 assert.equal(await topics.classifyLater({eventId:EVENT,question:'😎'},{pool:()=>({query:async()=>{throw new Error('db down');}})}),false);
 assert.equal(await topics.classifyLater({eventId:EVENT,question:'😎'},{pool:()=>{throw new Error('boom');}}),false);
});

test('AI聊天次數 is for jasper, molly and llp-pslau only; ranges 今日 / 7 / 30 / 全部',async()=>{
 const call=caller(createChatLog(deps([])));
 for(const who of [{role:'teacher',login:'chan'},{role:'student',login:'molly'}]){
  const r=await withActor(who,()=>call({}));assert.equal(r.statusCode,403);assert.doesNotMatch(JSON.stringify(r.body),/測試甲/);
 }
 for(const login of ['jasper','molly','llp-pslau'])assert.equal((await withActor({role:'teacher',login},()=>call({days:'7'}))).statusCode,200);
 for(const days of ['1','7','30','400'])assert.equal(filters({days},NOW).days,Number(days));
 for(const days of ['2','3','401'])assert(filters({days},NOW).error,days);
 const f=filters({days:'30',grade:'2',cls:'A',q:'x',student:B},NOW);assert.equal(f.q,undefined);assert.equal(f.student,undefined);
});

test('jasper, molly and llp-pslau all get ⚠ 需要關注 with the words and the poet reply',async()=>{
 for(const login of ['jasper','molly','llp-pslau']){
  const r=await withActor({role:'teacher',login},()=>caller(createChatLog(deps([])))({days:'7',grade:'2'}));
  assert.equal(r.statusCode,200);const b=r.body.students.find(s=>s.student===B);
  assert.equal(b.questions,8);assert.equal(b.concern,1);assert.equal(b.concerns.abuse,1);assert.equal(r.body.labels.concerns.abuse,'罵人粗口');
  assert.deepEqual(b.flagged,[{at:AT,poemId:2,poemTitle:b.flagged[0].poemTitle,question:WORDS,reply:REPLY,concern:'abuse'}],login);
  assert.deepEqual(r.body.students.find(s=>s.student===A).flagged,[]);
 }
});

test('the teacher list has counts by kind, 無效輸入 and ⚠ with its kind, and words only for ⚠',async()=>{
 const seen=[],r=await withActor({role:'teacher',login:'jasper'},()=>caller(createChatLog(deps(seen)))({days:'7',grade:'2'}));
 assert.equal(r.statusCode,200);assert.equal(r.body.available,true);
 const b=r.body.students.find(s=>s.student===B);
 assert.equal(b.name,'測試甲');assert.equal(b.questions,8);assert.equal(b.invalid,2);assert.equal(b.unclassified,3);assert.equal(b.concern,1);
 assert.equal(b.topics.meaning,4);assert.equal(b.topics.offtopic,1);assert.equal(b.topics.invalid,undefined);assert.equal(b.concerns.abuse,1);
 assert.equal(r.body.questions,13);assert.equal(r.body.invalid,2);assert.equal(r.body.concern,1);
 const text=JSON.stringify({...r.body,students:r.body.students.map(({flagged,...s})=>s)});assert.doesNotMatch(text,new RegExp(WORDS+'|t2a01|"question"|"reply"|"login"'));assert.doesNotMatch(JSON.stringify(r.body),/t2a01|"login"/);
 const q=seen.find(x=>x.sql.includes('LEFT JOIN chat_topics'));assert(q.params.includes(RESET));assert(q.params.includes(2));
 assert.doesNotMatch(q.sql,/'question'|'reply'/);
});

test('需要關注的聊天 is 網站後台 only, today or 3 days, with words, pupil, time and kind',async()=>{
 const call=caller(createChatConcerns(deps([])));
 for(const login of ['molly','llp-pslau','chan']){const r=await withActor({role:'teacher',login},()=>call({days:'1'}));assert.equal(r.statusCode,403);assert.doesNotMatch(JSON.stringify(r.body),new RegExp(WORDS));}
 assert.equal((await withActor({role:'teacher',login:'jasper'},()=>call({days:'7'}))).statusCode,400);
 const seen=[],r=await withActor({role:'teacher',login:'jasper'},()=>caller(createChatConcerns(deps(seen)))({days:'3'}));
 assert.equal(r.statusCode,200);assert.equal(r.body.days,3);
 assert.deepEqual(r.body.items,[{at:AT,student:B,name:'測試甲',grade:2,cls:'A',classNo:1,poemId:2,poemTitle:r.body.items[0].poemTitle,question:WORDS,reply:REPLY,topic:'offtopic',concern:'abuse'}]);
 assert(r.body.items[0].poemTitle);assert.doesNotMatch(JSON.stringify(r.body),/t2a01/);
 assert.equal((await withActor({role:'teacher',login:'jasper'},()=>call({}))).body.days,1);
});

test('the backfill dry run only counts; --apply classifies what has no row yet',async()=>{
 assert.deepEqual(backfill.parseArgs([]),{apply:false,limit:2000,recheck:false});assert.deepEqual(backfill.parseArgs(['--apply','--limit','50']),{apply:true,limit:50,recheck:false});
 assert.deepEqual(backfill.parseArgs(['--recheck-concerns']),{apply:false,limit:2000,recheck:true});
 assert.match(backfill.FLAGGED(10),/t\.concern IS NOT NULL/);
 assert.throws(()=>backfill.parseArgs(['--limit','x']));
 assert.match(backfill.PENDING(10),/NOT EXISTS \(SELECT 1 FROM chat_topics/);
 const rows=[{event_id:EVENT,poem:1,question:'😎😎'},{event_id:'4f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f',poem:1,question:'甚麼意思'},{event_id:'5f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f',poem:1,question:'甚麼意思'}];
 const db={query:async sql=>({rows:sql.includes('NOT EXISTS')?rows:[]})},out=[];
 const dry=await backfill.run({db,emit:v=>out.push(v)});
 assert.equal(dry.pending,3);assert.equal(dry.localInvalid,1);assert.equal(dry.deepseekCalls,1);assert.doesNotMatch(JSON.stringify(out),/甚麼意思|😎/);
 const saved=[];const done=await backfill.run({db,apply:true,emit:()=>{},classify:async q=>topics.gibberish(q)?{topic:'invalid',concern:null,model:'local'}:{topic:'meaning',concern:null,model:'m'},save:async(_,id,v)=>saved.push([id,v.topic])});
 assert.equal(done.classified,3);assert.deepEqual(done.byTopic,{invalid:1,meaning:2});assert.equal(saved.length,3);
 const flaggedDb={query:async sql=>({rows:sql.includes('t.concern IS NOT NULL')?rows.slice(1,2):[]})};
 const again=await backfill.run({db:flaggedDb,apply:true,recheck:true,emit:()=>{},classify:async()=>({topic:'poet',concern:null,model:'m'}),save:async()=>{}});
 assert.equal(again.pending,1);assert.equal(again.classified,1);assert.equal(again.concern,0);
});

test('the concern rules say questions about the poet life and death, jokes and slang are none',()=>{
 const p=topics.PROMPT;
 for(const words of ['去世','死因','結婚','卡通','67','我靠','拿不準就用 none'])assert.ok(p.includes(words),words);
});

test('a recorded chat question is handed over after the reply, which never waits for the classifying',async t=>{
 const research=require('../api/_lib/research-store.cjs'),{withSchoolLearning}=require('../api/_lib/school-learning.cjs');
 const actor={id:'s_'+'a'.repeat(24),grade:2,role:'student'},response=()=>({statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
 t.mock.method(auth,'enabled',()=>true);t.mock.method(auth,'requireActor',async()=>actor);
 let recorded={recorded:true,eventId:EVENT};t.mock.method(research,'recordVerifiedOutcome',async()=>recorded);
 const handed=[];t.mock.method(topics,'classifyLater',job=>{handed.push(job);return new Promise(()=>{});});
 const handler=withSchoolLearning('chat',async(req,res)=>{res.researchExtras={chat:{question:WORDS,inputMode:'typed'}};res.json({reply:'好'});});
 const res=response();await handler({method:'POST',body:{grade:2,researchContext:{actorId:actor.id,poemId:2}}},res);
 assert.equal(res.body.reply,'好');assert.equal(res.body.researchRecorded,true);
 assert.deepEqual(handed,[{eventId:EVENT,question:WORDS,poemTitle:require('../api/_lib/poems.js').getPoem(2).title}]);
 recorded={recorded:false};await handler({method:'POST',body:{grade:2,researchContext:{actorId:actor.id,poemId:2}}},response());
 assert.equal(handed.length,1,'nothing is classified without a recorded event');
 t.mock.method(topics,'classifyLater',()=>{throw new Error('boom');});recorded={recorded:true,eventId:EVENT};
 const safe=response();await handler({method:'POST',body:{grade:2,researchContext:{actorId:actor.id,poemId:2}}},safe);assert.equal(safe.body.researchRecorded,true);
});
