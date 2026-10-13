'use strict';
// 網站後台: one GET for the site administrator with the health of the Guangzhou
// origin, the Hong Kong tunnels, the Vercel crons, the database and what pupils
// experienced recently. Aggregates only: no addresses, environment values,
// accounts, names, research IDs or upstream message text ever leave here.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),tls=require('node:tls');
const {execFile}=require('node:child_process');
const auth=require('./school-auth.cjs');
const ops=require('./ops-metrics.cjs');

const MINUTE=60000,HOUR=60*MINUTE,CACHE_MS=10000,STALE_MS=60000,HEARTBEAT_STALE_MS=3*MINUTE,STARTUP_GRACE_S=150;
const DAILY_MS=MINUTE,UPKEEP_MS=5*MINUTE,CERT_MS=10*MINUTE;
const MEMORY_LIMIT_MB=768,HK_RENEWAL='2026-11-07';
const SPEECH_LIMIT=4800; // MONTHLY_SITE_LIMIT in api/speech-to-text.js
// Scheduled upkeep on the origin: unit, label, and the longest normal gap
// between two runs (daily timers carry a random delay of up to 15 minutes).
const JOBS=[['maanshan-backup','每日備份',30*HOUR],['maanshan-health-check','健康檢查',45*MINUTE],['maanshan-health-restore','恢復演練',50*HOUR],['certbot','證書續期',36*HOUR]];
const CERTS=[['mandarin.aiducation.asia','學生平台證書'],['aiducation.hk.cn','展示版證書']];
const CLIENT_ERROR_LABELS={network:'網絡中斷',timeout:'等候超時',permission_denied:'未允許錄音',audio_unavailable:'無法播放或錄音',provider_unavailable:'評分服務不可用',
  invalid_response:'回覆不完整',storage_unavailable:'本機儲存不可用',unsupported:'裝置不支援',unknown:'其他',script:'頁面程式錯誤'};
const OPERATION_LABELS={reading:'朗讀評分',handwriting:'手寫',chat:'對話',report:'報告',challenge:'挑戰'};
const UNITS=[['maanshan','網站程式'],['nginx','網頁伺服器'],['postgresql@14-main','資料庫'],['maanshan-hk-tunnel','香港通道 3100'],
  ['maanshan-hk-tunnel@3101','香港通道 3101'],['maanshan-hk-tunnel@3102','香港通道 3102'],['maanshan-relay-2222','直連中轉 2222'],['maanshan-egress-shape','出口限速']];
const TUNNELS=[['maanshan-hk-tunnel',3100],['maanshan-hk-tunnel@3101',3101],['maanshan-hk-tunnel@3102',3102]];
const ROUTE_LABELS={soe:'朗讀評分','school-recordings':'錄音上傳',tts:'語音合成','maanshan-chat':'對話',handwriting:'手寫','speech-to-text':'語音輸入','maanshan-report':'報告',
  'school-auth':'登入','research-events':'學習紀錄','challenge-result':'挑戰結果','teacher-analytics':'教師數據','teacher-tools':'教師工具','maanshan-save':'存檔','maanshan-data':'讀檔'};
const ERROR_CODES=['network','timeout','permission_denied','audio_unavailable','provider_unavailable','invalid_response','storage_unavailable','unsupported','unknown'];
const OPERATIONS=['reading','handwriting','chat','report','challenge'];
const LATENCY_KINDS=[['reading','朗讀評分'],['report','朗讀報告'],['chat','對話']];
const STATE=/^[a-z][a-z-]{0,31}$/;

function withTimeout(promise,ms,onLate){
  let timer;
  const late=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('timeout'),{code:'PROBE_TIMEOUT'})),ms);});
  return Promise.race([promise,late]).finally(()=>clearTimeout(timer)).catch(error=>{
    if(error?.code==='PROBE_TIMEOUT'&&onLate)promise.then(onLate,()=>{});
    throw error;
  });
}

// One systemctl call, read over D-Bus without privileges; TZ=UTC so the
// timestamps parse exactly. Unknown units come back as LoadState=not-found.
function systemctl(units,properties){
  return new Promise((resolve,reject)=>execFile('systemctl',['show',...units,'--no-pager','--property='+properties],
    {timeout:2000,maxBuffer:64*1024,env:{PATH:'/usr/bin:/bin',TZ:'UTC',LANG:'C',SYSTEMD_COLORS:'0'},windowsHide:true},
    (error,stdout)=>error?reject(error):resolve(String(stdout))));
}
const systemctlShow=units=>systemctl(units.map(u=>u+'.service'),'Id,LoadState,ActiveState,SubState,NRestarts,ActiveEnterTimestamp');
// Each job's service (last result, when it finished) and its timer (last and next run).
const systemctlJobs=units=>systemctl(units.flatMap(u=>[u+'.service',u+'.timer']),'Id,LoadState,ActiveState,Result,ExecMainExitTimestamp,LastTriggerUSec,NextElapseUSecRealtime');
function blocks(text){
  return String(text).split(/\r?\n\s*\r?\n/).map(block=>{
    const fields={};
    for(const line of block.split(/\r?\n/)){const at=line.indexOf('=');if(at>0)fields[line.slice(0,at)]=line.slice(at+1).trim();}
    return fields;
  });
}
function stampOf(value){const m=/(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d) UTC/.exec(value||'');return m?Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]):null;}
const word=value=>STATE.test(value||'')?value:'unknown';
function parseUnits(text){
  const found={};
  for(const fields of blocks(text)){
    const id=/^(.+)\.service$/.exec(fields.Id||'')?.[1];
    if(!id)continue;
    const restarts=fields.NRestarts?Number(fields.NRestarts):NaN;
    found[id]={loadState:word(fields.LoadState),activeState:word(fields.ActiveState),subState:word(fields.SubState),
      restarts:Number.isInteger(restarts)&&restarts>=0?restarts:null,activeSince:stampOf(fields.ActiveEnterTimestamp)};
  }
  return found;
}
function parseJobs(text){
  const found={};
  for(const fields of blocks(text)){
    const m=/^(.+)\.(service|timer)$/.exec(fields.Id||'');
    if(!m)continue;
    const job=found[m[1]]||(found[m[1]]={loadState:'unknown',state:'unknown',result:'unknown',finishedAt:null,timer:'unknown',lastAt:null,nextAt:null});
    if(m[2]==='service')Object.assign(job,{loadState:word(fields.LoadState),state:word(fields.ActiveState),result:word(fields.Result),finishedAt:stampOf(fields.ExecMainExitTimestamp)});
    else Object.assign(job,{timer:fields.LoadState==='loaded'?word(fields.ActiveState):'missing',lastAt:stampOf(fields.LastTriggerUSec),nextAt:stampOf(fields.NextElapseUSecRealtime)});
  }
  return found;
}

