'use strict';
// 網站後台: only jasper may read it, it carries aggregates only, and the
// traffic store, systemd parsing and verdict rules behave as documented.
const {test,afterEach}=require('node:test'),assert=require('node:assert/strict');
const handler=require('../api/teacher-tools.js'),auth=require('../api/_lib/school-auth.cjs');
const ops=require('../api/_lib/ops-metrics.cjs'),monitor=require('../api/_lib/site-monitor-handler.cjs');

const T=Date.parse('2026-10-09T03:00:00Z'),MB=1048576,CRON='vercel-cron/1.0';
const response=()=>({headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;}});
const teacher=login=>({id:'t_'+login,researchId:null,role:'teacher',login,displayName:'老師'});
afterEach(()=>ops.reset());

async function withActor(actor,run){
  const previous=auth.requireActor,calls=[];
  auth.requireActor=async(req,options)=>{calls.push(options);if(actor instanceof Error)throw actor;return actor;};
  try{return await run(calls);}finally{auth.requireActor=previous;}
}
const status=(actor,method='GET')=>withActor(actor,async calls=>{const res=response();await handler({method,query:{tool:'site-status'},headers:{}},res);return {res,calls};});

test('only the jasper teacher account reads the site status; everyone else is refused without data',async()=>{
  let {res,calls}=await status(teacher('jasper'));
  assert.equal(res.statusCode,200);assert.equal(res.body.ok,true);assert.equal(res.body.schemaVersion,1);
  assert.deepEqual(calls,[{roles:['teacher']}]);
  assert.equal(res.headers['Cache-Control'],'private, no-store');assert.equal(res.headers.Vary,'Cookie');
  assert(!JSON.stringify(res.body).includes('jasper'));
  for(const actor of [teacher('molly'),teacher('Jasper '),{...teacher('jasper'),role:'student'},{id:'t_x',role:'teacher'}]){
    ({res}=await status(actor));
    assert.equal(res.statusCode,403);assert.equal(res.body.code,'SITE_ADMIN_ONLY');assert.equal(res.body.ok,false);
    assert.deepEqual(Object.keys(res.body).sort(),['code','error','ok']);
    assert.equal(res.headers['Cache-Control'],'private, no-store');
  }
  ({res}=await status(new auth.AuthError(403,'ROLE_FORBIDDEN')));
  assert.equal(res.statusCode,403);assert.equal(res.body.code,'ROLE_FORBIDDEN');assert(!('origin' in res.body));
  ({res}=await status(new auth.AuthError(401,'AUTH_REQUIRED')));
  assert.equal(res.statusCode,401);assert.equal(res.body.code,'AUTH_REQUIRED');
  ({res}=await status(null));
  assert.equal(res.statusCode,503);assert.equal(res.body.code,'AUTH_DISABLED');
  ({res,calls}=await status(teacher('jasper'),'POST'));
  assert.equal(res.statusCode,405);assert.equal(res.body.code,'GET_ONLY');assert.equal(res.headers.Allow,'GET');assert.equal(calls.length,0);
});

test('the siteAdmin flag in the session user is set for jasper only',()=>{
  const account=(role,login)=>({id:'u_'+login,researchId:role==='student'?'r_'+login:null,role,login,displayName:'用戶',grade:role==='student'?2:null,cls:null,classNo:null});
  assert.equal(auth.publicActor(account('teacher','jasper')).siteAdmin,true);
  assert.equal(auth.publicActor(account('teacher','molly')).siteAdmin,false);
  assert.equal(auth.publicActor(account('student','jasper')).siteAdmin,false);
  assert.equal(auth.siteAdmin(null),false);
});

test('heartbeats are recognised only for Vercel cron GETs of school-auth with a relay label',()=>{
  const beat=(relay,extra={})=>ops.heartbeatOf({route:'school-auth',method:'GET',userAgent:CRON,relay,...extra});
  assert.equal(beat('hk:3100'),'hkg1');assert.equal(beat('hk:3102'),'hkg1');
  assert.equal(beat('hop-gz:3100'),'hkg1');assert.equal(beat('hop-hk:3101'),'hkg1');
  assert.equal(beat('gz:3100'),'iad1');
  for(const [relay,extra] of [[undefined,{}],['hk:3103',{}],['10.0.0.1',{}],['gz:3100',{method:'POST'}],['gz:3100',{route:'soe'}],['gz:3100',{userAgent:'Mozilla/5.0'}],['gz:3100',{userAgent:undefined}]])
    assert.equal(beat(relay,extra),null,JSON.stringify([relay,extra]));
});

test('ops metrics: per-minute windows, status classes, sampled percentiles and recent errors',()=>{
  for(let i=1;i<=10;i++)ops.record({route:'soe',method:'POST',status:200,totalMs:i*100,relay:'hk:3101',now:T-1000});
  ops.record({route:'soe',method:'POST',status:500,totalMs:99999,relay:'hk:3101',now:T-2000});
  ops.record({route:'soe',method:'POST',status:504,totalMs:95000,relay:'hop-gz:3100',now:T-3000});
  ops.record({route:'tts',method:'GET',status:408,totalMs:30000,relay:'gz:3100',now:T-4000});
  ops.record({route:'tts',method:'GET',status:499,totalMs:5,now:T-5000});
  ops.record({route:'school-auth',method:'POST',status:401,totalMs:20,now:T-6000});
  ops.record({route:'maanshan-chat',method:'POST',status:200,totalMs:4000,now:T-20*60000});
  ops.record({route:'maanshan-chat',method:'POST',status:200,totalMs:4000,now:T-61*60000});
  for(const skipped of [{route:'health',status:200},{route:'unknown',status:404},{route:'soe',status:'200'},{route:'soe',status:200.5},{status:200}])
    ops.record({method:'GET',totalMs:1,now:T,...skipped});
  const snap=ops.snapshot(T),w5=snap.windows[5],w15=snap.windows[15],w60=snap.windows[60];
  assert.deepEqual(w5.totals,{count:15,s5xx:2,s504:1,s408:1,s499:1,s4xx:1});
  assert.deepEqual({...w5.routes.soe},{count:12,s5xx:2,s504:1,s408:0,s499:0,s4xx:0,p50Ms:550,p95Ms:955});
  assert.equal(w5.routes.tts.p50Ms,null);assert.equal(w5.routes['school-auth'].p50Ms,undefined);
  assert.equal(w15.routes['maanshan-chat'],undefined);assert.equal(w60.routes['maanshan-chat'].count,1);
  assert.equal(w60.routes['maanshan-chat'].p50Ms,4000);
  assert.deepEqual(w5.relay,{'hk:3101':11,'hop-gz:3100':1,'gz:3100':1});
  assert.equal(w5.hk,11);assert.equal(w5.hop,1);assert.equal(w5.direct,1);assert.equal(w5.hopRatio,1/12);
  assert.equal(snap.ports['3101'],T-1000);assert.equal(snap.lastHop,T-3000);assert.equal(snap.lastDirect,T-4000);
  assert.deepEqual(snap.errors,[{at:T-4000,route:'tts',status:408},{at:T-3000,route:'soe',status:504},{at:T-2000,route:'soe',status:500}],'latest recorded first');
  for(let i=0;i<30;i++)ops.record({route:'tts',method:'GET',status:502,now:T+i});
  assert.equal(ops.snapshot(T+30).errors.length,20);assert.equal(ops.snapshot(T+30).errors[0].at,T+29);
  assert.equal(ops.percentile([],.5),null);assert.equal(ops.percentile([7],.95),7);
});

