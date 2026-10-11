'use strict';
// 和詩人對話: at most DAILY_LIMIT questions per student per day. The day turns
// at 06:00 Hong Kong time, so the count is fresh before school.
// Counted in the auth database so a second device or a reload does not reset
// it. Teachers and test (demo) accounts are not limited. If the database is
// unreachable the question goes through: a missing count must never block a
// pupil. A question that receives no answer is given back.
const auth=require('./school-auth.cjs');

const DAILY_LIMIT=20;
const SCHEMA=`CREATE TABLE IF NOT EXISTS student_chat_daily (
  day date NOT NULL, actor_id varchar(128) NOT NULL,
  n integer NOT NULL DEFAULT 0 CHECK(n >= 0),
  last_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(day, actor_id)
)`;
const ready=new WeakMap();

function defaultPool(){try{return auth.getStore()?.pool||null;}catch{return null;}}
// Hong Kong is UTC+8 and the day starts at 06:00 there: shift by +2 hours.
function chatDay(t){return new Date(t+2*3600000).toISOString().slice(0,10);}
function schema(pool){
  if(!ready.has(pool))ready.set(pool,pool.query(SCHEMA).catch(error=>{ready.delete(pool);throw error;}));
  return ready.get(pool);
}

function createChatQuota({pool=defaultPool,now=Date.now,limit=DAILY_LIMIT}={}){
  // {limited:false} when not counted; otherwise {limited:true,allowed,remaining,refund()}.
  async function take(actor){
    if(!auth.researchEligible(actor)||typeof actor.id!=='string'||!actor.id||actor.id.length>128)return {limited:false};
    const db=pool();if(!db)return {limited:false};
    const day=chatDay(now());
    try{
      await schema(db);
      // Only increments below the limit, so concurrent questions cannot pass it.
      const {rows}=await db.query(`INSERT INTO student_chat_daily(day,actor_id,n,last_at) VALUES($1,$2,1,$3)
        ON CONFLICT(day,actor_id) DO UPDATE SET n=student_chat_daily.n+1,last_at=EXCLUDED.last_at WHERE student_chat_daily.n < $4
        RETURNING n`,[day,actor.id,new Date(now()).toISOString(),limit]);
      if(!rows.length)return {limited:true,allowed:false,remaining:0,limit,refund:async()=>{}};
      let given=false;
      return {limited:true,allowed:true,remaining:Math.max(0,limit-Number(rows[0].n)),limit,refund:async()=>{
        if(given)return;given=true;
        try{await db.query('UPDATE student_chat_daily SET n=n-1 WHERE day=$1 AND actor_id=$2 AND n > 0',[day,actor.id]);}catch{}
      }};
    }catch{return {limited:false};}
  }
  return {take};
}

module.exports=createChatQuota();
Object.assign(module.exports,{createChatQuota,DAILY_LIMIT,SCHEMA,chatDay});