// The certificate nginx serves for a host name on this machine: when it
// expires and whether it covers the name. Never leaves the loopback.
function certificateOf(host){
  return new Promise(resolve=>{
    let done=false;
    const finish=value=>{if(done)return;done=true;socket.destroy();resolve(value);};
    const socket=tls.connect({host:'127.0.0.1',port:443,servername:host,rejectUnauthorized:false,timeout:3000},()=>{
      const cert=socket.getPeerCertificate(),until=Date.parse(cert?.valid_to||'');
      finish(Number.isFinite(until)?{validTo:until,matches:!tls.checkServerIdentity(host,cert)}:null);
    });
    socket.on('error',()=>finish(null));socket.on('timeout',()=>finish(null));
  });
}

function releaseOf(dir){
  const m=/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z-([0-9a-f]{10})-[0-9a-f]{8}$/.exec(path.basename(String(dir||'')));
  return m?{commit:m[7].slice(0,7),builtAt:new Date(Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6])).toISOString()}:null;
}
function defaultRelease(){try{return releaseOf(fs.realpathSync(process.cwd()));}catch{return null;}}
async function defaultDisk(){const s=await fs.promises.statfs('/');return s.blocks>0?Math.round(s.bavail/s.blocks*1000)/10:null;}
function defaultAuthPool(){const store=auth.getStore();return store?.pool||null;}
function defaultResearch(){const research=require('./research-store.cjs');return research.mode()==='postgres'?research.getPool():null;}
const poolCounts=pool=>pool&&Number.isInteger(pool.totalCount)?{total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount}:null;

const STUDENT_SQL={
  active:`SELECT count(DISTINCT research_id) FILTER (WHERE received_at >= now() - interval '5 minutes')::int AS active5,
    count(DISTINCT research_id)::int AS active60 FROM research_events WHERE received_at >= now() - interval '60 minutes'`,
  // $1: how far back, as an interval ('60 minutes' or '24 hours').
  errors:`SELECT source='server_verified' AS server,record->'event'->'error'->>'code' AS code,
    CASE WHEN source='server_verified' THEN record->'event'->>'operation' END AS operation,count(*)::int AS n
    FROM research_events WHERE received_at >= now() - $1::interval
      AND record->'event'->'error'->>'code' IS NOT NULL AND record->'event'->'error'->>'code' <> 'aborted'
      AND (source='client' AND record->'event'->>'type'='error' OR source='server_verified' AND record->'event'->>'type'='provider_result')
    GROUP BY 1,2,3`,
  latency:`SELECT kind,count(*)::int AS n,percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS p50,percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) AS p95
    FROM (SELECT CASE WHEN activity='read' AND record->'event'->>'itemId' ~ '^p[0-9]+[.]l[0-9]+$' THEN 'reading'
        WHEN activity='read' AND record->'event'->>'itemId' ~ '^p[0-9]+[.]report$' THEN 'report' WHEN activity='chat' THEN 'chat' END AS kind,
        (record->'event'->'metrics'->>'latencyMs')::float8 AS ms
      FROM research_events WHERE received_at >= now() - $1::interval AND source='client' AND record->'event'->>'type'='feedback_shown'
        AND jsonb_typeof(record->'event'->'metrics'->'latencyMs')='number') x
    WHERE kind IS NOT NULL GROUP BY kind`,
  providers:`SELECT record->'event'->>'operation' AS operation,count(*)::int AS n,
    count(*) FILTER (WHERE coalesce(record->'event'->'error'->>'code','aborted')<>'aborted')::int AS failed
    FROM research_events WHERE received_at >= now() - $1::interval AND source='server_verified' AND record->'event'->>'type'='provider_result' GROUP BY 1`
};