test('ops metrics: heartbeats update the Vercel record but never count as pupil traffic; nothing identifying is kept',()=>{
  ops.record({route:'school-auth',method:'GET',status:200,totalMs:30,relay:'hk:3102',userAgent:CRON,now:T-30000});
  ops.record({route:'school-auth',method:'GET',status:200,totalMs:30,relay:'gz:3100',userAgent:CRON,now:T-20000});
  ops.record({route:'school-auth',method:'GET',status:503,totalMs:30,relay:'hop-gz:3100',userAgent:CRON,now:T-10000});
  ops.record({route:'soe',method:'POST',status:200,totalMs:900,relay:'203.0.113.9',userAgent:'Mozilla/5.0 (iPad)',now:T-5000});
  const snap=ops.snapshot(T);
  assert.deepEqual(snap.heartbeat,{hkg1:T-30000,iad1:T-20000});
  assert.equal(snap.windows[5].beats,3);
  assert.deepEqual(Object.keys(snap.windows[5].routes).sort(),['school-auth','soe']);
  assert.equal(snap.windows[5].routes['school-auth'].count,1);assert.equal(snap.windows[5].routes['school-auth'].s5xx,1);
  assert.equal(snap.ports['3102'],T-30000);
  const text=JSON.stringify(snap);
  for(const secret of ['203.0.113.9','Mozilla','vercel-cron','iPad'])assert(!text.includes(secret),secret);
});

const UNIT_TEXT=`Id=maanshan.service
LoadState=loaded
ActiveState=active
SubState=running
NRestarts=0
ActiveEnterTimestamp=Wed 2026-10-08 02:10:11 UTC

ActiveEnterTimestamp=
NRestarts=7
SubState=auto-restart
ActiveState=activating
LoadState=loaded
Id=maanshan-hk-tunnel@3102.service

Id=gone.service
LoadState=not-found
ActiveState=inactive
SubState=dead
NRestarts=
ActiveEnterTimestamp=n/a

Id=odd.service
LoadState=loaded
ActiveState=active; rm -rf
SubState=<b>
NRestarts=-1
`;

test('systemctl show output and release directory names are parsed strictly',()=>{
  const units=monitor.parseUnits(UNIT_TEXT.replace(/\n/g,'\r\n'));
  assert.deepEqual(units.maanshan,{loadState:'loaded',activeState:'active',subState:'running',restarts:0,activeSince:Date.UTC(2026,9,8,2,10,11)});
  assert.deepEqual(units['maanshan-hk-tunnel@3102'],{loadState:'loaded',activeState:'activating',subState:'auto-restart',restarts:7,activeSince:null});
  assert.equal(units.gone.loadState,'not-found');assert.equal(units.gone.restarts,null);
  assert.deepEqual(units.odd,{loadState:'loaded',activeState:'unknown',subState:'unknown',restarts:null,activeSince:null});
  assert.deepEqual(monitor.parseUnits(''),{});
  assert.deepEqual(monitor.releaseOf('/srv/maanshan/releases/20261008T021011Z-0123456789-abcdef01'),{commit:'0123456',builtAt:'2026-10-08T02:10:11.000Z'});
  for(const dir of ['/srv/maanshan/current','20261008T021011Z-0123456789',null])assert.equal(monitor.releaseOf(dir),null);
  assert.equal(monitor.UNITS.length,8);
});

