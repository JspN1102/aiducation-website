'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),net=require('node:net');
const {EventEmitter}=require('node:events');
const {gzipSync,gunzipSync}=require('node:zlib');
const {createApiServer}=require('./index.cjs');
const routes=require('./routes.cjs');
const {createRelay,configuration,createGateway}=require('../api/_lib/guangzhou-relay.cjs');
const env={GUANGZHOU_RELAY_HOST:'134.175.149.14',GUANGZHOU_RELAY_USERNAME:'maanshan-relay',GUANGZHOU_RELAY_HOST_SHA256:'a'.repeat(64),GUANGZHOU_RELAY_PRIVATE_KEY:'-----BEGIN OPENSSH PRIVATE KEY-----\nSYNTHETIC-ONLY\n-----END OPENSSH PRIVATE KEY-----'};
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
async function fixture(fn,options={}){
 const origin=options.origin||http.createServer(fn),originPort=await listen(origin),clients=[],requests=[];
 class SSH extends EventEmitter{
  constructor(){super();this.closed=false;this.once('close',()=>{this.closed=true;});}
  connect(config){this.config=config;if(options.onConnect){options.onConnect(this,clients);return this;}queueMicrotask(()=>{if(options.failFirstHandshake&&clients.length===1)return this.emit('error',new Error('synthetic transport timeout'));config.hostVerifier(options.hostHash||'a'.repeat(64))?this.emit('ready'):this.emit('error',new Error('synthetic key mismatch'));});return this;}
  forwardOut(from,port,to,target,cb){requests.push({from,port,to,target});const socket=net.connect(originPort,'127.0.0.1');socket.once('connect',()=>cb(null,socket));socket.once('error',cb);}
  end(){this.emit('close');}destroy(){if(options.onDestroy)return options.onDestroy(this);this.end();}
 }
 const relay=createRelay({env,clientFactory:()=>{const client=new SSH();clients.push(client);return client;},timeoutMs:options.timeoutMs||1500});
 const frontend=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);if(chunks.length){try{req.body=JSON.parse(Buffer.concat(chunks));}catch{req.body=Buffer.concat(chunks);}}options.onRequest?.(req);await relay.relay(options.name||'school-auth',req,res);});
 const port=await listen(frontend);
 return {clients,requests,call:(url='/api/school-auth',init={})=>fetch('http://127.0.0.1:'+port+url,init),raw:(url,init)=>raw('http://127.0.0.1:'+port+url,init),close:async()=>{relay.close();frontend.closeAllConnections();origin.closeAllConnections();await Promise.all([new Promise(r=>frontend.close(r)),new Promise(r=>origin.close(r))]);}};
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
  const headers={'Content-Type':'application/json',Origin:'https://mandarin.aiducation.asia',Cookie:'__Host-maanshan_session=synthetic','X-CSRF-Token':'synthetic-csrf','X-Real-IP':'203.0.113.99','X-Vercel-Forwarded-For':'192.0.2.8'};
  const r=await f.call('/api/school-auth/?action=roster',{method:'POST',headers,body:JSON.stringify({action:'session'})});assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true});assert.match(r.headers.get('set-cookie'),/HttpOnly/);
  await (await f.call()).text();assert.equal(f.clients.length,1);
  assert.equal(received[0].url,'/api/school-auth?action=roster');assert.equal(received[0].headers.origin,headers.Origin);assert.equal(received[0].headers.cookie,headers.Cookie);assert.equal(received[0].headers['x-csrf-token'],'synthetic-csrf');assert.equal(received[0].headers['x-real-ip'],'192.0.2.8');assert.equal(received[0].headers['accept-encoding'],'identity');assert.deepEqual(JSON.parse(received[0].body),{action:'session'});
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
