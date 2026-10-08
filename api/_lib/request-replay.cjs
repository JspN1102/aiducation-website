'use strict';
const {createHash}=require('node:crypto');
// The relay may send a recording or drawing a second time when its answer was
// lost on the way back, and the browser may resend it after a network failure.
// Both copies carry the browser's requestId: the second waits for the first
// and receives the same answer, so the provider is asked (and billed) and the
// research outcome is written only once. Requests without an id run as before.
// The origin is a single process, so memory is enough. An entry is kept ten
// minutes, so a reading resent when a tablet shows the page again (or by the
// pupil) still gets the first answer; answers are a few kilobytes each.
const TTL_MS=600000,MAX_ENTRIES=1000;
const ID=/^[A-Za-z0-9-]{8,64}$/;
const entries=new Map();
const digest=value=>createHash('sha256').update(value).digest('hex');
function prune(at){
 for(const [key,entry]of entries){if(entry.settled&&entry.until<=at)entries.delete(key);}
 for(const [key,entry]of entries){if(entries.size<=MAX_ENTRIES)break;if(entry.settled)entries.delete(key);}
}
// Runs `run` once per (operation, actor, requestId, body). A later copy waits
// for the first; only a 2xx JSON answer without an error is shared, anything
// else lets the copy run itself.
async function coalesce(operation,actorId,req,res,run,{now=Date.now}={}){
 const requestId=req.body?.requestId;
 if(typeof requestId!=='string'||!ID.test(requestId)||!actorId)return run();
 const key=digest(JSON.stringify([operation,actorId,requestId])),fingerprint=digest(JSON.stringify(req.body));
 for(;;){
  const entry=entries.get(key);
  if(!entry)break;
  // The same id with another body (a re-encoded recording) is its own request.
  if(entry.fingerprint!==fingerprint)return run();
  const result=await entry.result;
  if(result){res.setHeader?.('X-Request-Replayed','1');return res.status(result.status).json(result.body);}
  if(entries.get(key)===entry)entries.delete(key);
 }
 prune(now());
 let resolve;const entry={fingerprint,settled:false,until:Infinity,result:new Promise(done=>{resolve=done;})};
 entries.set(key,entry);
 const json=res.json;let captured=null;
 res.json=function(body){const status=res.statusCode||200;if(status>=200&&status<300&&body&&typeof body==='object'&&!Array.isArray(body)&&!body.error)captured={status,body};return json.call(this,body);};
 try{return await run();}
 finally{
  if(res.json!==json)res.json=json;
  entry.settled=true;entry.until=now()+TTL_MS;resolve(captured);
  if(!captured&&entries.get(key)===entry)entries.delete(key);
 }
}
module.exports={coalesce,TTL_MS,_entries:entries};