function unitText(units,override={}){
  return units.map(unit=>{const u={LoadState:'loaded',ActiveState:'active',SubState:'running',NRestarts:'0',ActiveEnterTimestamp:'Thu 2026-10-09 01:00:00 UTC',...override[unit]};
    return ['Id='+unit+'.service',...Object.entries(u).map(([k,v])=>k+'='+v)].join('\n');}).join('\n\n')+'\n';
}
// systemctl show for every job's service and timer; health checks run on a
// monotonic timer, so they never report a wall-clock next run.
function jobText(override={}){
  return monitor.JOBS.flatMap(([unit])=>{const o=override[unit]||{};
    return [['Id='+unit+'.service','LoadState='+(o.load||'loaded'),'ActiveState='+(o.state||'inactive'),'Result='+(o.result||'success'),'ExecMainExitTimestamp='+(o.finished??'Fri 2026-10-09 02:46:00 UTC')].join('\n'),
      ['Id='+unit+'.timer','LoadState='+(o.timerLoad||'loaded'),'ActiveState='+(o.timer||'active'),'Result=success','LastTriggerUSec='+(o.last??'Fri 2026-10-09 02:45:00 UTC'),
        'NextElapseUSecRealtime='+(o.next??(unit==='maanshan-health-check'?'':'Sat 2026-10-10 02:15:00 UTC'))].join('\n')];}).join('\n\n')+'\n';
}
const DAY=86400000;
const DAILY_ROWS={
  today:[{total:false,grade:1,pupils:12,readings:100,chats:20,events:300},{total:false,grade:2,pupils:8,readings:50,chats:5,events:150},
    {total:false,grade:null,pupils:1,readings:0,chats:0,events:3},{total:true,grade:null,pupils:21,readings:150,chats:25,events:453}],
  peak:[{slot:String((T-3600000)/1000),pupils:6}],
  week:[{day:-6,pupils:3},{day:0,pupils:21},{day:null,pupils:30}],
  // Per kind: events, pupils and the most from one pupil; the total row counts each pupil once.
  clients:[{total:false,code:'permission_denied',n:30,pupils:3,top:24},{total:false,code:'network',n:12,pupils:4,top:5},{total:false,code:'script',n:10,pupils:3,top:5},
    {total:false,code:'unsupported',n:7,pupils:1,top:7},{total:false,code:'<script>',n:1,pupils:1,top:1},{total:true,code:null,n:60,pupils:9,top:24}],
  month:[{readings:1300}],
  last:[{at:T-42000}]
};
const dailyKey=sql=>Object.entries(monitor.DAILY_SQL).find(([,v])=>v===sql)?.[0];
// Postgres refuses a statement whose parameters do not match its placeholders.
const placeholders=(sql,params=[])=>assert.equal(params.length,Math.max(0,...[...sql.matchAll(/\$(\d+)/g)].map(m=>Number(m[1]))),'parameters for '+sql.slice(0,40));
function fakes({units={},systemctl,jobs,certificate,authPool,researchPool,rows={},usage={},uptimeS=5*3600,rssMB=200,now=()=>T}={}){
  const log={systemctl:0,jobs:0,certs:0,sql:[],params:{},windows:{},released:0};
  const client={async query(sql,params){log.sql.push(sql);placeholders(sql,params);const key=dailyKey(sql);if(key)log.params[key]=params;
      if(rows.fail&&sql===rows.fail.sql)throw Object.assign(new Error('x'),{code:rows.fail.code});
      if(sql===monitor.STUDENT_SQL.active)return {rows:[rows.active||{active5:3,active60:41}]};
      // Window queries: rows per interval ('60 minutes' or '24 hours').
      for(const kind of ['errors','latency','providers'])if(sql===monitor.STUDENT_SQL[kind]){(log.windows[kind]||(log.windows[kind]=[])).push(params[0]);return {rows:rows[kind]?.[params[0]]||[]};}
      if(key)return {rows:(rows.daily||DAILY_ROWS)[key]};
      return {rows:[]};},release(){log.released++;}};
  let tick=0;
  const options={now,clock:()=>(tick+=7),uptime:()=>uptimeS,memory:()=>({rss:rssMB*MB,heapUsed:80*MB}),loadavg:()=>[0.123,0.2,0.3],
    system:()=>({cpus:2,totalMB:3900,availableMB:2100}),release:()=>({commit:'abc1234',builtAt:'2026-10-09T01:00:00.000Z'}),disk:()=>42.5,
    systemctl:systemctl||(async list=>{log.systemctl++;return unitText(list,units);}),
    jobs:jobs||(async list=>{log.jobs++;assert.deepEqual(list,monitor.JOBS.map(j=>j[0]));return jobText();}),
    certificate:certificate||(async host=>{log.certs++;return {validTo:T+70*DAY+3600000,matches:true};}),
    authPool:authPool===undefined?()=>({totalCount:3,idleCount:2,waitingCount:0,query:async(sql,params)=>{placeholders(sql,params);
      if(sql===monitor.USAGE_SQL.size)return {rows:[{mb:usage.mb??145}]};
      if(sql===monitor.USAGE_SQL.speech){if(usage.speechError)throw Object.assign(new Error('x'),{code:usage.speechError});log.params.speech=params;return {rows:usage.used===undefined?[{used:19}]:usage.used===null?[]:[{used:usage.used}]};}
      return {rows:[{'?column?':1}]};}}):authPool,
    researchPool:researchPool===undefined?()=>({totalCount:2,idleCount:2,waitingCount:0,connect:async()=>client}):researchPool,metrics:ops};
  return {monitor:monitor.createSiteMonitor(options),log};
}
function healthyTraffic(){
  for(let i=0;i<4;i++)ops.record({route:'soe',method:'POST',status:200,totalMs:2000+i*500,relay:'hk:310'+(i%3),now:T-60000});
  ops.record({route:'school-auth',method:'GET',status:200,relay:'hk:3101',userAgent:CRON,now:T-30000});
  ops.record({route:'school-auth',method:'GET',status:200,relay:'gz:3100',userAgent:CRON,now:T-25000});
}

test('today counts reset at Hong Kong midnight; the first day starts at the restart',()=>{
  const midnight=Date.parse('2026-10-09T16:00:00Z'); // 2026-10-10 00:00 in Hong Kong
  globalThis[ops.KEY]=undefined;delete globalThis[ops.KEY];
  ops.record({route:'soe',method:'POST',status:200,totalMs:900,now:midnight-120000});
  let day=ops.snapshot(midnight-60000).day;
  assert.equal(day.date,'2026-10-09');assert.equal(day.restarted,ops.snapshot(midnight-60000).startedAt>midnight-8*3600000-16*3600000);assert.equal(day.totals.count,1);
  ops.record({route:'soe',method:'POST',status:504,totalMs:30000,now:midnight+60000});
  ops.record({route:'tts',method:'POST',status:408,now:midnight+90000});
  ops.record({route:'school-auth',method:'GET',status:200,relay:'hk:3101',userAgent:CRON,now:midnight+95000});
  day=ops.snapshot(midnight+120000).day;
  assert.deepEqual(day,{date:'2026-10-10',since:midnight,restarted:false,totals:{count:2,s5xx:1,s504:1,s408:1,s499:0,s4xx:0}});
});

