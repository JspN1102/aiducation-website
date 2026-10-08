'use strict';
// 網站後台: one GET for the site administrator with the health of the Guangzhou
// origin, the Hong Kong tunnels, the Vercel crons, the database and what pupils
// experienced recently. Aggregates only: no addresses, environment values,
// accounts, names, research IDs or upstream message text ever leave here.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFile}=require('node:child_process');
const auth=require('./school-auth.cjs');
const ops=require('./ops-metrics.cjs');

const MINUTE=60000,CACHE_MS=10000,STALE_MS=60000,HEARTBEAT_STALE_MS=3*MINUTE,STARTUP_GRACE_S=150;
const MEMORY_LIMIT_MB=768,HK_RENEWAL='2026-11-07';
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
function systemctlShow(units){
  return new Promise((resolve,reject)=>execFile('systemctl',['show',...units.map(u=>u+'.service'),'--no-pager','--property=Id,LoadState,ActiveState,SubState,NRestarts,ActiveEnterTimestamp'],
    {timeout:2000,maxBuffer:64*1024,env:{PATH:'/usr/bin:/bin',TZ:'UTC',LANG:'C',SYSTEMD_COLORS:'0'},windowsHide:true},
    (error,stdout)=>error?reject(error):resolve(String(stdout))));
}
function parseUnits(text){
  const found={};
  for(const block of String(text).split(/\r?\n\s*\r?\n/)){
    const fields={};
    for(const line of block.split(/\r?\n/)){const at=line.indexOf('=');if(at>0)fields[line.slice(0,at)]=line.slice(at+1).trim();}
    const id=/^(.+)\.service$/.exec(fields.Id||'')?.[1];
    if(!id)continue;
    const since=/(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d) UTC/.exec(fields.ActiveEnterTimestamp||'');
    const restarts=fields.NRestarts?Number(fields.NRestarts):NaN;
    found[id]={loadState:STATE.test(fields.LoadState||'')?fields.LoadState:'unknown',activeState:STATE.test(fields.ActiveState||'')?fields.ActiveState:'unknown',
      subState:STATE.test(fields.SubState||'')?fields.SubState:'unknown',restarts:Number.isInteger(restarts)&&restarts>=0?restarts:null,
      activeSince:since?Date.UTC(+since[1],+since[2]-1,+since[3],+since[4],+since[5],+since[6]):null};
  }
  return found;
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
  errors:`SELECT source='server_verified' AS server,record->'event'->'error'->>'code' AS code,
    CASE WHEN source='server_verified' THEN record->'event'->>'operation' END AS operation,
    count(*) FILTER (WHERE received_at >= now() - interval '15 minutes')::int AS n15,count(*)::int AS n60
    FROM research_events WHERE received_at >= now() - interval '60 minutes'
      AND record->'event'->'error'->>'code' IS NOT NULL AND record->'event'->'error'->>'code' <> 'aborted'
      AND (source='client' AND record->'event'->>'type'='error' OR source='server_verified' AND record->'event'->>'type'='provider_result')
    GROUP BY 1,2,3`,
  latency:`SELECT kind,count(*)::int AS n,percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS p50,percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) AS p95
    FROM (SELECT CASE WHEN activity='read' AND record->'event'->>'itemId' ~ '^p[0-9]+[.]l[0-9]+$' THEN 'reading'
        WHEN activity='read' AND record->'event'->>'itemId' ~ '^p[0-9]+[.]report$' THEN 'report' WHEN activity='chat' THEN 'chat' END AS kind,
        (record->'event'->'metrics'->>'latencyMs')::float8 AS ms
      FROM research_events WHERE received_at >= now() - interval '30 minutes' AND source='client' AND record->'event'->>'type'='feedback_shown'
        AND jsonb_typeof(record->'event'->'metrics'->'latencyMs')='number') x
    WHERE kind IS NOT NULL GROUP BY kind`
};

