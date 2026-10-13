'use strict';
// 網站後台 → 使用紀錄 (site administrator only, loaded on request, never polled):
// what each pupil asked the poets and how each teacher used the dashboard.
// Chats carry the pupil's name, class, seat number and login so a conversation
// can be traced; nothing here is ever sent to an ordinary teacher.
const auth=require('./school-auth.cjs');
const {catalog}=require('./poems.js');

const DAY=86400000,RECENT_LIMIT=300,STUDENT_LIMIT=1000,CONVERSATION_LIMIT=3000,MAX_DAYS=400;
const RESEARCH_ID=/^r_[a-f0-9]{24}$/,DATE=/^\d{4}-\d{2}-\d{2}$/;
const CHAT=`source='server_verified' AND activity='chat' AND record->'event'->>'type'='provider_result' AND record->'event' ? 'chat'`;
// One server-scored line reading (朗讀測評), itemId p<poem>.l<line>.
const READ=`source='server_verified' AND activity='read' AND record->'event'->>'type'='provider_result' AND record->'event'->>'operation'='reading' AND record->'event'->>'itemId' ~ '^p[0-9]+[.]l[0-9]+$'`;
const READ_LIMIT=20000;
const MODES={typed:'自己打字',voice:'語音輸入',suggestion:'建議問題'};

const title=id=>catalog.find(poem=>poem.id===Number(id))?.title||null;
const lineText=(id,line)=>catalog.find(poem=>poem.id===Number(id))?.lines?.[line]?.text||null;
const text=(value,max)=>typeof value==='string'?value.slice(0,max):null;
const hkStart=t=>{const d=new Date(t+8*3600000);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-8*3600000;};
const dateStart=date=>Date.parse(date+'T00:00:00+08:00');

// Query string → filters, or null when something is out of range.
function filtersFrom(query,t){
  const q=query||{},one=key=>{const v=q[key];return v===undefined||v===''?undefined:String(v);};
  if(Object.values(q).some(Array.isArray))return {error:'INVALID_FILTER'};
  const f={};
  const days=one('days')===undefined?7:Number(one('days'));
  if(!Number.isInteger(days)||days<1||days>MAX_DAYS)return {error:'INVALID_DAYS'};
  f.days=days;let from=hkStart(t)-(days-1)*DAY,to=hkStart(t)+DAY;
  const fromDate=one('fromDate'),toDate=one('toDate');
  for(const d of [fromDate,toDate])if(d!==undefined&&(!DATE.test(d)||!Number.isFinite(dateStart(d))))return {error:'INVALID_DATE'};
  if(fromDate!==undefined)from=dateStart(fromDate);
  if(toDate!==undefined)to=dateStart(toDate)+DAY;
  if(to<=from||to-from>MAX_DAYS*DAY)return {error:'INVALID_DATE'};
  Object.assign(f,{from:new Date(from).toISOString(),to:new Date(to).toISOString(),fromDate:fromDate||null,toDate:toDate||null});
  const grade=one('grade'),cls=one('cls'),poem=one('poem'),student=one('student'),search=one('q');
  if(grade!==undefined){f.grade=Number(grade);if(!Number.isInteger(f.grade)||f.grade<1||f.grade>6)return {error:'INVALID_FILTER'};}
  if(cls!==undefined){if(!/^[A-Z]$/.test(cls))return {error:'INVALID_FILTER'};f.cls=cls;}
  if(poem!==undefined){f.poem=Number(poem);if(!title(f.poem))return {error:'INVALID_FILTER'};}
  if(student!==undefined){if(!RESEARCH_ID.test(student))return {error:'INVALID_FILTER'};f.student=student;}
  if(search!==undefined){const s=search.normalize('NFC').trim();if(s.length>50)return {error:'INVALID_FILTER'};if(s)f.q=s;}
  return f;
}
function where(f,kind=CHAT){
  const params=[f.from,f.to],clauses=['received_at >= $1','received_at < $2',kind];
  const add=(sql,value)=>{params.push(value);clauses.push(sql.replace('?','$'+params.length));};
  if(f.since)add('received_at >= ?',f.since);
  if(f.grade)add('grade = ?',f.grade);
  if(f.cls)add('cls = ?',f.cls);
  if(f.poem)add('poem_id = ?',f.poem);
  if(f.student)add('research_id = ?',f.student);
  if(f.q&&kind===CHAT){params.push('%'+f.q.replace(/[\\%_]/g,c=>'\\'+c)+'%');const n='$'+params.length;
    clauses.push(`(record->'event'->'chat'->>'question' ILIKE ${n} OR record->'event'->'chat'->>'reply' ILIKE ${n})`);}
  return {sql:clauses.join(' AND '),params};
}
const ROW=`(extract(epoch FROM received_at)*1000)::float8 AS at,research_id,poem_id AS poem,grade,cls,
      record->'event'->'chat' AS chat,record->'event'->'result'->>'status' AS status`;