test('payload shape: aggregates from injected systemd, database and traffic fakes, nothing identifying',async()=>{
  healthyTraffic();
  const {monitor:m,log}=fakes({rows:{
    errors:{'60 minutes':[{server:false,code:'network',operation:null,n:2},{server:false,code:'<script>',operation:null,n:1},{server:true,code:'timeout',operation:'reading',n:1}],
      '24 hours':[{server:false,code:'network',operation:null,n:6},{server:false,code:'<script>',operation:null,n:1},
        {server:true,code:'timeout',operation:'reading',n:3},{server:true,code:'provider_unavailable',operation:'r_secret',n:1}]},
    latency:{'60 minutes':[{kind:'reading',n:12,p50:2310.4,p95:6100.6}],'24 hours':[{kind:'reading',n:300,p50:2500,p95:7000.2},{kind:'chat',n:20,p50:4100,p95:9000}]},
    providers:{'60 minutes':[{operation:'reading',n:12,failed:1}],'24 hours':[{operation:'reading',n:150,failed:2},{operation:'chat',n:25,failed:0},{operation:'r_secret',n:1,failed:1}]}}});
  const p=await m.collect();
  assert.deepEqual(Object.keys(p),['ok','schemaVersion','generatedAt','origin','db','hk','vercel','traffic','students','today','usage','upkeep','verdict']);
  assert.equal(p.generatedAt,'2026-10-09T03:00:00.000Z');
  assert.equal(p.origin.unitsAvailable,true);assert.equal(p.origin.units.length,8);
  assert(p.origin.units.every(u=>u.activeState==='active'&&u.label&&Number.isFinite(u.activeSince)));
  assert.equal(p.origin.rssMB,200);assert.equal(p.origin.memoryLimitMB,768);assert.equal(p.origin.diskFreePct,42.5);assert.deepEqual(p.origin.loadavg,[0.12,0.2,0.3]);
  assert.deepEqual(p.origin.release,{commit:'abc1234',builtAt:'2026-10-09T01:00:00.000Z'});assert.equal(p.origin.uptimeS,18000);
  assert.deepEqual({ok:p.db.ok,latencyMs:p.db.latencyMs,pools:p.db.pools},{ok:true,latencyMs:7,pools:{auth:{total:3,idle:2,waiting:0},research:{total:2,idle:2,waiting:0}}});
  assert.deepEqual(p.hk.tunnels.map(t=>[t.port,t.state,t.upSinceS]),[[3100,'active',7200],[3101,'active',7200],[3102,'active',7200]]);
  assert.equal(p.hk.tunnels[1].lastSeenAt,T-30000);assert.equal(p.hk.lastHeartbeatAt,T-30000);
  assert.deepEqual(p.hk.renewal,{date:'2027-01-07',daysLeft:90});assert.deepEqual(p.hk.hop15,{hop:0,total:5,ratio:0});
  assert.deepEqual(p.vercel,{hkg1:{lastAt:T-30000,ageS:30},iad1:{lastAt:T-25000,ageS:25}});
  assert.deepEqual(p.traffic[5].routes.map(r=>r.route),ops.STUDENT_ROUTES);
  assert.deepEqual(p.traffic[15].routes[0],{route:'soe',label:'朗讀評分',count:4,p50Ms:2750,p95Ms:3425,s5xx:0,s504:0,s408:0});
  assert.deepEqual(p.traffic.recentErrors,[]);
  assert.equal(p.traffic.today.date,'2026-10-09');assert.equal(p.traffic.today.totals.count,4);assert.equal(p.traffic.today.totals.s5xx,0);
  assert.equal(p.students.available,true);assert.equal(p.students.active5,3);assert.equal(p.students.active60,41);
  assert.deepEqual(p.students.clientErrors,{network:2,unknown:1});
  assert.deepEqual(p.students.providerErrors,[{operation:'reading',code:'timeout',n:1}]);
  assert.deepEqual(p.students.providers,[{operation:'reading',label:'朗讀評分',count:12,failed:1}]);
  assert.deepEqual(p.students.latency,[{kind:'reading',label:'朗讀評分',count:12,p50Ms:2310,p95Ms:6101},{kind:'report',label:'朗讀報告',count:0,p50Ms:null,p95Ms:null},{kind:'chat',label:'對話',count:0,p50Ms:null,p95Ms:null}]);
  const recent=[monitor.STUDENT_SQL.errors,monitor.STUDENT_SQL.latency,monitor.STUDENT_SQL.providers];
  assert.deepEqual(log.sql,['BEGIN READ ONLY',"SET LOCAL statement_timeout = '3s'",monitor.STUDENT_SQL.active,...recent,'COMMIT',
    'BEGIN READ ONLY',"SET LOCAL statement_timeout = '4s'",...Object.values(monitor.DAILY_SQL),monitor.DAILY_SQL.clients,...recent,'COMMIT']);
  assert.deepEqual(log.windows,{errors:['60 minutes','24 hours'],latency:['60 minutes','24 hours'],providers:['60 minutes','24 hours']});
  assert.equal(log.released,2);
  assert.deepEqual(log.params,{today:['2026-10-08T16:00:00.000Z'],peak:['2026-10-08T16:00:00.000Z'],week:['2026-10-08T16:00:00.000Z'],
    clients:['2026-10-06T16:00:00.000Z'],month:['2026-09-30T16:00:00.000Z'],last:[],speech:['2026-10']},'Hong Kong day and month; 學生端問題 last read over 3 days');
  assert.deepEqual(p.today,{available:true,date:'2026-10-09',pupils:21,readings:150,chats:25,events:453,
    byGrade:[{grade:1,pupils:12,readings:100,chats:20},{grade:2,pupils:8,readings:50,chats:5}],peak:{pupils:6,at:T-3600000},
    week:{days:['2026-10-03','2026-10-04','2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09'].map((date,i)=>({date,pupils:i===0?3:i===6?21:0})),pupils:30},
    last24:{clientErrors:{network:6,unknown:1},providerErrors:[{operation:'reading',code:'timeout',n:3},{operation:'other',code:'provider_unavailable',n:1}],
      providers:[{operation:'reading',label:'朗讀評分',count:150,failed:2},{operation:'chat',label:'對話',count:25,failed:0},{operation:'other',label:'其他',count:1,failed:1}],
      latency:[{kind:'reading',label:'朗讀評分',count:300,p50Ms:2500,p95Ms:7000},{kind:'report',label:'朗讀報告',count:0,p50Ms:null,p95Ms:null},{kind:'chat',label:'對話',count:20,p50Ms:4100,p95Ms:9000}]},
    clientErrors:[{code:'network',label:'網絡中斷',count:12,pupils:4,topPupil:null},{code:'permission_denied',label:'未允許錄音',count:30,pupils:3,topPupil:24},
      {code:'script',label:'頁面程式錯誤',count:10,pupils:3,topPupil:5},{code:'unsupported',label:'裝置不支援',count:7,pupils:1,topPupil:null},{code:'unknown',label:'其他',count:1,pupils:1,topPupil:null}],
    clientErrorPupils:9,clientErrors3:p.today.clientErrors,clientErrorPupils3:9,monthReadings:1300,lastRecordAt:T-42000,checkedAt:T});
  assert.deepEqual(p.usage,{available:true,dbMB:145,speech:{month:'2026-10',used:19,limit:4800},checkedAt:T});
  assert.equal(p.upkeep.available,true);assert.equal(p.upkeep.checkedAt,T);
  assert.deepEqual(p.upkeep.jobs[0],{unit:'maanshan-backup',label:'每日備份',loadState:'loaded',running:false,result:'success',lastAt:Date.UTC(2026,9,9,2,45),
    finishedAt:Date.UTC(2026,9,9,2,46),nextAt:Date.UTC(2026,9,10,2,15),timer:'active',maxGapS:30*3600});
  assert.equal(p.upkeep.jobs[1].nextAt,null,'monotonic timer');
  assert.deepEqual(p.upkeep.certs,[{host:'mandarin.aiducation.asia',label:'學生平台證書',daysLeft:70,matches:true,validTo:new Date(T+70*DAY+3600000).toISOString()},
    {host:'aiducation.hk.cn',label:'展示版證書',daysLeft:70,matches:true,validTo:new Date(T+70*DAY+3600000).toISOString()}]);
  assert.equal(p.traffic.series.length,60);assert.deepEqual(p.traffic.series.at(-2),{at:Math.floor(T/60000)*60000-60000,count:4,failed:0});
  assert.deepEqual(p.traffic[60].routes[0],{route:'soe',label:'朗讀評分',count:4,p50Ms:2750,p95Ms:3425,s5xx:0,s504:0,s408:0});
  assert.equal(p.traffic[1440].routes[0].count>=4,true);assert.equal(Number.isFinite(p.traffic.since),true);
  assert.equal(p.verdict.level,'ok');assert.equal(p.verdict.text,'全部正常。');
  assert.deepEqual(Object.keys(p.verdict.sections),['server','hk','vercel','db','latency','errors','services','upkeep','today','week','trend','clients','clients3']);
  assert.deepEqual(p.verdict.sections.services,{level:'ok',text:'近 1 小時成功率 100%。'});
  assert.deepEqual(p.verdict.sections.upkeep,{level:'ok',text:'備份、健康檢查、恢復演練都正常，證書還有 70 天。'});
  assert.deepEqual(p.verdict.sections.today,{level:'info',text:'今天有 21 位學生用過，朗讀 150 句。'});
  assert.deepEqual(p.verdict.sections.trend,{level:'info',text:'共 4 個請求，最忙一分鐘 4 個。'});
  assert.deepEqual(p.verdict.sections.clients,{level:'info',text:'今天有 9 位學生遇到問題，共 60 次，最多學生遇到「網絡中斷」。'});
  const text=JSON.stringify(p);
  for(const leak of ['<script>','r_secret','vercel-cron','research_id','jasper'])assert(!text.includes(leak),leak);
  assert(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(text),'no addresses');
  await m.collect();assert.equal(log.systemctl,1,'host probe is shared for 10 seconds');
  assert.deepEqual([log.jobs,log.certs],[1,2]);
});

