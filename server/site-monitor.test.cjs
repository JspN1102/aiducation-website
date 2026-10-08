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
function fakes({units={},systemctl,authPool,researchPool,rows={},uptimeS=5*3600,rssMB=200}={}){
  const log={systemctl:0,sql:[],released:0};
  const client={async query(sql){log.sql.push(sql);
      if(rows.fail&&sql===rows.fail.sql)throw Object.assign(new Error('x'),{code:rows.fail.code});
      if(sql===monitor.STUDENT_SQL.active)return {rows:[rows.active||{active5:3,active60:41}]};
      if(sql===monitor.STUDENT_SQL.errors)return {rows:rows.errors||[]};
      if(sql===monitor.STUDENT_SQL.latency)return {rows:rows.latency||[]};
      return {rows:[]};},release(){log.released++;}};
  let tick=0;
  const options={now:()=>T,clock:()=>(tick+=7),uptime:()=>uptimeS,memory:()=>({rss:rssMB*MB,heapUsed:80*MB}),loadavg:()=>[0.123,0.2,0.3],
    system:()=>({cpus:2,totalMB:3900,availableMB:2100}),release:()=>({commit:'abc1234',builtAt:'2026-10-09T01:00:00.000Z'}),disk:()=>42.5,
    systemctl:systemctl||(async list=>{log.systemctl++;return unitText(list,units);}),
    authPool:authPool===undefined?()=>({totalCount:3,idleCount:2,waitingCount:0,query:async()=>({rows:[{'?column?':1}]})}):authPool,
    researchPool:researchPool===undefined?()=>({totalCount:2,idleCount:2,waitingCount:0,connect:async()=>client}):researchPool,metrics:ops};
  return {monitor:monitor.createSiteMonitor(options),log};
}
function healthyTraffic(){
  for(let i=0;i<4;i++)ops.record({route:'soe',method:'POST',status:200,totalMs:2000+i*500,relay:'hk:310'+(i%3),now:T-60000});
  ops.record({route:'school-auth',method:'GET',status:200,relay:'hk:3101',userAgent:CRON,now:T-30000});
  ops.record({route:'school-auth',method:'GET',status:200,relay:'gz:3100',userAgent:CRON,now:T-25000});
}

