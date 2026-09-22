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
const voices=[],texts=[];
require.cache[require.resolve('../../api/_lib/school-auth.cjs')]={exports:{enabled:()=>false}};
if(options.delayedMiss)require.cache[cachePath]={exports:{...realCache,async hasAudio(key){
  const sequence=++lookups,result=await realCache.hasAudio(key);
  if(sequence===2&&result.status==='miss')await new Promise(resolve=>setTimeout(resolve,150));
  return result;
}}};
https.request=(_request,callback)=>{
  const request=new EventEmitter();request.setTimeout=()=>{};request.destroy=()=>{};
  request.end=body=>{
    const parsed=JSON.parse(body);synthesisCalls++;voices.push(parsed.VoiceType);texts.push(parsed.Text);
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
// A local stand-in for the COS bucket: records signed uploads and, unless the
// scenario is "private", lets anonymous readers fetch what was stored.
const http=require('node:http');
const cos={putCount:0,objects:[]};let cosServer=null;
async function startCos(){
  if(!options.cos)return;
  process.env.TTS_COS_BUCKET='fixture-bucket-1250000000';process.env.TTS_COS_REGION='ap-guangzhou';
  if(options.cos==='down'){process.env.TTS_COS_ENDPOINT='http://127.0.0.1:9';return;}
  const stored=new Map();
  cosServer=http.createServer((req,res)=>{
    const authorization=req.headers.authorization||'';
    const ak=(/q-ak=([^&]+)/.exec(authorization)||[])[1];
    const authorized=/^q-sign-algorithm=sha1&q-ak=[^&]+&q-sign-time=\d+;\d+&q-key-time=\d+;\d+&q-header-list=host&q-url-param-list=&q-signature=[0-9a-f]{40}$/.test(authorization)&&req.headers.host==='fixture-bucket-1250000000.cos.ap-guangzhou.myqcloud.com';
    const deny=code=>{res.statusCode=403;res.end('<Error><Code>'+code+'</Code></Error>');};
    if(req.method==='PUT'){
      const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{
        if(!authorized)return deny('AccessDenied');
        const bytes=Buffer.concat(chunks);stored.set(req.url,bytes);cos.putCount++;
        cos.objects.push({path:req.url,ak,bytes:bytes.length,type:req.headers['content-type'],cacheControl:req.headers['cache-control'],wav:bytes.toString('ascii',0,4)==='RIFF'});
        res.statusCode=200;res.end();
      });return;
    }
    if(req.method==='HEAD'||req.method==='GET'){
      if(options.cos==='private'&&!authorized)return deny('AccessDenied');
      const bytes=stored.get(req.url);
      if(!bytes){res.statusCode=404;res.end('<Error><Code>NoSuchKey</Code></Error>');return;}
      res.statusCode=200;res.setHeader('Content-Length',bytes.length);res.end(req.method==='HEAD'?undefined:bytes);return;
    }
    res.statusCode=405;res.end();
  });
  await new Promise(resolve=>cosServer.listen(0,'127.0.0.1',resolve));
  process.env.TTS_COS_ENDPOINT='http://127.0.0.1:'+cosServer.address().port;
}
async function invoke(body){
  const response={headers:{},statusCode:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(s){this.statusCode=s;return this;},json(value){this.body=value;return this;},end(value){this.body=value;return this;}};
  await handler({method:'POST',headers:{},body},response);
  return {status:response.statusCode,cache:response.headers['x-tts-cache'],voice:response.headers['x-tts-voice'],url:response.body?.url,...(response.body?.remote?{remote:response.body.remote}:{}),bytes:Buffer.isBuffer(response.body)?response.body.length:undefined};
}
(async()=>{
  await startCos();
  const results=[];
  for(const batch of options.batches)results.push(...await Promise.all(batch.map(invoke)));
  const deliveries=[];
  if(options.readback)for(const result of results){
    const parsed=new URL(result.url,'http://localhost'),query=Object.fromEntries(parsed.searchParams);
    for(const range of [undefined,'bytes=0-43','bytes=-1024']){
      const response={headers:{},statusCode:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(s){this.statusCode=s;return this;},json(value){this.body=value;return this;},end(value){this.body=value;return this;}};
      await handler({method:'GET',headers:range?{range}:{},query},response);
      deliveries.push({range:range||'full',status:response.statusCode,bytes:response.body?.length,contentRange:response.headers['content-range'],wav:Buffer.isBuffer(response.body)&&response.body.toString('ascii',0,4)==='RIFF',...(response.headers.location?{location:response.headers.location,cache:response.headers['x-tts-cache']}:{})});
    }
  }
  console.log(JSON.stringify({synthesisCalls,voices,texts,results,deliveries,cos}));
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>{https.request=realRequest;cosServer?.close();});