test('pupil-side problems: page-script errors apart, pupils per kind and per day, one pupil tapping again and again',async()=>{
  const sql=monitor.DAILY_SQL.clients;
  assert.match(sql,/^SELECT GROUPING\(code\)=1 AS total,/);assert.match(sql,/WHEN record->'event'->>'itemId' LIKE 'client\.%' THEN 'script'/);
  assert.match(sql,/WHERE received_at >= \$1 AND source='client'/,'today first, read-only aggregates');assert.match(sql,/GROUP BY ROLLUP\(code\)$/);
  assert(sql.includes("IN ('network','timeout','permission_denied','audio_unavailable','provider_unavailable','invalid_response','storage_unavailable','unsupported','unknown')"));
  // A code outside the list (the query already folds them) is merged into 其他.
  const daily={...DAILY_ROWS,clients:[{total:false,code:'permission_denied',n:5,pupils:2,top:4},{total:false,code:'unknown',n:8,pupils:2,top:6},{total:false,code:'mystery',n:2,pupils:1,top:2},
    {total:true,code:null,n:15,pupils:3,top:6}]};
  let p=await fakes({rows:{daily}}).monitor.collect();
  assert.deepEqual(p.today.clientErrors,[{code:'unknown',label:'其他',count:10,pupils:3,topPupil:6},{code:'permission_denied',label:'未允許錄音',count:5,pupils:2,topPupil:null}]);
  assert.equal(p.today.clientErrorPupils,3);assert.equal(p.verdict.sections.clients.text,'今天有 3 位學生遇到問題，共 15 次，最多學生遇到「其他」。');
  assert.deepEqual(p.today.clientErrors3,p.today.clientErrors);assert.equal(p.today.clientErrorPupils3,3);assert.equal(p.verdict.sections.clients3.text,'3 日內有 3 位學生遇到問題，共 15 次，最多學生遇到「其他」。');
  // No problems today: Postgres still returns the empty total row.
  p=await fakes({rows:{daily:{...DAILY_ROWS,clients:[{total:true,code:null,n:null,pupils:0,top:null}]}}}).monitor.collect();
  assert.deepEqual([p.today.clientErrors,p.today.clientErrorPupils,p.verdict.sections.clients.text],[[],0,'今天學生裝置沒有回報問題。']);
});

test('網站後台 page: times and pupils per kind, the one-pupil note, and an older server without pupil figures',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../maanshan/teacher-dashboard.mjs'),'utf8');
  const pick=name=>new RegExp('^function '+name+'\\(.*$','m').exec(source)[0];
  const ui=vm.runInNewContext(['esc','number','shown','monitorList','clientErrorItems'].map(pick).join('\n')+'\n({monitorList,clientErrorItems})');
  const plain=value=>JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(ui.clientErrorItems([{code:'permission_denied',label:'未允許錄音',count:37,pupils:11,topPupil:24},{code:'script',label:'頁面程式錯誤',count:3,pupils:2,topPupil:null}])),
    [['info','未允許錄音','37 次（11 位學生）','其中 1 位學生就有 24 次'],['info','頁面程式錯誤','3 次（2 位學生）','']]);
  assert.deepEqual(plain(ui.clientErrorItems([{code:'network',label:'網絡中斷',count:4},{code:'unknown',count:1}])),[['info','網絡中斷','4 次',''],['info','其他','1 次','']],'older server');
  const html=ui.monitorList(ui.clientErrorItems([{label:'未允許錄音',count:37,pupils:11,topPupil:24},{label:'<b>',count:1,pupils:1,topPupil:null}]));
  assert.equal((html.match(/<small>/g)||[]).length,1);assert.match(html,/<small>其中 1 位學生就有 24 次<\/small>/);assert(html.includes('&lt;b&gt;'));
});

