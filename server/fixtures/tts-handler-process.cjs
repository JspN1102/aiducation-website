'use strict';
// Runs the production handler and real disk cache. Only the paid network
// service and authentication gate are substituted with local test fixtures.
const {EventEmitter}=require('node:events');
const https=require('node:https');
const realRequest=https.request;
const cachePath=require.resolve('../../api/_lib/tts-cache.js');
const realCache=require(cachePath);
const options=JSON.parse(process.argv[2]);
let synthesisCalls=0,lookups=0;
const voices=[];
require.cache[require.resolve('../../api/_lib/school-auth.cjs')]={exports:{enabled:()=>false}};
if(options.delayedMiss)require.cache[cachePath]={exports:{...realCache,async hasAudio(key){
  const sequence=++lookups,result=await realCache.hasAudio(key);
  if(sequence===2&&result.status==='miss')await new Promise(resolve=>setTimeout(resolve,150));
  return result;
}}};
https.request=(_request,callback)=>{
  const request=new EventEmitter();request.setTimeout=()=>{};request.destroy=()=>{};
  request.end=body=>{
    const parsed=JSON.parse(body);synthesisCalls++;voices.push(parsed.VoiceType);
    setTimeout(()=>{
      const response=new EventEmitter();callback(response);
      // Distinct waveform bytes prove different voices cannot share a file.
      response.emit('data',Buffer.from(JSON.stringify({Response:{Audio:Buffer.alloc(options.pcmBytes||3200,parsed.VoiceType===101021?2:1).toString('base64')}})));
      response.emit('end');
    },20);
  };
  return request;
};
const handler=require('../../api/tts.js');
async function invoke(body){
  const response={headers:{},statusCode:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(s){this.statusCode=s;return this;},json(value){this.body=value;return this;},end(value){this.body=value;return this;}};
  await handler({method:'POST',headers:{},body},response);
  return {status:response.statusCode,cache:response.headers['x-tts-cache'],voice:response.headers['x-tts-voice'],url:response.body?.url,bytes:Buffer.isBuffer(response.body)?response.body.length:undefined};
}
(async()=>{
  const results=[];
  for(const batch of options.batches)results.push(...await Promise.all(batch.map(invoke)));
  const deliveries=[];
  if(options.readback)for(const result of results){
    const parsed=new URL(result.url,'http://localhost'),query=Object.fromEntries(parsed.searchParams);
    for(const range of [undefined,'bytes=0-43','bytes=-1024']){
      const response={headers:{},statusCode:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(s){this.statusCode=s;return this;},json(value){this.body=value;return this;},end(value){this.body=value;return this;}};
      await handler({method:'GET',headers:range?{range}:{},query},response);
      deliveries.push({range:range||'full',status:response.statusCode,bytes:response.body?.length,contentRange:response.headers['content-range'],wav:Buffer.isBuffer(response.body)&&response.body.toString('ascii',0,4)==='RIFF'});
    }
  }
  console.log(JSON.stringify({synthesisCalls,voices,results,deliveries}));
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>{https.request=realRequest;});
