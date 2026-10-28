'use strict';
// school74 within-pupil study: aggregates from a research export (deploy/research-export.cjs).
// Reads <export>/events.jsonl and prints counts, means and paired comparisons only, never a
// researchId, a name or an utterance:
//
//   node scripts/school74-study-report.cjs <export directory> [--from YYYY-MM-DD]
//
// 先讀後聽 (demoArm) and 拼音逐步隱藏 (pinyinArm) come from the reading attempt_started
// context; each attempt's score is the server-verified reading provider_result of the same
// attempt. A line's day score is its first scored attempt that study day (Hong Kong, from 06:00).
// 選字自查 answers are joined to their reading attempt; 每日溫故 counts come from the
// p<id>.warmup.<spot|rule> items. 下週挑戰句 lives in weekly_reports, not in the export.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');

const studyDay=at=>new Date(Date.parse(at)+2*3600000).toISOString().slice(0,10);
const LINE=/^p(\d+)\.l(\d+)$/,SELF=/^p(\d+)\.l(\d+)\.selfcheck$/,WARMUP=/^p(\d+)\.warmup\.(spot|rule)$/;

// Two-sided p of Student's t (regularised incomplete beta, Numerical Recipes continued fraction).
function betacf(a,b,x){
  let c=1,d=1-(a+b)*x/(a+1);d=1/(Math.abs(d)<1e-30?1e-30:d);let h=d;
  for(let m=1;m<=200;m++){
    const m2=2*m;let aa=m*(b-m)*x/((a-1+m2)*(a+m2));
    d=1+aa*d;d=1/(Math.abs(d)<1e-30?1e-30:d);c=1+aa/c;c=Math.abs(c)<1e-30?1e-30:c;h*=d*c;
    aa=-(a+m)*(a+b+m)*x/((a+m2)*(a+1+m2));
    d=1+aa*d;d=1/(Math.abs(d)<1e-30?1e-30:d);c=1+aa/c;c=Math.abs(c)<1e-30?1e-30:c;const del=d*c;h*=del;
    if(Math.abs(del-1)<1e-12)break;
  }
  return h;
}
function lgamma(z){const g=[76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,.1208650973866179e-2,-.5395239384953e-5];
  let x=z,y=z,t=x+5.5;t-=(x+.5)*Math.log(t);let s=1.000000000190015;for(const v of g)s+=v/++y;return -t+Math.log(2.5066282746310005*s/x);}
function ibeta(a,b,x){
  if(x<=0)return 0;if(x>=1)return 1;
  const bt=Math.exp(lgamma(a+b)-lgamma(a)-lgamma(b)+a*Math.log(x)+b*Math.log(1-x));
  return x<(a+1)/(a+b+2)?bt*betacf(a,b,x)/a:1-bt*betacf(b,a,1-x)/b;
}
const tTest=t=>df=>ibeta(df/2,.5,df/(df+t*t));
const pText=p=>p<.001?'p<.001':'p='+p.toFixed(3).replace(/^0/,'');

const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const round=v=>v===null?null:Math.round(v*10)/10;
function paired(diffs){
  const n=diffs.length,m=mean(diffs);
  if(n<2)return {pupils:n,meanDiff:round(m)};
  const sd=Math.sqrt(diffs.reduce((s,d)=>s+(d-m)**2,0)/(n-1));
  if(!sd)return {pupils:n,meanDiff:round(m),sd:0};
  const t=m/(sd/Math.sqrt(n));
  return {pupils:n,meanDiff:round(m),sd:round(sd),t:Math.round(t*100)/100,df:n-1,p:pText(tTest(t)(n-1))};
}