test('daily figures are kept for a minute, schedules for five; an older answer is served while one refresh runs',async()=>{
  let t=T;const {monitor:m,log}=fakes({now:()=>t}),today=()=>log.sql.filter(sql=>sql===monitor.DAILY_SQL.today).length;
  await m.collect();t=T+30000;await m.collect();
  assert.deepEqual([today(),log.jobs,log.systemctl],[1,1,2]);
  t=T+61000;const p=await m.collect();assert.equal(p.today.checkedAt,T,'stale answer at once');
  for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));
  assert.equal(today(),2);assert.equal(log.jobs,1);
  t=T+5*60000+1000;await m.collect();for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));
  assert.equal(log.jobs,2);assert.equal(log.certs,2,'certificates every ten minutes');
});

test('the monitor never holds two research connections at once',async()=>{
  let open=0,most=0,connects=0;
  const client={async query(sql){await new Promise(r=>setTimeout(r,2));
      if(sql===monitor.STUDENT_SQL.active)return {rows:[{active5:0,active60:0}]};
      const key=dailyKey(sql);return {rows:key?DAILY_ROWS[key]:[]};},release(){open--;}};
  const {monitor:m}=fakes({researchPool:()=>({totalCount:1,idleCount:1,waitingCount:0,connect:async()=>{connects++;open++;most=Math.max(most,open);return client;}})});
  const p=await m.collect();
  assert.equal(connects,2);assert.equal(most,1);assert.equal(open,0);
  assert.equal(p.students.available,true);assert.equal(p.today.available,true);
});

test('daily, usage, schedule and certificate probes degrade without failing the request',async()=>{
  healthyTraffic();
  let f=fakes({rows:{fail:{sql:monitor.DAILY_SQL.peak,code:'57014'}}}),p=await f.monitor.collect();
  assert.deepEqual({available:p.today.available,reason:p.today.reason},{available:false,reason:'timeout'});
  assert.equal(f.log.sql.at(-1),'ROLLBACK');assert.equal(f.log.released,2);
  assert.equal(p.verdict.sections.today.level,'unknown');assert.equal(p.verdict.sections.clients.level,'unknown');assert.equal(p.verdict.level,'ok');
  p=await fakes({researchPool:null}).monitor.collect();assert.deepEqual({available:p.today.available,reason:p.today.reason},{available:false,reason:'disabled'});
  p=await fakes({usage:{speechError:'42P01'}}).monitor.collect();assert.deepEqual(p.usage.speech,{month:'2026-10',used:0,limit:4800},'no table yet');
  p=await fakes({usage:{used:null}}).monitor.collect();assert.equal(p.usage.speech.used,0,'no row this month');
  p=await fakes({usage:{speechError:'ECONNRESET'}}).monitor.collect();assert.deepEqual({available:p.usage.available,reason:p.usage.reason},{available:false,reason:'unavailable'});
  p=await fakes({authPool:null}).monitor.collect();assert.equal(p.usage.reason,'unconfigured');
  for(const jobs of [async()=>{throw new Error('ENOENT');},async()=>''])
  {
    p=await fakes({jobs,certificate:async()=>null}).monitor.collect();
    assert.equal(p.upkeep.available,false);assert(p.upkeep.jobs.every(j=>j.loadState==='unknown'&&j.lastAt===null));
    assert(p.upkeep.certs.every(c=>c.daysLeft===null&&c.matches===null&&c.validTo===null));
    assert.deepEqual(p.verdict.sections.upkeep,{level:'unknown',text:'未能讀取排程狀態。'});assert.equal(p.verdict.level,'ok');
  }
  p=await fakes({certificate:async()=>{throw new Error('ECONNREFUSED 10.0.0.1');}}).monitor.collect();
  assert(p.upkeep.certs.every(c=>c.daysLeft===null));assert.equal(p.verdict.sections.upkeep.level,'ok');assert(!JSON.stringify(p).includes('10.0.0.1'));
});

test('ops metrics: one entry per minute for the last hour, failures counted, heartbeats left out',()=>{
  const N=T+30000;
  ops.record({route:'soe',method:'POST',status:200,totalMs:900,now:N-1000});
  ops.record({route:'soe',method:'POST',status:502,totalMs:900,now:N-1500});
  ops.record({route:'school-recordings',method:'POST',status:408,totalMs:900,now:N-5*60000});
  ops.record({route:'school-auth',method:'POST',status:401,now:N-5*60000});
  ops.record({route:'school-auth',method:'GET',status:200,relay:'gz:3100',userAgent:CRON,now:N-2000});
  ops.record({route:'soe',method:'POST',status:200,totalMs:900,now:N-60*60000});
  const series=ops.snapshot(N).series,minute=Math.floor(N/60000)*60000;
  assert.equal(series.length,60);assert.equal(series[0].at,minute-59*60000);assert.equal(series.at(-1).at,minute);
  assert.deepEqual(series.at(-1),{at:minute,count:2,failed:1});
  assert.deepEqual(series.at(-6),{at:minute-5*60000,count:2,failed:1});
  assert.equal(series.reduce((n,m)=>n+m.count,0),4,'an hour ago and the heartbeat are not counted');
});

