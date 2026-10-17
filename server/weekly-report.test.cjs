'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const weekly=require('../api/_lib/weekly-report.cjs');

const HK=(date,time='00:00')=>Date.parse(date+'T'+time+'+08:00');
const words=(scores,chars='春風又綠江南岸')=>[...chars].map((c,i)=>({c,i,p:'p'+i,score:scores[i]??90}));
const rec=(poem,line,score,t,id,ws)=>({poem_id:poem,t,li:String(line),ls:String(score),rec:{recordingId:id,words:ws||[]},ch:null});

// In-memory weekly_reports plus fixed student_data rows per week.
function fakePool(rowsByWeek){
  const stored=new Map(),seen=[];
  const pool={stored,seen,async query(sql,params){
    seen.push(sql.trim().split(/\s+/).slice(0,3).join(' '));
    if(sql===weekly.SCHEMA)return {rows:[]};
    if(/^SELECT to_char\(week_start/.test(sql))return {rows:params[1].filter(d=>stored.has(params[0]+'|'+d)).map(d=>({d,report:stored.get(params[0]+'|'+d)}))};
    if(/^INSERT INTO weekly_reports/.test(sql)){const k=params[0]+'|'+params[1];if(!stored.has(k))stored.set(k,JSON.parse(params[2]));return {rows:[]};}
    if(/^SELECT report FROM weekly_reports/.test(sql))return {rows:[{report:stored.get(params[0]+'|'+params[1])}]};
    if(/GROUP BY student_id/.test(sql))return {rows:(rowsByWeek.pupils||[]).map((student_id,i)=>({student_id,grade:4,cls:'A',n:i+1}))};
    if(/FROM student_data/.test(sql)){
      const start=Date.parse(params[3]),data=rowsByWeek[weekly.weekStartOf(start)]||{reading:[],chat:[]};
      return {rows:/section='chat'/.test(sql)?data.chat:data.reading};
    }
    throw new Error('unexpected '+sql);
  }};
  return pool;
}
const pupil={id:'s_'+'a'.repeat(24),role:'student',grade:4,cls:'A'};
const scope=async()=>({studentId:'v_1234567890'});

test('weeks start on Sunday 00:00 Hong Kong; the first report opens 10-18 08:00, later ones Sunday 06:00',()=>{
  assert.equal(weekly.weekStartOf(HK('2026-10-17','23:59')),HK('2026-10-11'));
  assert.equal(weekly.weekStartOf(HK('2026-10-18','00:00')),HK('2026-10-18'));
  assert.equal(weekly.publishAt(weekly.FIRST_WEEK),HK('2026-10-18','08:00'));
  assert.equal(weekly.publishAt(HK('2026-10-18')),HK('2026-10-25','06:00'));
  assert.deepEqual(weekly.publishedWeeks(HK('2026-10-18','07:59')),[]);
  assert.deepEqual(weekly.publishedWeeks(HK('2026-10-18','08:00')),[HK('2026-10-11')]);
  assert.equal(weekly.publishedWeeks(HK('2026-10-25','05:59')).length,1);
  assert.equal(weekly.publishedWeeks(HK('2026-10-25','06:00')).length,2);
});

test('a week is summarised: days, lines, best line, biggest rise, characters now read well, badges',()=>{
  const s=HK('2026-10-11');
  const reading=[
    rec(4,2,58,HK('2026-10-12','16:00'),'r1',words([40,90,90,50])),
    rec(4,2,58,HK('2026-10-12','16:00'),'r1',words([40,90,90,50])), // the same recording saved twice
    rec(4,2,89,HK('2026-10-13','16:00'),'r2',words([88,90,90,86])),
    rec(4,2,96,HK('2026-10-16','16:00'),'r3',words([92,95,95,90])),
    {poem_id:4,t:HK('2026-10-17','10:00'),li:null,ls:null,rec:null,ch:{attemptId:'a1',completed:true,completedAt:HK('2026-10-17','10:05'),
      answers:[{type:'dictation',itemId:'g4-d1',status:'correct',submittedAt:HK('2026-10-17','10:01')},{type:'dictation',itemId:'g4-d2',status:'skipped',submittedAt:HK('2026-10-17','10:02')},
        {type:'sound',itemId:'g4-s1',status:'correct',submittedAt:HK('2026-10-17','10:03')},{type:'dictation',itemId:'g4-d3',status:'correct',submittedAt:HK('2026-10-10','10:00')}]}},
    // The per-item summary has no round id of its own and moves completedAt with every answer.
    {poem_id:4,t:HK('2026-10-17','11:00'),li:null,ls:null,rec:null,ch:{completed:true,completedAt:HK('2026-10-17','10:59'),
      answers:[{type:'sound',itemId:'g4-s2',status:'correct',attemptId:'a1',submittedAt:HK('2026-10-17','10:04')},{type:'sound',itemId:'g4-s3',status:'correct',attemptId:'a1',submittedAt:HK('2026-10-17','10:58')},
        {type:'sound',itemId:'g4-s4',status:'correct',attemptId:'a1-review',mode:'review',submittedAt:HK('2026-10-17','10:59')}]}}
  ];
  const chat=[{t:HK('2026-10-14','19:00'),last:'好問題！'},{t:HK('2026-10-14','19:05'),last:'今天聊得夠多啦，先把詩讀熟，明天再來找我。'}];
  const r=weekly.buildReport(s,{reading,chat});
  assert.equal(r.id,'w2026-10-11');assert.deepEqual(r.week,{start:'2026-10-11',end:'2026-10-17'});
  assert.deepEqual(r.days,[false,true,true,true,false,true,true]);
  assert.deepEqual(r.reading,{lines:3,poems:1});
  assert.equal(r.writing.chars,1,'only this week, not skipped');
  assert.equal(r.challenge.count,1);assert.equal(r.chat.count,1,'the daily-limit notice is not a question');
  assert.equal(r.best.score,96);assert.equal(r.best.label,'第3句');assert.equal(r.best.title,'泊船瓜洲');assert.equal(r.best.line,'春風又綠江南岸');
  assert.deepEqual([r.improved.from,r.improved.to],[58,96]);
  assert.deepEqual(r.fixedChars.map(c=>c.c),['春','綠']);
  assert.deepEqual(r.badges.map(b=>b.key),['days','rise','voice']);
  const empty=weekly.buildReport(s,{reading:[],chat:[]});
  assert.equal(empty.best,null);assert.equal(empty.improved,null);assert.deepEqual(empty.badges,[]);assert.ok(!empty.days.some(Boolean));
});

test('reports are stored once and never recomputed; quiet earlier weeks are left out',async()=>{
  const w1=HK('2026-10-11'),w2=HK('2026-10-18'),w3=HK('2026-10-25');
  const rows={[w1]:{reading:[rec(1,0,70,HK('2026-10-12','09:00'),'x1')],chat:[]},[w2]:{reading:[],chat:[]},[w3]:{reading:[],chat:[]}};
  const pool=fakePool(rows);let now=HK('2026-10-18','09:00');
  const reports=weekly.createWeeklyReports({pool:()=>pool,now:()=>now,scope});
  let list=await reports.list(pupil);
  assert.deepEqual(list.map(r=>r.id),['w2026-10-11']);
  // New practice rows for an already published week do not change its report.
  rows[w1].reading.push(rec(1,1,99,HK('2026-10-13','09:00'),'x2'));
  list=await reports.list(pupil);assert.equal(list[0].reading.lines,1);assert.equal(list[0].best.score,70);
  now=HK('2026-10-25','06:00');list=await reports.list(pupil);
  assert.deepEqual(list.map(r=>r.id),['w2026-10-18','w2026-10-11'],'the latest week shows even when empty');
  now=HK('2026-11-01','06:00');list=await reports.list(pupil);
  assert.deepEqual(list.map(r=>r.id),['w2026-10-25','w2026-10-11'],'an empty earlier week drops out');
  assert.equal(pool.stored.size,3);
});

test('the site admin sees a preview of this week before the first report; nobody else does',async()=>{
  const pool=fakePool({[HK('2026-10-11')]:{reading:[rec(1,0,80,HK('2026-10-17','20:00'),'p1')],chat:[]},pupils:Array.from({length:21},(_,i)=>'v_'+i)});
  // Early Sunday morning the preview is still last week, the one published at 08:00.
  const reports=weekly.createWeeklyReports({pool:()=>pool,now:()=>HK('2026-10-18','07:00'),scope});
  assert.deepEqual(await reports.list(pupil),[]);
  assert.deepEqual(await reports.list({id:'t_x',role:'teacher',login:'molly'}),[]);
  const admin=await reports.list({id:'t_j',role:'teacher',login:'jasper'});
  assert.deepEqual(admin.map(r=>r.id),['preview-2026-10-11','sample-1','sample-2','sample-3']);
  assert.ok(admin.every(r=>r.preview));assert.equal(admin[0].reading.lines,1);
  assert.equal(admin[0].sampleName,undefined);assert.equal(admin[1].sampleName,'示範同學（4年級）','pupil names are never sent');
  assert.equal(pool.stored.size,0,'a preview is never stored');
  const later=weekly.createWeeklyReports({pool:()=>pool,now:()=>HK('2026-10-18','08:00'),scope});
  const after=await later.list({id:'t_j',role:'teacher',login:'jasper'});
  assert.equal(after.length,1);assert.equal(after[0].preview,undefined);
});
