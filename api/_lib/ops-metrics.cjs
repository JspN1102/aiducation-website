'use strict';
// In-memory traffic aggregates for the site monitor (網站後台). The origin is a
// single process; the handler bundle inlines its own copy of this module, so
// the state lives on one global symbol shared by server/index.cjs and handlers.
// Fixed labels, statuses and timings only: never addresses, accounts or payloads.
const fs=require('node:fs');
const {monitorEventLoopDelay}=require('node:perf_hooks');

const KEY=Symbol.for('maanshan.ops.v1');
const MINUTE=60000,BUCKETS=60,SAMPLES=120,RECENT_ERRORS=20,HK_OFFSET=8*3600000;
// Hourly buckets for the last 24 hours, with a larger sample each.
const HOUR=60*MINUTE,HOURS=24,HOUR_SAMPLES=240,SAVE_MS=MINUTE,FILE_VERSION=1;
const LABEL=/^(hop-)?(hk|gz):(310[0-2])$/;
const CRON=/^vercel-cron\//i;
// Pupil-facing routes whose latency is reported; heartbeats, research uploads
// and teacher routes are counted but never mixed into these figures.
const STUDENT_ROUTES=['soe','school-recordings','tts','maanshan-chat','handwriting','speech-to-text','maanshan-report'];
const SAMPLED=new Set(STUDENT_ROUTES);

function state(){
  let s=globalThis[KEY];
  if(!s){
    s={startedAt:Date.now(),since:Date.now(),restoredAt:null,buckets:new Map(),hours:new Map(),heartbeat:{hkg1:null,iad1:null},ports:{},lastHop:null,lastDirect:null,errors:[],loop:null};
    try{const histogram=monitorEventLoopDelay({resolution:20});histogram.enable();s.loop={histogram,since:Date.now(),last:null};}catch{}
    Object.defineProperty(globalThis,KEY,{value:s,configurable:true});
  }
  return s;
}

// hkg1 crons reach the origin through a Hong Kong port, or hop to iad1 and
// arrive as hop-gz; the iad1 cron always goes direct (gz:3100).
function heartbeatOf({route,method,userAgent,relay}){
  if(route!=='school-auth'||method!=='GET'||typeof userAgent!=='string'||!CRON.test(userAgent))return null;
  const m=typeof relay==='string'&&LABEL.exec(relay);
  if(!m)return null;
  if(m[2]==='hk'||m[1])return 'hkg1';
  return 'iad1';
}

function bucketFor(s,now){
  const minute=Math.floor(now/MINUTE);
  let bucket=s.buckets.get(minute);
  if(!bucket){
    bucket={minute,routes:{},relay:{},beats:0};s.buckets.set(minute,bucket);
    for(const key of s.buckets.keys())if(key<=minute-BUCKETS)s.buckets.delete(key);
  }
  return bucket;
}
function hourFor(s,now){
  const hour=Math.floor(now/HOUR);
  let bucket=s.hours.get(hour);
  if(!bucket){
    bucket={hour,routes:{}};s.hours.set(hour,bucket);
    for(const key of s.hours.keys())if(key<=hour-HOURS)s.hours.delete(key);
  }
  return bucket;
}
function routeStats(bucket,route){
  return bucket.routes[route]||(bucket.routes[route]={count:0,s5xx:0,s504:0,s408:0,s499:0,s4xx:0,samples:[],sampled:0});
}
// Hong Kong calendar day: counts for "today" reset at Hong Kong midnight (and on restart).
const hkDate=now=>new Date(now+HK_OFFSET).toISOString().slice(0,10);
function dayFor(s,now){
  const date=hkDate(now);
  if(s.day?.date!==date){
    // The first day of a process starts at the restart; later days at midnight.
    const midnight=now-(now+HK_OFFSET)%86400000,restarted=!s.day&&s.startedAt>midnight;
    s.day={date,since:restarted?s.startedAt:midnight,restarted,totals:{count:0,s5xx:0,s504:0,s408:0,s499:0,s4xx:0}};
  }
  return s.day;
}
function rotateLoop(s,now){
  const loop=s.loop;if(!loop||now-loop.since<MINUTE)return;
  const h=loop.histogram;
  if(h.count>0)loop.last={p50Ms:h.percentile(50)/1e6,p99Ms:h.percentile(99)/1e6,maxMs:h.max/1e6,at:now};
  h.reset();loop.since=now;
}