async function readExport(directory,{from}={}){
  const attempts=new Map(),scores=new Map(),selfChecks=[],warmups=[];
  const lines=readline.createInterface({input:fs.createReadStream(path.join(directory,'events.jsonl'),'utf8'),crlfDelay:Infinity});
  for await(const text of lines){
    if(!text.trim())continue;
    const row=JSON.parse(text),e=row.event||{},who=row.researchId;
    if(!who||!e.clientAt||from&&studyDay(e.clientAt)<from)continue;
    const key=who+'|'+e.attemptId;
    if(row.source==='client'&&e.type==='attempt_started'&&e.activity==='read'&&LINE.test(e.itemId||''))
      attempts.set(key,{who,item:e.itemId,day:studyDay(e.clientAt),at:e.clientAt,demoArm:e.context?.demoArm||null,pinyinArm:e.context?.pinyinArm||null});
    else if(row.source==='server_verified'&&e.type==='provider_result'&&e.operation==='reading'&&Number.isFinite(e.result?.score))
      scores.set(key,e.result.score);
    else if(row.source==='client'&&e.type==='answer_submitted'&&SELF.test(e.itemId||''))
      selfChecks.push({key,choice:e.response?.choiceId||'unknown'});
    else if(row.source==='client'&&WARMUP.test(e.itemId||'')&&['answer_submitted','item_presented'].includes(e.type))
      warmups.push({who,poem:WARMUP.exec(e.itemId)[1],kind:WARMUP.exec(e.itemId)[2],type:e.type,status:e.result?.status||null});
  }
  return {attempts,scores,selfChecks,warmups};
}

// First scored attempt per pupil, line and study day.
function dayScores({attempts,scores}){
  const first=new Map();
  for(const [key,a] of attempts){
    if(!scores.has(key))continue;
    const k=a.who+'|'+a.item+'|'+a.day,seen=first.get(k);
    if(!seen||a.at<seen.at)first.set(k,{...a,score:scores.get(key)});
  }
  return [...first.values()];
}
// One arm against the other, within pupils (each pupil's mean per arm).
function compare(rows,arm,a,b){
  const byPupil=new Map(),counts={};
  for(const r of rows){
    const v=r[arm];if(!v)continue;counts[v]=(counts[v]||0)+1;
    if(!byPupil.has(r.who))byPupil.set(r.who,{});const p=byPupil.get(r.who);(p[v]||=[]).push(r.score);
  }
  const arms=Object.fromEntries(Object.keys(counts).sort().map(v=>[v,{lineDays:counts[v],meanScore:round(mean(rows.filter(r=>r[arm]===v).map(r=>r.score)))}]));
  const diffs=[...byPupil.values()].filter(p=>p[a]&&p[b]).map(p=>mean(p[a])-mean(p[b]));
  return {arms,[a+' minus '+b]:paired(diffs)};
}

function report(data){
  const rows=dayScores(data);
  // A line's later days: did reading it first (or without pinyin) carry over?
  const firstDay=new Map();for(const r of rows){const k=r.who+'|'+r.item;if(!firstDay.has(k)||r.day<firstDay.get(k))firstDay.set(k,r.day);}
  const later=rows.filter(r=>r.day>firstDay.get(r.who+'|'+r.item));
  const self={};
  for(const s of data.selfChecks){const v=self[s.choice]||={answers:0,scored:[]};v.answers++;if(data.scores.has(s.key))v.scored.push(data.scores.get(s.key));}
  const warm={pupils:new Set(data.warmups.map(w=>w.who)).size,poems:new Set(data.warmups.map(w=>w.who+'|'+w.poem)).size,shown:{},answered:{}};
  for(const w of data.warmups){const bucket=w.type==='item_presented'?warm.shown:warm.answered;const k=w.type==='item_presented'?w.kind:w.kind+' '+(w.status||'unknown');bucket[k]=(bucket[k]||0)+1;}
  return {
    readingLineDays:rows.length,pupils:new Set(rows.map(r=>r.who)).size,
    demoArm:{sameDay:compare(rows,'demoArm','attempt-first','open'),laterDays:compare(later,'demoArm','attempt-first','open')},
    pinyinArm:{sameDay:compare(rows,'pinyinArm','faded','kept'),laterDays:compare(later,'pinyinArm','faded','kept')},
    selfCheck:Object.fromEntries(Object.entries(self).map(([k,v])=>[k,{answers:v.answers,scored:v.scored.length,meanScore:round(mean(v.scored))}])),
    warmup:warm
  };
}

if(require.main===module){
  const [directory,...rest]=process.argv.slice(2);
  const from=rest[0]==='--from'?rest[1]:undefined;
  if(!directory||from!==undefined&&!/^\d{4}-\d\d-\d\d$/.test(from)){console.error('usage: node scripts/school74-study-report.cjs <export directory> [--from YYYY-MM-DD]');process.exit(2);}
  readExport(directory,{from}).then(data=>console.log(JSON.stringify(report(data),null,1))).catch(error=>{console.error(error.message);process.exit(1);});
}
module.exports={readExport,report,paired,studyDay};
