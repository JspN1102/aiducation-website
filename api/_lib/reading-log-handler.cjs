'use strict';
// 朗讀測評次數 (teacher dashboard, jasper, molly and llp-pslau only): how many times each
// pupil had each line of each poem scored, and every attempt's score as Excel.
// Readings before the whole-cohort reset (2026-10-03) were staff tests and are left out.
const auth=require('./school-auth.cjs');
const log=require('./activity-log-handler.cjs');

const RANGES=new Set([1,7,30,400]),ATTEMPT_LIMIT=20000;
// Every scored reading of one pupil, numbered per line over all their readings
// (第 1 次 is their first ever), then narrowed to the chosen days.
const ATTEMPTS=(w,since)=>`SELECT poem,line,n,at,status,score FROM (
    SELECT poem_id AS poem,substring(record->'event'->>'itemId' from '[.]l([0-9]+)$')::int AS line,
      row_number() OVER (PARTITION BY poem_id,record->'event'->>'itemId' ORDER BY received_at,event_id)::int AS n,
      received_at,(extract(epoch FROM received_at)*1000)::float8 AS at,
      record->'event'->'result'->>'status' AS status,record->'event'->'result'->'score' AS score
    FROM research_events WHERE ${log.READ} AND research_id = $1${since?' AND received_at >= $2':''}) x
  WHERE ${w} ORDER BY poem,line,n LIMIT ${ATTEMPT_LIMIT+1}`;

// Only the range, grade, class and pupil are offered; nothing else is read.
function filters(query,t){
  const q=query||{},pick={};
  for(const key of ['days','grade','cls','student'])if(q[key]!==undefined)pick[key]=q[key];
  const f=log.filtersFrom(pick,t);
  if(!f.error&&!RANGES.has(f.days))return {error:'INVALID_DAYS'};
  return f;
}
const scoreOf=v=>typeof v==='number'&&Number.isFinite(v)?Math.round(v):null;
function attempts(pool,f){
  const params=[f.student],since=f.since?params.push(f.since):0;
  params.push(f.from,f.to);
  const w=`received_at >= $${params.length-1} AND received_at < $${params.length}`;
  return log.readOnly(pool,async q=>{
    const rows=await q(ATTEMPTS(w,since),params);
    return {attempts:rows.slice(0,ATTEMPT_LIMIT).map(r=>({poem:Number(r.poem),line:Number(r.line)+1,n:Number(r.n),at:Math.round(Number(r.at)),
      score:r.status==='error'?null:scoreOf(r.score),failed:r.status==='error'})).filter(a=>log.title(a.poem)&&Number.isInteger(a.line)),truncated:rows.length>ATTEMPT_LIMIT};
  });
}