function record({route,method,status,totalMs,relay,userAgent,now=Date.now()}={}){
  if(!route||route==='health'||route==='unknown'||!Number.isInteger(status))return;
  const s=state();rotateLoop(s,now);
  const bucket=bucketFor(s,now),m=typeof relay==='string'?LABEL.exec(relay):null;
  if(m){
    const label=m[0];bucket.relay[label]=(bucket.relay[label]||0)+1;
    if(m[2]==='hk'&&status<500)s.ports[m[3]]=now;
    if(m[1])s.lastHop=now;else if(m[2]==='gz')s.lastDirect=now;
  }
  const beat=heartbeatOf({route,method,userAgent,relay});
  if(beat){bucket.beats++;if(status<500)s.heartbeat[beat]=now;}
  if(status>=500||status===408||(status===413&&route==='tts')){s.errors.push({at:now,route,status});if(s.errors.length>RECENT_ERRORS)s.errors.splice(0,s.errors.length-RECENT_ERRORS);}
  if(beat&&status<500)return;
  tally(route,status,totalMs,routeStats(bucket,route),routeStats(hourFor(s,now),route),dayFor(s,now).totals);
}
// Adds one request to its minute, hour and day (any of them may be left out).
function tally(route,status,totalMs,minute,hourly,day){
  const key=status===504?'s504':status===408?'s408':status===499?'s499':status>=400&&status<500?'s4xx':null;
  for(const t of [minute,hourly,day])if(t){t.count++;if(status>=500)t.s5xx++;if(key)t[key]++;}
  if(SAMPLED.has(route)&&status<400&&Number.isFinite(totalMs)&&totalMs>=0){if(minute)sample(minute,totalMs,SAMPLES);if(hourly)sample(hourly,totalMs,HOUR_SAMPLES);}
}
// Requests the counters never saw (before counting began, or between the last
// save and a restart) are read back from the service log, so a deploy does not
// empty the last 24 hours. The log has no user agent: successful GET
// school-auth lines are skipped because cron heartbeats look the same there.
function replay(entries,now=Date.now()){
  const s=state(),day=dayFor(s,now);let added=0;
  for(const e of Array.isArray(entries)?entries:[]){
    const {at,route,method,status,totalMs,relay}=e||{};
    if(!Number.isFinite(at)||at<=now-HOURS*HOUR||at>now||typeof route!=='string'||!ROUTE.test(route)||route==='health'||route==='unknown'||!Number.isInteger(status))continue;
    if(status>=500||status===408||(status===413&&route==='tts'))s.errors.push({at,route,status});
    if(route==='school-auth'&&method==='GET'&&status<500)continue;
    const bucket=at>now-BUCKETS*MINUTE?bucketFor(s,at):null,m=bucket&&typeof relay==='string'?LABEL.exec(relay):null;
    if(m)bucket.relay[m[0]]=(bucket.relay[m[0]]||0)+1;
    tally(route,status,totalMs,bucket&&routeStats(bucket,route),routeStats(hourFor(s,at),route),hkDate(at)===day.date?day.totals:null);
    added++;
  }
  s.errors.sort((a,b)=>a.at-b.at);if(s.errors.length>RECENT_ERRORS)s.errors.splice(0,s.errors.length-RECENT_ERRORS);
  return added;
}
// read(from,until) resolves to [{at,route,method,status,totalMs,relay}].
async function backfill(read,now=Date.now()){
  const s=state(),from=now-HOURS*HOUR,gaps=[];
  if(s.since>from+MINUTE)gaps.push(['before',from,s.since]);
  if(Number.isFinite(s.restoredAt)&&s.startedAt>s.restoredAt&&s.startedAt>from)gaps.push(['restart',Math.max(s.restoredAt,from),s.startedAt]);
  let added=0;
  for(const [kind,a,b] of gaps){
    let entries;
    try{entries=await read(a,b);}catch{continue;}
    added+=replay((Array.isArray(entries)?entries:[]).filter(e=>e?.at>=a&&e.at<b),Date.now());
    if(kind==='before'){
      s.since=Math.min(s.since,a);
      const midnight=now-(now+HK_OFFSET)%86400000,day=dayFor(s,now);
      if(day.since>a){day.since=Math.max(midnight,a);day.restarted=day.since>midnight;}
    }
  }
  s.backfilled={at:Date.now(),added};
  return added;
}
// Reservoir sample: a fixed amount of memory per route and minute (or hour).
function sample(stats,ms,size){
  stats.sampled++;
  if(stats.samples.length<size)stats.samples.push(ms);
  else{const j=Math.floor(Math.random()*stats.sampled);if(j<size)stats.samples[j]=ms;}
}

