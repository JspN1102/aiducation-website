'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),net=require('node:net');
const {EventEmitter}=require('node:events');
const {gzipSync,gunzipSync}=require('node:zlib');
const {generateKeyPairSync,createHash}=require('node:crypto');
const {Client:SSHClient,Server:SSHServer,utils:sshUtils}=require('ssh2');
const {createApiServer}=require('./index.cjs');
const routes=require('./routes.cjs');
const {createRelay,configuration,createGateway}=require('../api/_lib/guangzhou-relay.cjs');
const env={GUANGZHOU_RELAY_HOST:'134.175.149.14',GUANGZHOU_RELAY_USERNAME:'maanshan-relay',GUANGZHOU_RELAY_HOST_SHA256:'a'.repeat(64),GUANGZHOU_RELAY_PRIVATE_KEY:'-----BEGIN OPENSSH PRIVATE KEY-----\nSYNTHETIC-ONLY\n-----END OPENSSH PRIVATE KEY-----'};
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
async function fixture(fn,options={}){
 const origin=options.origin||http.createServer(fn);
 if(!options.origin)origin.keepAliveTimeout=65000;
 const originPort=await listen(origin),clients=[],requests=[],channels=[];
 class SSH extends EventEmitter{
  constructor(){super();this.closed=false;this.once('close',()=>{this.closed=true;});}
  connect(config){this.config=config;if(options.onConnect){options.onConnect(this,clients);return this;}queueMicrotask(()=>{if(options.failFirstHandshake&&clients.length===1)return this.emit('error',new Error('synthetic transport timeout'));config.hostVerifier(options.hostHash||'a'.repeat(64))?this.emit('ready'):this.emit('error',new Error('synthetic key mismatch'));});return this;}
  forwardOut(from,port,to,target,cb){requests.push({from,port,to,target});const socket=net.connect(originPort,'127.0.0.1');channels.push(socket);socket.once('connect',()=>options.forwardDelayMs?setTimeout(()=>cb(null,socket),options.forwardDelayMs):cb(null,socket));socket.once('error',cb);}
  end(){this.emit('close');}destroy(){if(options.onDestroy)return options.onDestroy(this);this.end();}
 }
 const relay=createRelay({env,clientFactory:()=>{const client=new SSH();clients.push(client);return client;},timeoutMs:options.timeoutMs||1500,...options.now?{now:options.now}:{},...options.channelOpenTimeoutMs?{channelOpenTimeoutMs:options.channelOpenTimeoutMs}:{}});
 const frontend=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);if(chunks.length){try{req.body=JSON.parse(Buffer.concat(chunks));}catch{req.body=Buffer.concat(chunks);}}options.onRequest?.(req);await relay.relay(options.name||'school-auth',req,res);});
 const port=await listen(frontend);
 return {clients,requests,channels,call:(url='/api/school-auth',init={})=>fetch('http://127.0.0.1:'+port+url,init),raw:(url,init)=>raw('http://127.0.0.1:'+port+url,init),close:async()=>{relay.close();frontend.closeAllConnections();origin.closeAllConnections();await Promise.all([new Promise(r=>frontend.close(r)),new Promise(r=>origin.close(r))]);}};
}
function raw(url,options={}){return new Promise((resolve,reject)=>{const req=http.request(url,options,res=>{const chunks=[];res.on('error',reject);res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);req.end();});}
test('fixed host and pinned key are mandatory; environment cannot create an arbitrary destination',()=>{
 assert.equal(configuration(env).host,'134.175.149.14');
 assert.equal(configuration(env).port,22);
 assert.equal(configuration({...env,GUANGZHOU_RELAY_PORT:'2222'}).port,2222);
 assert.throws(()=>configuration({...env,GUANGZHOU_RELAY_PORT:'5432'}));
 for(const update of [{GUANGZHOU_RELAY_HOST:'127.0.0.1'},{GUANGZHOU_RELAY_USERNAME:'ubuntu'},{GUANGZHOU_RELAY_HOST_SHA256:''},{GUANGZHOU_RELAY_PRIVATE_KEY:'password'}])assert.throws(()=>configuration({...env,...update}));
});
test('shared gateway only accepts allowed endpoints and preserves repeated business query values',()=>{
 let forwarded;const handler=createGateway((...args)=>{forwarded=args;});
 const req={query:{__school_route:'teacher-tools'},url:'/api/teacher-tools/?tool=demo-export&grade=2&x=1&x=2',body:{action:'xlsx'},headers:{cookie:'synthetic'}};
 handler(req,{});assert.equal(forwarded[0],'teacher-tools');assert.equal(req.url,'/api/teacher-tools?tool=demo-export&grade=2&x=1&x=2');assert.strictEqual(forwarded[1],req);
 for(const path of ['/api/maanshan-init','/api/teacher-tools/private','/api/school-gateway?__school_route=school-auth','/api/']){forwarded=null;const res={setHeader(){},end(){}};handler({url:path},res);assert.equal(res.statusCode,404);assert.equal(forwarded,null);}
});
test('encrypted channel destination is fixed, auth headers and query survive; same connection reused',async()=>{
 const received=[];const f=await fixture(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;received.push({url:req.url,headers:req.headers,body});res.setHeader('set-cookie',['__Host-maanshan_session=synthetic; Secure; HttpOnly; Path=/; SameSite=Lax']);res.setHeader('content-type','application/json');res.end('{"ok":true}');});
 try{
  const headers={'Content-Type':'application/json',Origin:'https://mandarin.aiducation.asia',Cookie:'__Host-maanshan_session=synthetic','X-CSRF-Token':'synthetic-csrf','X-Learning-Epoch':'cccccccccccccccccccccccccccccccc','X-Real-IP':'203.0.113.99','X-Vercel-Forwarded-For':'192.0.2.8'};
  const r=await f.call('/api/school-auth/?action=roster',{method:'POST',headers,body:JSON.stringify({action:'session'})});assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true});assert.match(r.headers.get('set-cookie'),/HttpOnly/);
  await (await f.call()).text();assert.equal(f.clients.length,1);
  assert.equal(f.requests.length,1,'complete HTTP responses reuse one forwarded channel');
  assert.equal(received[0].url,'/api/school-auth?action=roster');assert.equal(received[0].headers.origin,headers.Origin);assert.equal(received[0].headers.cookie,headers.Cookie);assert.equal(received[0].headers['x-csrf-token'],'synthetic-csrf');assert.equal(received[0].headers['x-learning-epoch'],headers['X-Learning-Epoch']);assert.equal(received[0].headers['x-real-ip'],'192.0.2.8');assert.equal(received[0].headers['accept-encoding'],'identity');assert.deepEqual(JSON.parse(received[0].body),{action:'session'});
  assert(f.requests.every(r=>r.to==='127.0.0.1'&&r.target===3100));
  assert.equal(f.clients[0].config.hostHash,'sha256');assert.equal(f.clients[0].config.hostVerifier('b'.repeat(64)),false);
 }finally{await f.close();}
});
test('route traversal, unsupported verbs, and oversized bodies are rejected before connecting',async()=>{
 const f=await fixture((req,res)=>res.end('unexpected'));
 try{
  assert.equal((await f.call('/api/maanshan-init')).status,400);
  assert.equal((await f.call('/api/school-auth',{method:'DELETE'})).status,405);
  assert.equal((await f.call('/api/school-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'x'.repeat(18000)})})).status,413);
  assert.equal(f.clients.length,0);
 }finally{await f.close();}
});
test('SSH host mismatch fails closed without exposing transport error details',async()=>{
 const f=await fixture((req,res)=>res.end('unexpected'),{hostHash:'b'.repeat(64)});
 try{const r=await f.call();assert.equal(r.status,503);const body=await r.text();assert.match(body,/ORIGIN_UNAVAILABLE/);assert(!body.includes('SYNTHETIC-ONLY'));assert.equal(f.requests.length,0);}finally{await f.close();}
});
test('binary files, upstream errors and cookie arrays retain status and headers',async()=>{
 const bytes=Buffer.from([80,75,3,4,0,255,9]);let count=0;
 const f=await fixture((req,res)=>{if(count++===0){res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');res.setHeader('Content-Disposition','attachment; filename="demo.docx"');res.end(bytes);}else{res.statusCode=403;res.setHeader('Content-Type','application/json');res.end('{"code":"ROLE_FORBIDDEN"}');}},{name:'teacher-tools'});
 try{const r=await f.call('/api/teacher-tools?tool=demo-export');assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),/demo.docx/);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);const denied=await f.call('/api/teacher-tools?tool=demo-data');assert.equal(denied.status,403);assert.equal((await denied.json()).code,'ROLE_FORBIDDEN');}finally{await f.close();}
});
test('auth failure diagnostics use only approved labels and field presence, never private values',async t=>{
 const logs=[];t.mock.method(console,'warn',(...args)=>logs.push(args));
 const secret='SYNTHETIC-PRIVATE-CONTENT';
 const cases=[
  ...['TERMS_REQUIRED','TERMS_VERSION_CHANGED','ORIGIN_REJECTED'].map(code=>({status:400,body:JSON.stringify({code,error:secret,user:secret,password:secret}),expected:code})),
  {status:400,body:JSON.stringify({code:'INVALID_REQUEST',error:secret}),expected:'INVALID_REQUEST'},
  {status:400,body:JSON.stringify({error:'Invalid JSON body',detail:secret}),expected:'INVALID_JSON_BODY'},
  {status:400,body:JSON.stringify({error:'Request interrupted',detail:secret}),expected:'REQUEST_INTERRUPTED'},
  {status:400,body:'<html>'+secret+'</html>',expected:'NON_JSON_RESPONSE'},
  {status:400,body:JSON.stringify({code:secret,error:secret}),expected:'UNRECOGNIZED_CODE'},
  {status:400,body:JSON.stringify({code:{secret},error:'Invalid JSON body '+secret}),expected:'UNRECOGNIZED_CODE'},
  {status:401,body:JSON.stringify({code:'INVALID_CREDENTIALS',error:secret}),expected:'INVALID_CREDENTIALS'},
  {status:503,body:JSON.stringify({code:'AUTH_UNAVAILABLE',error:secret}),expected:'AUTH_UNAVAILABLE'}
 ];
 let next=0;const f=await fixture((req,res)=>{const item=cases[next++];res.statusCode=item.status;res.setHeader('Set-Cookie','session='+secret);res.end(item.body);});
 try{
  for(const item of cases){
   const response=await f.call('/api/school-auth',{method:'POST',headers:{'content-type':'application/json',cookie:'session='+secret,'x-csrf-token':secret,'x-vercel-forwarded-for':'192.0.2.8'},body:JSON.stringify({action:secret,login:secret,password:secret,termsAccepted:true,termsVersion:secret})});
   assert.equal(response.status,item.status);assert.equal(await response.text(),item.body,'diagnostics must not rewrite the upstream response');
   const expected={event:'school_auth_upstream_error',status:item.status,code:item.expected};
   if(item.expected==='INVALID_REQUEST'){expected.bodyKind='object';expected.fields={action:true,login:true,password:true,termsAccepted:true,termsVersion:true};}
   assert.deepEqual(logs.at(-1),[JSON.stringify(expected)]);
  }
  assert.equal(logs.length,cases.length);assert(!JSON.stringify(logs).includes(secret));assert(!JSON.stringify(logs).includes('192.0.2.8'));
 }finally{await f.close();}
});

test('auth diagnostics distinguish missing or string request bodies and stay silent for successful or other APIs',async t=>{
 const logs=[];t.mock.method(console,'warn',(...args)=>logs.push(args));
 const inputs=[undefined,'encoded JSON string',Buffer.from('encoded bytes'),[],null,{action:'synthetic'},17];
 const kinds=['undefined','string','buffer','array','null','object','other'];
 let index=0;const f=await fixture((req,res)=>{res.statusCode=400;res.end('{"code":"INVALID_REQUEST"}');},{onRequest(req){req.body=inputs[index++];}});
 try{
  for(let i=0;i<inputs.length;i++){
   const response=await f.call('/api/school-auth',{method:'POST'});assert.equal(response.status,400);await response.text();
   assert.deepEqual(JSON.parse(logs.at(-1)[0]),{event:'school_auth_upstream_error',status:400,code:'INVALID_REQUEST',bodyKind:kinds[i],fields:{action:i===5,login:false,password:false,termsAccepted:false,termsVersion:false}});
  }
 }finally{await f.close();}
 const baseline=logs.length;
 const success=await fixture((req,res)=>res.end('{"enabled":true,"authenticated":true,"csrfToken":"SYNTHETIC-PRIVATE"}'));
 try{const response=await success.call();assert.equal(response.status,200);await response.text();}finally{await success.close();}
 const other=await fixture((req,res)=>{res.statusCode=400;res.end('{"code":"INVALID_REQUEST"}');},{name:'teacher-tools'});
 try{const response=await other.call('/api/teacher-tools');assert.equal(response.status,400);await response.text();}finally{await other.close();}
 assert.equal(logs.length,baseline,'success and unrelated APIs must not produce auth diagnostics');
});

test('disconnects do not retry a POST and timeout returns an honest bounded failure',async()=>{
 let calls=0;const broken=await fixture((req,res)=>{calls++;req.socket.destroy();});
 try{const r=await broken.call('/api/school-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"login"}'});assert.equal(r.status,502);assert.equal(calls,1);}finally{await broken.close();}
 const stalled=await fixture(()=>{},{timeoutMs:70});
 try{const r=await stalled.call();assert.equal(r.status,504);assert.equal((await r.json()).code,'ORIGIN_TIMEOUT');}finally{await stalled.close();}
});

test('transport failure can switch between the two restricted ports before forwarding a POST once',async()=>{
 let calls=0;const f=await fixture((req,res)=>{calls++;res.end('{"ok":true}');},{failFirstHandshake:true});
 try{const r=await f.call('/api/school-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"login"}'});assert.equal(r.status,200);assert.equal(calls,1);assert.deepEqual(f.clients.map(c=>c.config.port),[22,2222]);assert.equal(f.requests.length,1);}finally{await f.close();}
});
test('late close from a failed SSH connection preserves the shared fallback for concurrent POSTs', {timeout:5000},async()=>{
 let fallbackStarted,secondArrived;
 const fallback=new Promise(resolve=>{fallbackStarted=resolve;}),secondRequest=new Promise(resolve=>{secondArrived=resolve;});
 const received=[];
 const f=await fixture(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  received.push({method:req.method,id:JSON.parse(body).requestId});res.end('{"ok":true}');
 },{
  onConnect(client,clients){
   if(clients.length===1)queueMicrotask(()=>client.emit('error',new Error('synthetic first-port timeout')));
   else if(clients.length===2)fallbackStarted();
  },
  // A real failed socket may emit close after the fallback has begun connecting.
  onDestroy(){},
  onRequest(req){if(req.body?.requestId==='second')secondArrived();}
 });
 const post=id=>f.call('/api/school-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',requestId:id})});
 try{
  const first=post('first');await fallback;
  f.clients[0].emit('close');
  const second=post('second');await secondRequest;
  // Complete every pending handshake so regressions fail by assertion, not timeout.
  for(const client of f.clients.slice(1))client.emit('ready');
  const responses=await Promise.all([first,second]);
  for(const response of responses){assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});}
  assert.deepEqual(f.clients.map(client=>client.config.port),[22,2222]);
  assert.equal(f.requests.length,2);
  assert.deepEqual(received.sort((a,b)=>a.id.localeCompare(b.id)),[{method:'POST',id:'first'},{method:'POST',id:'second'}]);
 }finally{await f.close();}
 assert(f.clients.every(client=>client.closed),'relay cleanup must close every SSH connection');
});

