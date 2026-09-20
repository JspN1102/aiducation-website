'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),net=require('node:net');
const {EventEmitter}=require('node:events');
const {createRelay,configuration,createGateway}=require('../api/_lib/guangzhou-relay.cjs');
const env={GUANGZHOU_RELAY_HOST:'134.175.149.14',GUANGZHOU_RELAY_USERNAME:'maanshan-relay',GUANGZHOU_RELAY_HOST_SHA256:'a'.repeat(64),GUANGZHOU_RELAY_PRIVATE_KEY:'-----BEGIN OPENSSH PRIVATE KEY-----\nSYNTHETIC-ONLY\n-----END OPENSSH PRIVATE KEY-----'};
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
async function fixture(fn,options={}){
 const origin=http.createServer(fn),originPort=await listen(origin),clients=[],requests=[];
 class SSH extends EventEmitter{
  connect(config){this.config=config;queueMicrotask(()=>config.hostVerifier(options.hostHash||'a'.repeat(64))?this.emit('ready'):this.emit('error',new Error('synthetic key mismatch')));return this;}
  forwardOut(from,port,to,target,cb){requests.push({from,port,to,target});const socket=net.connect(originPort,'127.0.0.1');socket.once('connect',()=>cb(null,socket));socket.once('error',cb);}
  end(){this.emit('close');}destroy(){this.end();}
 }
 const relay=createRelay({env,clientFactory:()=>{const client=new SSH();clients.push(client);return client;},timeoutMs:options.timeoutMs||1500});
 const frontend=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);if(chunks.length){try{req.body=JSON.parse(Buffer.concat(chunks));}catch{req.body=Buffer.concat(chunks);}}await relay.relay(options.name||'school-auth',req,res);});
 const port=await listen(frontend);
 return {clients,requests,call:(url='/api/school-auth',init={})=>fetch('http://127.0.0.1:'+port+url,init),close:async()=>{relay.close();frontend.closeAllConnections();origin.closeAllConnections();await Promise.all([new Promise(r=>frontend.close(r)),new Promise(r=>origin.close(r))]);}};
}
test('fixed host and pinned key are mandatory; environment cannot create an arbitrary destination',()=>{
 assert.equal(configuration(env).host,'134.175.149.14');
 assert.equal(configuration(env).port,22);
 assert.equal(configuration({...env,GUANGZHOU_RELAY_PORT:'2222'}).port,2222);
 assert.throws(()=>configuration({...env,GUANGZHOU_RELAY_PORT:'5432'}));
 for(const update of [{GUANGZHOU_RELAY_HOST:'127.0.0.1'},{GUANGZHOU_RELAY_USERNAME:'ubuntu'},{GUANGZHOU_RELAY_HOST_SHA256:''},{GUANGZHOU_RELAY_PRIVATE_KEY:'password'}])assert.throws(()=>configuration({...env,...update}));
});
test('shared gateway only accepts allowed endpoints and preserves repeated business query values',()=>{
 let forwarded;const handler=createGateway((...args)=>{forwarded=args;});
 const req={query:{schoolRoute:'teacher-tools'},url:'/api/teacher-tools/?schoolRoute=teacher-tools&tool=demo-export&grade=2&x=1&x=2',body:{action:'xlsx'},headers:{cookie:'synthetic'}};
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
test('oversized upstream data is never delivered as a truncated Office download',async()=>{
 const f=await fixture((req,res)=>res.end(Buffer.alloc(5*1024*1024)),{name:'teacher-tools'});
 try{const r=await f.call('/api/teacher-tools');assert.equal(r.status,502);assert.equal((await r.json()).code,'ORIGIN_RESPONSE_TOO_LARGE');}finally{await f.close();}
});