// Errors, waiting times and outside services seen by pupils over one window,
// inside an open read-only transaction.
async function recentFigures(client,interval){
  const errors=(await client.query(STUDENT_SQL.errors,[interval])).rows;
  const latency=(await client.query(STUDENT_SQL.latency,[interval])).rows;
  const used=(await client.query(STUDENT_SQL.providers,[interval])).rows;
  const clientErrors={},providerErrors={},providers={};
  for(const row of errors){
    const code=ERROR_CODES.includes(row.code)?row.code:'unknown',n=Number(row.n)||0;
    if(!row.server){clientErrors[code]=(clientErrors[code]||0)+n;continue;}
    const operation=OPERATIONS.includes(row.operation)?row.operation:'other',key=operation+':'+code;
    const into=providerErrors[key]||(providerErrors[key]={operation,code,n:0});into.n+=n;
  }
  for(const row of used){const operation=OPERATION_LABELS[row.operation]?row.operation:'other',into=providers[operation]||(providers[operation]={operation,label:OPERATION_LABELS[operation]||'其他',count:0,failed:0});
    into.count+=Number(row.n)||0;into.failed+=Number(row.failed)||0;}
  const byKind=Object.fromEntries(latency.map(row=>[row.kind,row]));
  return {clientErrors,providerErrors:Object.values(providerErrors),providers:Object.values(providers).sort((a,b)=>b.count-a.count),
    latency:LATENCY_KINDS.map(([kind,label])=>{const row=byKind[kind];return {kind,label,count:Number(row?.n)||0,
      p50Ms:Number.isFinite(row?.p50)?Math.round(row.p50):null,p95Ms:Number.isFinite(row?.p95)?Math.round(row.p95):null};})};
}

// The last hour; the last 24 hours come with the daily figures (once a minute).
async function studentProbe(pool){
  if(!pool)return {available:false,reason:'disabled'};
  let client;
  try{
    client=await withTimeout(pool.connect(),2000,late=>late.release());
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '3s'");
    const active=(await client.query(STUDENT_SQL.active)).rows[0]||{};
    const recent=await recentFigures(client,'60 minutes');
    await client.query('COMMIT');
    return {available:true,active5:Number(active.active5)||0,active60:Number(active.active60)||0,...recent};
  }catch(error){
    if(client)await client.query('ROLLBACK').catch(()=>{});
    return {available:false,reason:error?.code==='42P01'?'missing':error?.code==='PROBE_TIMEOUT'||error?.code==='57014'?'timeout':'unavailable'};
  }finally{client?.release();}
}
async function dbProbe(pool,researchPool,clock){
  if(!pool)return {ok:false,reason:'unconfigured',pools:{auth:null,research:poolCounts(researchPool)}};
  const started=clock();
  try{await withTimeout(pool.query('SELECT 1'),2000);return {ok:true,latencyMs:Math.round(clock()-started),pools:{auth:poolCounts(pool),research:poolCounts(researchPool)}};}
  catch(error){return {ok:false,reason:error?.code==='PROBE_TIMEOUT'?'timeout':'unavailable',pools:{auth:poolCounts(pool),research:poolCounts(researchPool)}};}
}

// Hong Kong calendar day and month for "today" and "this month".
function hkCalendar(t){
  const d=new Date(t+8*HOUR),dayStart=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-8*HOUR;
  return {date:d.toISOString().slice(0,10),month:d.toISOString().slice(0,7),dayStart,monthStart:Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)-8*HOUR};
}
// $1 is the start of the Hong Kong day (of the month in `month`). Counts only.
const READ_LINE=`source='client' AND activity='read' AND record->'event'->>'type'='feedback_shown' AND record->'event'->>'itemId' ~ '^p[0-9]+[.]l[0-9]+$'`;
const DAILY_SQL={
  today:`SELECT GROUPING(grade)=1 AS total,grade,count(DISTINCT research_id)::int AS pupils,count(*) FILTER (WHERE ${READ_LINE})::int AS readings,
    count(*) FILTER (WHERE source='client' AND activity='chat' AND record->'event'->>'type'='feedback_shown')::int AS chats,count(*)::int AS events
    FROM research_events WHERE received_at >= $1 GROUP BY ROLLUP(grade)`,
  peak:`SELECT floor(extract(epoch FROM received_at)/300)::bigint*300 AS slot,count(DISTINCT research_id)::int AS pupils
    FROM research_events WHERE received_at >= $1 GROUP BY 1 ORDER BY pupils DESC,slot DESC LIMIT 1`,
  week:`SELECT day,count(DISTINCT research_id)::int AS pupils FROM (SELECT floor(extract(epoch FROM received_at-$1::timestamptz)/86400)::int AS day,research_id
    FROM research_events WHERE received_at >= $1::timestamptz-interval '6 days') x GROUP BY ROLLUP(day)`,
  // Per label (page-script errors, itemId client.*, apart): events, pupils and the most from one pupil; the total row counts pupils once.
  clients:`SELECT GROUPING(code)=1 AS total,code,sum(n)::int AS n,count(DISTINCT research_id)::int AS pupils,max(n)::int AS top
    FROM (SELECT CASE WHEN record->'event'->>'itemId' LIKE 'client.%' THEN 'script' WHEN record->'event'->'error'->>'code' IN (${ERROR_CODES.map(c=>`'${c}'`).join(',')})
        THEN record->'event'->'error'->>'code' ELSE 'unknown' END AS code,research_id,count(*)::int AS n FROM research_events
      WHERE received_at >= $1 AND source='client' AND record->'event'->>'type'='error' AND coalesce(record->'event'->'error'->>'code','')<>'aborted' GROUP BY 1,2) x
    GROUP BY ROLLUP(code)`,
  month:`SELECT count(*)::int AS readings FROM research_events WHERE received_at >= $1 AND source='server_verified' AND record->'event'->>'type'='provider_result'
    AND record->'event'->>'operation'='reading' AND record->'event'->'error' IS NULL`,
  last:`SELECT (extract(epoch FROM max(received_at))*1000)::float8 AS at FROM research_events`
};
const USAGE_SQL={size:`SELECT (pg_database_size(current_database())/1048576)::int AS mb`,speech:`SELECT used FROM speech_input_usage WHERE actor_id='*site' AND month=$1`};