test('oversized upstream data is never delivered as a truncated Office download',async()=>{
 const f=await fixture((req,res)=>res.end(Buffer.alloc(5*1024*1024)),{name:'teacher-tools'});
 try{const r=await f.call('/api/teacher-tools');assert.equal(r.status,502);assert.equal((await r.json()).code,'ORIGIN_RESPONSE_TOO_LARGE');}finally{await f.close();}
});

test('a reading pause reuses the SSH connection and closed transports reconnect before forwarding',async()=>{
 let clock=1000;const f=await fixture((req,res)=>res.end('{"ok":true}'),{now:()=>clock});
 try{
  await (await f.call()).text();clock+=60000;
  await (await f.call()).text();assert.equal(f.clients.length,1);
  assert.equal(f.requests.length,2,'a long reading pause opens a fresh HTTP channel');
  f.clients[0].emit('close');clock+=10;
  await (await f.call()).text();assert.equal(f.clients.length,2);assert.equal(f.requests.length,3);
 }finally{await f.close();}
});

test('HTTP keep-alive preserves per-request identities, CSRF, bodies and origin authentication',async()=>{
 const sockets=new Set(),received=[];
 const f=await fixture(async(req,res)=>{
  sockets.add(req.socket);let body='';for await(const chunk of req)body+=chunk;
  received.push({cookie:req.headers.cookie,csrf:req.headers['x-csrf-token'],body});
  const identity=req.headers.cookie==='session=alice'?'alice':req.headers.cookie==='session=bob'?'bob':null;
  res.statusCode=identity&&req.headers['x-csrf-token']===identity+'-csrf'?200:401;
  res.end(JSON.stringify({identity}));
 });
 try{
  for(const identity of ['alice','bob']){
   const response=await f.call('/api/school-auth',{method:'POST',headers:{cookie:'session='+identity,'x-csrf-token':identity+'-csrf','content-type':'application/json'},body:JSON.stringify({action:identity})});
   assert.equal(response.status,200);assert.equal((await response.json()).identity,identity);
  }
  const unauthenticated=await f.call();assert.equal(unauthenticated.status,401);await unauthenticated.text();
  assert.equal(f.requests.length,1);assert.equal(sockets.size,1);
  assert.deepEqual(received,[{cookie:'session=alice',csrf:'alice-csrf',body:'{"action":"alice"}'},{cookie:'session=bob',csrf:'bob-csrf',body:'{"action":"bob"}'},{cookie:undefined,csrf:undefined,body:''}]);
 }finally{await f.close();}
});