test('systemctl show output for jobs and the Hong Kong calendar are parsed strictly',()=>{
  const jobs=monitor.parseJobs(jobText({'maanshan-backup':{state:'activating',result:'exit-code'},'maanshan-health-restore':{timerLoad:'not-found',last:'n/a'},
    certbot:{result:'<b>',finished:'n/a',timer:'inactive; rm'}}).replace(/\n/g,'\r\n'));
  assert.deepEqual(jobs['maanshan-backup'],{loadState:'loaded',state:'activating',result:'exit-code',finishedAt:Date.UTC(2026,9,9,2,46),timer:'active',lastAt:Date.UTC(2026,9,9,2,45),nextAt:Date.UTC(2026,9,10,2,15)});
  assert.equal(jobs['maanshan-health-check'].nextAt,null);
  assert.deepEqual([jobs['maanshan-health-restore'].timer,jobs['maanshan-health-restore'].lastAt],['missing',null]);
  assert.deepEqual([jobs.certbot.result,jobs.certbot.finishedAt,jobs.certbot.timer],['unknown',null,'unknown']);
  assert.deepEqual(monitor.parseJobs('Id=x.socket\nLoadState=loaded\n'),{});assert.deepEqual(monitor.parseJobs(''),{});
  assert.deepEqual(monitor.hkCalendar(T),{date:'2026-10-09',month:'2026-10',dayStart:Date.parse('2026-10-08T16:00:00Z'),monthStart:Date.parse('2026-09-30T16:00:00Z')});
  assert.deepEqual(monitor.hkCalendar(Date.parse('2026-10-31T16:00:00Z')),{date:'2026-11-01',month:'2026-11',dayStart:Date.parse('2026-10-31T16:00:00Z'),monthStart:Date.parse('2026-10-31T16:00:00Z')});
  assert.equal(monitor.hkCalendar(Date.parse('2026-10-31T15:59:59Z')).month,'2026-10');
});

test('the speech input limit shown matches the one the route enforces',()=>{
  const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','api','speech-to-text.js'),'utf8');
  assert.equal(Number(/MONTHLY_SITE_LIMIT\s*=\s*(\d+)/.exec(source)?.[1]),monitor.SPEECH_LIMIT);
});

test('missing probes degrade to unknown or unavailable instead of failing the request',async()=>{
  for(const systemctl of [async()=>{throw new Error('ENOENT');},async()=>''])
  {
    const p=await fakes({systemctl}).monitor.collect();
    assert.equal(p.origin.unitsAvailable,false);assert.deepEqual(p.origin.units,[]);
    assert(p.hk.tunnels.every(t=>t.state==='unknown'));assert.notEqual(p.verdict.sections.server.level,'bad');
  }
  let p=await fakes({authPool:null,researchPool:null}).monitor.collect();
  assert.deepEqual({ok:p.db.ok,reason:p.db.reason},{ok:false,reason:'unconfigured'});assert.equal(p.verdict.sections.db.level,'bad');
  assert.deepEqual({available:p.students.available,reason:p.students.reason},{available:false,reason:'disabled'});
  const f=fakes({rows:{fail:{sql:monitor.STUDENT_SQL.errors,code:'42P01'}}});
  p=await f.monitor.collect();
  assert.equal(p.students.reason,'missing');assert.equal(f.log.released,2);
  assert.deepEqual(f.log.sql.slice(0,5),['BEGIN READ ONLY',"SET LOCAL statement_timeout = '3s'",monitor.STUDENT_SQL.active,monitor.STUDENT_SQL.errors,'ROLLBACK']);
  p=await fakes({authPool:()=>({totalCount:1,idleCount:0,waitingCount:0,query:async()=>{throw new Error('ECONNREFUSED 10.0.0.1');}})}).monitor.collect();
  assert.deepEqual({ok:p.db.ok,reason:p.db.reason},{ok:false,reason:'unavailable'});assert(!JSON.stringify(p).includes('10.0.0.1'));
  p=await fakes({units:{'maanshan-hk-tunnel@3101':{ActiveState:'failed',SubState:'failed',NRestarts:'12'}}}).monitor.collect();
  assert.deepEqual(p.hk.tunnels[1],{port:3101,state:'failed',upSinceS:null,restarts:12,lastSeenAt:null});
});

test('verdict rules: each section raises only what needs attention',async()=>{
  healthyTraffic();
  const base=await fakes().monitor.collect(),clone=()=>structuredClone(base),judge=p=>monitor.judge(p,T);
  assert.equal(judge(clone()).level,'ok');
  let p=clone();p.origin.units.find(u=>u.unit==='nginx').activeState='failed';
  let v=judge(p);assert.equal(v.sections.server.level,'bad');assert.equal(v.level,'bad');assert.match(v.text,/^有問題：廣州伺服器/);
  p=clone();p.origin.rssMB=700;assert.equal(judge(p).sections.server.level,'bad');
  p=clone();p.origin.rssMB=640;assert.equal(judge(p).sections.server.level,'warn');
  p=clone();p.origin.diskFreePct=9;assert.equal(judge(p).sections.server.level,'warn');
  p=clone();p.hk.tunnels[1].state='failed';v=judge(p);assert.equal(v.sections.hk.level,'warn');assert.match(v.sections.hk.text,/3101/);assert.match(v.text,/^需要留意：香港中轉/);
  p=clone();p.hk.tunnels.forEach(t=>{t.state='failed';});assert.equal(judge(p).sections.hk.level,'warn');
  p.hk.lastHeartbeatAt=T-10*60000;assert.equal(judge(p).sections.hk.level,'bad');
  p=clone();p.hk.hop15={hop:5,total:12,ratio:5/12};assert.equal(judge(p).sections.hk.level,'warn');
  p=clone();p.hk.hop15={hop:3,total:4,ratio:.75};assert.equal(judge(p).sections.hk.level,'ok','too few requests to judge');
  p=clone();p.hk.renewal.daysLeft=3;assert.match(judge(p).sections.hk.text,/3 天後到期/);
  p=clone();p.vercel.iad1.lastAt=T-5*60000;v=judge(p);assert.equal(v.sections.vercel.level,'bad');assert.match(v.sections.vercel.text,/美國節點/);
  p=clone();p.origin.uptimeS=60;p.vercel.iad1.lastAt=null;p.vercel.hkg1.lastAt=null;p.hk.lastHeartbeatAt=null;
  v=judge(p);assert.equal(v.sections.vercel.level,'ok','grace period after a restart');assert.equal(v.sections.hk.level,'ok');
  p=clone();p.db.latencyMs=800;assert.equal(judge(p).sections.db.level,'warn');
  p=clone();p.origin.units.find(u=>u.unit==='postgresql@14-main').activeState='inactive';assert.equal(judge(p).sections.db.level,'bad');
  p=clone();Object.assign(p.traffic[60].routes[0],{count:5,p95Ms:9000});v=judge(p);assert.equal(v.sections.latency.level,'warn');assert.match(v.sections.latency.text,/近 1 小時朗讀評分偏慢/);
  p=clone();Object.assign(p.traffic[60].routes[0],{count:2,p95Ms:9000});assert.equal(judge(p).sections.latency.level,'ok','too few to judge');
  p=clone();Object.assign(p.traffic[5].totals,{count:20,s5xx:6});assert.equal(judge(p).sections.errors.level,'bad');
  p=clone();Object.assign(p.traffic[5].totals,{count:500,s5xx:6});Object.assign(p.traffic[60].totals,{count:500,s5xx:6});v=judge(p);assert.equal(v.sections.errors.level,'ok','a few errors among many requests');assert.match(v.sections.errors.text,/近 1 小時有零星錯誤（6 個）/);
  p=clone();p.students.clientErrors={network:6,timeout:3};assert.equal(judge(p).sections.errors.level,'ok','below ten in an hour');
  p=clone();p.students.clientErrors={network:6,timeout:4};v=judge(p);assert.equal(v.sections.errors.level,'warn');assert.match(v.sections.errors.text,/近 1 小時學生端有 10 次/);
  p=clone();p.students.providerErrors=[{operation:'reading',code:'provider_unavailable',n:12}];assert.match(judge(p).sections.errors.text,/近 1 小時朗讀評分服務失敗 12 次/);
  p=clone();Object.assign(p.traffic[60].totals,{s504:6,s408:4});assert.equal(judge(p).sections.errors.level,'warn');
});