const RANGE_LABEL={1:'今日',7:'近 7 日',30:'近 30 日',400:'全部'};
const hk=t=>new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t));
const classLabel=p=>[p.grade?p.grade+' 年級':'',p.cls?p.cls+' 班':'',p.classNo?p.classNo+' 號':''].filter(Boolean).join(' ');
// Sheet 1: one row per line, 第 1 次, 第 2 次 … across. Sheet 2: every attempt with its time.
async function workbook(person,list,f,generatedAt){
  const ExcelJS=require('exceljs'),wb=new ExcelJS.Workbook();
  wb.creator='AIDUCATION';wb.created=new Date(generatedAt);wb.title='朗讀測評分數';
  const info=`${person.name||'學生'}　${classLabel(person)}　${RANGE_LABEL[f.days]}（香港時間 ${hk(generatedAt)} 匯出）`;
  const font={name:'Microsoft JhengHei',size:11},head=row=>{row.font={...font,bold:true,color:{argb:'FFFFFFFF'}};row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF28665C'}};row.height=26;row.alignment={vertical:'middle',horizontal:'center'};};
  const lines=new Map();
  for(const a of list){const key=a.poem+'.'+a.line,l=lines.get(key)||{poem:a.poem,line:a.line,tries:[]};l.tries.push(a);lines.set(key,l);}
  const ordered=[...lines.values()].sort((a,b)=>a.poem-b.poem||a.line-b.line);
  const first=Math.min(...list.map(a=>a.n)),last=Math.max(...list.map(a=>a.n));
  const wide=wb.addWorksheet('每句分數',{properties:{defaultRowHeight:22}});
  wide.addRow([info]).font={...font,bold:true};
  const ordinals=list.length?Array.from({length:last-first+1},(_,i)=>first+i):[];
  head(wide.addRow(['古詩','句','句子','次數',...ordinals.map(n=>`第 ${n} 次`)]));
  for(const l of ordered){const by=new Map(l.tries.map(a=>[a.n,a]));
    const row=wide.addRow([log.title(l.poem),`第 ${l.line} 句`,log.lineText(l.poem,l.line-1)||'',l.tries.length,...ordinals.map(n=>{const a=by.get(n);return !a?null:a.failed?'未能評分':a.score;})]);
    row.font=font;row.alignment={vertical:'middle',horizontal:'center'};row.getCell(3).alignment={vertical:'middle',horizontal:'left'};}
  wide.columns.forEach((c,i)=>{c.width=i===0?12:i===1?8:i===2?20:i===3?7:9;});
  wide.views=[{state:'frozen',xSplit:4,ySplit:2}];
  if(!list.length)wide.addRow(['這段時間沒有朗讀測評。']);
  const each=wb.addWorksheet('每次明細',{properties:{defaultRowHeight:22}});
  each.addRow([info]).font={...font,bold:true};
  head(each.addRow(['古詩','句','句子','第幾次','時間（香港）','分數']));
  for(const l of ordered)for(const a of l.tries){const row=each.addRow([log.title(a.poem),`第 ${a.line} 句`,log.lineText(a.poem,a.line-1)||'',a.n,hk(a.at),a.failed?'未能評分':a.score]);row.font=font;}
  each.columns.forEach((c,i)=>{c.width=[12,8,20,8,20,8][i];});
  each.views=[{state:'frozen',ySplit:2}];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function createReadingLog({researchPool=defaultResearch,directory=()=>auth.directory(),cohort=log.cohortStart,now=Date.now}={}){
  return async function handler(req,res){
    res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie');
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,code:'GET_ONLY',error:'朗讀測評次數只供查看。'});}
    let actor;
    try{actor=await auth.requireActor(req,{roles:['teacher']});}
    catch(error){if(error instanceof auth.AuthError)return auth.sendError(res,error);throw error;}
    if(!actor)return res.status(503).json({ok:false,code:'AUTH_DISABLED',error:'朗讀測評次數需要學校帳戶服務。'});
    if(!auth.readingLog(actor))return res.status(403).json({ok:false,code:'READING_LOG_ONLY',error:'這個帳戶不能查看朗讀測評次數。'});
    const t=now(),f=filters(req.query,t),view=req.query?.view===undefined?'list':req.query.view;
    if(f.error)return res.status(400).json({ok:false,code:f.error,error:'查詢條件不正確。'});
    if(!['list','student','xlsx'].includes(view))return res.status(400).json({ok:false,code:'INVALID_VIEW',error:'查詢條件不正確。'});
    if(view!=='list'&&!f.student)return res.status(400).json({ok:false,code:'INVALID_FILTER',error:'請選擇學生。'});
    f.since=await cohort();
    const map=await log.people(directory),pool=researchPool();
    const base={ok:true,schemaVersion:1,generatedAt:new Date(t).toISOString(),days:f.days,filters:{days:f.days,grade:f.grade||null,cls:f.cls||null,student:f.student||null}};
    // Names, class and seat only: no login and no last-used time.
    const pupil=s=>({student:s.student,name:s.name,grade:s.grade,cls:s.cls,classNo:s.classNo,total:s.total,failed:s.failed});
    if(view==='list'){
      const r=await log.readings(pool,f,map);
      if(!r.available)return res.status(200).json({...base,available:false});
      return res.status(200).json({...base,available:true,readings:r.readings,truncated:r.truncated,
        students:r.students.map(s=>({...pupil(s),poems:s.poems.map(p=>({id:p.id,title:p.title,total:p.total}))}))});
    }
    if(view==='student'){
      const r=await log.readings(pool,f,map),s=r.students?.[0];
      if(!r.available)return res.status(200).json({...base,available:false});
      return res.status(200).json({...base,available:true,student:s?{...pupil(s),poems:s.poems.map(p=>({id:p.id,title:p.title,total:p.total,failed:p.failed,
        lines:p.lines.map(l=>({line:l.line,text:l.text,count:l.count,failed:l.failed}))}))}:log.identity(map,f.student)});
    }
    const r=await attempts(pool,f);
    if(!r.available)return res.status(503).json({ok:false,code:'READINGS_UNAVAILABLE',error:'暫時未能讀取朗讀紀錄，請再試一次。'});
    if(r.truncated)return res.status(413).json({ok:false,code:'TOO_MANY_READINGS',error:'紀錄太多，請縮短時間範圍。'});
    const person=log.identity(map,f.student),file=await workbook(person,r.attempts,f,t);
    const name=`朗讀測評分數_${person.grade||''}${person.cls||''}${person.classNo?'_'+person.classNo+'號':''}_${person.name||'學生'}.xlsx`.replace(/[\\/:*?"<>|\s]/g,'');
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename="reading-scores.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`);
    return res.status(200).send(file);
  };
}
function defaultResearch(){const research=require('./research-store.cjs');return research.mode()==='postgres'?research.getPool():null;}

module.exports=createReadingLog();
Object.assign(module.exports,{createReadingLog,filters,attempts,workbook,ATTEMPTS});