test('real ssh2 channels carry successive HTTP requests without requiring net.Socket methods', {timeout:5000},async()=>{
 const origin=http.createServer((req,res)=>res.end(req.headers.cookie||'anonymous')),originPort=await listen(origin);
 const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
 const hash=createHash('sha256').update(sshUtils.parseKey(key).getPublicSSH()).digest('hex');
 let channelCount=0;const connections=[],targets=[];
 const ssh=new SSHServer({hostKeys:[key]},client=>{
  connections.push(client);client.on('error',()=>{});
  client.on('authentication',ctx=>ctx.accept()).on('ready',()=>client.on('tcpip',(accept,reject,info)=>{
   assert.equal(info.destIP,'127.0.0.1');assert.equal(info.destPort,3100);channelCount++;
   const channel=accept(),target=net.connect(originPort,'127.0.0.1');targets.push(target);
   target.on('error',()=>channel.destroy());channel.on('error',()=>target.destroy());channel.on('close',()=>target.destroy());
   channel.pipe(target).pipe(channel);
  }));
 });
 const sshPort=await listen(ssh);
 class LocalClient extends SSHClient{connect(config){return super.connect({...config,host:'127.0.0.1',port:sshPort,privateKey:undefined});}}
 const relay=createRelay({env:{...env,GUANGZHOU_RELAY_HOST_SHA256:hash},clientFactory:()=>new LocalClient(),timeoutMs:1500});
 const front=http.createServer((req,res)=>relay.relay('school-auth',req,res)),port=await listen(front);
 try{
  for(const identity of ['alice','bob','']){
   const response=await fetch('http://127.0.0.1:'+port+'/api/school-auth',{headers:identity?{cookie:identity}:{}});
   assert.equal(response.status,200);assert.equal(await response.text(),identity||'anonymous');
  }
  assert.equal(channelCount,1);assert.equal(connections.length,1);
 }finally{
  relay.close();for(const client of connections)client.end();for(const target of targets)target.destroy();
  front.closeAllConnections();origin.closeAllConnections();
  await Promise.all([front,origin,ssh].map(server=>new Promise(resolve=>server.close(resolve))));
 }
});

