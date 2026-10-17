'use strict';
// 上週學習報告 (school70). A week runs Sunday 00:00 to Saturday 24:00 Hong Kong
// time and is published the Sunday after at 06:00 (the very first one, for
// 10/11–10/17, at 08:00). Each report is computed once from the saved practice
// rows of that week and stored in weekly_reports; it is never recomputed, so a
// pupil sees the same report every time. Rows are dated by the server when
// they arrive, so a week's rows cannot change after the week has ended.
// Pupils, teachers and test (demo) accounts all get reports; nothing is
// compared between pupils.
const auth=require('./school-auth.cjs');
const teacherLearning=require('./teacher-learning-reset.cjs');
const {poems}=require('./all-poems.cjs');

const HOUR=3600000,DAY=24*HOUR,WEEK=7*DAY,HK=8*HOUR;
const FIRST_WEEK=Date.UTC(2026,9,11)-HK;
const MAX_WEEKS=26;
const CHAT_ENOUGH='今天聊得夠多啦，先把詩讀熟，明天再來找我。';
const SCHEMA=`CREATE TABLE IF NOT EXISTS weekly_reports (
  actor_id varchar(128) NOT NULL, week_start date NOT NULL,
  report jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(actor_id, week_start)
)`;
const ready=new WeakMap();
function schema(pool){
  if(!ready.has(pool))ready.set(pool,pool.query(SCHEMA).catch(error=>{ready.delete(pool);throw error;}));
  return ready.get(pool);
}

// Sunday 00:00 Hong Kong of the week containing t (1970-01-01 was a Thursday).
function weekStartOf(t){const day=Math.floor((t+HK)/DAY);return (day-(day+4)%7)*DAY-HK;}
function publishAt(start){return start+WEEK+(start===FIRST_WEEK?8:6)*HOUR;}
const isoDate=t=>new Date(t+HK).toISOString().slice(0,10);
function publishedWeeks(now){
  const weeks=[];
  for(let start=FIRST_WEEK;publishAt(start)<=now;start+=WEEK)weeks.push(start);
  return weeks.slice(-MAX_WEEKS);
}

const BADGE_RULES=[['days',r=>r.days.filter(Boolean).length,3],['reader',r=>r.reading.lines,20],
  ['rise',r=>r.improved?r.improved.to-r.improved.from:0,15],['writer',r=>r.writing.chars,10],['voice',r=>r.best?.score||0,90]];