const CHAT_SQL={
  totals:w=>`SELECT count(*)::int AS questions,count(DISTINCT research_id)::int AS pupils,
      count(*) FILTER (WHERE record->'event'->'chat' ? 'presetId')::int AS suggested,
      count(*) FILTER (WHERE record->'event'->'chat'->>'inputMode'='typed')::int AS typed,
      count(*) FILTER (WHERE record->'event'->'chat'->>'inputMode'='voice')::int AS voice
    FROM research_events WHERE ${w}`,
  top:w=>`SELECT poem_id AS poem,record->'event'->'chat'->>'question' AS question,bool_or(record->'event'->'chat' ? 'presetId') AS suggested,
      count(*)::int AS n,count(DISTINCT research_id)::int AS pupils
    FROM research_events WHERE ${w} GROUP BY 1,2 ORDER BY pupils DESC,n DESC LIMIT 20`,
  students:w=>`SELECT research_id,max(grade) AS grade,max(cls) AS cls,count(*)::int AS n,
      count(*) FILTER (WHERE record->'event'->'result'->>'status'='error')::int AS failed,
      (extract(epoch FROM min(received_at))*1000)::float8 AS first,(extract(epoch FROM max(received_at))*1000)::float8 AS last,
      array_agg(DISTINCT poem_id) AS poems
    FROM research_events WHERE ${w} GROUP BY research_id ORDER BY max(received_at) DESC LIMIT ${STUDENT_LIMIT}`,
  recent:w=>`SELECT ${ROW} FROM research_events WHERE ${w} ORDER BY received_at DESC LIMIT ${RECENT_LIMIT}`,
  conversation:w=>`SELECT ${ROW} FROM research_events WHERE ${w} ORDER BY received_at ASC LIMIT ${CONVERSATION_LIMIT}`,
  readings:w=>`SELECT research_id,max(grade) AS grade,max(cls) AS cls,poem_id AS poem,
      substring(record->'event'->>'itemId' from '[.]l([0-9]+)$')::int AS line,count(*)::int AS n,
      count(*) FILTER (WHERE record->'event'->'result'->>'status'='error')::int AS failed,
      (extract(epoch FROM max(received_at))*1000)::float8 AS last
    FROM research_events WHERE ${w} GROUP BY research_id,poem_id,5 ORDER BY research_id,poem_id,5 LIMIT ${READ_LIMIT}`,
  classes:()=>`SELECT DISTINCT grade,cls FROM research_events WHERE received_at >= '2026-10-10T00:00:00+08:00' AND ${CHAT} AND grade IS NOT NULL AND cls IS NOT NULL ORDER BY 1,2 LIMIT 200`
};

// researchId → who the pupil is, from the school account directory.
async function people(directory){
  try{const d=await directory();return new Map(d.accounts.filter(a=>a.role==='student').map(a=>[a.researchId,{name:a.displayName,login:a.login,grade:a.grade,cls:a.cls,classNo:a.classNo}]));}
  catch{return new Map();}
}
function identity(map,id,row){const p=map.get(id);
  return {student:id,name:p?.name||null,login:p?.login||null,grade:p?.grade??(Number(row?.grade)||null),cls:p?.cls??(typeof row?.cls==='string'?row.cls:null),classNo:p?.classNo??null};}