async function dailyProbe(pool,t){
  if(!pool)return {available:false,reason:'disabled'};
  const cal=hkCalendar(t),params=[new Date(cal.dayStart).toISOString(),new Date(cal.monthStart).toISOString()];
  let client;
  try{
    client=await withTimeout(pool.connect(),2000,late=>late.release());
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '4s'");
    const rows={};
    for(const [key,sql] of Object.entries(DAILY_SQL))rows[key]=(await client.query(sql,key==='month'?[params[1]]:sql.includes('$1')?[params[0]]:[])).rows;
    // 學生端問題 can also be read over 3 days: today and the two days before (Hong Kong).
    rows.clients3=(await client.query(DAILY_SQL.clients,[new Date(cal.dayStart-2*24*HOUR).toISOString()])).rows;
    const last24=await recentFigures(client,'24 hours');
    await client.query('COMMIT');
    const total=rows.today.find(r=>r.total)||{},peak=rows.peak[0],weekTotal=rows.week.find(r=>r.day===null);
    const days=Array.from({length:7},(_,i)=>{const day=i-6,row=rows.week.find(r=>r.day===day);return {date:hkCalendar(cal.dayStart+day*24*HOUR).date,pupils:Number(row?.pupils)||0};});
    const clientSummary=list=>{const clients={};
    for(const row of list.filter(r=>!r.total)){const code=Object.hasOwn(CLIENT_ERROR_LABELS,row.code)?row.code:'unknown',into=clients[code]||(clients[code]={code,label:CLIENT_ERROR_LABELS[code],count:0,pupils:0,top:0});
      into.count+=Number(row.n)||0;into.pupils+=Number(row.pupils)||0;into.top=Math.max(into.top,Number(row.top)||0);}
    // topPupil: one pupil's events when they are half or more of the label's (and 5 or more); a count only.
    return Object.values(clients).map(({top,...e})=>({...e,topPupil:top>=5&&top*2>=e.count&&e.pupils>1?top:null})).sort((a,b)=>b.pupils-a.pupils||b.count-a.count);};
    const clientErrors=clientSummary(rows.clients);
    const last=Number(rows.last[0]?.at);
    return {available:true,date:cal.date,pupils:Number(total.pupils)||0,readings:Number(total.readings)||0,chats:Number(total.chats)||0,events:Number(total.events)||0,
      byGrade:rows.today.filter(r=>!r.total&&Number.isInteger(r.grade)&&r.grade>=1&&r.grade<=6).sort((a,b)=>a.grade-b.grade).map(r=>({grade:r.grade,pupils:Number(r.pupils)||0,readings:Number(r.readings)||0,chats:Number(r.chats)||0})),
      peak:peak&&Number(peak.pupils)>0?{pupils:Number(peak.pupils),at:Number(peak.slot)*1000}:null,
      week:{days,pupils:Number(weekTotal?.pupils)||0},
      last24,clientErrors,clientErrorPupils:Number(rows.clients.find(r=>r.total)?.pupils)||0,
      clientErrors3:clientSummary(rows.clients3),clientErrorPupils3:Number(rows.clients3.find(r=>r.total)?.pupils)||0,
      monthReadings:Number(rows.month[0]?.readings)||0,lastRecordAt:Number.isFinite(last)&&last>0?Math.round(last):null};
  }catch(error){
    if(client)await client.query('ROLLBACK').catch(()=>{});
    return {available:false,reason:error?.code==='42P01'?'missing':error?.code==='PROBE_TIMEOUT'||error?.code==='57014'?'timeout':'unavailable'};
  }finally{client?.release();}
}
async function usageProbe(pool,t){
  if(!pool)return {available:false,reason:'unconfigured'};
  const {month}=hkCalendar(t);
  try{
    const size=await withTimeout(pool.query(USAGE_SQL.size),2000);
    // No table yet means nothing has been used.
    const speech=await withTimeout(pool.query(USAGE_SQL.speech,[month]),2000).catch(error=>{if(error?.code==='42P01')return {rows:[]};throw error;});
    return {available:true,dbMB:Number(size.rows[0]?.mb)||0,speech:{month,used:Number(speech.rows[0]?.used)||0,limit:SPEECH_LIMIT}};
  }catch(error){return {available:false,reason:error?.code==='PROBE_TIMEOUT'?'timeout':'unavailable'};}
}

function rate(ok,total){const r=ok/total*100;return r===100?100:Math.floor(r*10)/10;}
function level(...levels){return levels.includes('bad')?'bad':levels.includes('warn')?'warn':'ok';}
function ago(ms){const s=Math.max(0,Math.round(ms/1000));return s<90?s+' 秒':s<5400?Math.round(s/60)+' 分鐘':Math.round(s/3600)+' 小時';}
function upFor(seconds){return seconds<3600?Math.max(1,Math.round(seconds/60))+' 分鐘':seconds<172800?Math.round(seconds/3600)+' 小時':Math.round(seconds/86400)+' 天';}

