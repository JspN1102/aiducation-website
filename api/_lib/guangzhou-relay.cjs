'use strict';
// The public school site relays its fixed APIs through SSH to the existing
// loopback-only Guangzhou service. No database port or public origin is opened.
const http=require('node:http');
const net=require('node:net');
const {Client}=require('ssh2');
const LIMITS=Object.freeze({soe:4*1024*1024,tts:65536,'maanshan-chat':131072,'maanshan-report':524288,'maanshan-save':393216,'maanshan-data':1024,handwriting:524288,'school-auth':16384,'research-events':131072,'teacher-analytics':1024,'challenge-result':16384,'teacher-tools':16384});
const HOP=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
const RESPONSE_LIMIT=4*1024*1024+65536;
function configuration(env){
 const host=env.GUANGZHOU_RELAY_HOST,username=env.GUANGZHOU_RELAY_USERNAME,privateKey=env.GUANGZHOU_RELAY_PRIVATE_KEY,hostHash=env.GUANGZHOU_RELAY_HOST_SHA256,port=Number(env.GUANGZHOU_RELAY_PORT||22);
 if(host!=='134.175.149.14'||username!=='maanshan-relay'||typeof privateKey!=='string'||!privateKey.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')||privateKey.length>8192||!/^([a-f0-9]{64})$/.test(hostHash||''))throw new Error('RELAY_NOT_CONFIGURED');
 if(![22,2222].includes(port))throw new Error('RELAY_NOT_CONFIGURED');
 return {host,port,username,privateKey,hostHash};
}
function createRelay({env=process.env,clientFactory=()=>new Client(),request=http.request,now=Date.now,timeoutMs=55000}={}){
 let pending=null,connection=null,lastUsed=0,active=0;
 async function tunnel(alternate=false){
  if(connection&&now()-lastUsed>20000&&active<=1){connection.end();connection=null;pending=null;}
  lastUsed=now();
  if(pending)return pending;
  const config=configuration(env),client=clientFactory();
  const port=alternate?(config.port===2222?22:2222):config.port;
  pending=new Promise((resolve,reject)=>{
   let ready=false,tcpConnected=false,handshakeComplete=false;
   client.once('connect',()=>{tcpConnected=true;});
   client.once('handshake',()=>{handshakeComplete=true;});
   const clear=()=>{if(connection===client){connection=null;pending=null;}};
   client.once('ready',()=>{ready=true;connection=client;resolve(client);});
   client.on('error',error=>{clear();if(!ready){pending=null;const code=typeof error?.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'SSH_CONNECT_ERROR';console.error('Guangzhou relay transport:',code,error?.level==='client-timeout'?'HANDSHAKE_TIMEOUT':'CONNECT_FAILED',JSON.stringify({tcpConnected,handshakeComplete}));reject(new Error('RELAY_CONNECT_FAILED'));}});
   client.once('close',()=>{clear();if(!ready){pending=null;reject(new Error('RELAY_CONNECT_FAILED'));}});
   client.connect({host:config.host,port,username:config.username,privateKey:config.privateKey,hostHash:'sha256',hostVerifier:hash=>hash===config.hostHash,readyTimeout:4500,keepaliveInterval:15000,keepaliveCountMax:2,tryKeyboard:false});
  });
  try{return await pending;}catch(error){pending=null;client.destroy();throw error;}
 }
 function fail(res,status,code){if(res.writableEnded||res.destroyed)return;if(res.headersSent){res.destroy();return;}res.statusCode=status;res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({ok:false,code,error:'服務暫時未能連線，請稍後再試。'}));}
 async function relay(name,req,res){
  if(!Object.hasOwn(LIMITS,name))return fail(res,404,'NOT_FOUND');
  if(!['GET','POST','HEAD','OPTIONS'].includes(req.method))return fail(res,405,'METHOD_NOT_ALLOWED');
  let url,body;
  try{
   url=new URL(req.url,'https://mandarin.aiducation.asia');
   if(url.pathname!=='/api/'+name&&url.pathname!=='/api/'+name+'/')return fail(res,400,'INVALID_RELAY_PATH');
   if(url.search.length>8192)return fail(res,413,'REQUEST_TOO_LARGE');
   body=['GET','HEAD'].includes(req.method)?null:Buffer.isBuffer(req.body)?req.body:Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body??{}));
   if(body&&body.length>LIMITS[name])return fail(res,413,'REQUEST_TOO_LARGE');
  }catch{return fail(res,400,'INVALID_REQUEST');}
  if(active>=16)return fail(res,503,'SERVICE_BUSY');
  active++;
  let upstream,channel,timer,done=false;
  const close=()=>{upstream?.destroy();channel?.destroy();};
  const disconnected=()=>{if(!res.writableEnded){done=true;close();}};
  res.once('close',disconnected);
  try{
   await new Promise(async resolve=>{
    let settled=false;const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);resolve();};
    const error=(status,code)=>{if(done){finish();return;}done=true;close();fail(res,status,code);finish();};
    timer=setTimeout(()=>error(504,'ORIGIN_TIMEOUT'),timeoutMs);timer.unref?.();
    res.once('close',finish);
    try{
     // A second handshake is safe before any request reaches the origin.
     // Never retry once a channel/request has been opened.
     let client;try{client=await tunnel();}catch{if(done||res.destroyed){finish();return;}client=await tunnel(true);}
     if(done||res.destroyed){finish();return;}
     const headers={host:'mandarin.aiducation.asia','accept-encoding':'identity','x-forwarded-proto':'https',connection:'close'};
     for(const key of ['origin','cookie','content-type','x-csrf-token','sec-fetch-site','accept','user-agent','if-none-match','range'])if(typeof req.headers?.[key]==='string')headers[key]=req.headers[key];
     // Vercel supplies this client address; never trust caller-provided X-Real-IP.
     const raw=String(req.headers?.['x-vercel-forwarded-for']||req.socket?.remoteAddress||'').split(',')[0].trim();
     if(net.isIP(raw))headers['x-real-ip']=raw;
     if(body)headers['content-length']=String(body.length);
     client.forwardOut('127.0.0.1',0,'127.0.0.1',3100,(failure,stream)=>{
      if(failure)return error(503,'ORIGIN_UNAVAILABLE');
      if(done||res.destroyed){stream.destroy();finish();return;}
      channel=stream;
      upstream=request({host:'127.0.0.1',port:3100,method:req.method,path:'/api/'+name+url.search,headers,createConnection:()=>stream},response=>{
       if(done){response.destroy();return;}
       const chunks=[];let size=0;
       response.on('error',()=>error(502,'ORIGIN_INTERRUPTED'));
       response.on('data',chunk=>{size+=chunk.length;if(size>RESPONSE_LIMIT){response.destroy();error(502,'ORIGIN_RESPONSE_TOO_LARGE');}else chunks.push(chunk);});
       response.on('end',()=>{
        if(done){finish();return;}
        done=true;
        if(!res.writableEnded&&!res.destroyed){
         res.statusCode=response.statusCode||502;
         const hop=new Set([...HOP,...String(response.headers.connection||'').toLowerCase().split(',').map(x=>x.trim())]);
         for(const [key,value]of Object.entries(response.headers))if(value!==undefined&&!hop.has(key)&&key!=='content-length')res.setHeader(key,value);
         res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
         const result=Buffer.concat(chunks);
         if(req.method!=='HEAD')res.setHeader('Content-Length',result.length);
         res.end(req.method==='HEAD'?undefined:result);
        }
        finish();
       });
      });
      upstream.on('error',()=>error(502,'ORIGIN_INTERRUPTED'));
      if(body)upstream.write(body);upstream.end();
     });
    }catch{error(503,'ORIGIN_UNAVAILABLE');}
   });
  }finally{clearTimeout(timer);res.off('close',disconnected);close();active--;}
 }
 return {relay,close(){connection?.end();connection=null;pending=null;}};
}
let singleton;
const relay=(name,req,res)=>(singleton||(singleton=createRelay())).relay(name,req,res);
function createGateway(forward=relay){return function gateway(req,res){
 const url=new URL(req.url,'https://mandarin.aiducation.asia');
 const name=/^\/api\/([a-z-]+)\/?$/.exec(url.pathname)?.[1];
 if(typeof name!=='string'||!Object.hasOwn(LIMITS,name)){
  res.statusCode=404;res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','application/json');return res.end('{"ok":false,"code":"NOT_FOUND"}');
 }
 const search=url.searchParams;
 search.delete('schoolRoute');
 req.url='/api/'+name+(search.size?'?'+search.toString():'');
 return forward(name,req,res);
};}
module.exports={LIMITS,configuration,createRelay,relay,createGateway,gateway:createGateway()};
