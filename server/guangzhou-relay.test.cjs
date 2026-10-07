'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),https=require('node:https'),net=require('node:net');
const {EventEmitter}=require('node:events');
const {gzipSync,gunzipSync}=require('node:zlib');
const {generateKeyPairSync,createHash,createHmac}=require('node:crypto');
const {Client:SSHClient,Server:SSHServer,utils:sshUtils}=require('ssh2');
const {createApiServer}=require('./index.cjs');
const routes=require('./routes.cjs');
const {createRelay,configuration,createGateway,HONG_KONG}=require('../api/_lib/guangzhou-relay.cjs');
const env={GUANGZHOU_RELAY_HOST:'134.175.149.14',GUANGZHOU_RELAY_USERNAME:'maanshan-relay',GUANGZHOU_RELAY_HOST_SHA256:'a'.repeat(64),GUANGZHOU_RELAY_PRIVATE_KEY:'-----BEGIN OPENSSH PRIVATE KEY-----\nSYNTHETIC-ONLY\n-----END OPENSSH PRIVATE KEY-----',GUANGZHOU_RELAY_HONG_KONG:'off'};
const viaHongKong={...env,GUANGZHOU_RELAY_HONG_KONG:''};
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
async function fixture(fn,options={}){
 const origin=options.origin||http.createServer(fn);
 if(!options.origin)origin.keepAliveTimeout=65000;
 const originPort=await listen(origin),clients=[],requests=[],channels=[],logs=[];
 // A tunnel whose listener accepts the channel, then drops it unanswered.
 let deadHits=0;const deadSockets=new Set(),dead=net.createServer(socket=>{deadSockets.add(socket);socket.on('error',()=>{});socket.once('data',()=>{deadHits++;socket.destroy();});}),deadPort=await listen(dead);
 class SSH extends EventEmitter{
  constructor(){super();this.closed=false;this.once('close',()=>{this.closed=true;});}
  connect(config){this.config=config;if(options.onConnect){options.onConnect(this,clients);return this;}queueMicrotask(()=>{if(options.failFirstHandshake&&clients.length===1)return this.emit('error',new Error('synthetic transport timeout'));config.hostVerifier(options.hostHash||(config.host===HONG_KONG.host?HONG_KONG.hostHash:'a'.repeat(64)))?this.emit('ready'):this.emit('error',new Error('synthetic key mismatch'));});return this;}
  forwardOut(from,port,to,target,cb){
   requests.push({from,port,to,target});const action=options.onForward?.(target,this);
   if(action==='refuse'){queueMicrotask(()=>cb(Object.assign(new Error('(SSH) Channel open failure: Connection refused'),{reason:'CONNECT_FAILED'})));return;}
   const socket=net.connect(action==='dead'?deadPort:originPort,'127.0.0.1');channels.push(socket);(this.chans||=[]).push(socket);socket.once('connect',()=>options.forwardDelayMs?setTimeout(()=>cb(null,socket),options.forwardDelayMs):cb(null,socket));socket.once('error',cb);}
  end(){this.emit('close');}destroy(){if(options.onDestroy)return options.onDestroy(this);this.end();}
 }
 const relay=createRelay({env:options.env||env,clientFactory:()=>{const client=new SSH();clients.push(client);return client;},timeoutMs:options.timeoutMs||1500,log:line=>logs.push(line),...options.mode?{mode:options.mode}:{},...options.hopRequest?{hopRequest:options.hopRequest}:{},...options.now?{now:options.now}:{},...options.channelOpenTimeoutMs?{channelOpenTimeoutMs:options.channelOpenTimeoutMs}:{},...options.laneSessions?{laneSessions:options.laneSessions}:{},...options.maxActive?{maxActive:options.maxActive}:{}});
 // The gateway option stands in for a Vercel function entry (query parsed by the platform).
 const gateway=options.gateway&&createGateway((name,req,res)=>relay.relay(name,req,res,{acceptHop:!!options.acceptHop}));
 const frontend=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);if(chunks.length){try{req.body=JSON.parse(Buffer.concat(chunks));}catch{req.body=Buffer.concat(chunks);}}options.onRequest?.(req);if(gateway){req.query=Object.fromEntries(new URL(req.url,'http://test').searchParams);return gateway(req,res);}await relay.relay(req.headers['x-test-route']||options.name||'school-auth',req,res,{acceptHop:!!options.acceptHop});});
 const port=await listen(frontend);
 return {port,logs,get deadHits(){return deadHits;},clients,requests,channels,call:(url='/api/school-auth',init={})=>fetch('http://127.0.0.1:'+port+url,init),raw:(url,init)=>raw('http://127.0.0.1:'+port+url,init),close:async()=>{relay.close();frontend.closeAllConnections();origin.closeAllConnections();for(const socket of deadSockets)socket.destroy();await Promise.all([new Promise(r=>frontend.close(r)),new Promise(r=>origin.close(r)),new Promise(r=>dead.close(r))]);}};
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
 const origin=http.createServer((req,res)=>res.end(req.headers.cookie||'anonymous'));origin.keepAliveTimeout=95000;const originPort=await listen(origin);
 const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
 const hash=createHash('sha256').update(sshUtils.parseKey(key).getPublicSSH()).digest('hex');
 let channelCount=0;const connections=[],targets=[],methods=[];
 const ssh=new SSHServer({hostKeys:[key]},client=>{
  connections.push(client);client.on('error',()=>{});
  client.on('authentication',ctx=>{methods.push(ctx.method);if(ctx.method==='publickey')ctx.accept();else ctx.reject(['publickey']);}).on('ready',()=>client.on('tcpip',(accept,reject,info)=>{
   assert.equal(info.destIP,'127.0.0.1');assert.equal(info.destPort,3100);channelCount++;
   const channel=accept(),target=net.connect(originPort,'127.0.0.1');targets.push(target);
   target.on('error',()=>channel.destroy());channel.on('error',()=>target.destroy());channel.on('close',()=>target.destroy());
   channel.pipe(target).pipe(channel);
  }));
 });
 const sshPort=await listen(ssh);
 class LocalClient extends SSHClient{connect(config){return super.connect({...config,host:'127.0.0.1',port:sshPort,privateKey:key});}}
 const relay=createRelay({env:{...env,GUANGZHOU_RELAY_HOST_SHA256:hash},clientFactory:()=>new LocalClient(),timeoutMs:1500});
 const front=http.createServer((req,res)=>relay.relay('school-auth',req,res)),port=await listen(front);
 try{
  for(const identity of ['alice','bob','']){
   const response=await fetch('http://127.0.0.1:'+port+'/api/school-auth',{headers:identity?{cookie:identity}:{}});
   assert.equal(response.status,200);assert.equal(await response.text(),identity||'anonymous');
  }
  assert.equal(channelCount,1);assert.equal(connections.length,1);
  assert.deepEqual([...new Set(methods)],['publickey'],'the key is offered at once, without a none-auth round trip');
 }finally{
  relay.close();for(const client of connections)client.end();for(const target of targets)target.destroy();
  front.closeAllConnections();origin.closeAllConnections();
  await Promise.all([front,origin,ssh].map(server=>new Promise(resolve=>server.close(resolve))));
 }
});

