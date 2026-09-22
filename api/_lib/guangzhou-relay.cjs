'use strict';
// The public school site relays its fixed APIs through SSH to the existing
// loopback-only Guangzhou service. No database port or public origin is opened.
const http=require('node:http');
const net=require('node:net');
const {Duplex}=require('node:stream');
const {Client}=require('ssh2');
const {TEACHER_ROUTES,acceptsGzip}=require('./response-encoding.cjs');
const LIMITS=Object.freeze({soe:4*1024*1024,tts:65536,'maanshan-chat':131072,'maanshan-report':524288,'maanshan-save':393216,'maanshan-data':1024,handwriting:524288,'school-auth':16384,'school-recordings':1400000,'research-events':131072,'teacher-analytics':1024,'challenge-result':16384,'teacher-tools':16384});
const HOP=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
const RESPONSE_LIMIT=4*1024*1024+65536;
const AUTH_DIAGNOSTIC_CODES=new Set(['TERMS_REQUIRED','TERMS_VERSION_CHANGED','INVALID_REQUEST','ORIGIN_REJECTED','INVALID_CREDENTIALS','LOGIN_THROTTLED','AUTH_DISABLED','AUTH_UNAVAILABLE','AUTH_REQUIRED','ACCOUNT_CHANGED','CSRF_REJECTED']);
function logAuthFailure(status,result,input){
 if(!Number.isInteger(status)||status<400||status>599)return;
 let code='UNRECOGNIZED_CODE';
 try{
  const data=JSON.parse(result.toString('utf8'));
  if(AUTH_DIAGNOSTIC_CODES.has(data?.code))code=data.code;
  else if(data?.error==='Invalid JSON body')code='INVALID_JSON_BODY';
  else if(data?.error==='Request interrupted')code='REQUEST_INTERRUPTED';
 }catch{code='NON_JSON_RESPONSE';}
 const entry={event:'school_auth_upstream_error',status,code};
 if(code==='INVALID_REQUEST'){
  entry.bodyKind=input===undefined?'undefined':input===null?'null':Buffer.isBuffer(input)?'buffer':Array.isArray(input)?'array':typeof input==='object'?'object':typeof input==='string'?'string':'other';
  const fields=input!==null&&typeof input==='object'&&!Buffer.isBuffer(input)&&!Array.isArray(input)?input:null;
  entry.fields=Object.fromEntries(['action','login','password','termsAccepted','termsVersion'].map(key=>[key,!!fields&&Object.hasOwn(fields,key)]));
 }
 // Only fixed labels, status, and presence flags reach logs; never payloads or headers.
 console.warn(JSON.stringify(entry));
}
// The loopback HTTP server closes idle sockets after 35 seconds. Expire earlier,
// including after a suspended serverless instance resumes without firing timers.
const CHANNEL_IDLE_MS=25000;
// Opening a channel normally takes one round trip (well under two seconds even
// when many open at once). Longer silence means the session is gone.
const CHANNEL_OPEN_TIMEOUT_MS=5000;
class ChannelAgent extends http.Agent{
 constructor(client,now,openTimeoutMs=CHANNEL_OPEN_TIMEOUT_MS){
  super({keepAlive:true,maxSockets:16,maxTotalSockets:16,maxFreeSockets:4,scheduling:'lifo'});
  this.client=client;this.now=now;this.openTimeoutMs=openTimeoutMs;this.idle=new Map();this.closed=false;
 }
 createConnection(options,callback){
  if(this.closed){queueMicrotask(()=>callback(new Error('RELAY_CLOSED')));return;}
  // A suspended serverless instance resumes holding an SSH session that the
  // server may have closed meanwhile, or whose network path silently went
  // away. Opening the channel is the first round trip on it: a synchronous
  // throw, an error or a long silence all mean the session is dead. Report
  // that before any HTTP bytes exist so the relay can reconnect once safely.
  // An open failure answered by the server (it carries a reason) means the
  // session is alive but the origin refused; everything else marks it dead.
  let settled=false;
  const settle=(error,socket)=>{if(settled){socket?.destroy();return;}settled=true;clearTimeout(timer);if(error&&error.reason===undefined)error.sessionDead=true;callback(error,socket);};
  const timer=setTimeout(()=>{settle(new Error('CHANNEL_OPEN_TIMEOUT'));this.client.destroy();},this.openTimeoutMs);timer.unref?.();
  try{
   this.client.forwardOut('127.0.0.1',0,'127.0.0.1',3100,(error,stream)=>{
    if(error){settle(error);return;}
    if(this.closed||settled){stream.destroy();settle(new Error('RELAY_CLOSED'));return;}
    // ssh2 channels lack Socket ref/unref and synchronous destroyed semantics.
    // A Duplex wrapper supplies reliable abort/close handling for the HTTP pool.
    const socket=Duplex.from({readable:stream,writable:stream});
    socket.ref=socket.unref=()=>socket;
    socket.on('error',()=>{});
    socket.once('close',()=>this.clearIdle(socket));
    settle(null,socket);
   });
  }catch(error){settle(error);}
 }
 clearIdle(socket){const idle=this.idle.get(socket);if(idle){clearTimeout(idle.timer);this.idle.delete(socket);}}
 keepSocketAlive(socket){
  if(this.closed||socket.destroyed)return false;
  let lifetime=CHANNEL_IDLE_MS;
  const hint=/(?:^|,)\s*timeout=(\d+)/i.exec(String(socket._httpMessage?.res?.headers['keep-alive']||''));
  if(hint)lifetime=Math.min(lifetime,Number(hint[1])*1000-1000);
  if(lifetime<=0)return false;
  this.clearIdle(socket);
  const timer=setTimeout(()=>{this.clearIdle(socket);socket.destroy();},lifetime);timer.unref?.();
  this.idle.set(socket,{timer,expiresAt:this.now()+lifetime});return true;
 }
 addRequest(req,options){
  for(const [name,sockets]of Object.entries(this.freeSockets)){
   this.freeSockets[name]=sockets.filter(socket=>{
    const expiry=this.idle.get(socket)?.expiresAt;
    if(this.closed||socket.destroyed||!expiry||expiry<=this.now()){
     this.clearIdle(socket);socket.destroy();return false;
    }
    return true;
   });
   if(!this.freeSockets[name].length)delete this.freeSockets[name];
  }
  super.addRequest(req,options);
 }
 reuseSocket(socket,req){this.clearIdle(socket);super.reuseSocket(socket,req);}
 destroy(){this.closed=true;for(const socket of this.idle.keys())this.clearIdle(socket);super.destroy();}
}
function configuration(env){
 const host=env.GUANGZHOU_RELAY_HOST,username=env.GUANGZHOU_RELAY_USERNAME,privateKey=env.GUANGZHOU_RELAY_PRIVATE_KEY,hostHash=env.GUANGZHOU_RELAY_HOST_SHA256,port=Number(env.GUANGZHOU_RELAY_PORT||22);
 if(host!=='134.175.149.14'||username!=='maanshan-relay'||typeof privateKey!=='string'||!privateKey.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')||privateKey.length>8192||!/^([a-f0-9]{64})$/.test(hostHash||''))throw new Error('RELAY_NOT_CONFIGURED');
 if(![22,2222].includes(port))throw new Error('RELAY_NOT_CONFIGURED');
 return {host,port,username,privateKey,hostHash};
}
function createRelay({env=process.env,clientFactory=()=>new Client(),request=http.request,now=Date.now,timeoutMs=55000,channelOpenTimeoutMs=CHANNEL_OPEN_TIMEOUT_MS}={}){
 let pending=null,pendingClient=null,connection=null,lastUsed=0,active=0;
 const agents=new Map();
 const disposeAgent=client=>{const agent=agents.get(client);if(agent){agents.delete(client);agent.destroy();}};
 const agentFor=client=>{if(!agents.has(client))agents.set(client,new ChannelAgent(client,now,channelOpenTimeoutMs));return agents.get(client);};
 // Forget a session whose first round trip failed, so that no later request
 // (including a concurrent one that shares it) is offered the same dead client.
 const discard=client=>{disposeAgent(client);if(connection===client)connection=null;if(pendingClient===client){pending=null;pendingClient=null;}client.destroy();};
 async function tunnel(alternate=false){
  // A child can listen or write for much longer than 20 seconds between calls.
  // Keep the verified SSH session across those pauses; transport errors/close
  // still invalidate it immediately, and no forwarded POST is ever replayed.
  if(connection&&now()-lastUsed>120000&&active<=1){disposeAgent(connection);connection.end();connection=null;pending=null;pendingClient=null;}
  lastUsed=now();
  if(pending)return pending;
  const config=configuration(env),client=clientFactory();
  const port=alternate?(config.port===2222?22:2222):config.port;
  pendingClient=client;
  pending=new Promise((resolve,reject)=>{
   let ready=false,tcpConnected=false,handshakeComplete=false;
   client.once('connect',()=>{tcpConnected=true;client.setNoDelay?.(true);});
   client.once('handshake',()=>{handshakeComplete=true;});
   const clear=()=>{disposeAgent(client);if(connection===client)connection=null;if(pendingClient===client){pending=null;pendingClient=null;}};
   client.once('ready',()=>{ready=true;connection=client;resolve(client);});
   // The peer closing its side ends the writable socket before 'close' fires;
   // forget the session at once so nothing tries to open a channel on it.
   client.once('end',()=>{clear();});
   client.on('error',error=>{clear();if(!ready){const code=typeof error?.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'SSH_CONNECT_ERROR';console.error('Guangzhou relay transport:',code,error?.level==='client-timeout'?'HANDSHAKE_TIMEOUT':'CONNECT_FAILED',JSON.stringify({tcpConnected,handshakeComplete}));reject(new Error('RELAY_CONNECT_FAILED'));}});
   client.once('close',()=>{clear();if(!ready)reject(new Error('RELAY_CONNECT_FAILED'));});
   client.connect({host:config.host,port,username:config.username,privateKey:config.privateKey,hostHash:'sha256',hostVerifier:hash=>hash===config.hostHash,readyTimeout:4500,keepaliveInterval:15000,keepaliveCountMax:2,tryKeyboard:false});
  });
  try{return await pending;}catch(error){if(pendingClient===client){pending=null;pendingClient=null;}client.destroy();throw error;}
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
  let upstream,channel,timer,done=false,responseComplete=false;
  const startedAt=now();let connectedAt=startedAt,channelAt=startedAt;
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
     const connect=async()=>{try{return await tunnel();}catch{if(done||res.destroyed)return null;return tunnel(true);}};
     const client=await connect();
     if(client===null||done||res.destroyed){finish();return;}
     connectedAt=now();
     const gzipAllowed=TEACHER_ROUTES.has(name)&&acceptsGzip(req.headers?.['accept-encoding']);
     const headers={host:'mandarin.aiducation.asia','accept-encoding':gzipAllowed?'gzip':'identity','x-forwarded-proto':'https'};
     for(const key of ['origin','cookie','content-type','x-csrf-token','sec-fetch-site','accept','user-agent','if-none-match','range'])if(typeof req.headers?.[key]==='string')headers[key]=req.headers[key];
     // Vercel supplies this client address; never trust caller-provided X-Real-IP.
     const raw=String(req.headers?.['x-vercel-forwarded-for']||req.socket?.remoteAddress||'').split(',')[0].trim();
     if(net.isIP(raw))headers['x-real-ip']=raw;
     if(body)headers['content-length']=String(body.length);
     let retried=false;
     const send=client=>{
      upstream=request({host:'127.0.0.1',port:3100,method:req.method,path:'/api/'+name+url.search,headers,agent:agentFor(client)},response=>{
       if(done){response.destroy();return;}
       const encoding=String(response.headers['content-encoding']||'identity').toLowerCase().trim();
       if(TEACHER_ROUTES.has(name)&&encoding!=='identity'&&(encoding!=='gzip'||!gzipAllowed)){response.destroy();error(502,'ORIGIN_ENCODING_UNSUPPORTED');return;}
       const streaming=name==='maanshan-chat'&&/^text\/event-stream(?:;|$)/i.test(String(response.headers['content-type']||''))&&String(req.headers?.accept||'').includes('text/event-stream');
       const chunks=[];let size=0;
       const copyHeaders=()=>{
        res.statusCode=response.statusCode||502;
        const hop=new Set([...HOP,...String(response.headers.connection||'').toLowerCase().split(',').map(x=>x.trim())]);
        for(const [key,value]of Object.entries(response.headers))if(value!==undefined&&!hop.has(key)&&key!=='content-length')res.setHeader(key,value);
        res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
        const duration=(from,to)=>Math.max(0,to-from).toFixed(1);
        const originTiming=typeof response.headers['server-timing']==='string'?response.headers['server-timing']+', ':'';
        res.setHeader('Server-Timing',originTiming+'relay_connect;dur='+duration(startedAt,connectedAt)+', relay_channel;dur='+duration(connectedAt,channelAt)+', relay_origin;dur='+duration(channelAt,now()));
       };
       if(streaming){copyHeaders();res.setHeader('X-Accel-Buffering','no');res.flushHeaders?.();}
       response.on('error',()=>error(502,'ORIGIN_INTERRUPTED'));
       response.on('aborted',()=>error(502,'ORIGIN_INTERRUPTED'));
       response.on('data',chunk=>{
        if(done)return;
        size+=chunk.length;
        if(size>RESPONSE_LIMIT){error(502,'ORIGIN_RESPONSE_TOO_LARGE');response.destroy();}
        else if(streaming){if(!res.write(chunk)){response.pause();res.once('drain',()=>{if(!done)response.resume();});}}
        else chunks.push(chunk);
       });
       response.on('end',()=>{
        if(done){finish();return;}
        responseComplete=true;
        done=true;
        if(!res.writableEnded&&!res.destroyed){
         if(streaming){res.end();finish();return;}
         copyHeaders();
         const result=Buffer.concat(chunks);
         if(name==='school-auth')logAuthFailure(response.statusCode,result,req.body);
         if(req.method!=='HEAD')res.setHeader('Content-Length',result.length);
         else if(/^\d+$/.test(String(response.headers['content-length']||'')))res.setHeader('Content-Length',response.headers['content-length']);
         res.end(req.method==='HEAD'?undefined:result);
        }
        finish();
       });
      });
      upstream.once('socket',socket=>{channel=socket;channelAt=now();if(done||res.destroyed){socket.destroy();finish();}});
      upstream.on('error',cause=>{
       // Without a channel nothing was written to the origin: the cached SSH
       // session died while the instance was idle. Reconnect and send once more.
       // After a channel exists the request may have arrived, so never retry.
       if(!done&&channel===undefined&&!retried&&cause?.sessionDead===true){retried=true;discard(client);reconnect();return;}
       if(channel===undefined)error(503,'ORIGIN_UNAVAILABLE');else error(502,'ORIGIN_INTERRUPTED');
      });
      if(body)upstream.write(body);upstream.end();
     };
     const reconnect=async()=>{
      try{
       const next=await connect();
       if(next===null||done||res.destroyed){finish();return;}
       connectedAt=now();
       send(next);
      }catch{error(503,'ORIGIN_UNAVAILABLE');}
     };
     send(client);
    }catch{error(503,'ORIGIN_UNAVAILABLE');}
   });
  }finally{clearTimeout(timer);res.off('close',disconnected);if(!responseComplete)close();active--;}
 }
 return {relay,close(){for(const client of agents.keys())disposeAgent(client);const connecting=pendingClient;if(connecting&&connecting!==connection)connecting.destroy();connection?.end();connection=null;pending=null;pendingClient=null;}};
}
let singleton;
const relay=(name,req,res)=>(singleton||(singleton=createRelay())).relay(name,req,res);
function createGateway(forward=relay){return function gateway(req,res){
 const url=new URL(req.url,'https://mandarin.aiducation.asia');
 const name=req.query?.__school_route||/^\/api\/([a-z-]+)\/?$/.exec(url.pathname)?.[1];
 if(typeof name!=='string'||!Object.hasOwn(LIMITS,name)){
  res.statusCode=404;res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','application/json');return res.end('{"ok":false,"code":"NOT_FOUND"}');
 }
 const search=url.searchParams;
 search.delete('__school_route');
 req.url='/api/'+name+(search.size?'?'+search.toString():'');
 return forward(name,req,res);
};}
module.exports={LIMITS,configuration,createRelay,relay,createGateway,gateway:createGateway()};