test('payload shape: aggregates from injected systemd, database and traffic fakes, nothing identifying',async()=>{
  healthyTraffic();
  const {monitor:m,log}=fakes({rows:{errors:[{server:false,code:'network',operation:null,n15:2,n60:6},{server:false,code:'<script>',operation:null,n15:1,n60:1},
      {server:true,code:'timeout',operation:'reading',n15:1,n60:3},{server:true,code:'provider_unavailable',operation:'r_secret',n15:0,n60:1}],
    latency:[{kind:'reading',n:12,p50:2310.4,p95:6100.6}]}});
  const p=await m.collect();
  assert.deepEqual(Object.keys(p),['ok','schemaVersion','generatedAt','origin','db','hk','vercel','traffic','students','verdict']);
  assert.equal(p.generatedAt,'2026-10-09T03:00:00.000Z');
  assert.equal(p.origin.unitsAvailable,true);assert.equal(p.origin.units.length,8);
  assert(p.origin.units.every(u=>u.activeState==='active'&&u.label&&Number.isFinite(u.activeSince)));
  assert.equal(p.origin.rssMB,200);assert.equal(p.origin.memoryLimitMB,768);assert.equal(p.origin.diskFreePct,42.5);assert.deepEqual(p.origin.loadavg,[0.12,0.2,0.3]);
  assert.deepEqual(p.origin.release,{commit:'abc1234',builtAt:'2026-10-09T01:00:00.000Z'});assert.equal(p.origin.uptimeS,18000);
  assert.deepEqual({ok:p.db.ok,latencyMs:p.db.latencyMs,pools:p.db.pools},{ok:true,latencyMs:7,pools:{auth:{total:3,idle:2,waiting:0},research:{total:2,idle:2,waiting:0}}});
  assert.deepEqual(p.hk.tunnels.map(t=>[t.port,t.state,t.upSinceS]),[[3100,'active',7200],[3101,'active',7200],[3102,'active',7200]]);
  assert.equal(p.hk.tunnels[1].lastSeenAt,T-30000);assert.equal(p.hk.lastHeartbeatAt,T-30000);
  assert.deepEqual(p.hk.renewal,{date:'2026-11-07',daysLeft:29});assert.deepEqual(p.hk.hop15,{hop:0,total:5,ratio:0});
  assert.deepEqual(p.vercel,{hkg1:{lastAt:T-30000,ageS:30},iad1:{lastAt:T-25000,ageS:25}});
  assert.deepEqual(p.traffic[5].routes.map(r=>r.route),ops.STUDENT_ROUTES);
  assert.deepEqual(p.traffic[15].routes[0],{route:'soe',label:'朗讀評分',count:4,p50Ms:2750,p95Ms:3425,s5xx:0,s504:0,s408:0});
  assert.deepEqual(p.traffic.recentErrors,[]);
  assert.equal(p.students.available,true);assert.equal(p.students.active5,3);assert.equal(p.students.active60,41);
  assert.deepEqual(p.students.clientErrors,{network:{n15:2,n60:6},unknown:{n15:1,n60:1}});
  assert.deepEqual(p.students.providerErrors,[{operation:'reading',code:'timeout',n15:1,n60:3},{operation:'other',code:'provider_unavailable',n15:0,n60:1}]);
  assert.deepEqual(p.students.latency,[{kind:'reading',label:'朗讀評分',count:12,p50Ms:2310,p95Ms:6101},{kind:'report',label:'朗讀報告',count:0,p50Ms:null,p95Ms:null},{kind:'chat',label:'對話',count:0,p50Ms:null,p95Ms:null}]);
  assert.deepEqual(log.sql,['BEGIN READ ONLY',"SET LOCAL statement_timeout = '3s'",monitor.STUDENT_SQL.active,monitor.STUDENT_SQL.errors,monitor.STUDENT_SQL.latency,'COMMIT']);
  assert.equal(log.released,1);
  assert.equal(p.verdict.level,'ok');assert.equal(p.verdict.text,'全部正常。');
  assert.deepEqual(Object.keys(p.verdict.sections),['server','hk','vercel','db','latency','errors']);
  const text=JSON.stringify(p);
  for(const leak of ['<script>','r_secret','vercel-cron','research_id','jasper'])assert(!text.includes(leak),leak);
  assert(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(text),'no addresses');
  await m.collect();assert.equal(log.systemctl,1,'host probe is shared for 10 seconds');
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
  assert.equal(p.students.reason,'missing');assert.equal(f.log.sql.at(-1),'ROLLBACK');assert.equal(f.log.released,1);
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
  p=clone();p.traffic[15].routes[0].p95Ms=9000;assert.equal(judge(p).sections.latency.level,'warn');
  p=clone();Object.assign(p.traffic[5].totals,{count:20,s5xx:6});assert.equal(judge(p).sections.errors.level,'bad');
  p=clone();Object.assign(p.traffic[5].totals,{count:500,s5xx:6});Object.assign(p.traffic[15].totals,{count:500,s5xx:6});assert.equal(judge(p).sections.errors.level,'ok','a few errors among many requests');
  p=clone();p.students.clientErrors={network:{n15:3,n60:3},timeout:{n15:2,n60:2}};assert.equal(judge(p).sections.errors.level,'warn');
  p=clone();p.students.providerErrors=[{operation:'reading',code:'provider_unavailable',n15:6,n60:6}];assert.match(judge(p).sections.errors.text,/朗讀評分服務失敗 6 次/);
  p=clone();Object.assign(p.traffic[15].totals,{s504:3,s408:2});assert.equal(judge(p).sections.errors.level,'warn');
});