function percentile(sorted,p){
  if(!sorted.length)return null;
  const rank=(sorted.length-1)*p,low=Math.floor(rank),high=Math.ceil(rank);
  return Math.round(sorted[low]+(sorted[high]-sorted[low])*(rank-low));
}
function windowSummary(s,now,minutes){
  const from=Math.floor(now/MINUTE)-minutes+1,routes={},relay={},totals={count:0,s5xx:0,s504:0,s408:0,s499:0,s4xx:0};
  const samples={};let beats=0;
  for(const bucket of s.buckets.values()){
    if(bucket.minute<from||bucket.minute>from+minutes-1)continue;
    beats+=bucket.beats;
    for(const [label,count]of Object.entries(bucket.relay))relay[label]=(relay[label]||0)+count;
    for(const [route,stats]of Object.entries(bucket.routes)){
      const into=routes[route]||(routes[route]={count:0,s5xx:0,s504:0,s408:0,s499:0,s4xx:0});
      for(const key of Object.keys(totals)){into[key]+=stats[key];totals[key]+=stats[key];}
      if(stats.samples.length)(samples[route]||(samples[route]=[])).push(...stats.samples);
    }
  }
  for(const [route,stats]of Object.entries(routes)){
    const sorted=(samples[route]||[]).sort((a,b)=>a-b);
    if(SAMPLED.has(route))Object.assign(stats,{p50Ms:percentile(sorted,.5),p95Ms:percentile(sorted,.95)});
  }
  let hk=0,hop=0,direct=0;
  for(const [label,count]of Object.entries(relay)){if(label.startsWith('hop-'))hop+=count;else if(label.startsWith('hk:'))hk+=count;else direct+=count;}
  return {minutes,totals,routes,relay,beats,hk,hop,direct,hopRatio:hk+hop?hop/(hk+hop):null};
}

// The last 24 hours from the hourly buckets (the current hour and the 23
// before it): totals and per-route counts and timings, same shape as a window.
function daySummary(s,now){
  const from=Math.floor(now/HOUR)-HOURS+1,routes={},totals={count:0,s5xx:0,s504:0,s408:0,s499:0,s4xx:0},samples={};
  for(const bucket of s.hours.values()){
    if(bucket.hour<from||bucket.hour>from+HOURS-1)continue;
    for(const [route,stats]of Object.entries(bucket.routes)){
      const into=routes[route]||(routes[route]={count:0,s5xx:0,s504:0,s408:0,s499:0,s4xx:0});
      for(const key of Object.keys(totals)){into[key]+=stats[key];totals[key]+=stats[key];}
      // Each hour's sample stands for that hour's requests: weighted, so a
      // busy hour is not outvoted by a quiet one.
      if(stats.samples.length)(samples[route]||(samples[route]=[])).push({values:stats.samples,weight:stats.sampled/stats.samples.length});
    }
  }
  for(const [route,stats]of Object.entries(routes)){
    if(!SAMPLED.has(route))continue;
    const all=(samples[route]||[]).flatMap(({values,weight})=>values.map(ms=>[ms,weight])).sort((a,b)=>a[0]-b[0]);
    Object.assign(stats,{p50Ms:weighted(all,.5),p95Ms:weighted(all,.95)});
  }
  return {minutes:HOURS*60,totals,routes};
}
function weighted(sorted,p){
  if(!sorted.length)return null;
  const total=sorted.reduce((n,[,w])=>n+w,0);let seen=0;
  for(const [ms,w]of sorted){seen+=w;if(seen>=total*p)return Math.round(ms);}
  return Math.round(sorted[sorted.length-1][0]);
}

// One entry per minute for the last hour, oldest first: every counted request
// (heartbeats excluded) and the failures among them (5xx and upload timeouts).
function series(s,now){
  const last=Math.floor(now/MINUTE),out=[];
  for(let minute=last-BUCKETS+1;minute<=last;minute++){
    let count=0,failed=0;
    for(const stats of Object.values(s.buckets.get(minute)?.routes||{})){count+=stats.count;failed+=stats.s5xx+stats.s408;}
    out.push({at:minute*MINUTE,count,failed});
  }
  return out;
}

function snapshot(now=Date.now()){
  const s=state();rotateLoop(s,now);
  const h=s.loop?.histogram,current=h&&h.count>0?{p50Ms:h.percentile(50)/1e6,p99Ms:h.percentile(99)/1e6,maxMs:h.max/1e6,at:now}:null;
  return {startedAt:s.startedAt,now,heartbeat:{...s.heartbeat},ports:{...s.ports},lastHop:s.lastHop,lastDirect:s.lastDirect,
    since:s.since,restoredAt:s.restoredAt,
    windows:{5:windowSummary(s,now,5),15:windowSummary(s,now,15),60:windowSummary(s,now,60),1440:daySummary(s,now)},
    day:(({date,since,restarted,totals})=>({date,since,restarted,totals:{...totals}}))(dayFor(s,now)),series:series(s,now),errors:s.errors.slice(-RECENT_ERRORS).reverse(),eventLoop:s.loop?.last||current};
}
function reset(){const s=globalThis[KEY];s?.loop?.histogram.disable();if(s?.timer)clearInterval(s.timer);delete globalThis[KEY];}

