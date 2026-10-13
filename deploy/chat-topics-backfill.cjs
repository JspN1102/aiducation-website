'use strict';
// One-time: classify the AI 詩人 chats recorded before school62 (no chat_topics row yet).
// Run on the application server with its private env:
//   node --env-file=/private/app.env deploy/chat-topics-backfill.cjs            (dry run: counts only)
//   node --env-file=/private/app.env deploy/chat-topics-backfill.cjs --apply [--limit 500]
// --recheck-concerns: classify again only the questions flagged ⚠ (after the concern rules changed, school63).
// Prints counts only: never a question, a name or a key. Safe to run again (skips done rows).
const store=require('../api/_lib/research-store.cjs');
const topics=require('../api/_lib/chat-topics.cjs');
const {title,CHAT}=require('../api/_lib/activity-log-handler.cjs');

const PENDING=limit=>`SELECT e.event_id,e.poem_id AS poem,e.record->'event'->'chat'->>'question' AS question
  FROM research_events e WHERE ${CHAT} AND NOT EXISTS (SELECT 1 FROM chat_topics t WHERE t.event_id=e.event_id)
  ORDER BY e.received_at LIMIT ${limit}`;
const FLAGGED=limit=>`SELECT e.event_id,e.poem_id AS poem,e.record->'event'->'chat'->>'question' AS question
  FROM research_events e JOIN chat_topics t ON t.event_id=e.event_id WHERE ${CHAT} AND t.concern IS NOT NULL
  ORDER BY e.received_at LIMIT ${limit}`;
function parseArgs(argv){
  const args={apply:false,limit:2000,recheck:false};
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--apply')args.apply=true;
    else if(argv[i]==='--recheck-concerns')args.recheck=true;
    else if(argv[i]==='--limit'&&/^\d{1,5}$/.test(argv[i+1]||'')&&Number(argv[i+1])>0)args.limit=Number(argv[++i]);
    else throw new Error('USAGE: chat-topics-backfill.cjs [--apply] [--recheck-concerns] [--limit N]');
  }
  return args;
}
async function run({db,apply=false,limit=2000,recheck=false,classify=topics.classify,save=topics.save,emit=v=>console.log(JSON.stringify(v))}){
  await topics.schema(db);
  const rows=(await db.query((recheck?FLAGGED:PENDING)(limit))).rows,local=rows.filter(r=>topics.gibberish(r.question)).length;
  const distinct=new Set(rows.filter(r=>!topics.gibberish(r.question)).map(r=>(title(r.poem)||'')+'\n'+String(r.question||'').trim())).size;
  const summary={ok:true,apply,recheck,pending:rows.length,localInvalid:local,deepseekCalls:distinct,model:topics.modelName()};
  if(!apply){emit(summary);return summary;}
  const done={classified:0,failed:0,concern:0,byTopic:{}};
  for(const r of rows){
    const v=await classify(r.question,title(r.poem));
    if(!v){done.failed++;continue;}
    await save(db,r.event_id,v);done.classified++;done.byTopic[v.topic]=(done.byTopic[v.topic]||0)+1;if(v.concern)done.concern++;
  }
  const result={...summary,...done};emit(result);return result;
}
async function main(){
  const args=parseArgs(process.argv.slice(2));
  const {Pool}=require('pg'),db=new Pool({...store.pgConfig(),max:1,statement_timeout:60000,application_name:'maanshan-chat-topics-backfill'});
  try{await run({db,...args});}finally{await db.end();}
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({ok:false,error:'CHAT_TOPICS_BACKFILL_FAILED',detail:/^[A-Z_]+$/.test(error.message)?error.message:'database_or_provider_error'}));process.exitCode=1;});
module.exports={parseArgs,run,PENDING,FLAGGED};