test('a session that died while the instance was suspended is replaced before a POST is forwarded',async()=>{
 let calls=0,clock=1000;const f=await fixture((req,res)=>{calls++;res.end('{"ok":true}');},{now:()=>clock});
 try{
  await (await f.call()).text();assert.equal(f.clients.length,1);
  clock+=60000; // still inside the idle window, so the cached session is trusted
  // The server closed the session meanwhile: ssh2 throws synchronously on the ended socket.
  f.clients[0].forwardOut=()=>{throw new Error('Not connected');};
  const r=await f.call('/api/school-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"login"}'});
  assert.equal(r.status,200);assert.equal(calls,2,'the origin saw the POST exactly once');
  assert.equal(f.clients.length,2);assert.equal(f.clients[0].closed,true,'the dead session is torn down');
  assert.equal(f.requests.length,2,'the dead session forwarded nothing');
 }finally{await f.close();}
});
test('a channel open that never answers is a dead session: torn down and retried once',{timeout:5000},async()=>{
 let calls=0,clock=1000;const f=await fixture((req,res)=>{calls++;res.end('{"ok":true}');},{channelOpenTimeoutMs:150,now:()=>clock});
 try{
  await (await f.call()).text();clock+=60000;
  f.clients[0].forwardOut=()=>{}; // the network path is silently gone
  const started=Date.now();
  const r=await f.call('/api/school-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"login"}'});
  assert.equal(r.status,200);assert.equal(calls,2);assert.equal(f.clients.length,2);assert.equal(f.clients[0].closed,true);
  assert.ok(Date.now()-started>=140,'waited for the channel-open deadline before replacing the session');
 }finally{await f.close();}
});
test('a half-closed SSH socket is forgotten at once and the next request reconnects',async()=>{
 let clock=1000;const f=await fixture((req,res)=>res.end('{"ok":true}'),{now:()=>clock});
 try{
  await (await f.call()).text();assert.equal(f.clients.length,1);
  f.clients[0].emit('end');clock+=10;
  await (await f.call()).text();assert.equal(f.clients.length,2);
 }finally{await f.close();}
});
test('concurrent requests on a dead session share one replacement session',async()=>{
 let calls=0,clock=1000;const f=await fixture((req,res)=>{calls++;res.end('{"ok":true}');},{now:()=>clock});
 try{
  await (await f.call()).text();clock+=60000;
  f.clients[0].forwardOut=()=>{throw new Error('Not connected');};
  const results=await Promise.all([f.call(),f.call(),f.call()]);
  assert.deepEqual(results.map(r=>r.status),[200,200,200]);assert.equal(calls,4);assert.equal(f.clients.length,2);
 }finally{await f.close();}
});
test('an open failure answered by the server keeps the live session and is not retried',async()=>{
 let calls=0,clock=1000;const f=await fixture((req,res)=>{calls++;res.end('{"ok":true}');},{now:()=>clock});
 try{
  await (await f.call()).text();clock+=60000;
  let refused=0;f.clients[0].forwardOut=(from,port,to,target,cb)=>{refused++;queueMicrotask(()=>cb(Object.assign(new Error('(SSH) Channel open failure: Connection refused'),{reason:'CONNECT_FAILED'})));};
  const r=await f.call('/api/school-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"login"}'});
  assert.equal(r.status,503);assert.equal((await r.json()).code,'ORIGIN_UNAVAILABLE');assert.equal(calls,1);assert.equal(refused,1);
  assert.equal(f.clients.length,1,'the origin refused, so the session itself is kept');assert.equal(f.clients[0].closed,false);
 }finally{await f.close();}
});
test('a dead replacement session is not retried again: the POST is reported unavailable and never forwarded',async()=>{
 let calls=0;const f=await fixture((req,res)=>{calls++;res.end('{"ok":true}');},{onConnect:client=>{queueMicrotask(()=>{client.forwardOut=()=>{throw new Error('Not connected');};client.emit('ready');});}});
 try{
  const r=await f.call('/api/school-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"login"}'});
  assert.equal(r.status,503);assert.equal((await r.json()).code,'ORIGIN_UNAVAILABLE');assert.equal(calls,0);assert.equal(f.clients.length,2);
 }finally{await f.close();}
});
test('expired HTTP channels reconnect on the same SSH session even after a suspended clock',async()=>{
 let clock=1000;const f=await fixture((req,res)=>res.end('ok'),{now:()=>clock});
 try{
  await (await f.call()).text();clock+=45000;
  await (await f.call()).text();assert.equal(f.requests.length,1,'a 45 second reading pause reuses the HTTP channel');
  clock+=56000;
  await (await f.call()).text();assert.equal(f.clients.length,1);assert.equal(f.requests.length,2);
  assert(f.channels[0].destroyed,'expired channel is destroyed before reuse');
  const previous=f.channels[1],closed=new Promise(resolve=>previous.once('close',resolve));
  f.clients[0].emit('close');await closed;
  await (await f.call()).text();assert.equal(f.clients.length,2);assert.equal(f.requests.length,3);
 }finally{await f.close();}
});