function chatRow(r,map){const chat=r.chat&&typeof r.chat==='object'?r.chat:{};
  return {at:Math.round(Number(r.at)),...identity(map,r.research_id,r),poemId:Number(r.poem)||null,poemTitle:title(r.poem),
    inputMode:Object.hasOwn(MODES,chat.inputMode)?chat.inputMode:chat.presetId?'suggestion':null,
    suggested:typeof chat.presetId==='string',presetId:typeof chat.presetId==='string'?chat.presetId:null,
    question:text(chat.question,1000),reply:text(chat.reply,4000),failed:r.status==='error'};}

// Everything before the whole-cohort reset (初始化, 2026-10-03) was staff testing
// on pupils' accounts; the teacher dashboard already starts there, and so do these.
async function cohortStart(){
  try{return (await require('./student-learning-reset.cjs').current())?.resetAt||null;}catch{return null;}
}
async function readOnly(pool,work){
  if(!pool)return {available:false,reason:'disabled'};
  let client;
  try{
    client=await pool.connect();
    await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout = '8s'");
    const value=await work((sql,params)=>client.query(sql,params).then(r=>r.rows));
    await client.query('COMMIT');return {available:true,...value};
  }catch(error){
    if(client)await client.query('ROLLBACK').catch(()=>{});
    return {available:false,reason:error?.code==='57014'?'timeout':'unavailable'};
  }finally{client?.release();}
}
function chatLog(pool,f,map=new Map()){
  const {sql,params}=where(f);
  return readOnly(pool,async q=>{
    const [totals,top,students,recent,classes]=[await q(CHAT_SQL.totals(sql),params),await q(CHAT_SQL.top(sql),params),
      await q(CHAT_SQL.students(sql),params),await q(CHAT_SQL.recent(sql),params),await q(CHAT_SQL.classes(),[])];
    const t=totals[0]||{};
    return {questions:Number(t.questions)||0,pupils:Number(t.pupils)||0,suggested:Number(t.suggested)||0,typed:Number(t.typed)||0,voice:Number(t.voice)||0,
      top:top.map(r=>({poemId:Number(r.poem)||null,poemTitle:title(r.poem),question:text(r.question,1000),suggested:r.suggested===true,count:Number(r.n)||0,pupils:Number(r.pupils)||0})),
      students:students.map(r=>({...identity(map,r.research_id,r),count:Number(r.n)||0,failed:Number(r.failed)||0,firstAt:Math.round(Number(r.first)),lastAt:Math.round(Number(r.last)),
        poems:(Array.isArray(r.poems)?r.poems:[]).map(Number).filter(title).sort((a,b)=>a-b).map(id=>({id,title:title(id)}))})),
      studentLimit:STUDENT_LIMIT,recent:recent.map(r=>chatRow(r,map)),limit:RECENT_LIMIT,
      classes:classes.map(r=>({grade:Number(r.grade),cls:r.cls})).filter(c=>c.grade>=1&&c.grade<=6&&/^[A-Z]$/.test(c.cls))};
  });
}
function conversation(pool,f,map=new Map()){
  const {sql,params}=where(f);
  return readOnly(pool,async q=>{const list=(await q(CHAT_SQL.conversation(sql),params)).map(r=>chatRow(r,map));
    return {student:identity(map,f.student,list[0]),conversation:list,limit:CONVERSATION_LIMIT};});
}