async function studentProbe(pool){
  if(!pool)return {available:false,reason:'disabled'};
  let client;
  try{
    client=await withTimeout(pool.connect(),2000,late=>late.release());
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '3s'");
    const active=(await client.query(STUDENT_SQL.active)).rows[0]||{};
    const errors=(await client.query(STUDENT_SQL.errors)).rows;
    const latency=(await client.query(STUDENT_SQL.latency)).rows;
    await client.query('COMMIT');
    const clientErrors={},providerErrors={};
    for(const row of errors){
      const code=ERROR_CODES.includes(row.code)?row.code:'unknown',n15=Number(row.n15)||0,n60=Number(row.n60)||0;
      if(!row.server){const into=clientErrors[code]||(clientErrors[code]={n15:0,n60:0});into.n15+=n15;into.n60+=n60;continue;}
      const operation=OPERATIONS.includes(row.operation)?row.operation:'other',key=operation+':'+code;
      const into=providerErrors[key]||(providerErrors[key]={operation,code,n15:0,n60:0});into.n15+=n15;into.n60+=n60;
    }
    const byKind=Object.fromEntries(latency.map(row=>[row.kind,row]));
    return {available:true,active5:Number(active.active5)||0,active60:Number(active.active60)||0,clientErrors,providerErrors:Object.values(providerErrors),
      latency:LATENCY_KINDS.map(([kind,label])=>{const row=byKind[kind];return {kind,label,count:Number(row?.n)||0,
        p50Ms:Number.isFinite(row?.p50)?Math.round(row.p50):null,p95Ms:Number.isFinite(row?.p95)?Math.round(row.p95):null};})};
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
    const soe=p.traffic[15].routes.find(r=>r.route==='soe');
    if(soe?.p95Ms>8000)sections.latency={level:'warn',text:'朗讀評分偏慢，最慢一成要 '+Math.round(soe.p95Ms/100)/10+' 秒以上。'};
    else sections.latency={level:'ok',text:p.traffic[15].totals.count?'近 15 分鐘使用順暢。':'近 15 分鐘沒有學生使用。'};
  }
  { // 近期報錯
    const OPS={reading:'朗讀評分',handwriting:'手寫',chat:'對話',report:'報告',challenge:'挑戰'};
    const failed=(p.students.available?p.students.providerErrors:[]).filter(e=>['timeout','provider_unavailable'].includes(e.code));
    const worst=Object.entries(failed.reduce((a,e)=>(a[e.operation]=(a[e.operation]||0)+e.n15,a),{})).sort((a,b)=>b[1]-a[1])[0];
    const provider={n:failed.reduce((n,e)=>n+e.n15,0),label:worst?OPS[worst[0]]||'外部':'外部'};
    const t5=p.traffic[5].totals,t15=p.traffic[15].totals,client=p.students.available?['network','timeout'].reduce((n,c)=>n+(p.students.clientErrors[c]?.n15||0),0):0;
    if(t5.s5xx>=5&&t5.s5xx/Math.max(1,t5.count)>0.05)sections.errors={level:'bad',text:'近 5 分鐘有 '+t5.s5xx+' 個伺服器錯誤（'+Math.round(t5.s5xx/Math.max(1,t5.count)*100)+'%）。'};
    else if(client>=5)sections.errors={level:'warn',text:'近 15 分鐘學生端有 '+client+' 次網絡中斷或超時。'};
    else if(provider.n>=5)sections.errors={level:'warn',text:'近 15 分鐘'+provider.label+'服務失敗 '+provider.n+' 次。'};
    else if(t15.s504+t15.s408>=5)sections.errors={level:'warn',text:'近 15 分鐘有 '+(t15.s504+t15.s408)+' 個請求超時。'};
    else sections.errors={level:'ok',text:t15.s5xx?'近 15 分鐘有零星錯誤（'+t15.s5xx+' 個），不影響使用。':'近 15 分鐘沒有伺服器錯誤。'};
  }
  const overall=level(...Object.values(sections).map(s=>s.level));
  const NAMES={server:'廣州伺服器',hk:'香港中轉',vercel:'Vercel',db:'資料庫',latency:'學生使用',errors:'近期報錯'};
  const flagged=Object.entries(sections).filter(([,s])=>s.level===overall).map(([k])=>NAMES[k]);
  return {level:overall,text:overall==='ok'?'全部正常。':(overall==='bad'?'有問題：':'需要留意：')+flagged.join('、')+'。',sections};
}

function createSiteMonitor({now=Date.now,clock=()=>performance.now(),uptime=()=>process.uptime(),memory=()=>process.memoryUsage(),
  loadavg=()=>os.loadavg(),system=()=>({cpus:os.cpus().length,totalMB:Math.round(os.totalmem()/1048576),availableMB:Math.round(os.freemem()/1048576)}),
  release=defaultRelease,disk=defaultDisk,systemctl=systemctlShow,authPool=defaultAuthPool,researchPool=defaultResearch,metrics=ops}={}){
  const cache=new Map();
  // Slow probes are shared for 10 s; an older answer (under a minute) is
  // returned at once while a single refresh runs in the background.
  function cached(key,load){
    const entry=cache.get(key),t=now();
    if(entry?.value&&t-entry.at<CACHE_MS)return entry.value;
    if(!entry?.pending){
      const pending=Promise.resolve().then(load).then(value=>{cache.set(key,{value,at:now()});return value;},error=>{cache.set(key,{...cache.get(key),pending:null});throw error;});
      cache.set(key,{...entry,pending});pending.catch(()=>{});
    }
    const current=cache.get(key);
    return current.value&&t-current.at<STALE_MS?current.value:current.pending;
  }
  async function host(){
    const [units,diskFreePct]=await Promise.all([systemctl(UNITS.map(u=>u[0])).then(text=>{const units=parseUnits(text);return Object.keys(units).length?units:null;}).catch(()=>null),Promise.resolve().then(disk).catch(()=>null)]);
    return {units,diskFreePct:Number.isFinite(diskFreePct)?diskFreePct:null,checkedAt:now()};
  }
  async function database(){
    let pool=null,rPool=null;
    try{pool=authPool();}catch{}
    try{rPool=researchPool();}catch{}
    const [db,students]=await Promise.all([dbProbe(pool,rPool,clock),withTimeout(studentProbe(rPool),4000).catch(()=>({available:false,reason:'timeout'}))]);
    return {db:{...db,checkedAt:now()},students:{...students,checkedAt:now()}};
  }
  async function collect(){
    const t=now(),[hostInfo,data]=await Promise.all([cached('host',host),cached('db',database)]),snap=metrics.snapshot(t),mem=memory();
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
    for(const minutes of [5,15]){const w=snap.windows[minutes];
      traffic[minutes]={totals:w.totals,routes:ops.STUDENT_ROUTES.map(route=>{const r=w.routes[route]||{};
        return {route,label:ROUTE_LABELS[route],count:r.count||0,p50Ms:r.p50Ms??null,p95Ms:r.p95Ms??null,s5xx:r.s5xx||0,s504:r.s504||0,s408:r.s408||0};})};}
    traffic.recentErrors=snap.errors.map(e=>({at:e.at,route:e.route,label:ROUTE_LABELS[e.route]||'其他',status:e.status}));
    const payload={ok:true,schemaVersion:1,generatedAt:new Date(t).toISOString(),origin,db:data.db,hk,vercel,traffic,students:data.students};
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
Object.assign(module.exports,{createSiteMonitor,parseUnits,releaseOf,judge,UNITS,STUDENT_SQL});
