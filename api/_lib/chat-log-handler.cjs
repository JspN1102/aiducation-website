'use strict';
// AI聊天次數 (teacher dashboard, beside 朗讀測評次數; jasper, molly and llp-pslau): how many
// questions each pupil asked the AI 詩人 and of what kind. Counts only: no question, no
// keyword and no reply ever leaves here. A question flagged 罵人粗口 / 欺凌 / 自傷 / 其他不當
// shows only as 「⚠ 需要關注」 with its kind; the words are in 網站後台 (concerns below).
const auth=require('./school-auth.cjs');
const log=require('./activity-log-handler.cjs');
const topics=require('./chat-topics.cjs');

const RANGES=new Set([1,7,30,400]),CONCERN_DAYS=new Set([1,3]),ROW_LIMIT=20000,CONCERN_LIMIT=200;
const COUNTS=w=>`SELECT e.research_id,max(e.grade) AS grade,max(e.cls) AS cls,t.topic,t.concern,count(*)::int AS n
    FROM research_events e LEFT JOIN chat_topics t ON t.event_id=e.event_id
    WHERE ${w} GROUP BY e.research_id,t.topic,t.concern LIMIT ${ROW_LIMIT}`;
const FLAGGED=w=>`SELECT (extract(epoch FROM e.received_at)*1000)::float8 AS at,e.research_id,e.poem_id AS poem,e.grade,e.cls,
      e.record->'event'->'chat'->>'question' AS question,t.topic,t.concern
    FROM research_events e JOIN chat_topics t ON t.event_id=e.event_id
    WHERE ${w} AND t.concern IS NOT NULL ORDER BY e.received_at DESC LIMIT ${CONCERN_LIMIT}`;

function filters(query,t,ranges=RANGES,keys=['days','grade','cls']){
  const q=query||{},pick={};
  for(const key of keys)if(q[key]!==undefined)pick[key]=q[key];
  const f=log.filtersFrom(pick,t);
  if(!f.error&&!ranges.has(f.days))return {error:'INVALID_DAYS'};
  return f;
}
const zero=list=>Object.fromEntries(Object.keys(list).map(k=>[k,0]));
// Per pupil: valid questions by kind, 無效輸入, 未分類 and each kind of concern.
async function counts(pool,f,map=new Map()){
  if(pool)await topics.schema(pool).catch(()=>{});
  const {sql,params}=log.where(f);
  return log.readOnly(pool,async q=>{
    const rows=await q(COUNTS(sql),params),by=new Map();
    for(const r of rows){
      const s=by.get(r.research_id)||{...log.identity(map,r.research_id,r),questions:0,invalid:0,unclassified:0,topics:zero(topics.TOPICS),concerns:zero(topics.CONCERNS),concern:0};
      const n=Number(r.n)||0,topic=Object.hasOwn(topics.TOPICS,r.topic)?r.topic:null;
      if(topic==='invalid')s.invalid+=n;else{s.questions+=n;if(topic)s.topics[topic]+=n;else s.unclassified+=n;}
      if(Object.hasOwn(topics.CONCERNS,r.concern)){s.concerns[r.concern]+=n;s.concern+=n;}
      by.set(r.research_id,s);
    }
    const students=[...by.values()].map(s=>{delete s.topics.invalid;return s;})
      .sort((a,b)=>(a.grade||9)-(b.grade||9)||String(a.cls||'').localeCompare(String(b.cls||''))||(a.classNo||99)-(b.classNo||99)||b.questions-a.questions);
    const sum=key=>students.reduce((n,s)=>n+s[key],0);
    return {students,questions:sum('questions'),invalid:sum('invalid'),unclassified:sum('unclassified'),concern:sum('concern'),truncated:rows.length>=ROW_LIMIT};
  });
}
// 網站後台 only: each flagged question with its words, the pupil and the time, for Jasper to check.
async function flagged(pool,f,map=new Map()){
  if(pool)await topics.schema(pool).catch(()=>{});
  const {sql,params}=log.where(f);
  return log.readOnly(pool,async q=>{
    const rows=await q(FLAGGED(sql),params);
    return {items:rows.filter(r=>Object.hasOwn(topics.CONCERNS,r.concern)).map(r=>{const {login,...who}=log.identity(map,r.research_id,r);return {at:Math.round(Number(r.at)),...who,
      poemId:Number(r.poem)||null,poemTitle:log.title(r.poem),question:typeof r.question==='string'?r.question.slice(0,1000):'',
      topic:Object.hasOwn(topics.TOPICS,r.topic)?r.topic:null,concern:r.concern};}),limit:CONCERN_LIMIT};
  });
}
async function teacher(req,res,{roles=['teacher']}={}){
  let actor;
  try{actor=await auth.requireActor(req,{roles});}
  catch(error){if(error instanceof auth.AuthError){auth.sendError(res,error);return null;}throw error;}
  if(!actor){res.status(503).json({ok:false,code:'AUTH_DISABLED',error:'需要學校帳戶服務。'});return null;}
  return actor;
}
const labels={topics:topics.TOPICS,concerns:topics.CONCERNS};