test('a warm HTTP request skips the measured channel-open delay',async()=>{
 const f=await fixture((req,res)=>res.end('ok'),{forwardDelayMs:120});
 try{
  const timings=[];
  for(let i=0;i<2;i++){const response=await f.call();await response.text();timings.push(Number(/relay_channel;dur=([\d.]+)/.exec(response.headers.get('server-timing'))[1]));}
  assert(timings[0]>=100,'cold request includes the injected channel-open network delay');
  assert(timings[1]<timings[0]/2,'warm request avoids reopening the channel');
  assert.equal(f.requests.length,1);
 }finally{await f.close();}
});

test('idle HTTP channels close before the origin keep-alive deadline', {timeout:6000},async()=>{
 const f=await fixture((req,res)=>{res.setHeader('Keep-Alive','timeout=2');res.end('ok');});
 try{
  await (await f.call()).text();const began=performance.now(),socket=f.channels[0];
  if(!socket.destroyed)await new Promise(resolve=>socket.once('close',resolve));
  assert(performance.now()-began<1800,'client honours a shorter advertised timeout before the origin deadline');
  await (await f.call()).text();assert.equal(f.clients.length,1);assert.equal(f.requests.length,2);
 }finally{await f.close();}
});

test('sixteen concurrent requests use bounded separate channels and reuse them after completion',async()=>{
 let allArrived;const arrived=new Promise(resolve=>allArrived=resolve),held=[],sockets=new Set();let release=false;
 const f=await fixture((req,res)=>{sockets.add(req.socket);if(release)return res.end('ok');held.push(res);if(held.length===16)allArrived();});
 try{
  const pending=Array.from({length:16},()=>f.call());await arrived;
  const overflow=await f.call();assert.equal(overflow.status,503);assert.equal((await overflow.json()).code,'SERVICE_BUSY');
  assert.equal(f.requests.length,16);assert.equal(sockets.size,16);
  release=true;for(const res of held)res.end('ok');
  for(const response of await Promise.all(pending))assert.equal(await response.text(),'ok');
  await new Promise(resolve=>setImmediate(resolve));
  assert(f.channels.filter(socket=>!socket.destroyed).length<=4,'only four idle channels are retained');
  await (await f.call()).text();assert.equal(f.requests.length,16);
 }finally{for(const res of held)res.end();await f.close();}
});