test('a pooled channel the far side ended (its tunnel went away) is dropped, not reused unanswered', {timeout:5000},async()=>{
 const origin=http.createServer((req,res)=>res.end('ok'));origin.keepAliveTimeout=95000;const originPort=await listen(origin);
 const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
 const hash=createHash('sha256').update(sshUtils.parseKey(key).getPublicSSH()).digest('hex');
 const connections=[],targets=[],channels=[];
 const ssh=new SSHServer({hostKeys:[key]},client=>{
  connections.push(client);client.on('error',()=>{});
  client.on('authentication',ctx=>ctx.accept()).on('ready',()=>client.on('tcpip',accept=>{
   const channel=accept(),target=net.connect(originPort,'127.0.0.1');targets.push(target);channels.push({channel,target});
   target.on('error',()=>{});channel.on('error',()=>{});
   channel.on('data',chunk=>target.write(chunk));target.on('data',chunk=>channel.write(chunk));
  }));
 });
 const sshPort=await listen(ssh);
 class LocalClient extends SSHClient{connect(config){return super.connect({...config,host:'127.0.0.1',port:sshPort,privateKey:key});}}
 const relay=createRelay({env:{...env,GUANGZHOU_RELAY_HOST_SHA256:hash},clientFactory:()=>new LocalClient(),timeoutMs:1500});
 const front=http.createServer((req,res)=>relay.relay('school-auth',req,res)),port=await listen(front);
 try{
  const first=await fetch('http://127.0.0.1:'+port+'/api/school-auth');assert.equal(await first.text(),'ok');
  // What OpenSSH does when the forwarded listener's process exits: EOF only,
  // no CLOSE, and later data goes nowhere.
  const {channel,target}=channels[0];channel.removeAllListeners('data');channel.on('data',()=>{});target.destroy();channel.eof();
  await new Promise(resolve=>setTimeout(resolve,50));
  const began=performance.now(),second=await fetch('http://127.0.0.1:'+port+'/api/school-auth');
  assert.equal(second.status,200);assert.equal(await second.text(),'ok');
  assert(performance.now()-began<1000,'answered on a fresh channel, not after the relay deadline');
  assert.equal(channels.length,2);assert.equal(connections.length,1,'the SSH session itself stays');
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
 let calls=0,clock=1000;const f=await fixture((req,res)=>{calls++;res.end('{"ok":true}');},{now:()=>clock,laneSessions:{interactive:1,background:1}});
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

test('the once-a-minute keep-warm request keeps a channel open against the 95 second origin',async()=>{
 let clock=1000;const origin=http.createServer((req,res)=>res.end('ok'));origin.keepAliveTimeout=95000;
 const f=await fixture(null,{origin,now:()=>clock});
 try{
  await (await f.call()).text();clock+=62000;
  await (await f.call()).text();assert.equal(f.requests.length,1,'a minute later the channel is reused');
  clock+=86000;
  await (await f.call()).text();assert.equal(f.requests.length,2,'past 85 seconds a fresh channel is opened');
  assert(f.channels[0].destroyed,'the expired channel is closed before the origin deadline');
  assert.equal(f.clients.length,1);
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
 const f=await fixture((req,res)=>{sockets.add(req.socket);if(release)return res.end('ok');held.push(res);if(held.length===16)allArrived();},{laneSessions:{interactive:1,background:1},maxActive:16});
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

test('a class-wide burst spreads over at most three scoring sessions; a single pupil keeps one',async()=>{
 let allArrived;const arrived=new Promise(resolve=>allArrived=resolve),held=[];let release=false;
 const f=await fixture((req,res)=>{if(release)return res.end('ok');held.push(res);if(held.length===12)allArrived();},{name:'soe'});
 try{
  await (await f.call('/api/soe')).text();assert.equal(f.clients.length,1,'one request at a time never opens a second session');
  const pending=Array.from({length:12},()=>f.call('/api/soe',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));await arrived;
  assert.equal(f.clients.length,3,'concurrent scoring opens extra sessions, bounded at three');
  release=true;for(const res of held)res.end('ok');
  for(const response of await Promise.all(pending))assert.equal(await response.text(),'ok');
 }finally{for(const res of held)res.end();await f.close();}
});
test('background uploads travel on their own session, never the one carrying scores',async()=>{
 const f=await fixture((req,res)=>res.end('{"ok":true}'));
 try{
  await (await f.call('/api/soe',{headers:{'x-test-route':'soe'}})).text();
  await (await f.call('/api/school-recordings',{method:'POST',headers:{'x-test-route':'school-recordings','Content-Type':'application/json'},body:'{}'})).text();
  await (await f.call('/api/research-events',{method:'POST',headers:{'x-test-route':'research-events','Content-Type':'application/json'},body:'{}'})).text();
  await (await f.call('/api/soe',{headers:{'x-test-route':'soe'}})).text();
  assert.equal(f.clients.length,2,'one scoring session and one background session, each reused');
 }finally{await f.close();}
 assert(f.clients.every(client=>client.closed),'relay cleanup must close every SSH session');
});

test('requests take the Hong Kong relay first with its own pinned key; off keeps the direct route',async()=>{
 const f=await fixture((req,res)=>res.end('{"ok":true}'),{env:viaHongKong});
 try{
  const r=await f.call('/api/school-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"login"}'});
  assert.equal(r.status,200);assert.equal(r.headers.get('x-relay-route'),'hk');
  assert.deepEqual(f.clients.map(c=>[c.config.host,c.config.port,c.config.username]),[['43.161.201.12',2222,'maanshan-relay']]);
  assert.equal(f.clients[0].config.hostVerifier(HONG_KONG.hostHash),true);assert.equal(f.clients[0].config.hostVerifier('a'.repeat(64)),false,'the Guangzhou key is not accepted for Hong Kong');
  assert(f.requests.every(x=>x.to==='127.0.0.1'&&x.target===3100));
 }finally{await f.close();}
 const direct=await fixture((req,res)=>res.end('{"ok":true}'),{env:{...viaHongKong,GUANGZHOU_RELAY_HONG_KONG:'OFF'}});
 try{const r=await direct.call();assert.equal(r.headers.get('x-relay-route'),'gz');assert.deepEqual(direct.clients.map(c=>c.config.host),['134.175.149.14']);}finally{await direct.close();}
});
test('a Hong Kong handshake failure sends the POST once on the direct route, then pauses Hong Kong and returns to it later',async t=>{
 const logs=[];t.mock.method(console,'warn',(...args)=>logs.push(args));t.mock.method(console,'error',()=>{});
 let calls=0,clock=1000,hongKongDown=true;
 const f=await fixture((req,res)=>{calls++;res.end('{"ok":true}');},{env:viaHongKong,now:()=>clock,onConnect(client){queueMicrotask(()=>{if(client.config.host===HONG_KONG.host&&hongKongDown)client.emit('error',new Error('synthetic Hong Kong timeout'));else client.emit('ready');});}});
 try{
  const r=await f.call('/api/school-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"login"}'});
  assert.equal(r.status,200);assert.equal(r.headers.get('x-relay-route'),'gz');assert.equal(calls,1);assert.equal(f.requests.length,1);
  assert.deepEqual(f.clients.map(c=>c.config.host),['43.161.201.12','134.175.149.14']);
  assert.deepEqual(logs.map(x=>JSON.parse(x[0])),[{event:'school_relay_route',route:'guangzhou',reason:'HONG_KONG_CONNECT_FAILED',pauseSeconds:30}]);
  // A request in another lane during the pause goes straight to the direct route.
  await (await f.call('/api/school-recordings',{method:'POST',headers:{'x-test-route':'school-recordings','Content-Type':'application/json'},body:'{}'})).text();
  assert.deepEqual(f.clients.map(c=>c.config.host),['43.161.201.12','134.175.149.14','134.175.149.14']);
  // After the pause an idle direct session is replaced by Hong Kong.
  hongKongDown=false;clock+=31000;
  const back=await f.call();assert.equal(back.headers.get('x-relay-route'),'hk');await back.text();
  assert.equal(f.clients[1].closed,true,'the idle direct session is closed once Hong Kong is back');
  assert.equal(f.clients.at(-1).config.host,'43.161.201.12');
 }finally{await f.close();}
});
test('repeated Hong Kong connect failures double the pause from 30 seconds up to five minutes',async t=>{
 const logs=[];t.mock.method(console,'warn',(...args)=>logs.push(JSON.parse(args[0])));t.mock.method(console,'error',()=>{});
 let clock=1000;
 const f=await fixture((req,res)=>res.end('ok'),{env:viaHongKong,now:()=>clock,laneSessions:{interactive:1,background:1},onConnect(client){queueMicrotask(()=>client.config.host===HONG_KONG.host?client.emit('error',new Error('synthetic')):client.emit('ready'));}});
 try{
  for(let i=0;i<6;i++){await (await f.call()).text();clock+=6*60000;}
  assert.deepEqual(logs.map(x=>x.pauseSeconds),[30,60,120,240,300,300]);
 }finally{await f.close();}
});
test('Hong Kong refusing every port (tunnel down) reroutes the unsent POST to Guangzhou once, then rests Hong Kong for 15 seconds',async t=>{
 const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(JSON.parse(args[0])));
 let calls=0,clock=1000,tunnelDown=true;const refused=[];
 const f=await fixture((req,res)=>{calls++;res.end('{"ok":true}');},{env:viaHongKong,now:()=>clock,onForward(target,client){if(client.config.host===HONG_KONG.host&&tunnelDown){refused.push(target);return 'refuse';}}});
 try{
  const r=await f.call('/api/maanshan-save',{method:'POST',headers:{'x-test-route':'maanshan-save','Content-Type':'application/json'},body:'{"save":1}'});
  assert.equal(r.status,200);assert.equal(r.headers.get('x-relay-route'),'gz');assert.equal(calls,1);assert.deepEqual(refused,[3100,3101,3102]);
  assert.deepEqual(f.clients.map(c=>c.config.host),['43.161.201.12','134.175.149.14']);assert.equal(f.clients[0].closed,true);
  assert.deepEqual(warnings,[...[3100,3101,3102].map(port=>({event:'school_relay_port',port,reason:'refused',pauseSeconds:10})),{event:'school_relay_route',route:'guangzhou',reason:'HONG_KONG_TUNNEL_DOWN',pauseSeconds:15}]);
  clock+=14000;
  const paused=await f.call();assert.equal(paused.headers.get('x-relay-route'),'gz');await paused.text();
  tunnelDown=false;clock+=2000;
  const back=await f.call();assert.equal(back.headers.get('x-relay-route'),'hk');await back.text();
  assert.deepEqual(f.clients.map(c=>c.config.host),['43.161.201.12','134.175.149.14','134.175.149.14','43.161.201.12']);
 }finally{await f.close();}
});
test('a channel lost after Hong Kong accepted it is never replayed',async t=>{
 const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(JSON.parse(args[0])));
 let calls=0;const f=await fixture((req,res)=>{calls++;req.socket.destroy();},{env:viaHongKong});
 try{const r=await f.call('/api/soe',{method:'POST',headers:{'x-test-route':'soe','Content-Type':'application/json'},body:'{}'});assert.equal(r.status,502);assert.equal(calls,1);assert.equal(f.clients.length,1);assert.equal(f.requests.length,1);}finally{await f.close();}
 assert.deepEqual(warnings,[{event:'school_relay_port',port:3100,reason:'closed',pauseSeconds:10}],'a fresh channel dropped unanswered rests its port');
});
test('Hong Kong ports take turns per request; X-Relay-Port and x-school-relay name the port',async()=>{
 const seen=[];const f=await fixture((req,res)=>{seen.push(req.headers['x-school-relay']);res.end('ok');},{env:viaHongKong});
 try{
  const ports=[];
  for(let i=0;i<4;i++){const r=await f.call();assert.equal(r.headers.get('x-relay-route'),'hk');ports.push(r.headers.get('x-relay-port'));await r.text();}
  assert.deepEqual(ports,['3100','3101','3102','3100']);
  assert.deepEqual(f.requests.map(x=>x.target),[3100,3101,3102],'each port keeps its own pooled channel');
  assert.deepEqual(seen,['hk:3100','hk:3101','hk:3102','hk:3100']);assert.equal(f.clients.length,1);
 }finally{await f.close();}
 const direct=await fixture((req,res)=>{seen.push(req.headers['x-school-relay']);res.end('ok');});
 try{const r=await direct.call();assert.equal(r.headers.get('x-relay-route'),'gz');assert.equal(r.headers.get('x-relay-port'),'3100');await r.text();assert.equal(seen.at(-1),'gz:3100');}finally{await direct.close();}
});
test('a refused Hong Kong port rests ten seconds while the next port carries the unsent POST on the same session',async t=>{
 const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(JSON.parse(args[0])));
 let clock=1000,calls=0;
 const f=await fixture((req,res)=>{calls++;res.end('{"ok":true}');},{env:viaHongKong,now:()=>clock,onForward:target=>target===3101?'refuse':undefined});
 const post=async()=>{const r=await f.call('/api/soe',{method:'POST',headers:{'x-test-route':'soe','Content-Type':'application/json'},body:'{}'});assert.equal(r.status,200);await r.text();return r.headers.get('x-relay-port');};
 try{
  const ports=[];for(let i=0;i<4;i++)ports.push(await post());
  assert.deepEqual(ports,['3100','3102','3100','3102'],'3101 is skipped while it rests');
  assert.equal(calls,4);assert.equal(f.clients.length,1,'a refused channel keeps the session');
  assert.equal(f.requests.filter(x=>x.target===3101).length,1);
  assert.deepEqual(warnings,[{event:'school_relay_port',port:3101,reason:'refused',pauseSeconds:10}]);
  clock+=10001;
  assert.deepEqual([await post(),await post()],['3100','3102']);
  assert.equal(f.requests.filter(x=>x.target===3101).length,2,'after ten seconds the port is tried again');
 }finally{await f.close();}
});
test('a GET and a background upload go once more, on another port, after a fresh channel closed unanswered',async t=>{
 const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(JSON.parse(args[0])));
 for(const [route,init] of [['school-auth',{}],['school-recordings',{method:'POST',headers:{'x-test-route':'school-recordings','Content-Type':'application/json'},body:'{"id":"r1"}'}]]){
  const received=[];
  const f=await fixture(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;received.push({relay:req.headers['x-school-relay'],body});res.end('{"ok":true}');},{env:viaHongKong,onForward:target=>target===3100?'dead':undefined});
  try{
   const r=await f.call('/api/'+route,init);assert.equal(r.status,200);assert.equal(r.headers.get('x-relay-port'),'3101');await r.text();
   assert.equal(f.deadHits,1,'the first copy reached the broken listener');
   assert.deepEqual(received,[{relay:'hk:3101',body:init.body||''}]);
   assert.deepEqual(f.requests.map(x=>x.target),[3100,3101]);assert.equal(f.clients.length,1);
  }finally{await f.close();}
 }
 assert.deepEqual(warnings.map(x=>[x.event,x.port,x.reason]),[['school_relay_port',3100,'closed'],['school_relay_port',3100,'closed']]);
});
test('scoring, chat and speech POSTs are never sent again once a channel opened',async t=>{
 t.mock.method(console,'warn',()=>{});
 let calls=0;const f=await fixture((req,res)=>{calls++;res.end('{"ok":true}');},{env:viaHongKong,onForward:()=>'dead'});
 try{
  for(const route of ['soe','maanshan-chat','speech-to-text']){
   const r=await f.call('/api/'+route,{method:'POST',headers:{'x-test-route':route,'Content-Type':'application/json',accept:'text/event-stream'},body:'{}'});
   assert.equal(r.status,502);assert.equal((await r.json()).code,'ORIGIN_INTERRUPTED');
  }
  assert.equal(f.deadHits,3);assert.equal(f.requests.length,3,'one channel per request, none replayed');assert.equal(calls,0);
  assert.deepEqual(f.logs.map(line=>JSON.parse(line).retried),[false,false,false]);
 }finally{await f.close();}
});
test('a GET is not sent again once response headers arrived',async t=>{
 t.mock.method(console,'warn',()=>{});
 let calls=0;const f=await fixture((req,res)=>{calls++;res.writeHead(200,{'content-type':'application/json'});res.flushHeaders();setTimeout(()=>req.socket.destroy(),20);},{env:viaHongKong});
 try{const r=await f.call();assert.equal(r.status,502);assert.equal((await r.json()).code,'ORIGIN_INTERRUPTED');assert.equal(calls,1);assert.equal(f.requests.length,1);}finally{await f.close();}
});
// Computed here independently of the relay, so the signed format itself is pinned.
const hopSign=(ts,reason,ip,name,method)=>{const key=createHash('sha256').update('maanshan-school-hop-v1\n'+env.GUANGZHOU_RELAY_PRIVATE_KEY).digest();return ['v1',ts,reason,Buffer.from(ip).toString('base64url'),createHmac('sha256',key).update(['v1',ts,reason,ip,name,method].join('|')).digest('base64url')].join('.');};
const hopReason=hop=>hop.headers['x-school-hop'].split('.')[2];
// The hkg1 function and its iad1 sibling, joined by plain HTTP in place of the Vercel hop.
async function pair({origin=(req,res)=>res.end('{"ok":true}'),sibling=(req,res)=>res.end('{"ok":true}'),primaryEnv={},siblingEnv=viaHongKong,siblingOptions={},...options}={}){
 const iad1=await fixture(sibling,{gateway:true,acceptHop:true,env:siblingEnv,...options.now?{now:options.now}:{},...siblingOptions}),hops=[];
 const hopRequest=(url,init,callback)=>{const target=new URL(url);hops.push({url:target,method:init.method,headers:init.headers,agent:init.agent});return http.request({host:'127.0.0.1',port:iad1.port,path:target.pathname+target.search,method:init.method,headers:init.headers},callback);};
 const hkg1=await fixture(origin,{mode:'hk-primary',env:{...viaHongKong,VERCEL_URL:'school-abc.vercel.app',...primaryEnv},hopRequest,...options});
 return {hkg1,iad1,hops,close:async()=>{await hkg1.close();await iad1.close();}};
}
test('hk-primary never takes the direct route: a Hong Kong connect failure opens a 10 second breaker and hops to iad1',async t=>{
 const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(JSON.parse(args[0])));t.mock.method(console,'error',()=>{});
 let clock=1_700_000_000_000;const received=[];
 const p=await pair({now:()=>clock,
  sibling:async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;received.push({url:req.url,ip:req.headers['x-real-ip'],relay:req.headers['x-school-relay'],hop:req.headers['x-school-hop'],body});res.setHeader('set-cookie','sid=synthetic; HttpOnly');res.end('{"ok":true}');},
  onConnect(client){queueMicrotask(()=>client.config.host===HONG_KONG.host?client.emit('error',new Error('synthetic Hong Kong outage')):client.emit('ready'));}});
 try{
  const r=await p.hkg1.call('/api/school-auth/?action=session',{method:'POST',headers:{'Content-Type':'application/json','X-Vercel-Forwarded-For':'198.51.100.7','X-School-Hop':'v1.forged-by-client'},body:'{"action":"login"}'});
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true});
  assert.equal(r.headers.get('x-relay-hop'),'iad1');assert.equal(r.headers.get('x-relay-route'),'gz','a connect hop skips Hong Kong in iad1 too');assert.deepEqual(p.iad1.clients.map(c=>c.config.host),['134.175.149.14']);assert.match(r.headers.get('set-cookie'),/HttpOnly/);
  assert.deepEqual(p.hkg1.clients.map(c=>c.config.host),[HONG_KONG.host],'hkg1 never dials Guangzhou');assert.equal(p.hkg1.clients[0].config.readyTimeout,2500);
  assert.equal(p.hops.length,1);const [hop]=p.hops;
  assert.equal(hop.url.origin+hop.url.pathname,'https://school-abc.vercel.app/api/school-gateway-us/');assert.equal(hop.url.search,'?__school_route=school-auth&action=session');assert.equal(hop.method,'POST');
  assert.equal(hop.headers['x-school-hop'],hopSign(Math.floor(clock/1000),'connect','198.51.100.7','school-auth','POST'),'a client copy is replaced by a fresh signature');
  assert.equal(hop.headers['x-real-ip'],undefined);assert.equal(hop.headers['content-length'],'18');
  assert.deepEqual(received,[{url:'/api/school-auth?action=session',ip:'198.51.100.7',relay:'hop-gz:3100',hop:undefined,body:'{"action":"login"}'}]);
  assert.deepEqual(warnings,[{event:'school_relay_route',route:'iad1',reason:'HONG_KONG_CONNECT_FAILED',pauseSeconds:10}]);
  clock+=9000;
  const open=await p.hkg1.call();assert.equal(open.headers.get('x-relay-hop'),'iad1');await open.text();
  assert.equal(p.hkg1.clients.length,1,'an open breaker hops without touching Hong Kong');assert.equal(hopReason(p.hops.at(-1)),'breaker');
  clock+=1001;
  const retry=await p.hkg1.call();assert.equal(retry.status,200);await retry.text();
  assert.deepEqual(p.hkg1.clients.map(c=>c.config.host),[HONG_KONG.host,HONG_KONG.host],'after ten seconds Hong Kong is tried again');assert.equal(hopReason(p.hops.at(-1)),'connect');
  assert.deepEqual(p.iad1.clients.map(c=>c.config.host),['134.175.149.14'],'no hop reason sends iad1 to Hong Kong');
 }finally{await p.close();}
});
test('every Hong Kong port refusing in hkg1 hops; iad1 skips Hong Kong and records the original client address',async t=>{
 const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(JSON.parse(args[0])));
 const received=[];
 const p=await pair({onForward:()=>'refuse',sibling:async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;received.push({ip:req.headers['x-real-ip'],relay:req.headers['x-school-relay'],body});res.end('{"ok":true}');}});
 try{
  const r=await p.hkg1.call('/api/soe',{method:'POST',headers:{'x-test-route':'soe','Content-Type':'application/json','X-Vercel-Forwarded-For':'203.0.113.50'},body:'{"score":1}'});
  assert.equal(r.status,200);assert.equal(r.headers.get('x-relay-hop'),'iad1');assert.equal(r.headers.get('x-relay-route'),'gz');assert.equal(r.headers.get('x-relay-port'),'3100');
  assert.deepEqual(p.hkg1.requests.map(x=>x.target),[3100,3101,3102]);assert.equal(hopReason(p.hops[0]),'tunnel');
  assert.deepEqual(p.iad1.clients.map(c=>c.config.host),['134.175.149.14'],'a tunnel hop goes straight to Guangzhou');
  assert.deepEqual(received,[{ip:'203.0.113.50',relay:'hop-gz:3100',body:'{"score":1}'}]);
  assert.deepEqual(warnings.filter(x=>x.event==='school_relay_route'),[{event:'school_relay_route',route:'iad1',reason:'HONG_KONG_TUNNEL_DOWN',pauseSeconds:10}]);
 }finally{await p.close();}
});
test('hkg1 hops an idempotent request after its one retry closed unanswered, but never a scoring POST',async t=>{
 t.mock.method(console,'warn',()=>{});
 const p=await pair({onForward:()=>'dead'});
 try{
  const r=await p.hkg1.call('/api/school-auth');assert.equal(r.status,200);assert.equal(r.headers.get('x-relay-hop'),'iad1');await r.text();
  assert.deepEqual(p.hkg1.requests.map(x=>x.target),[3100,3101]);assert.equal(p.hkg1.deadHits,2);assert.equal(hopReason(p.hops[0]),'retry');
  const scored=await p.hkg1.call('/api/soe',{method:'POST',headers:{'x-test-route':'soe','Content-Type':'application/json'},body:'{}'});
  assert.equal(scored.status,502);await scored.text();assert.equal(p.hops.length,1,'a POST that may have arrived is never sent on');assert.equal(p.hkg1.deadHits,3);
 }finally{await p.close();}
});
test('Hong Kong off in hkg1 hops every request and iad1 goes direct; hop failures are honest',async t=>{
 const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(JSON.parse(args[0])));
 const received=[];
 const p=await pair({primaryEnv:{GUANGZHOU_RELAY_HONG_KONG:'off'},sibling:(req,res)=>{received.push([req.headers['x-school-relay'],req.headers['x-real-ip']]);res.end('ok');}});
 try{
  const r=await p.hkg1.call('/api/school-auth',{headers:{'X-Vercel-Forwarded-For':'2001:db8::7'}});assert.equal(r.status,200);assert.equal(await r.text(),'ok');
  assert.equal(r.headers.get('x-relay-hop'),'iad1');assert.equal(r.headers.get('x-relay-route'),'gz');
  assert.equal(p.hkg1.clients.length,0);assert.deepEqual(p.iad1.clients.map(c=>c.config.host),['134.175.149.14'],'an off hop skips Hong Kong in iad1 too');
  assert.deepEqual(received,[['hop-gz:3100','2001:db8::7']]);assert.equal(hopReason(p.hops[0]),'off');
 }finally{await p.close();}
 // No sibling address, a sibling that drops the connection, or a stalled one: the pupil gets the usual bounded failure.
 const lost=await fixture(()=>{},{mode:'hk-primary'});
 try{const r=await lost.call();assert.equal(r.status,503);assert.equal((await r.json()).code,'ORIGIN_UNAVAILABLE');assert.equal(lost.clients.length,0);assert.deepEqual(warnings,[{event:'school_relay_hop_failed',route:'school-auth',reason:'no_host',status:0}]);}finally{await lost.close();}
 const dropping=net.createServer(socket=>socket.destroy()),droppingPort=await listen(dropping);
 const unreachable=await fixture(()=>{},{mode:'hk-primary',env:{...env,VERCEL_URL:'school-abc.vercel.app'},hopRequest:(url,init,callback)=>http.request({host:'127.0.0.1',port:droppingPort,method:init.method,headers:init.headers},callback)});
 try{const r=await unreachable.call();assert.equal(r.status,503);assert.equal((await r.json()).code,'ORIGIN_UNAVAILABLE');assert.equal(JSON.parse(unreachable.logs[0]).hop,'off');}finally{await unreachable.close();await new Promise(r=>dropping.close(r));}
 const slow=await pair({primaryEnv:{GUANGZHOU_RELAY_HONG_KONG:'off'},timeoutMs:150,sibling:()=>{}});
 try{const r=await slow.hkg1.call();assert.equal(r.status,504);assert.equal((await r.json()).code,'ORIGIN_TIMEOUT');}finally{await slow.close();}
});
test('iad1 accepts only a fresh hop signed for the same route and method',async t=>{
 const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(JSON.parse(args[0])));
 let clock=1_700_000_000_000;const seen=[];
 const f=await fixture((req,res)=>{seen.push({ip:req.headers['x-real-ip'],relay:req.headers['x-school-relay'],hop:req.headers['x-school-hop']});res.end('ok');},{gateway:true,acceptHop:true,now:()=>clock});
 const ts=Math.floor(clock/1000);
 const call=(value,{route='school-auth',method='GET'}={})=>f.call('/api/school-gateway-us/?__school_route='+route,{method,headers:{...value===undefined?{}:{'x-school-hop':value},'X-Vercel-Forwarded-For':'192.0.2.200',...method==='POST'?{'Content-Type':'application/json'}:{}},...method==='POST'?{body:'{}'}:{}});
 try{
  const valid=await call(hopSign(ts-120,'connect','198.51.100.9','school-auth','GET'));assert.equal(valid.status,200);assert.equal(valid.headers.get('x-school-sibling'),'1');await valid.text();
  assert.deepEqual(seen,[{ip:'198.51.100.9',relay:'hop-gz:3100',hop:undefined}]);
  const good=hopSign(ts,'breaker','198.51.100.9','school-auth','GET'),parts=good.split('.');
  const forged=[
   [hopSign(ts-121,'connect','198.51.100.9','school-auth','GET')],
   [hopSign(ts+121,'connect','198.51.100.9','school-auth','GET')],
   [[...parts.slice(0,2),'tunnel',...parts.slice(3)].join('.')],
   [[...parts.slice(0,3),Buffer.from('203.0.113.1').toString('base64url'),parts[4]].join('.')],
   [good,{route:'soe'}],
   [good,{method:'POST'}],
   ['v1.'+ts+'.connect..x'],
   ['v2'+good.slice(2)],
  ];
  for(const [value,init] of forged){const r=await call(value,init);assert.equal(r.status,403);assert.equal(r.headers.get('x-school-sibling'),'rejected');assert.equal(await r.text(),'{"ok":false,"code":"BAD_HOP"}');}
  assert.equal(seen.length,1,'a rejected hop never reaches Guangzhou');
  assert.deepEqual(warnings.map(x=>[x.event,x.reason]),['expired','expired','signature','signature','signature','signature','format','format'].map(reason=>['school_relay_hop_rejected',reason]));
  assert(!JSON.stringify(warnings).includes('198.51.100.9'));
  const plain=await call(undefined);assert.equal(plain.status,200);await plain.text();
  assert.deepEqual(seen.at(-1),{ip:'192.0.2.200',relay:'gz:3100',hop:undefined},'without the header the sibling behaves as before');
 }finally{await f.close();}
 // A gateway that does not take hops never reads the header.
 const other=await fixture((req,res)=>{seen.push({ip:req.headers['x-real-ip'],relay:req.headers['x-school-relay'],hop:req.headers['x-school-hop']});res.end('ok');},{gateway:true,now:()=>clock});
 try{const r=await other.call('/api/school-gateway/?__school_route=school-auth',{headers:{'x-school-hop':hopSign(ts,'tunnel','198.51.100.9','school-auth','GET'),'X-Vercel-Forwarded-For':'192.0.2.200'}});assert.equal(r.status,200);await r.text();assert.deepEqual(seen.at(-1),{ip:'192.0.2.200',relay:'gz:3100',hop:undefined});}finally{await other.close();}
});
test('slow or failed requests leave one line of fixed labels and timings, never addresses, cookies, queries or bodies',async()=>{
 let clock=1000,slow=true;const secret='SYNTHETIC-SECRET';
 const f=await fixture((req,res)=>{if(slow)clock+=6000;res.end('{"ok":true}');},{now:()=>clock});
 try{
  const r=await f.call('/api/school-auth?login='+secret,{method:'POST',headers:{'Content-Type':'application/json',cookie:'session='+secret,'X-Vercel-Forwarded-For':'192.0.2.77'},body:JSON.stringify({password:secret})});
  assert.equal(r.status,200);await r.text();
  assert.equal(f.logs.length,1);
  assert.deepEqual(JSON.parse(f.logs[0]),{event:'school_relay_slow',route:'school-auth',via:'gz',port:3100,lane:'interactive',status:200,code:null,retried:false,hop:null,connectMs:0,channelMs:0,originMs:6000,totalMs:6000,bytes:11,region:process.env.VERCEL_REGION||null});
  for(const leak of [secret,'192.0.2.77','127.0.0.1','session'])assert(!f.logs[0].includes(leak),leak);
  slow=false;const quick=await f.call();await quick.text();assert.equal(f.logs.length,1,'a quick success is silent');
 }finally{await f.close();}
 const stalled=await fixture(()=>{},{timeoutMs:70});
 try{
  const r=await stalled.call('/api/school-auth?login='+secret,{headers:{'X-Vercel-Forwarded-For':'192.0.2.77'}});assert.equal(r.status,504);await r.text();
  assert.equal(stalled.logs.length,1);const line=JSON.parse(stalled.logs[0]);assert.equal(line.status,504);assert.equal(line.code,'ORIGIN_TIMEOUT');assert.equal(line.port,3100);
  for(const leak of [secret,'192.0.2.77'])assert(!stalled.logs[0].includes(leak));
 }finally{await stalled.close();}
});
test('relay modes are fixed and every mode has its gateway export',()=>{
 assert.throws(()=>createRelay({env,mode:'direct'}),/RELAY_MODE/);
 const exported=require('../api/_lib/guangzhou-relay.cjs');
 for(const key of ['gateway','gatewayHongKong','gatewayUs'])assert.equal(typeof exported[key],'function');
 assert.deepEqual(HONG_KONG.ports,[3100,3101,3102]);assert(Object.isFrozen(HONG_KONG.ports));
});
// A stand-in for whatever answers at the hop address; by default it marks its answers as the sibling does.
async function siblingStub(handler=(req,res)=>{res.setHeader('x-school-sibling','1');res.end('{"ok":true}');}){
 const server=http.createServer(handler),port=await listen(server),calls=[];
 const hopRequest=(url,init,callback)=>{const target=new URL(url);calls.push({url:target,method:init.method,headers:init.headers,agent:init.agent});return http.request({host:'127.0.0.1',port,path:target.pathname+target.search,method:init.method,headers:init.headers},callback);};
 return {calls,hopRequest,close:()=>{server.closeAllConnections();return new Promise(r=>server.close(r));}};
}
// As ssh2 does when a session drops: its channels close and the session ends together.
const kill=client=>{for(const socket of client.chans||[])socket.destroy();client.forwardOut=()=>{throw new Error('Not connected');};client.emit('end');client.emit('close');};
test('a session that dies with uploads in flight replays them on a new session; no port and never Hong Kong is rested',async t=>{
 const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(JSON.parse(args[0])));t.mock.method(console,'error',()=>{});
 for(const mode of ['full','hk-primary']){
  warnings.length=0;let hold=true;const held=[];
  const f=await fixture(async(req,res)=>{for await(const chunk of req);if(req.url==='/api/soe'||hold){held.push(res);return;}res.end('{"ok":true}');},{env:viaHongKong,mode,laneSessions:{interactive:1,background:1}});
  const until=n=>new Promise(r=>{const check=()=>held.length>=n?r():setTimeout(check,5);check();});
  const post=route=>f.call('/api/'+route,{method:'POST',headers:{'x-test-route':route,'Content-Type':'application/json'},body:'{}'});
  try{
   const scored=post('soe');await until(1);
   const uploads=[post('school-recordings'),post('school-recordings'),post('school-recordings')];await until(4);
   assert.equal(f.clients.length,2);hold=false;kill(f.clients[1]);
   for(const r of await Promise.all(uploads)){assert.equal(r.status,200,mode);assert.equal(r.headers.get('x-relay-route'),'hk');await r.text();}
   assert.deepEqual(f.clients.map(c=>c.config.host),[HONG_KONG.host,HONG_KONG.host,HONG_KONG.host],'one shared replacement session');
   assert.equal(f.clients[0].closed,false,'the scoring session is untouched');
   held[0].end('{"ok":true}');const r=await scored;assert.equal(r.status,200);await r.text();
   const next=await f.call();assert.equal(next.headers.get('x-relay-route'),'hk');await next.text();
   await new Promise(r=>setImmediate(r));
   assert.deepEqual(warnings,[],mode+': a lost session says nothing about the tunnels');
  }finally{for(const res of held)res.destroy();await f.close();}
 }
});
test('ports other requests rested are still tried, earliest first, before Hong Kong is declared down',async t=>{
 const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(JSON.parse(args[0])));
 let clock=1000,dead=true;
 const f=await fixture((req,res)=>res.end('{"ok":true}'),{env:viaHongKong,now:()=>clock,onForward:()=>dead?'dead':undefined});
 const post=()=>f.call('/api/soe',{method:'POST',headers:{'x-test-route':'soe','Content-Type':'application/json'},body:'{}'});
 try{
  const ports=[];for(let i=0;i<4;i++){const r=await post();assert.equal(r.status,502);ports.push(JSON.parse(f.logs.at(-1)).port);await r.text();clock++;}
  assert.deepEqual(ports,[3100,3101,3102,3100],'with every port resting, the one whose rest ends first is probed');
  dead=false;const r=await post();assert.equal(r.status,200);assert.equal(r.headers.get('x-relay-route'),'hk');assert.equal(r.headers.get('x-relay-port'),'3101');await r.text();
  assert.equal(f.clients.length,1);assert.equal(f.deadHits,4);
  assert.deepEqual(warnings,[3100,3101,3102].map(port=>({event:'school_relay_port',port,reason:'closed',pauseSeconds:10})),'no tunnel-down pause');
 }finally{await f.close();}
});
test('a session that ends right after its handshake is never used: the request opens a new one',async()=>{
 let opened=0,misused=0;
 const f=await fixture((req,res)=>res.end('{"ok":true}'),{onConnect(client){queueMicrotask(()=>{if(opened++)return client.emit('ready');client.forwardOut=()=>{misused++;throw new Error('Not connected');};client.emit('ready');client.emit('end');client.emit('close');});}});
 try{
  const r=await f.call('/api/school-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"login"}'});
  assert.equal(r.status,200);assert.equal(misused,0);assert.equal(f.clients.length,2);assert.equal(f.requests.length,1);
 }finally{await f.close();}
});
test('requests still queued for a channel when their session ends reconnect instead of failing',async t=>{
 t.mock.method(console,'warn',()=>{});
 let hold=true;const held=[];
 const f=await fixture((req,res)=>{if(hold)held.push(res);else res.end('ok');},{env:viaHongKong,laneSessions:{interactive:1,background:1}});
 const until=n=>new Promise(r=>{const check=()=>held.length>=n?r():setTimeout(check,5);check();});
 try{
  // Sixteen open channels fill the session's pool, then one more request queues behind them.
  const pending=Array.from({length:16},()=>f.call());await until(16);
  pending.push(f.call());await new Promise(r=>setTimeout(r,50));
  assert.equal(f.clients.length,1);assert.equal(f.requests.length,16,'the seventeenth waits for a channel');
  hold=false;kill(f.clients[0]);
  const results=await Promise.all(pending);
  assert.deepEqual(results.map(r=>r.status),Array(17).fill(200));for(const r of results)await r.text();
  assert.equal(f.clients.length,2);
 }finally{for(const res of held)res.destroy();await f.close();}
});
test('after a quiet spell a session takes the port it used last, whose channel is still warm',async()=>{
 let clock=1000;const f=await fixture((req,res)=>res.end('ok'),{env:viaHongKong,now:()=>clock});
 const port=async()=>{const r=await f.call();await r.text();return r.headers.get('x-relay-port');};
 try{
  const ports=[await port()];clock+=30000;ports.push(await port(),await port());
  assert.deepEqual(ports,['3100','3100','3101'],'busy requests take turns again');
  assert.deepEqual(f.requests.map(x=>x.target),[3100,3101],'the quiet request reused the open channel');
 }finally{await f.close();}
});
test('an answer the sibling did not mark (a platform page or a rejected hop) reaches the pupil as unavailable',async t=>{
 const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(JSON.parse(args[0])));
 const pages=[[401,{'set-cookie':'_vercel_sso_nonce=synthetic; HttpOnly','content-type':'text/html'},'<html>login</html>'],[307,{location:'https://vercel.com/sso-api?url=x','set-cookie':'_vercel_jwt=synthetic'},''],[404,{'x-vercel-error':'NOT_FOUND'},'missing'],[200,{'content-type':'text/html'},'<html>page</html>']];
 let next=0;const stub=await siblingStub((req,res)=>{const [status,headers,body]=pages[next++];res.writeHead(status,headers);res.end(body);});
 const f=await fixture(()=>{},{mode:'hk-primary',env:{...env,VERCEL_URL:'school-abc.vercel.app'},hopRequest:stub.hopRequest});
 try{
  for(const [status] of pages){
   const r=await f.call();assert.equal(r.status,503);assert.equal((await r.json()).code,'ORIGIN_UNAVAILABLE');
   for(const key of ['set-cookie','location','x-vercel-error','x-relay-hop'])assert.equal(r.headers.get(key),null,key);
   assert.deepEqual(warnings.at(-1),{event:'school_relay_hop_failed',route:'school-auth',reason:'platform',status});
  }
  assert.equal(warnings.length,pages.length);
 }finally{await f.close();await stub.close();}
 // A sibling holding another key rejects the hop: the pupil sees an outage, not a 403.
 warnings.length=0;
 const p=await pair({primaryEnv:{GUANGZHOU_RELAY_HONG_KONG:'off'},siblingEnv:{...viaHongKong,GUANGZHOU_RELAY_PRIVATE_KEY:'-----BEGIN OPENSSH PRIVATE KEY-----\nOTHER-SYNTHETIC\n-----END OPENSSH PRIVATE KEY-----'}});
 try{
  const r=await p.hkg1.call();assert.equal(r.status,503);assert.equal((await r.json()).code,'ORIGIN_UNAVAILABLE');assert.equal(r.headers.get('x-school-sibling'),null);
  assert.deepEqual(warnings,[{event:'school_relay_hop_rejected',route:'school-auth',reason:'signature'},{event:'school_relay_hop_failed',route:'school-auth',reason:'rejected',status:403}]);
  assert.equal(p.iad1.clients.length,0);
 }finally{await p.close();}
});
test('the hop goes to this deployment with the bypass secret, else the public domain; reserved query values stay behind',async t=>{
 const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(JSON.parse(args[0])));
 const bypass='synthetic-bypass-0123456789abcdef';
 const stub=await siblingStub((req,res)=>{res.setHeader('x-school-sibling','1');res.setHeader('x-vercel-id','iad1::synthetic');res.setHeader('x-relay-route','gz');res.end('{"ok":true}');});
 const cases=[
  [{VERCEL_URL:'school-abc.vercel.app',VERCEL_ENV:'production',VERCEL_AUTOMATION_BYPASS_SECRET:bypass},'school-abc.vercel.app',bypass],
  [{VERCEL_URL:'school-abc.vercel.app',VERCEL_ENV:'production'},'mandarin.aiducation.asia',undefined],
  [{VERCEL_URL:'school-abc.vercel.app',VERCEL_ENV:'production',VERCEL_AUTOMATION_BYPASS_SECRET:'short'},'mandarin.aiducation.asia',undefined],
  [{VERCEL_URL:'school-abc.vercel.app',VERCEL_ENV:'production',VERCEL_AUTOMATION_BYPASS_SECRET:'has a space in it'},'mandarin.aiducation.asia',undefined],
  [{VERCEL_URL:'evil.example/x',VERCEL_ENV:'production',VERCEL_AUTOMATION_BYPASS_SECRET:bypass},'mandarin.aiducation.asia',undefined],
  [{VERCEL_URL:'school-abc.vercel.app',VERCEL_ENV:'preview'},'school-abc.vercel.app',undefined],
  [{VERCEL_ENV:'preview',VERCEL_AUTOMATION_BYPASS_SECRET:bypass},null,undefined],
 ];
 try{
  for(const [extra,host,sent] of cases){
   const f=await fixture(()=>{},{mode:'hk-primary',env:{...env,...extra},hopRequest:stub.hopRequest});
   try{
    const before=stub.calls.length;
    const r=await f.call('/api/school-auth/?action=session&x-vercel-protection-bypass=x&x-vercel-set-bypass-cookie=true&_vercel_share=y&__school_route=soe&X-Vercel-Skip-Toolbar=1&grade=2');
    const text=await r.text();
    if(host===null){assert.equal(r.status,503);assert.equal(stub.calls.length,before);assert.deepEqual(warnings.at(-1),{event:'school_relay_hop_failed',route:'school-auth',reason:'no_host',status:0});continue;}
    assert.equal(r.status,200);assert.equal(text,'{"ok":true}');
    const call=stub.calls.at(-1);assert.equal(call.url.host,host,JSON.stringify(extra));assert.equal(call.url.search,'?__school_route=school-auth&action=session&grade=2');
    assert.equal(call.headers['x-vercel-protection-bypass'],sent);
    assert.equal(r.headers.get('x-vercel-id'),null);assert.equal(r.headers.get('x-relay-route'),'gz');
    assert(![...r.headers.values()].some(v=>v.includes(bypass))&&!text.includes(bypass)&&!f.logs.join().includes(bypass));
   }finally{await f.close();}
  }
  assert.equal(stub.calls.length,cases.length-1);assert(!JSON.stringify(warnings).includes(bypass));
 }finally{await stub.close();}
});
test('hops share one kept-alive agent per relay, sized for every active request and closed with the relay',async t=>{
 const stub=await siblingStub();
 const f=await fixture(()=>{},{mode:'hk-primary',env:{...env,VERCEL_URL:'school-abc.vercel.app'},hopRequest:stub.hopRequest,maxActive:7});
 let destroyed;
 try{
  for(let i=0;i<2;i++){const r=await f.call();assert.equal(r.status,200);await r.text();}
  const [first,second]=stub.calls;
  assert(first.agent instanceof https.Agent);assert.notStrictEqual(first.agent,https.globalAgent);
  assert.equal(first.agent.maxSockets,7);assert.equal(first.agent.keepAlive,true);assert.strictEqual(second.agent,first.agent);
  destroyed=t.mock.method(first.agent,'destroy');
 }finally{await f.close();await stub.close();}
 assert.equal(destroyed.mock.callCount(),1);
});
test('a request reaches Guangzhou at most three times: two ports in hkg1, then one direct try in iad1',async t=>{
 t.mock.method(console,'warn',()=>{});
 const p=await pair({onForward:()=>'dead',siblingOptions:{onForward:()=>'dead'}});
 try{
  for(const [path,init] of [['/api/school-auth',{}],['/api/school-recordings',{method:'POST',headers:{'x-test-route':'school-recordings','Content-Type':'application/json'},body:'{"id":"r1"}'}]]){
   const before=[p.hkg1.deadHits,p.iad1.deadHits];
   const r=await p.hkg1.call(path,init);assert.equal(r.status,502);assert.equal((await r.json()).code,'ORIGIN_INTERRUPTED');assert.equal(r.headers.get('x-relay-hop'),'iad1');
   assert.deepEqual([p.hkg1.deadHits-before[0],p.iad1.deadHits-before[1]],[2,1],path);assert.equal(hopReason(p.hops.at(-1)),'retry');
  }
  assert(p.iad1.clients.every(c=>c.config.host==='134.175.149.14'),'iad1 never takes Hong Kong for a hop');
 }finally{await p.close();}
});
test('a hop on a kept-alive connection the edge had just closed is sent once more on a new connection, never again',async()=>{
 const stub=await siblingStub();const agents=[];
 class Dropped extends EventEmitter{constructor(reused){super();this.reusedSocket=reused;}write(){}end(){setImmediate(()=>this.emit('error',Object.assign(new Error('socket hang up'),{code:'ECONNRESET'})));}destroy(){}}
 const run=async plan=>{
  agents.length=0;
  const f=await fixture(()=>{},{mode:'hk-primary',env:{...env,VERCEL_URL:'school-abc.vercel.app'},hopRequest:(url,init,callback)=>{agents.push(init.agent);const kind=plan[agents.length-1];return kind==='ok'?stub.hopRequest(url,init,callback):new Dropped(kind==='reused');}});
  try{const r=await f.call();return [r.status,(await r.json()).code??null];}finally{await f.close();}
 };
 try{
  assert.deepEqual(await run(['reused','ok']),[200,null]);assert.equal(agents.length,2);assert(agents[0] instanceof https.Agent);assert.equal(agents[1],false,'the resend opens its own connection');
  assert.deepEqual(await run(['reused','reused']),[503,'ORIGIN_UNAVAILABLE']);assert.equal(agents.length,2);
  assert.deepEqual(await run(['fresh']),[503,'ORIGIN_UNAVAILABLE']);assert.equal(agents.length,1,'a new connection that failed is not sent again');
 }finally{await stub.close();}
});