function createChatLog({researchPool=defaultResearch,directory=()=>auth.directory(),cohort=log.cohortStart,now=Date.now}={}){
  return async function handler(req,res){
    res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie');
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,code:'GET_ONLY',error:'AI聊天次數只供查看。'});}
    const actor=await teacher(req,res);if(!actor)return;
    if(!auth.readingLog(actor))return res.status(403).json({ok:false,code:'READING_LOG_ONLY',error:'這個帳戶不能查看AI聊天次數。'});
    const t=now(),f=filters(req.query,t);
    if(f.error)return res.status(400).json({ok:false,code:f.error,error:'查詢條件不正確。'});
    f.since=await cohort();
    const map=await log.people(directory),r=await counts(researchPool(),f,map);
    const base={ok:true,schemaVersion:1,generatedAt:new Date(t).toISOString(),days:f.days,filters:{days:f.days,grade:f.grade||null,cls:f.cls||null},labels};
    if(!r.available)return res.status(200).json({...base,available:false});
    // Names, class and seat with counts only: no login, no time, no words.
    return res.status(200).json({...base,available:true,questions:r.questions,invalid:r.invalid,unclassified:r.unclassified,concern:r.concern,truncated:r.truncated,
      students:r.students.map(s=>({student:s.student,name:s.name,grade:s.grade,cls:s.cls,classNo:s.classNo,questions:s.questions,invalid:s.invalid,
        unclassified:s.unclassified,topics:s.topics,concerns:s.concerns,concern:s.concern}))});
  };
}
function createChatConcerns({researchPool=defaultResearch,directory=()=>auth.directory(),cohort=log.cohortStart,now=Date.now}={}){
  return async function handler(req,res){
    res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie');
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,code:'GET_ONLY',error:'只供查看。'});}
    const actor=await teacher(req,res);if(!actor)return;
    if(!auth.siteAdmin(actor))return res.status(403).json({ok:false,code:'SITE_ADMIN_ONLY',error:'只有網站管理員可以查看。'});
    const t=now(),f=filters({days:'1',...(req.query||{})},t,CONCERN_DAYS,['days']);
    if(f.error)return res.status(400).json({ok:false,code:f.error,error:'查詢條件不正確。'});
    f.since=await cohort();
    const map=await log.people(directory),r=await flagged(researchPool(),f,map);
    const base={ok:true,schemaVersion:1,generatedAt:new Date(t).toISOString(),days:f.days,labels};
    if(!r.available)return res.status(200).json({...base,available:false});
    return res.status(200).json({...base,available:true,items:r.items,limit:r.limit});
  };
}
function defaultResearch(){const research=require('./research-store.cjs');return research.mode()==='postgres'?research.getPool():null;}

module.exports=createChatLog();
Object.assign(module.exports,{createChatLog,createChatConcerns,concerns:createChatConcerns(),filters,counts,flagged,COUNTS,FLAGGED});
