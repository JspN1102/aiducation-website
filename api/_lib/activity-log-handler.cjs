'use strict';
// 網站後台 → 使用紀錄 (site administrator only, loaded on request, never polled):
// what pupils asked the poets and how each teacher used the dashboard.
// Pupils appear only as a number within this reply, with grade and class; no
// names, logins or research IDs leave here.
const auth=require('./school-auth.cjs');
const {catalog}=require('./poems.js');

const DAY=86400000,RECENT_LIMIT=300;
const CHAT=`source='server_verified' AND activity='chat' AND record->'event'->>'type'='provider_result' AND record->'event' ? 'chat'`;
const CHAT_SQL={
  totals:`SELECT count(*)::int AS questions,count(DISTINCT research_id)::int AS pupils,
      count(*) FILTER (WHERE record->'event'->'chat' ? 'presetId')::int AS suggested,
      count(*) FILTER (WHERE record->'event'->'chat'->>'inputMode'='typed')::int AS typed,
      count(*) FILTER (WHERE record->'event'->'chat'->>'inputMode'='voice')::int AS voice
    FROM research_events WHERE received_at >= $1 AND ${CHAT}`,
  top:`SELECT poem_id AS poem,record->'event'->'chat'->>'question' AS question,bool_or(record->'event'->'chat' ? 'presetId') AS suggested,
      count(*)::int AS n,count(DISTINCT research_id)::int AS pupils
    FROM research_events WHERE received_at >= $1 AND ${CHAT} GROUP BY 1,2 ORDER BY pupils DESC,n DESC LIMIT 20`,
  recent:`SELECT (extract(epoch FROM received_at)*1000)::float8 AS at,research_id,poem_id AS poem,grade,cls,
      record->'event'->'chat' AS chat,record->'event'->'result'->>'status' AS status
    FROM research_events WHERE received_at >= $1 AND ${CHAT} ORDER BY received_at DESC LIMIT ${RECENT_LIMIT}`
};

function defaultResearch(){const research=require('./research-store.cjs');return research.mode()==='postgres'?research.getPool():null;}
const title=id=>catalog.find(poem=>poem.id===Number(id))?.title||null;
const text=(value,max)=>typeof value==='string'?value.slice(0,max):null;

async function chatLog(pool,from){
  if(!pool)return {available:false,reason:'disabled'};
  let client;
  try{
    client=await pool.connect();
    await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout = '6s'");
    const rows={};for(const [key,sql] of Object.entries(CHAT_SQL))rows[key]=(await client.query(sql,[from])).rows;
    await client.query('COMMIT');
    const t=rows.totals[0]||{},pupils=new Map();
    const pupil=id=>{if(!pupils.has(id))pupils.set(id,pupils.size+1);return pupils.get(id);};
    return {available:true,questions:Number(t.questions)||0,pupils:Number(t.pupils)||0,suggested:Number(t.suggested)||0,typed:Number(t.typed)||0,voice:Number(t.voice)||0,
      top:rows.top.map(r=>({poemId:Number(r.poem)||null,poemTitle:title(r.poem),question:text(r.question,1000),suggested:r.suggested===true,count:Number(r.n)||0,pupils:Number(r.pupils)||0})),
      recent:rows.recent.map(r=>{const chat=r.chat&&typeof r.chat==='object'?r.chat:{};return {at:Math.round(Number(r.at)),pupil:pupil(r.research_id),grade:Number(r.grade)||null,cls:typeof r.cls==='string'?r.cls:null,
        poemId:Number(r.poem)||null,poemTitle:title(r.poem),inputMode:['typed','voice','suggestion'].includes(chat.inputMode)?chat.inputMode:chat.presetId?'suggestion':null,
        suggested:typeof chat.presetId==='string',question:text(chat.question,1000),reply:text(chat.reply,4000),failed:r.status==='error'};}),
      limit:RECENT_LIMIT};
  }catch(error){
    if(client)await client.query('ROLLBACK').catch(()=>{});
    return {available:false,reason:error?.code==='57014'?'timeout':'unavailable'};
  }finally{client?.release();}
}

function createActivityLog({researchPool=defaultResearch,activity=()=>require('./teacher-activity.cjs'),now=Date.now}={}){
  return async function handler(req,res){
    res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie');
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,code:'GET_ONLY',error:'使用紀錄只供查看。'});}
    let actor;
    try{actor=await auth.requireActor(req,{roles:['teacher']});}
    catch(error){if(error instanceof auth.AuthError)return auth.sendError(res,error);throw error;}
    if(!actor)return res.status(503).json({ok:false,code:'AUTH_DISABLED',error:'使用紀錄需要學校帳戶服務。'});
    if(!auth.siteAdmin(actor))return res.status(403).json({ok:false,code:'SITE_ADMIN_ONLY',error:'只有網站管理員可以查看使用紀錄。'});
    const raw=req.query?.days,days=raw===undefined?7:Number(raw);
    if(!Number.isInteger(days)||days<1||days>30)return res.status(400).json({ok:false,code:'INVALID_DAYS',error:'天數須為 1 至 30。'});
    const t=now(),d=new Date(t+8*3600000),dayStart=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-8*3600000,from=new Date(dayStart-(days-1)*DAY).toISOString();
    const [chats,teachers]=await Promise.all([chatLog(researchPool(),from),activity().summary(days)]);
    return res.status(200).json({ok:true,schemaVersion:1,generatedAt:new Date(t).toISOString(),days,from,chats,teachers});
  };
}

module.exports=createActivityLog();
Object.assign(module.exports,{createActivityLog,chatLog,CHAT_SQL});