test('aborted browser requests destroy the partial channel before another identity uses the pool',async()=>{
 let originClosed;const closed=new Promise(resolve=>originClosed=resolve);let calls=0;
 const f=await fixture((req,res)=>{
  calls++;if(calls>1){res.end('data: {"type":"done"}\n\n');return;}
  req.socket.once('close',originClosed);res.setHeader('Content-Type','text/event-stream');res.write('data: {"type":"delta"}\n\n');
 },{name:'maanshan-chat'});
 try{
  const abort=new AbortController(),response=await f.call('/api/maanshan-chat',{method:'POST',headers:{accept:'text/event-stream',cookie:'session=alice','content-type':'application/json'},body:'{}',signal:abort.signal});
  const reader=response.body.getReader();assert.equal((await reader.read()).done,false);abort.abort();
  await assert.rejects(reader.read());await closed;
  const next=await f.call('/api/maanshan-chat',{headers:{cookie:'session=bob'}});assert.equal(next.status,200);await next.text();
  assert.equal(calls,2,'the interrupted POST is never replayed');assert.equal(f.requests.length,2);assert(f.channels[0].destroyed);
 }finally{await f.close();}
});

test('chat deltas reach the browser before completion without buffering the provider response',async()=>{
 let finishOrigin;const f=await fixture((req,res)=>{
  res.setHeader('Content-Type','text/event-stream; charset=utf-8');
  res.write('data: {"type":"delta","text":"你好"}\n\n');
  finishOrigin=()=>res.end('data: {"type":"done","reply":"你好"}\n\n');
 },{name:'maanshan-chat'});
 try{
  const response=await f.call('/api/maanshan-chat',{headers:{accept:'text/event-stream'}});
  assert.match(response.headers.get('content-type'),/text\/event-stream/);assert.equal(response.headers.get('content-length'),null);
  const reader=response.body.getReader();const first=await reader.read();assert.match(new TextDecoder().decode(first.value),/"delta"/);
  finishOrigin();let remainder='';for(;;){const part=await reader.read();if(part.done)break;remainder+=new TextDecoder().decode(part.value);}
  assert.match(remainder,/"done"/);
 }finally{finishOrigin?.();await f.close();}
});

