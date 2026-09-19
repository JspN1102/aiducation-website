'use strict';
// This regression requires a disposable Unix-socket PostgreSQL database.
// It refuses production names and uses connection-local temporary tables.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
async function run({db,store,sync,exporter}={}){
  if(!db?.options?.host?.startsWith('/var/tmp/research-e2e-')||db.options.database!=='research_probe')throw new Error('ISOLATED_TIMEZONE_DATABASE_REQUIRED');
  const connection=await db.connect();let temporary=false,originalZone;
  const session={query:(...args)=>connection.query(...args),async connect(){return {query:(...args)=>connection.query(...args),release(){}};}};
  const cases=[];
  try{
    assert.equal((await connection.query('SELECT current_database() AS name')).rows[0].name,'research_probe');
    originalZone=(await connection.query('SHOW TimeZone')).rows[0].TimeZone;
    for(const table of ['research_events','research_sync_state','research_outbox_receipts'])await connection.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
    temporary=true;
    const days=['2026-03-08','2026-09-19','2026-11-01'];
    const actor={id:'s_timezone_synthetic_only',researchId:'r_timezone_synthetic_only',role:'student',grade:2,cls:'A'};
    for(const day of days){
      const midnight=Date.parse(day+'T00:00:00.000Z');
      for(const delta of [-1,0,43200000,86399999,86400000]){
        const at=midnight+delta;
        const event={eventId:randomUUID(),sessionId:randomUUID(),seq:0,activeMs:0,clientAt:new Date(at).toISOString(),poemId:2,activity:'read',type:'feedback_shown',itemId:'p2.l0',appVersion:'timezone-synthetic',contentVersion:'v1',result:{status:'completed',score:0}};
        const batch=store.validateBatch({schemaVersion:1,batchId:randomUUID(),actorId:actor.id,events:[event]},actor,at);
        await store.appendPostgres(batch,session);
      }
    }
    for(const zone of ['UTC','Asia/Shanghai','America/New_York']){
      await connection.query("SELECT set_config('TimeZone',$1,false)",[zone]);
      for(const day of days){
        const expected=[day+'T00:00:00.000Z',day+'T12:00:00.000Z',day+'T23:59:59.999Z'];
        const rows=await store.readPostgres({from:day,to:day,attempt:'latest'},session);
        assert.deepEqual(rows.map(row=>row.serverReceivedAt).sort(),expected,zone+' readPostgres '+day);
        const objects=new Map();
        const client={async put(name,body){objects.set(name,JSON.parse(body));return {pathname:name};}};
        const parts=await sync.publishDay(day,{db:session,client,deadline:Date.now()+10000});
        assert.equal(parts.reduce((count,part)=>count+part.count,0),3);
        assert.deepEqual([...objects.values()].flatMap(chunk=>chunk.events.map(row=>row.serverReceivedAt)).sort(),expected,zone+' publishDay '+day);
        const query=exporter.pageQuery({from:day,to:day},'0');
        const exported=(await connection.query(query.text,query.values)).rows;
        assert.deepEqual(exported.map(row=>row.record.serverReceivedAt).sort(),expected,zone+' export '+day);
        const legacy=(await connection.query("SELECT record FROM research_events WHERE received_at >= $1::date AND received_at < $1::date + interval '1 day' ORDER BY received_at",[day])).rows.map(row=>row.record.serverReceivedAt);
        cases.push({zone,day,expectedRows:3,readRows:rows.length,publishedRows:3,exportRows:exported.length,legacyBoundaryDiffers:JSON.stringify(legacy)!==JSON.stringify(expected)});
      }
    }
    assert.ok(cases.filter(value=>value.zone!=='UTC').every(value=>value.legacyBoundaryDiffers));
    return {ok:true,cases,casesPassed:cases.length,checkedOperations:['readPostgres','publishDay','pageQuery'],dstBoundaryDays:['2026-03-08','2026-11-01'],temporaryTablesOnly:true,productionDatabaseTouched:false};
  }finally{
    if(temporary)await connection.query('DROP TABLE pg_temp.research_events,pg_temp.research_sync_state,pg_temp.research_outbox_receipts');
    if(originalZone)await connection.query("SELECT set_config('TimeZone',$1,false)",[originalZone]);
    connection.release();
  }
}
module.exports={run};