// Survive restarts (every deploy restarts the origin): the counts are saved to
// a file once a minute and on shutdown, and read back on start. Counts,
// statuses and timings only, as in memory. A missing or unreadable file just
// means starting from zero.
const ROUTE=/^[a-z][a-z0-9-]{0,40}$/;
const count=v=>Number.isInteger(v)&&v>=0?v:0;
function cleanRoutes(routes,size){
  const out={};
  for(const [route,r]of Object.entries(routes&&typeof routes==='object'?routes:{})){
    if(!ROUTE.test(route)||!r||typeof r!=='object')continue;
    const samples=Array.isArray(r.samples)?r.samples.filter(ms=>Number.isFinite(ms)&&ms>=0).slice(0,size):[];
    out[route]={count:count(r.count),s5xx:count(r.s5xx),s504:count(r.s504),s408:count(r.s408),s499:count(r.s499),s4xx:count(r.s4xx),samples,sampled:Math.max(count(r.sampled),samples.length)};
  }
  return out;
}
function load(file,now=Date.now()){
  let data;
  try{data=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return false;}
  if(data?.version!==FILE_VERSION||!Number.isFinite(data.savedAt)||data.savedAt>now+MINUTE)return false;
  const s=state(),minute=Math.floor(now/MINUTE),hour=Math.floor(now/HOUR);
  for(const b of Array.isArray(data.buckets)?data.buckets:[]){
    if(!Number.isInteger(b?.minute)||b.minute<=minute-BUCKETS||b.minute>minute||s.buckets.has(b.minute))continue;
    const relay={};for(const [label,n]of Object.entries(b.relay||{}))if(LABEL.test(label))relay[label]=count(n);
    s.buckets.set(b.minute,{minute:b.minute,routes:cleanRoutes(b.routes,SAMPLES),relay,beats:count(b.beats)});
  }
  for(const b of Array.isArray(data.hours)?data.hours:[]){
    if(!Number.isInteger(b?.hour)||b.hour<=hour-HOURS||b.hour>hour||s.hours.has(b.hour))continue;
    s.hours.set(b.hour,{hour:b.hour,routes:cleanRoutes(b.routes,HOUR_SAMPLES)});
  }
  const d=data.day;
  if(d&&d.date===hkDate(now)&&!s.day)s.day={date:d.date,since:Number.isFinite(d.since)?d.since:s.startedAt,restarted:d.restarted===true,
    totals:Object.fromEntries(['count','s5xx','s504','s408','s499','s4xx'].map(k=>[k,count(d.totals?.[k])]))};
  if(Array.isArray(data.errors))s.errors=data.errors.filter(e=>Number.isFinite(e?.at)&&e.at>now-HOURS*HOUR&&typeof e.route==='string'&&ROUTE.test(e.route)&&Number.isInteger(e.status))
    .map(({at,route,status})=>({at,route,status})).concat(s.errors).slice(-RECENT_ERRORS);
  if(Number.isFinite(data.since)&&data.since<s.since)s.since=data.since;
  s.restoredAt=data.savedAt;
  return true;
}
function save(file,now=Date.now()){
  const s=globalThis[KEY];if(!s)return false;
  const data={version:FILE_VERSION,savedAt:now,since:s.since,day:s.day||null,errors:s.errors,buckets:[...s.buckets.values()],hours:[...s.hours.values()]};
  const tmp=file+'.tmp';
  try{fs.writeFileSync(tmp,JSON.stringify(data),{mode:0o600});fs.renameSync(tmp,file);return true;}
  catch{try{fs.unlinkSync(tmp);}catch{}return false;}
}
// Reads the file once and saves every minute; returns a function that saves
// one last time and stops (call it on shutdown).
function persist(file,{backfill:read}={}){
  if(typeof file!=='string'||!file)return ()=>{};
  load(file);
  const s=state();
  if(typeof read==='function')backfill(read).then(()=>save(file),()=>{});
  if(s.timer)clearInterval(s.timer);
  s.timer=setInterval(()=>save(file),SAVE_MS);s.timer.unref?.();
  return ()=>{clearInterval(s.timer);s.timer=null;save(file);};
}

module.exports={record,snapshot,reset,heartbeatOf,percentile,persist,load,save,replay,backfill,STUDENT_ROUTES,KEY};
