'use strict';
// How each teacher uses the teacher dashboard: daily counts per account of
// logins, dashboard visits, data loads and generated files. Read by 網站後台.
// Recording never delays or fails the teacher's own request.
const auth=require('./school-auth.cjs');

const KINDS=['login','open','view','analysis','xlsx','docx','research_export'];
const VISIT_GAP_MS=30*60000;
const SCHEMA=`CREATE TABLE IF NOT EXISTS teacher_activity (
  day date NOT NULL, login varchar(64) NOT NULL, kind varchar(24) NOT NULL,
  display_name varchar(128) NOT NULL DEFAULT '', n integer NOT NULL DEFAULT 0 CHECK(n >= 0),
  last_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(day, login, kind)
)`;
const ready=new WeakMap(),lastView=new Map();

function defaultPool(){try{return auth.getStore()?.pool||null;}catch{return null;}}
function hkDay(t){return new Date(t+8*3600000).toISOString().slice(0,10);}
function schema(pool){
  if(!ready.has(pool))ready.set(pool,pool.query(SCHEMA).catch(error=>{ready.delete(pool);throw error;}));
  return ready.get(pool);
}
async function add(pool,actor,kinds,t){
  await schema(pool);
  for(const kind of kinds)await pool.query(`INSERT INTO teacher_activity(day,login,kind,display_name,n,last_at) VALUES($1,$2,$3,$4,1,$5)
    ON CONFLICT(day,login,kind) DO UPDATE SET n=teacher_activity.n+1,last_at=EXCLUDED.last_at,display_name=EXCLUDED.display_name`,
    [hkDay(t),actor.login,kind,String(actor.displayName||'').slice(0,128),new Date(t).toISOString()]);
}
function createActivity({pool=defaultPool,now=Date.now}={}){
  // A data load after 30 minutes without one also counts as a new visit to the dashboard.
  function record(actor,kind){
    try{
      if(actor?.role!=='teacher'||typeof actor.login!=='string'||!actor.login||actor.login.length>64||!KINDS.includes(kind))return Promise.resolve(false);
      const db=pool();if(!db)return Promise.resolve(false);
      const t=now(),kinds=[kind];
      if(kind==='view'){const key=actor.login,last=lastView.get(key);if(last===undefined||t-last>VISIT_GAP_MS)kinds.unshift('open');lastView.set(key,t);
        if(lastView.size>2000)for(const [k,v] of lastView)if(t-v>VISIT_GAP_MS)lastView.delete(k);}
      return add(db,actor,kinds,t).then(()=>true,()=>false);
    }catch{return Promise.resolve(false);}
  }
  // Per teacher over the last `days` Hong Kong days (today included), newest activity first.
  async function summary(days=30){
    const db=pool();if(!db)return {available:false,reason:'unconfigured'};
    const t=now(),from=hkDay(t-(days-1)*86400000);
    try{
      await schema(db);
      const {rows}=await db.query(`SELECT login,max(display_name) AS name,kind,sum(n)::int AS n,count(DISTINCT day)::int AS days,(extract(epoch FROM max(last_at))*1000)::float8 AS last
        FROM teacher_activity WHERE day >= $1::date GROUP BY login,kind`,[from]);
      const teachers=new Map();
      for(const row of rows){
        const into=teachers.get(row.login)||{login:row.login,name:row.name||row.login,counts:Object.fromEntries(KINDS.map(k=>[k,0])),activeDays:0,lastAt:null};
        if(KINDS.includes(row.kind))into.counts[row.kind]=Number(row.n)||0;
        if(row.kind==='view'||row.kind==='login')into.activeDays=Math.max(into.activeDays,Number(row.days)||0);
        const last=Number(row.last);if(Number.isFinite(last)&&(into.lastAt===null||last>into.lastAt))into.lastAt=Math.round(last);
        if(row.name)into.name=row.name;teachers.set(row.login,into);
      }
      return {available:true,from,days,teachers:[...teachers.values()].sort((a,b)=>(b.lastAt||0)-(a.lastAt||0))};
    }catch{return {available:false,reason:'unavailable'};}
  }
  return {record,summary};
}

module.exports=createActivity();
Object.assign(module.exports,{createActivity,KINDS,SCHEMA,hkDay});