function judge(p,now){
  const fresh=p.origin.uptimeS<STARTUP_GRACE_S,stale=at=>!fresh&&(!at||now-at>HEARTBEAT_STALE_MS);
  const units=p.origin.unitsAvailable?Object.fromEntries(p.origin.units.map(u=>[u.unit,u])):null,active=name=>units?.[name]?.activeState==='active';
  const sections={};
  { // 廣州伺服器
    const rss=p.origin.rssMB/MEMORY_LIMIT_MB,disk=p.origin.diskFreePct,loop=p.origin.eventLoopP99Ms;
    const down=units?['maanshan','nginx'].filter(u=>!active(u)).map(u=>UNITS.find(x=>x[0]===u)[1]):[];
    if(rss>0.9)sections.server={level:'bad',text:'程式內存接近上限（'+Math.round(rss*100)+'%），可能被系統重啟。'};
    else if(disk!==null&&disk<5)sections.server={level:'bad',text:'伺服器空間幾乎已滿（只剩 '+disk+'%）。'};
    else if(down.length)sections.server={level:'bad',text:down.join('、')+' 沒有運行。'};
    else if(disk!==null&&disk<15)sections.server={level:'warn',text:'伺服器剩餘空間不多（'+disk+'%）。'};
    else if(rss>0.8)sections.server={level:'warn',text:'程式內存偏高（'+Math.round(rss*100)+'%）。'};
    else if(loop!==null&&loop>500)sections.server={level:'warn',text:'程式間歇卡頓（最慢 '+Math.round(loop)+' 毫秒）。'};
    else sections.server={level:'ok',text:'運行正常，已連續運行 '+upFor(p.origin.uptimeS)+'。'};
  }
  { // 香港中轉
    const down=p.hk.tunnels.filter(t=>t.state!=='active'&&t.state!=='unknown'),hkStale=stale(p.hk.lastHeartbeatAt),ratio=p.hk.hop15.ratio,days=p.hk.renewal.daysLeft;
    const allDown=p.hk.unitsAvailable&&down.length===p.hk.tunnels.length;
    if(allDown&&hkStale)sections.hk={level:'bad',text:'三條香港通道全部中斷，學生改走美國備用線路（較慢）。'};
    else if(allDown)sections.hk={level:'warn',text:'三條香港通道都中斷，新請求會繞道美國。'};
    else if(down.length)sections.hk={level:'warn',text:'香港通道 '+down.map(t=>t.port).join('、')+' 中斷，其餘通道照常。'};
    else if(!p.hk.unitsAvailable&&hkStale)sections.hk={level:'warn',text:'超過 3 分鐘未收到經香港的請求。'};
    else if(ratio!==null&&p.hk.hop15.total>=10&&ratio>0.2)sections.hk={level:'warn',text:'近 15 分鐘有 '+Math.round(ratio*100)+'% 請求繞道美國。'};
    else if(days!==null&&days<7)sections.hk={level:'warn',text:'香港伺服器 '+days+' 天後到期，請續期。'};
    else sections.hk={level:'ok',text:'三條通道正常'+(p.hk.lastHeartbeatAt?'，'+ago(now-p.hk.lastHeartbeatAt)+'前有請求經過':'')+'。'};
  }
  { // Vercel
    const late=[['hkg1','香港節點'],['iad1','美國節點']].filter(([k])=>stale(p.vercel[k].lastAt)).map(([,label])=>label);
    sections.vercel=late.length?{level:'bad',text:late.join('、')+'超過 3 分鐘沒有定時檢查到達。'}
      :{level:'ok',text:fresh&&(!p.vercel.hkg1.lastAt||!p.vercel.iad1.lastAt)?'伺服器剛重啟，等待第一次定時檢查。':'香港及美國節點每分鐘定時檢查正常。'};
  }
  { // 資料庫
    const pg=units?active('postgresql@14-main'):true;
    if(!p.db.ok||!pg)sections.db={level:'bad',text:p.db.reason==='unconfigured'?'未設定資料庫。':'資料庫沒有回應，登入和存檔會失敗。'};
    else if(p.db.latencyMs>500||p.db.pools.auth?.waiting>0)sections.db={level:'warn',text:'資料庫回應較慢（'+p.db.latencyMs+' 毫秒）。'};
    else sections.db={level:'ok',text:'回應正常（'+p.db.latencyMs+' 毫秒）。'};
  }
  { // 學生使用（回應時間）
    const routes=p.traffic[60]?.routes||[],soe=routes.find(r=>r.route==='soe'),used=routes.some(r=>r.count>0);
    if(soe?.count>=5&&soe.p95Ms>8000)sections.latency={level:'warn',text:'近 1 小時朗讀評分偏慢，最慢一成要 '+Math.round(soe.p95Ms/100)/10+' 秒以上。'};
    else sections.latency={level:'ok',text:used?'近 1 小時使用順暢。':'近 1 小時沒有學生使用。'};
  }
  { // 近期報錯
    const OPS={reading:'朗讀評分',handwriting:'手寫',chat:'對話',report:'報告',challenge:'挑戰'};
    const failed=(p.students.available?p.students.providerErrors:[]).filter(e=>['timeout','provider_unavailable'].includes(e.code));
    const worst=Object.entries(failed.reduce((a,e)=>(a[e.operation]=(a[e.operation]||0)+e.n,a),{})).sort((a,b)=>b[1]-a[1])[0];
    const provider={n:failed.reduce((n,e)=>n+e.n,0),label:worst?OPS[worst[0]]||'外部':'外部'};
    const t5=p.traffic[5].totals,t60=p.traffic[60]?.totals||{s5xx:0,s504:0,s408:0},client=p.students.available?['network','timeout'].reduce((n,c)=>n+(p.students.clientErrors[c]||0),0):0;
    if(t5.s5xx>=5&&t5.s5xx/Math.max(1,t5.count)>0.05)sections.errors={level:'bad',text:'近 5 分鐘有 '+t5.s5xx+' 個伺服器錯誤（'+Math.round(t5.s5xx/Math.max(1,t5.count)*100)+'%）。'};
    else if(client>=10)sections.errors={level:'warn',text:'近 1 小時學生端有 '+client+' 次網絡中斷或超時。'};
    else if(provider.n>=10)sections.errors={level:'warn',text:'近 1 小時'+provider.label+'服務失敗 '+provider.n+' 次。'};
    else if(t60.s504+t60.s408>=10)sections.errors={level:'warn',text:'近 1 小時有 '+(t60.s504+t60.s408)+' 個請求超時。'};
    else sections.errors={level:'ok',text:t60.s5xx?'近 1 小時有零星錯誤（'+t60.s5xx+' 個），不影響使用。':'近 1 小時沒有伺服器錯誤。'};
  }
  { // 外部服務（近 1 小時，所有帳戶）及本月額度
    const routes=(p.traffic[60]?.routes||[]).map(r=>({...r,failed:r.s5xx+r.s408})),speech=p.usage?.available?p.usage.speech:null;
    const worst=routes.filter(r=>r.failed>=5&&r.failed/r.count>0.1).sort((a,b)=>b.failed/b.count-a.failed/a.count)[0];
    const total=routes.reduce((n,r)=>n+r.count,0),failed=routes.reduce((n,r)=>n+r.failed,0);
    if(worst)sections.services={level:'warn',text:'近 1 小時'+worst.label+'失敗 '+worst.failed+' 次（'+Math.round(worst.failed/worst.count*100)+'%）。'};
    else if(speech&&speech.used>=speech.limit)sections.services={level:'warn',text:'本月語音輸入額度已用完，學生暫時不能用語音輸入。'};
    else if(speech&&speech.used>=speech.limit*0.9)sections.services={level:'warn',text:'本月語音輸入已用 '+speech.used+' / '+speech.limit+' 次，快用完了。'};
    else sections.services={level:'ok',text:total?'近 1 小時成功率 '+rate(total-failed,total)+'%。':'近 1 小時沒有人使用外部服務。'};
  }
  { // 維護與備份
    const u=p.upkeep,bad=[],warn=[];
    if(u?.available){
      for(const job of u.jobs){
        if(job.loadState!=='loaded')continue;
        const into=job.unit==='maanshan-backup'?bad:warn;
        if(job.result!=='success'&&job.result!=='unknown')into.push(job.label+'上次失敗');
        else if(!job.lastAt||now-job.lastAt>job.maxGapS*1000)into.push(job.label+(job.lastAt?'已 '+ago(now-job.lastAt)+'沒有運行':'從未運行'));
        else if(job.timer!=='active')warn.push(job.label+'的排程已停止');
      }
    }
    for(const cert of u?.certs||[]){
      if(cert.daysLeft===null)continue;
      if(!cert.matches||cert.daysLeft<7)bad.push(cert.label+(cert.matches?' '+cert.daysLeft+' 天後到期':'與網址不符'));
      else if(cert.daysLeft<20)warn.push(cert.label+' '+cert.daysLeft+' 天後到期，自動續期可能失敗');
    }
    const days=(u?.certs||[]).map(c=>c.daysLeft).filter(d=>d!==null);
    if(bad.length)sections.upkeep={level:'bad',text:bad.concat(warn).join('，')+'。'};
    else if(warn.length)sections.upkeep={level:'warn',text:warn.join('，')+'。'};
    else if(!u?.available)sections.upkeep={level:'unknown',text:'未能讀取排程狀態。'};
    else sections.upkeep={level:'ok',text:'備份、健康檢查、恢復演練都正常'+(days.length?'，證書還有 '+Math.min(...days)+' 天':'')+'。'};
  }
  { // 資料（不影響整體判斷）：今日、近 7 日、近 60 分鐘、學生端問題
    const d=p.today,unread={level:'unknown',text:'未能讀取學習紀錄。'};
    sections.today=!d?.available?unread:{level:'info',text:d.pupils?'今天有 '+d.pupils+' 位學生用過，朗讀 '+d.readings+' 句。':'今天還沒有學生使用。'};
    sections.week=!d?.available?unread:{level:'info',text:'7 日內共 '+d.week.pupils+' 位學生用過。'};
    const series=p.traffic.series||[],count=series.reduce((n,m)=>n+m.count,0),failed=series.reduce((n,m)=>n+m.failed,0),busiest=Math.max(0,...series.map(m=>m.count));
    sections.trend={level:'info',text:count?'共 '+count+' 個請求'+(failed?'，'+failed+' 個出錯':'')+'，最忙一分鐘 '+busiest+' 個。':fresh?'伺服器剛重啟，正在重新統計。':'近 60 分鐘沒有請求。'};
    const total=d?.available?d.clientErrors.reduce((n,e)=>n+e.count,0):0,who=d?.clientErrorPupils;
    sections.clients=!d?.available?unread:{level:'info',text:total?(who>0?'今天有 '+who+' 位學生遇到問題，共 '+total+' 次，最多學生遇到「':'今天共 '+total+' 次，最多是「')+d.clientErrors[0].label+'」。':'今天學生裝置沒有回報問題。'};
    const total3=d?.available&&d.clientErrors3?d.clientErrors3.reduce((n,e)=>n+e.count,0):0,who3=d?.clientErrorPupils3;
    sections.clients3=!d?.available||!d.clientErrors3?unread:{level:'info',text:total3?(who3>0?'3 日內有 '+who3+' 位學生遇到問題，共 '+total3+' 次，最多學生遇到「':'3 日內共 '+total3+' 次，最多是「')+d.clientErrors3[0].label+'」。':'3 日內學生裝置沒有回報問題。'};
  }
  const overall=level(...Object.values(sections).map(s=>s.level));
  const NAMES={server:'廣州伺服器',hk:'香港中轉',vercel:'Vercel',db:'資料庫',latency:'學生使用',errors:'近期報錯',services:'外部服務',upkeep:'維護與備份'};
  const flagged=Object.entries(sections).filter(([,s])=>s.level===overall).map(([k])=>NAMES[k]);
  return {level:overall,text:overall==='ok'?'全部正常。':(overall==='bad'?'有問題：':'需要留意：')+flagged.join('、')+'。',sections};
}