test('a broken chat stream stays incomplete and is never replayed',async()=>{
 let calls=0,breakOrigin;const f=await fixture((req,res)=>{
  calls++;if(calls>1){res.end('recovered');return;}res.setHeader('Content-Type','text/event-stream');res.write('data: {"type":"delta","text":"部分"}\n\n');breakOrigin=()=>res.destroy();
 },{name:'maanshan-chat'});
 try{
  const response=await f.call('/api/maanshan-chat',{method:'POST',headers:{accept:'text/event-stream','content-type':'application/json'},body:'{}'});
  const reader=response.body.getReader();assert.equal((await reader.read()).done,false);breakOrigin();
  await assert.rejects(reader.read());assert.equal(calls,1);
  assert.equal(await (await f.call('/api/maanshan-chat')).text(),'recovered');assert.equal(f.requests.length,2);assert(f.channels[0].destroyed);
 }finally{breakOrigin?.();await f.close();}
});

test('real teacher JSON server and relay negotiate gzip and preserve exact payload and HEAD headers',async()=>{
 const payload={students:Array.from({length:140},(_,id)=>({id,text:'測試學習資料',score:81}))},plain=Buffer.from(JSON.stringify(payload)),encodings=[];
 const handler=(req,res)=>{encodings.push(req.headers['accept-encoding']);res.setHeader('Vary','Cookie');res.json(payload);};
 const origin=createApiServer({handlers:Object.fromEntries(Object.keys(routes).map(name=>[name,handler]))});
 const f=await fixture(null,{name:'teacher-analytics',origin});
 try{
   const compressed=await f.raw('/api/teacher-analytics',{headers:{'Accept-Encoding':'br, gzip'}});
   assert.equal(encodings.at(-1),'gzip');assert.equal(compressed.headers['content-encoding'],'gzip');assert.deepEqual(gunzipSync(compressed.body),plain);assert.equal(Number(compressed.headers['content-length']),compressed.body.length);assert.match(compressed.headers.vary,/Cookie.*Accept-Encoding/);
   for(const encoding of [undefined,'identity','gzip;q=0','gzip;q=0, *;q=1','br']){
     const response=await f.raw('/api/teacher-analytics',{headers:encoding===undefined?{}:{'Accept-Encoding':encoding}});assert.equal(encodings.at(-1),'identity');assert.equal(response.headers['content-encoding'],undefined);assert.deepEqual(response.body,plain);
   }
   const head=await f.raw('/api/teacher-analytics',{method:'HEAD',headers:{'Accept-Encoding':'gzip'}});assert.equal(head.body.length,0);assert.equal(head.headers['content-encoding'],'gzip');assert.equal(head.headers['content-length'],compressed.headers['content-length']);
 }finally{await f.close();}
});

