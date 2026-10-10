'use strict';
// In-memory traffic aggregates for the site monitor (網站後台). The origin is a
// single process; the handler bundle inlines its own copy of this module, so
// the state lives on one global symbol shared by server/index.cjs and handlers.
// Fixed labels, statuses and timings only: never addresses, accounts or payloads.
const {monitorEventLoopDelay}=require('node:perf_hooks');

const KEY=Symbol.for('maanshan.ops.v1');
const MINUTE=60000,BUCKETS=60,SAMPLES=120,RECENT_ERRORS=20;
const LABEL=/^(hop-)?(hk|gz):(310[0-2])$/;
const CRON=/^vercel-cron\//i;
// Pupil-facing routes whose latency is reported; heartbeats, research uploads
// and teacher routes are counted but never mixed into these figures.
const STUDENT_ROUTES=['soe','school-recordings','tts','maanshan-chat','handwriting','speech-to-text','maanshan-report'];
const SAMPLED=new Set(STUDENT_ROUTES);

function state(){
  let s=globalThis[KEY];
  if(!s){
    s={startedAt:Date.now(),buckets:new Map(),heartbeat:{hkg1:null,iad1:null},ports:{},lastHop:null,lastDirect:null,errors:[],loop:null};
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
function routeStats(bucket,route){
  return bucket.routes[route]||(bucket.routes[route]={count:0,s5xx:0,s504:0,s408:0,s499:0,s4xx:0,samples:[],sampled:0});
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
  const stats=routeStats(bucket,route);stats.count++;
  if(status>=500)stats.s5xx++;
  if(status===504)stats.s504++;else if(status===408)stats.s408++;else if(status===499)stats.s499++;else if(status>=400&&status<500)stats.s4xx++;
  if(SAMPLED.has(route)&&status<400&&Number.isFinite(totalMs)&&totalMs>=0){
    // Reservoir sample: a fixed amount of memory per route and minute.
    stats.sampled++;
    if(stats.samples.length<SAMPLES)stats.samples.push(totalMs);
    else{const j=Math.floor(Math.random()*stats.sampled);if(j<SAMPLES)stats.samples[j]=totalMs;}
  }
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
    if(bucket.minute<from)continue;
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
    windows:{5:windowSummary(s,now,5),15:windowSummary(s,now,15),60:windowSummary(s,now,60)},
    series:series(s,now),errors:s.errors.slice(-RECENT_ERRORS).reverse(),eventLoop:s.loop?.last||current};
}
function reset(){const s=globalThis[KEY];s?.loop?.histogram.disable();delete globalThis[KEY];}

module.exports={record,snapshot,reset,heartbeatOf,percentile,STUDENT_ROUTES,KEY};