function createSiteMonitor({now=Date.now,clock=()=>performance.now(),uptime=()=>process.uptime(),memory=()=>process.memoryUsage(),
  loadavg=()=>os.loadavg(),system=()=>({cpus:os.cpus().length,totalMB:Math.round(os.totalmem()/1048576),availableMB:Math.round(os.freemem()/1048576)}),
  release=defaultRelease,disk=defaultDisk,systemctl=systemctlShow,jobs=systemctlJobs,certificate=certificateOf,authPool=defaultAuthPool,researchPool=defaultResearch,metrics=ops}={}){
  const cache=new Map();
  // Slow probes are shared for 10 s (daily figures for a minute, schedules and
  // certificates for longer); an older answer is returned at once while a
  // single refresh runs in the background.
  function cached(key,load,ttl=CACHE_MS){
    const entry=cache.get(key),t=now();
    if(entry?.value&&t-entry.at<ttl)return entry.value;
    if(!entry?.pending){
      const pending=Promise.resolve().then(load).then(value=>{cache.set(key,{value,at:now()});return value;},error=>{cache.set(key,{...cache.get(key),pending:null});throw error;});
      cache.set(key,{...entry,pending});pending.catch(()=>{});
    }
    const current=cache.get(key);
    return current.value&&t-current.at<ttl+STALE_MS-CACHE_MS?current.value:current.pending;
  }
  // The research pool also takes pupils' uploads: the monitor holds at most
  // one of its connections at a time.
  let queue=Promise.resolve();
  function serial(task){const run=queue.then(task,task);queue=run.catch(()=>{});return run;}
  async function host(){
    const [units,diskFreePct]=await Promise.all([systemctl(UNITS.map(u=>u[0])).then(text=>{const units=parseUnits(text);return Object.keys(units).length?units:null;}).catch(()=>null),Promise.resolve().then(disk).catch(()=>null)]);
    return {units,diskFreePct:Number.isFinite(diskFreePct)?diskFreePct:null,checkedAt:now()};
  }
  async function database(){
    let pool=null,rPool=null;
    try{pool=authPool();}catch{}
    try{rPool=researchPool();}catch{}
    const [db,students]=await Promise.all([dbProbe(pool,rPool,clock),withTimeout(serial(()=>studentProbe(rPool)),4000).catch(()=>({available:false,reason:'timeout'}))]);
    return {db:{...db,checkedAt:now()},students:{...students,checkedAt:now()}};
  }
  async function daily(){
    let pool=null,rPool=null;
    try{pool=authPool();}catch{}
    try{rPool=researchPool();}catch{}
    const t=now(),[today,usage]=await Promise.all([withTimeout(serial(()=>dailyProbe(rPool,t)),8000).catch(()=>({available:false,reason:'timeout'})),
      withTimeout(usageProbe(pool,t),5000).catch(()=>({available:false,reason:'timeout'}))]);
    return {today:{...today,checkedAt:now()},usage:{...usage,checkedAt:now()}};
  }
  async function upkeep(){
    const found=await withTimeout(Promise.resolve().then(()=>jobs(JOBS.map(j=>j[0]))),4000).then(parseJobs).catch(()=>null);
    const available=!!found&&Object.keys(found).length>0;
    return {available,jobs:JOBS.map(([unit,label,gap])=>{const j=available?found[unit]:null;
      return {unit,label,loadState:j?.loadState||'unknown',running:j?.state==='activating',result:j?.result||'unknown',lastAt:j?.lastAt??j?.finishedAt??null,
        finishedAt:j?.finishedAt??null,nextAt:j?.nextAt??null,timer:j?.timer||'unknown',maxGapS:gap/1000};}),checkedAt:now()};
  }
  async function certificates(){
    const t=now();
    return Promise.all(CERTS.map(async([host,label])=>{const cert=await withTimeout(Promise.resolve().then(()=>certificate(host)),5000).catch(()=>null);
      return {host,label,daysLeft:cert?Math.floor((cert.validTo-t)/86400000):null,matches:cert?cert.matches===true:null,validTo:cert?new Date(cert.validTo).toISOString():null};}));
  }
  async function collect(){
    const t=now(),[hostInfo,data,day,jobInfo,certs]=await Promise.all([cached('host',host),cached('db',database),cached('daily',daily,DAILY_MS),cached('upkeep',upkeep,UPKEEP_MS),cached('certs',certificates,CERT_MS)]);
    const snap=metrics.snapshot(t),mem=memory();
    const uptimeS=Math.round(uptime()),sys=system();
    const units=hostInfo.units?UNITS.map(([unit,label])=>({unit,label,...(hostInfo.units[unit]||{loadState:'not-found',activeState:'unknown',subState:'unknown',restarts:null,activeSince:null})})):[];
    const origin={uptimeS,release:release(),rssMB:Math.round(mem.rss/1048576),heapMB:Math.round(mem.heapUsed/1048576),memoryLimitMB:MEMORY_LIMIT_MB,
      loadavg:loadavg().map(v=>Math.round(v*100)/100),cpus:sys.cpus,memory:{totalMB:sys.totalMB,availableMB:sys.availableMB},diskFreePct:hostInfo.diskFreePct,
      eventLoopP99Ms:snap.eventLoop?Math.round(snap.eventLoop.p99Ms):null,unitsAvailable:!!hostInfo.units,units,checkedAt:hostInfo.checkedAt};
    const lastHk=Math.max(0,...Object.values(snap.ports).filter(Number.isFinite))||null,w15=snap.windows[15];
    const renewal=Date.parse(HK_RENEWAL+'T00:00:00+08:00');
    const hk={unitsAvailable:!!hostInfo.units,tunnels:TUNNELS.map(([unit,port])=>{const u=hostInfo.units?.[unit];
        return {port,state:!hostInfo.units?'unknown':u?.activeState==='active'?'active':u?.loadState==='not-found'||!u?'missing':u.activeState,
          upSinceS:u?.activeState==='active'&&u.activeSince?Math.max(0,Math.round((t-u.activeSince)/1000)):null,restarts:u?.restarts??null,lastSeenAt:snap.ports[port]||null};}),
      lastHeartbeatAt:lastHk,hop15:{hop:w15.hop,total:w15.hk+w15.hop,ratio:w15.hopRatio},mix15:w15.relay,
      renewal:{date:HK_RENEWAL,daysLeft:Math.ceil((renewal-t)/86400000)}};
    const vercel={hkg1:{lastAt:snap.heartbeat.hkg1,ageS:snap.heartbeat.hkg1?Math.round((t-snap.heartbeat.hkg1)/1000):null},
      iad1:{lastAt:snap.heartbeat.iad1,ageS:snap.heartbeat.iad1?Math.round((t-snap.heartbeat.iad1)/1000):null}};
    const traffic={};
    for(const minutes of [5,15,60,1440]){const w=snap.windows[minutes];
      traffic[minutes]={totals:w.totals,routes:ops.STUDENT_ROUTES.map(route=>{const r=w.routes[route]||{};
        return {route,label:ROUTE_LABELS[route],count:r.count||0,p50Ms:r.p50Ms??null,p95Ms:r.p95Ms??null,s5xx:r.s5xx||0,s504:r.s504||0,s408:r.s408||0};})};}
    traffic.today={date:snap.day.date,since:snap.day.since,restarted:snap.day.restarted,totals:snap.day.totals};
    // Counting since (older than 24 hours once it has run a day); restoredAt: read back after a restart.
    traffic.since=snap.since;traffic.restoredAt=snap.restoredAt;
    traffic.recentErrors=snap.errors.map(e=>({at:e.at,route:e.route,label:ROUTE_LABELS[e.route]||'其他',status:e.status}));
    traffic.series=(snap.series||[]).map(m=>({at:m.at,count:m.count,failed:m.failed}));
    const payload={ok:true,schemaVersion:1,generatedAt:new Date(t).toISOString(),origin,db:data.db,hk,vercel,traffic,students:data.students,
      today:day.today,usage:day.usage,upkeep:{...jobInfo,certs}};
    payload.verdict=judge(payload,t);
    return payload;
  }
  async function handler(req,res){
    res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie');
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,code:'GET_ONLY',error:'網站後台只供查看。'});}
    let actor;
    try{actor=await auth.requireActor(req,{roles:['teacher']});}
    catch(error){if(error instanceof auth.AuthError)return auth.sendError(res,error);throw error;}
    if(!actor)return res.status(503).json({ok:false,code:'AUTH_DISABLED',error:'網站後台需要學校帳戶服務。'});
    if(!auth.siteAdmin(actor))return res.status(403).json({ok:false,code:'SITE_ADMIN_ONLY',error:'只有網站管理員可以查看網站後台。'});
    return res.status(200).json(await collect());
  }
  handler.collect=collect;
  return handler;
}

module.exports=createSiteMonitor();
Object.assign(module.exports,{createSiteMonitor,parseUnits,parseJobs,releaseOf,judge,hkCalendar,UNITS,JOBS,STUDENT_SQL,DAILY_SQL,USAGE_SQL,SPEECH_LIMIT});