test('teacher relay keeps Office identity and compressed error status; rejects unexpected encoding',async()=>{
 const bytes=Buffer.concat([Buffer.from([80,75,3,4]),Buffer.alloc(3000)]),failure={code:'NOT_READY',detail:'synthetic '.repeat(150)};
 const handler=(req,res)=>{if(req.query.error)return res.status(503).json(failure);res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');res.send(bytes);};
 const origin=createApiServer({handlers:Object.fromEntries(Object.keys(routes).map(name=>[name,handler]))});
 const f=await fixture(null,{name:'teacher-tools',origin});
 try{
   const file=await f.raw('/api/teacher-tools?tool=export',{headers:{'Accept-Encoding':'gzip'}});assert.equal(file.headers['content-encoding'],undefined);assert.deepEqual(file.body,bytes);
   const error=await f.raw('/api/teacher-tools?error=1',{headers:{'Accept-Encoding':'gzip'}});assert.equal(error.status,503);assert.deepEqual(JSON.parse(gunzipSync(error.body)),failure);
 }finally{await f.close();}
 const bad=await fixture((req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Content-Encoding','gzip');res.end(gzipSync(Buffer.from(JSON.stringify(failure))));},{name:'teacher-tools'});
 try{const response=await bad.raw('/api/teacher-tools',{headers:{'Accept-Encoding':'gzip;q=0'}});assert.equal(response.status,502);assert.equal(response.headers['content-encoding'],undefined);assert.equal(JSON.parse(response.body).code,'ORIGIN_ENCODING_UNSUPPORTED');}finally{await bad.close();}
});
