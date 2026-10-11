'use strict';
// Reads this service's own request log lines back from the systemd journal, so
// the site monitor's counters can be filled in after a restart. Only the fixed
// fields of the {"event":"api"} line are kept: route, method, status, timing
// and relay label.
const {execFile}=require('node:child_process');

const ROUTE=/^[a-z][a-z0-9-]{0,40}$/,METHOD=/^[A-Z]{3,7}$/,RELAY=/^(hop-)?(hk|gz):\d{4}$/;

function parseLine(text){
  let row,d;
  try{row=JSON.parse(text);}catch{return null;}
  const message=row?.MESSAGE,at=Math.floor(Number(row?.__REALTIME_TIMESTAMP)/1000);
  if(typeof message!=='string'||!message.startsWith('{"event":"api"')||!Number.isFinite(at))return null;
  try{d=JSON.parse(message);}catch{return null;}
  if(!ROUTE.test(d?.route)||!Number.isInteger(d.status))return null;
  return {at,route:d.route,method:METHOD.test(d.method)?d.method:'',status:d.status,
    totalMs:Number.isFinite(d.totalMs)&&d.totalMs>=0?d.totalMs:null,relay:typeof d.relay==='string'&&RELAY.test(d.relay)?d.relay:null};
}

function readApiLog(from,until,{unit=process.env.OPS_JOURNAL_UNIT||'maanshan.service',run=execFile}={}){
  const args=['-u',unit,'--since','@'+Math.floor(from/1000),'--until','@'+Math.ceil(until/1000),'-o','json','--output-fields=MESSAGE','-q','--no-pager'];
  return new Promise((resolve,reject)=>{
    run('journalctl',args,{maxBuffer:128*1024*1024,timeout:60000},(error,stdout)=>{
      if(error)return reject(error);
      resolve(String(stdout).split('\n').map(parseLine).filter(Boolean));
    });
  });
}

module.exports={readApiLog,parseLine};