test('verdict rules for services and upkeep; the figures sections never change the overall level',async()=>{
  healthyTraffic();
  const base=await fakes().monitor.collect(),clone=()=>structuredClone(base),judge=p=>monitor.judge(p,T);
  let p=clone();Object.assign(p.traffic[60].routes[0],{count:20,s5xx:5,s408:1});let v=judge(p);
  assert.deepEqual(v.sections.services,{level:'warn',text:'近 1 小時朗讀評分失敗 6 次（30%）。'});assert.match(v.text,/^需要留意：外部服務/);
  p=clone();Object.assign(p.traffic[60].routes[0],{count:200,s5xx:5});assert.deepEqual(judge(p).sections.services,{level:'ok',text:'近 1 小時成功率 97.5%。'},'5 of 200 is not worth a warning');
  p=clone();Object.assign(p.traffic[60].routes[0],{count:2000,s5xx:1});assert.match(judge(p).sections.services.text,/成功率 99\.9%/,'never rounded up to 100');
  p=clone();p.traffic[60].routes.forEach(r=>{r.count=0;});assert.equal(judge(p).sections.services.text,'近 1 小時沒有人使用外部服務。');
  p=clone();p.usage.speech.used=4800;assert.match(judge(p).sections.services.text,/額度已用完/);
  p=clone();p.usage.speech.used=4400;assert.deepEqual(judge(p).sections.services,{level:'warn',text:'本月語音輸入已用 4400 / 4800 次，快用完了。'});
  p=clone();p.upkeep.jobs[0].result='exit-code';v=judge(p);assert.deepEqual(v.sections.upkeep,{level:'bad',text:'每日備份上次失敗。'});assert.match(v.text,/^有問題：維護與備份/);
  p=clone();p.upkeep.jobs[0].lastAt=T-31*3600000;assert.deepEqual(judge(p).sections.upkeep,{level:'bad',text:'每日備份已 31 小時沒有運行。'});
  p=clone();p.upkeep.jobs[1].result='exit-code';assert.deepEqual(judge(p).sections.upkeep,{level:'warn',text:'健康檢查上次失敗。'});
  p=clone();p.upkeep.jobs[2].lastAt=null;assert.deepEqual(judge(p).sections.upkeep,{level:'warn',text:'恢復演練從未運行。'});
  p=clone();p.upkeep.jobs[3].timer='inactive';assert.deepEqual(judge(p).sections.upkeep,{level:'warn',text:'證書續期的排程已停止。'});
  p=clone();p.upkeep.jobs[3].loadState='not-found';p.upkeep.jobs[3].lastAt=null;assert.equal(judge(p).sections.upkeep.level,'ok','a job that is not installed is skipped');
  p=clone();p.upkeep.certs[1].daysLeft=15;assert.deepEqual(judge(p).sections.upkeep,{level:'warn',text:'展示版證書 15 天後到期，自動續期可能失敗。'});
  p=clone();p.upkeep.certs[0].daysLeft=5;assert.deepEqual(judge(p).sections.upkeep,{level:'bad',text:'學生平台證書 5 天後到期。'});
  p=clone();p.upkeep.certs[0].matches=false;p.upkeep.certs[1].daysLeft=15;
  assert.deepEqual(judge(p).sections.upkeep,{level:'bad',text:'學生平台證書與網址不符，展示版證書 15 天後到期，自動續期可能失敗。'});
  p=clone();p.today={available:false,reason:'timeout'};p.traffic.series=[];v=judge(p);
  assert.deepEqual([v.sections.today.level,v.sections.week.level,v.sections.clients.level,v.sections.trend.text],['unknown','unknown','unknown','近 60 分鐘沒有請求。']);
  assert.equal(v.level,'ok');assert.equal(v.text,'全部正常。');
  p=clone();p.origin.uptimeS=30;p.traffic.series=[];assert.equal(judge(p).sections.trend.text,'伺服器剛重啟，正在重新統計。');
  p=clone();p.today.pupils=0;p.today.clientErrors=[];v=judge(p);assert.equal(v.sections.today.text,'今天還沒有學生使用。');assert.equal(v.sections.clients.text,'今天學生裝置沒有回報問題。');
  p=clone();delete p.today.clientErrorPupils;p.today.clientErrors=[{code:'network',label:'網絡中斷',count:4},{code:'unknown',label:'其他',count:1}];
  assert.deepEqual(judge(p).sections.clients,{level:'info',text:'今天共 5 次，最多是「網絡中斷」。'},'figures from an older server');
  p=clone();delete p.today;delete p.usage;delete p.upkeep;delete p.traffic[60];delete p.traffic.series;v=judge(p);
  assert.equal(v.level,'ok','an older payload without the new fields still judges');
});