// Line readings per pupil → per poem → per line (each count is one scored reading).
function readings(pool,f,map=new Map()){
  const {sql,params}=where(f,READ);
  return readOnly(pool,async q=>{
    const rows=await q(CHAT_SQL.readings(sql),params),by=new Map();
    for(const r of rows){const poem=Number(r.poem),line=Number(r.line);if(!title(poem)||!Number.isInteger(line))continue;
      const s=by.get(r.research_id)||{...identity(map,r.research_id,r),total:0,failed:0,lastAt:0,poems:new Map()};
      const p=s.poems.get(poem)||{id:poem,title:title(poem),total:0,failed:0,lastAt:0,lines:[]};
      const n=Number(r.n)||0,failed=Number(r.failed)||0,last=Math.round(Number(r.last))||0;
      p.lines.push({line:line+1,text:lineText(poem,line),count:n,failed,lastAt:last});p.total+=n;p.failed+=failed;p.lastAt=Math.max(p.lastAt,last);
      s.total+=n;s.failed+=failed;s.lastAt=Math.max(s.lastAt,last);s.poems.set(poem,p);by.set(r.research_id,s);}
    const students=[...by.values()].map(s=>({...s,poems:[...s.poems.values()].sort((a,b)=>a.id-b.id).map(p=>({...p,lines:p.lines.sort((a,b)=>a.line-b.line)}))}))
      .sort((a,b)=>(a.grade||9)-(b.grade||9)||String(a.cls||'').localeCompare(String(b.cls||''))||(a.classNo||99)-(b.classNo||99)||b.total-a.total);
    return {students,readings:students.reduce((n,s)=>n+s.total,0),truncated:rows.length>=READ_LIMIT};
  });
}

function createActivityLog({researchPool=defaultResearch,activity=()=>require('./teacher-activity.cjs'),directory=()=>auth.directory(),cohort=cohortStart,now=Date.now}={}){
  return async function handler(req,res){
    res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie');
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,code:'GET_ONLY',error:'使用紀錄只供查看。'});}
    let actor;
    try{actor=await auth.requireActor(req,{roles:['teacher']});}
    catch(error){if(error instanceof auth.AuthError)return auth.sendError(res,error);throw error;}
    if(!actor)return res.status(503).json({ok:false,code:'AUTH_DISABLED',error:'使用紀錄需要學校帳戶服務。'});
    if(!auth.siteAdmin(actor))return res.status(403).json({ok:false,code:'SITE_ADMIN_ONLY',error:'只有網站管理員可以查看使用紀錄。'});
    const t=now(),f=filtersFrom(req.query,t);
    if(f.error)return res.status(400).json({ok:false,code:f.error,error:'查詢條件不正確。'});
    const view=req.query?.view===undefined?'list':req.query.view;
    if(!['list','student'].includes(view))return res.status(400).json({ok:false,code:'INVALID_VIEW',error:'查詢條件不正確。'});
    if(view==='student'&&!f.student)return res.status(400).json({ok:false,code:'INVALID_FILTER',error:'請選擇學生。'});
    const map=await people(directory),pool=researchPool();
    const filters={days:f.days,fromDate:f.fromDate,toDate:f.toDate,grade:f.grade||null,cls:f.cls||null,poem:f.poem||null,q:f.q||null,student:f.student||null};
    const base={ok:true,schemaVersion:2,generatedAt:new Date(t).toISOString(),days:f.days,from:f.from,to:f.to,filters};
    // 朗讀測評次數 moved to the teacher dashboard (reading-log-handler.cjs).
    f.since=await cohort();
    if(view==='student')return res.status(200).json({...base,...await conversation(pool,f,map)});
    const [chats,teachers]=await Promise.all([chatLog(pool,f,map),activity().summary(Math.min(f.days,MAX_DAYS))]);
    return res.status(200).json({...base,chats,teachers});
  };
}
function defaultResearch(){const research=require('./research-store.cjs');return research.mode()==='postgres'?research.getPool():null;}

module.exports=createActivityLog();
Object.assign(module.exports,{createActivityLog,chatLog,conversation,readings,filtersFrom,where,readOnly,people,identity,cohortStart,CHAT_SQL,MODES,CHAT,READ,title,lineText});