const num=v=>{if(v===null||v===undefined||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;};
const han=c=>typeof c==='string'&&/^\p{Script=Han}$/u.test(c);

// Builds one week's report from that week's student_data rows (oldest first).
function buildReport(start,{reading=[],chat=[]}){
  const end=start+WEEK,days=Array(7).fill(false);
  const mark=t=>{if(t>=start&&t<end)days[Math.floor((t-start)/DAY)]=true;};
  const recordings=new Map(),dictation=new Set(),rounds=new Set();
  for(const row of reading){
    const t=Number(row.t);mark(t);
    const line=num(row.li),score=num(row.ls);
    if(Number.isInteger(line)&&score!==null){
      const key=row.rec?.recordingId||[row.poem_id,line,score,t].join('|');
      if(!recordings.has(key))recordings.set(key,{poemId:row.poem_id,line,score:Math.round(score),t,words:Array.isArray(row.rec?.words)?row.rec.words:[]});
    }
    const ch=row.ch;if(!ch||typeof ch!=='object')continue;
    for(const a of Array.isArray(ch.answers)?ch.answers:[]){
      const at=num(a?.submittedAt);
      if(a?.type==='dictation'&&at>=start&&at<end&&!['skipped','unanswered'].includes(a.status))dictation.add((a.attemptId||ch.attemptId||'')+'|'+a.itemId);
    }
    const done=num(ch.completedAt);
    if(ch.completed&&done>=start&&done<end)rounds.add(ch.attemptId||String(done));
  }
  let chats=0;
  for(const row of chat){mark(Number(row.t));if(row.last!==CHAT_ENOUGH)chats++;}
  const list=[...recordings.values()].sort((a,b)=>a.t-b.t),poemOf=id=>poems.find(p=>p.id===id);
  let best=null,improved=null;const byLine=new Map(),chars=new Map();
  for(const r of list){
    if(!best||r.score>=best.score)best=r;
    // A near-silent or cut-off recording (under 20) is not a starting point for 進步.
    const key=r.poemId+'|'+r.line,group=byLine.get(key);
    if(!group){if(r.score>=20)byLine.set(key,{poemId:r.poemId,line:r.line,from:r.score,to:r.score});}else group.to=Math.max(group.to,r.score);
    r.words.forEach((w,i)=>{
      if(!han(w?.c)||num(w.score)===null)return;
      const k=key+'|'+(Number.isInteger(w.i)?w.i:i),c=chars.get(k);
      if(!c)chars.set(k,{c:w.c,p:typeof w.p==='string'?w.p:'',low:w.score<60,last:w.score});else{c.low||=w.score<60;c.last=w.score;}
    });
  }
  for(const g of byLine.values())if(g.to>g.from&&(!improved||g.to-g.from>improved.to-improved.from))improved=g;
  const fixed=[];for(const c of chars.values())if(c.low&&c.last>=85&&!fixed.some(f=>f.c===c.c)&&fixed.length<6)fixed.push({c:c.c,p:c.p});
  const lineText=(id,line)=>poemOf(id)?.lines?.[line]?.text||'';
  const report={
    id:'w'+isoDate(start),week:{start:isoDate(start),end:isoDate(end-DAY)},days,
    reading:{lines:list.length,poems:new Set(list.map(r=>r.poemId)).size},writing:{chars:dictation.size},
    challenge:{count:rounds.size},chat:{count:chats},
    best:best&&best.score>=60&&lineText(best.poemId,best.line)?{title:poemOf(best.poemId).title,label:`第${best.line+1}句`,line:lineText(best.poemId,best.line),score:best.score}:null,
    improved:improved&&lineText(improved.poemId,improved.line)?{title:poemOf(improved.poemId).title,line:lineText(improved.poemId,improved.line),from:improved.from,to:improved.to}:null,
    fixedChars:fixed
  };
  report.badges=BADGE_RULES.map(([key,value,min])=>({key,value:value(report)})).filter((b,i)=>b.value>=BADGE_RULES[i][2]);
  return report;
}

async function weekRows(pool,who,start){
  const args=[who.studentId,who.grade,who.cls,new Date(start).toISOString(),new Date(start+WEEK).toISOString()];
  const where=`student_id=$1 AND ($2::int IS NULL OR grade=$2) AND cls=$3 AND updated_at>=$4::timestamptz AND updated_at<$5::timestamptz`;
  const [reading,chat]=await Promise.all([
    pool.query(`SELECT poem_id,(extract(epoch FROM updated_at)*1000)::bigint AS t,payload->>'lineIdx' AS li,payload->>'lineScore' AS ls,
      CASE WHEN jsonb_typeof(payload->'lineIdx')='number' THEN payload#>ARRAY['learningState','reading',payload->>'lineIdx'] END AS rec,
      CASE WHEN jsonb_typeof(payload->'challenge')='object' THEN jsonb_build_object('attemptId',payload#>'{challenge,attemptId}','completed',payload#>'{challenge,completed}',
        'completedAt',payload#>'{challenge,completedAt}','answers',payload#>'{challenge,answers}') END AS ch
      FROM student_data WHERE ${where} AND section='reading' ORDER BY updated_at,id`,args),
    pool.query(`SELECT (extract(epoch FROM updated_at)*1000)::bigint AS t,payload#>>'{messages,-1,content}' AS last
      FROM student_data WHERE ${where} AND section='chat' ORDER BY updated_at,id`,args)
  ]);
  return {reading:reading.rows,chat:chat.rows};
}

function createWeeklyReports({pool=()=>auth.getStore().pool,now=Date.now,scope=teacherLearning.scope}={}){
  async function list(actor){
    const db=typeof pool==='function'?pool():pool;
    if(!db)return [];
    await schema(db);
    const learning=await scope(actor);
    const who={studentId:learning.studentId,grade:auth.allGrades(actor)?null:actor.grade,cls:actor.cls||'T'};
    const weeks=publishedWeeks(now()),dates=weeks.map(isoDate);
    const stored=new Map((await db.query(`SELECT to_char(week_start,'YYYY-MM-DD') AS d,report FROM weekly_reports WHERE actor_id=$1 AND week_start=ANY($2::date[])`,[actor.id,dates])).rows.map(r=>[r.d,r.report]));
    for(const start of weeks){
      const d=isoDate(start);if(stored.has(d))continue;
      const report=buildReport(start,await weekRows(db,who,start));
      // Two tabs may build the same week at once: the first stored copy wins.
      await db.query(`INSERT INTO weekly_reports(actor_id,week_start,report) VALUES($1,$2::date,$3::jsonb) ON CONFLICT DO NOTHING`,[actor.id,d,JSON.stringify(report)]);
      stored.set(d,(await db.query(`SELECT report FROM weekly_reports WHERE actor_id=$1 AND week_start=$2::date`,[actor.id,d])).rows[0]?.report||report);
    }
    // Newest first. Earlier weeks in which nothing was practised are left out;
    // the latest week is always shown, as an invitation to come back.
    const reports=dates.map(d=>stored.get(d)).filter(Boolean).reverse().filter((r,i)=>i===0||r.days.some(Boolean));
    // Before the first report is published, the site admin sees this week so far.
    if(auth.siteAdmin(actor)&&now()<publishAt(FIRST_WEEK)){
      const start=weekStartOf(now());
      reports.unshift({...buildReport(start,await weekRows(db,who,start)),id:'preview-'+isoDate(start),preview:true});
    }
    return reports;
  }
  return {list};
}

let shared;
async function handle(req){
  const actor=await auth.requireActor(req,{roles:['student','teacher']});
  if(!actor)throw new auth.AuthError(403,'AUTH_DISABLED');
  return {ok:true,reports:await (shared||=createWeeklyReports()).list(actor)};
}
module.exports={createWeeklyReports,buildReport,weekStartOf,publishAt,publishedWeeks,FIRST_WEEK,SCHEMA,handle};
