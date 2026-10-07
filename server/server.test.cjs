'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const {gunzipSync}=require('node:zlib');
const { test } = require('node:test');
const { createApiServer, bodyBudget, routeDeadline } = require('./index.cjs');
const fs = require('node:fs');
const path = require('node:path');
const routes = require('./routes.cjs');

async function start(t, options) {
  const server = createApiServer({ log() {}, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
function fixtures(handler) {
  return Object.fromEntries(Object.keys(routes).map(name => [name, handler]));
}
function post(base, path, body, headers = {}) {
  return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
}
// Chunked upload written piece by piece, like a pupil's recording on the slow relay leg.
function trickle(url,parts,gapMs,headers={}){return new Promise((resolve,reject)=>{let answered=false;const req=http.request(url,{method:'POST',agent:false,headers:{'Content-Type':'application/json','Transfer-Encoding':'chunked',...headers}},res=>{answered=true;const chunks=[];res.on('error',reject);res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString(),closed:new Promise(done=>req.socket.destroyed?done():req.socket.once('close',done))}));});req.on('error',error=>{if(!answered)reject(error);});let n=0;const next=()=>{if(answered)return;if(n<parts.length){req.write(parts[n++]);setTimeout(next,gapMs);}else req.end();};next();});}
async function until(check){for(let n=0;n<200&&!check();n++)await new Promise(resolve=>setTimeout(resolve,5));}
function raw(url,options={}){return new Promise((resolve,reject)=>{const req=http.request(url,options,res=>{const chunks=[];res.on('error',reject);res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);req.end();});}

test('bundled real handlers preserve health, validation, methods and dynamic teaching import', async t => {
  // No paid API or real database requests are made by this test.
  const names = ['GPT_API_KEY', 'GPT_API_BASE', 'TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY', 'TENCENT_APP_ID', 'DB_HOST', 'INIT_KEY'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  names.forEach(name => delete process.env[name]);
  t.after(() => names.forEach(name => previous[name] === undefined ? delete process.env[name] : process.env[name] = previous[name]));
  const base = await start(t);
  const health = await fetch(base + '/api/health/');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  const head = await fetch(base + '/api/health', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  for (const name of ['soe', 'tts', 'maanshan-chat', 'maanshan-report', 'maanshan-save', 'handwriting']) {
    const response = await post(base, `/api/${name}/`, '{}');
    assert.equal(response.status, 400, name);
  }
  const options = await fetch(base + '/api/soe', { method: 'OPTIONS' });
  assert.equal(options.status, 200);
  assert.match(options.headers.get('access-control-allow-methods'), /POST/);
  assert.equal((await fetch(base + '/api/soe/')).status, 405);
  assert.equal((await fetch(base + '/api/maanshan-init?key=incorrect')).status, 403);
  const report = await post(base, '/api/maanshan-report', JSON.stringify({ poemId: 1, studentGrade: 1, soeResult: { total_score: 70, words: [], linesCompleted: 1 } }));
  assert.equal(report.status, 500);
  assert.deepEqual(await report.json(), { error: 'GPT API not configured' });
});

test('unknown paths and source files are never executed or served', async t => {
  const base = await start(t, { handlers: fixtures(() => assert.fail('Unknown route called a handler')) });
  for (const path of ['/.env', '/api/_lib/db.js', '/api/tts.js', '/api/tts/extra', '/server/.build/handlers.cjs', '/maanshan/', '/api/%74ts', '/api/constructor']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});

test('JSON bodies, duplicate query parameters and Buffer responses follow Vercel semantics', async t => {
  const base = await start(t, { handlers: fixtures((req, res) => {
    if (req.query.binary) return res.status(206).setHeader('Content-Type', 'audio/wav').send(Buffer.from([1, 2, 3]));
    return res.status(201).json({ body: req.body, query: req.query });
  }) });
  const response = await post(base, '/api/tts/?key=a&key=b&__proto__=safe', '{"text":"春雨"}');
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { body: { text: '春雨' }, query: { key: ['a', 'b'], ['__proto__']: 'safe' } });
  const binary = await fetch(base + '/api/tts?binary=1');
  assert.equal(binary.status, 206);
  assert.equal(binary.headers.get('content-type'), 'audio/wav');
  assert.deepEqual(Buffer.from(await binary.arrayBuffer()), Buffer.from([1, 2, 3]));
  const head = await fetch(base + '/api/tts?binary=1', { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '3');
  assert.equal(await head.text(), '');
});

test('malformed, compressed, non-JSON and oversized requests fail before handlers', async t => {
  const base = await start(t, { handlers: fixtures(() => assert.fail('Invalid input called a handler')) });
  assert.equal((await post(base, '/api/tts', '{')).status, 400);
  assert.equal((await post(base, '/api/tts', '{}', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post(base, '/api/tts', '{}', { 'Content-Encoding': 'gzip' })).status, 415);
  assert.equal((await post(base, '/api/tts', JSON.stringify({ text: 'a'.repeat(65536) }))).status, 413);
  const chunkedStatus = await new Promise((resolve, reject) => {
    const req = http.request(base + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.write('"');
    req.write('a'.repeat(65537));
    req.end('"');
  });
  assert.equal(chunkedStatus, 413);
});

test('callback handlers finish normally and hung handlers receive a bounded timeout', async t => {
  const base = await start(t, { requestTimeoutMs: 100, handlers: fixtures((req, res) => {
    if (req.query.hang) return;
    setTimeout(() => res.status(200).json({ delayed: true }), 10);
  }) });
  assert.deepEqual(await (await fetch(base + '/api/tts')).json(), { delayed: true });
  const timedOut = await fetch(base + '/api/tts?hang=1');
  assert.equal(timedOut.status, 504);
  assert.deepEqual(await timedOut.json(), { error: 'Request timed out' });
  assert.equal((await fetch(base + '/api/health')).status, 200);
});

test('late provider callbacks cannot change a timeout response or crash the service', async t => {
  let completed;
  const callback = new Promise(resolve => { completed = resolve; });
  const base = await start(t, { requestTimeoutMs: 25, handlers: fixtures((req, res) => {
    setTimeout(() => {
      try {
        res.status(200);
        res.setHeader('Content-Type', 'audio/wav');
        res.end(Buffer.from('late audio'));
        completed();
      } catch (error) { completed(error); }
    }, 75);
  }) });
  const response = await fetch(base + '/api/tts');
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), { error: 'Request timed out' });
  assert.equal(await callback, undefined);
  assert.equal((await fetch(base + '/api/health')).status, 200);
});

test('only large teacher JSON negotiates gzip, preserving Vary, bytes and HEAD representation',async t=>{
 const payload={students:Array.from({length:160},(_,n)=>({id:n,reading:83.25,text:'普通話學習紀錄'}))},plain=Buffer.from(JSON.stringify(payload));
 const base=await start(t,{handlers:fixtures((req,res)=>{res.setHeader('Vary','Cookie');res.json(req.query.small?{ok:true}:payload);})});
 for(const route of ['teacher-analytics','teacher-tools']){
   const compressed=await raw(`${base}/api/${route}`,{headers:{'Accept-Encoding':'br, gzip;q=0.5'}});
   assert.equal(compressed.headers['content-encoding'],'gzip');assert.deepEqual(gunzipSync(compressed.body),plain);
   assert.equal(Number(compressed.headers['content-length']),compressed.body.length);assert.match(compressed.headers.vary,/Cookie/);assert.match(compressed.headers.vary,/Accept-Encoding/);
   assert.ok(compressed.body.length<plain.length/3);
   const head=await raw(`${base}/api/${route}`,{method:'HEAD',headers:{'Accept-Encoding':'gzip'}});
   assert.equal(head.body.length,0);assert.equal(head.headers['content-encoding'],'gzip');assert.equal(head.headers['content-length'],compressed.headers['content-length']);
 }
 for(const encoding of [undefined,'identity','gzip;q=0','gzip;q=0, *;q=1','br','gzip;q=invalid','gzip;q=1, gzip;q=0']){
   const result=await raw(base+'/api/teacher-analytics',{headers:encoding===undefined?{}:{'Accept-Encoding':encoding}});
   assert.equal(result.headers['content-encoding'],undefined);assert.deepEqual(result.body,plain);assert.match(result.headers.vary,/Accept-Encoding/);
 }
 const wildcard=await raw(base+'/api/teacher-analytics',{headers:{'Accept-Encoding':'*;q=0.3'}});assert.equal(wildcard.headers['content-encoding'],'gzip');
 for(const route of ['school-auth','tts']){const result=await raw(`${base}/api/${route}`,{headers:{'Accept-Encoding':'gzip'}});assert.equal(result.headers['content-encoding'],undefined);assert.deepEqual(result.body,plain);assert.equal(result.headers.vary,'Cookie');}
 const small=await raw(base+'/api/teacher-tools?small=1',{headers:{'Accept-Encoding':'gzip'}});assert.equal(small.headers['content-encoding'],undefined);assert.deepEqual(JSON.parse(small.body),{ok:true});
});

test('Office bytes remain unchanged and JSON errors preserve status under gzip',async t=>{
 const bytes=Buffer.concat([Buffer.from([80,75,3,4]),Buffer.alloc(5000)]),error={code:'SYNTHETIC',details:'read unavailable '.repeat(100)};
 const base=await start(t,{handlers:fixtures((req,res)=>{if(req.query.error)return res.status(503).json(error);res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.send(bytes);})});
 const file=await raw(base+'/api/teacher-tools?tool=export',{headers:{'Accept-Encoding':'gzip'}});assert.equal(file.headers['content-encoding'],undefined);assert.equal(Number(file.headers['content-length']),bytes.length);assert.deepEqual(file.body,bytes);
 const failure=await raw(base+'/api/teacher-tools?error=1',{headers:{'Accept-Encoding':'gzip'}});assert.equal(failure.status,503);assert.equal(failure.headers['content-encoding'],'gzip');assert.deepEqual(JSON.parse(gunzipSync(failure.body)),error);
});

test('late large teacher JSON cannot overwrite a completed timeout or leave gzip headers',async t=>{
 let finish;const settled=new Promise(resolve=>finish=resolve);
 const base=await start(t,{requestTimeoutMs:15,handlers:fixtures((req,res)=>{setTimeout(()=>{try{res.setHeader('Content-Length',100000);res.json({large:'word '.repeat(20000)});finish();}catch(error){finish(error);}},45);})});
 const result=await raw(base+'/api/teacher-analytics',{headers:{'Accept-Encoding':'gzip'}});assert.equal(result.status,504);assert.equal(result.headers['content-encoding'],undefined);assert.deepEqual(JSON.parse(result.body),{error:'Request timed out'});assert.equal(await settled,undefined);
});

test('a slow upload gets its own body budget; the handler deadline starts only once the body has arrived',async t=>{
 // 400 ms trickle against a 150 ms handler deadline: before, upload time counted and this was a 504.
 const lines=[],base=await start(t,{requestTimeoutMs:150,bodyTimeoutMs:2000,log:line=>lines.push(JSON.parse(line)),handlers:fixtures((req,res)=>res.status(200).json({ok:true,size:req.body.audio.length}))});
 const result=await trickle(base+'/api/school-recordings',['{"audio":"','a'.repeat(4000),'b'.repeat(4000),'c'.repeat(4000),'"}'],100);
 assert.equal(result.status,200);assert.deepEqual(JSON.parse(result.body),{ok:true,size:12000});
 await until(()=>lines.length);const [entry]=lines;
 assert.equal(entry.route,'school-recordings');assert.equal(entry.status,200);assert.equal(entry.bodyBytes,12012);
 assert.ok(entry.bodyMs>=300,String(entry.bodyMs));assert.ok(entry.handlerMs<150,String(entry.handlerMs));assert.ok(entry.totalMs>=entry.bodyMs);
});

test('a body slower than its budget gets a JSON 408, is no longer read and never reaches the handler or the 504',async t=>{
 const lines=[],base=await start(t,{requestTimeoutMs:30,bodyTimeoutMs:120,log:line=>lines.push(JSON.parse(line)),handlers:fixtures(()=>assert.fail('An unfinished body reached the handler'))});
 const result=await trickle(base+'/api/school-recordings',['{"audio":"aaaa','b'.repeat(10),'"}'],400);
 assert.equal(result.status,408);assert.deepEqual(JSON.parse(result.body),{ok:false,code:'BODY_TIMEOUT'});
 assert.equal(result.headers.connection,'close');assert.equal(result.headers['content-type'],'application/json; charset=utf-8');assert.equal(result.headers['cache-control'],'no-store');
 await result.closed; // the server hung up instead of waiting for the rest
 await new Promise(resolve=>setTimeout(resolve,80));
 assert.equal((await fetch(base+'/api/health')).status,200);
 await until(()=>lines.length>=2);
 assert.deepEqual(lines[0],{event:'api',route:'school-recordings',method:'POST',status:408,bodyBytes:14,bodyMs:lines[0].bodyMs,handlerMs:null,totalMs:lines[0].totalMs});
 assert.ok(lines[0].bodyMs>=110&&lines[0].bodyMs<400,String(lines[0].bodyMs));assert.equal(lines.length,2);
});

test('upload deadlines end before the browser and the relay give up; other routes keep their old deadline and body window',()=>{
 // The browser's own waits, counted before the relay even reaches Guangzhou: leave each at least 5 s.
 const source=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8'),number=(text,pattern)=>Number(pattern.exec(text)?.[1]);
 const audio=source('maanshan/recording-audio.mjs'),relayMs=number(source('api/_lib/guangzhou-relay.cjs'),/[{,]timeoutMs=(\d+)/);
 const browser={soe:number(audio,/timeout = (\d+)\} = \{\}, messages\)/),'speech-to-text':number(audio,/'\/api\/speech-to-text\/', payload, \{timeout:(\d+)/),
  'school-recordings':number(source('maanshan/recording-library.mjs'),/controller\.abort\(\),(\d+)\)/)};
 assert.deepEqual(browser,{soe:50000,'speech-to-text':40000,'school-recordings':50000});assert.equal(relayMs,55000);
 for(const [name,wait] of Object.entries(browser)){
  assert.ok(routeDeadline(name)<=wait-5000&&routeDeadline(name)<relayMs,name);
  assert.ok(bodyBudget(name)>=30000&&routeDeadline(name)-bodyBudget(name)>=5000,name); // the handler always keeps 5 s
 }
 assert.deepEqual(Object.keys(browser).map(name=>[bodyBudget(name),routeDeadline(name)]),[[40000,45000],[30000,35000],[40000,45000]]);
 for(const name of Object.keys(routes).filter(name=>!Object.hasOwn(browser,name))){
  assert.equal(routeDeadline(name),routes[name].timeoutMs,name);assert.equal(bodyBudget(name),Math.min(30000,routes[name].timeoutMs),name);
 }
 const server=createApiServer({handlers:fixtures(()=>{}),log(){}});
 assert.equal(server.requestTimeout,50000);assert.equal(server.headersTimeout,15000);assert.equal(server.keepAliveTimeout,95000);
 assert.ok(server.requestTimeout>40000&&server.requestTimeout<55000); // the relay gives up at 55 s
});

test('a stalled body on any other route keeps the old 504, so a login keeps its typed password',async t=>{
 const lines=[],base=await start(t,{bodyTimeoutMs:120,log:line=>lines.push(JSON.parse(line)),handlers:fixtures(()=>assert.fail('An unfinished body reached the handler'))});
 const result=await trickle(base+'/api/school-auth',['{"action":"login"','}'],400);
 assert.equal(result.status,504);assert.deepEqual(JSON.parse(result.body),{error:'Request timed out'});assert.equal(result.headers.connection,'close');
 await result.closed;await until(()=>lines.length);
 assert.equal(lines[0].route,'school-auth');assert.equal(lines[0].status,504);assert.equal(lines[0].handlerMs,null);assert.ok(lines[0].bodyMs>=110&&lines[0].bodyMs<400,String(lines[0].bodyMs));
});

test('the handler only gets what the route deadline leaves after a slow upload',async t=>{
 // 300 ms upload, 450 ms deadline, 5 s handler deadline: the 504 comes at 450 ms, not 5.3 s.
 const lines=[],base=await start(t,{requestTimeoutMs:5000,bodyTimeoutMs:2000,deadlineMs:450,log:line=>lines.push(JSON.parse(line)),handlers:fixtures(()=>{})});
 const result=await trickle(base+'/api/soe',['{"audio":"','a'.repeat(100),'b'.repeat(100),'"}'],100);
 assert.equal(result.status,504);assert.deepEqual(JSON.parse(result.body),{error:'Request timed out'});
 await until(()=>lines.length);const [entry]=lines;
 assert.ok(entry.bodyMs>=280,String(entry.bodyMs));assert.ok(entry.totalMs>=440&&entry.totalMs<1500,String(entry.totalMs));
 assert.ok(entry.handlerMs<=entry.totalMs-entry.bodyMs+20,JSON.stringify(entry));
});

test('a slow handler after a complete upload still receives the existing 504',async t=>{
 const lines=[],base=await start(t,{requestTimeoutMs:100,log:line=>lines.push(JSON.parse(line)),handlers:fixtures(()=>{})});
 const response=await post(base,'/api/school-recordings',JSON.stringify({audio:'a'.repeat(1000)}));
 assert.equal(response.status,504);assert.deepEqual(await response.json(),{error:'Request timed out'});assert.equal(response.headers.get('connection'),'close');
 await until(()=>lines.length);assert.equal(lines.length,1);assert.equal(lines[0].status,504);assert.ok(lines[0].handlerMs>=90,String(lines[0].handlerMs));
});

test('the access log writes one PII-free line per API request',async t=>{
 const lines=[],base=await start(t,{requestTimeoutMs:2000,log:line=>lines.push(line),handlers:fixtures((req,res)=>{if(req.query.hang)return;res.setHeader('Set-Cookie','session=PUPIL-SESSION');res.status(201).json({ok:true,login:req.body.login});})});
 const secret={'Cookie':'maanshan_session=PUPIL-COOKIE','X-Forwarded-For':'203.0.113.9','X-Real-IP':'203.0.113.9'},login=JSON.stringify({login:'s1a01',password:'PUPIL-PASSWORD',actorId:'actor-123'});
 assert.equal((await trickle(base+'/api/school-auth?login=s1a01&research=r-77',[login],0,{...secret,'X-School-Relay':'hk:3101'})).status,201);
 assert.equal((await trickle(base+'/api/research-events/',['{"events":[]}'],0,{...secret,'X-School-Relay':'hop-gz:3100'})).status,201);
 // Only the relay's own labels: anything else a direct client sends is dropped, including login-shaped tokens.
 const forged=['hk','gz:2222','hk:3199','gz:3101','HK:3100','hop-hop-hk:3100','hk:3100,hk:3101','hk relay','s1a01','a'.repeat(25)];
 for(const relay of forged)assert.equal((await raw(base+'/api/challenge-result',{headers:{'X-School-Relay':relay}})).status,201,relay);
 assert.equal((await raw(base+'/api/health?login=s1a01')).status,200);
 assert.equal((await raw(base+'/api/secretpupilname?login=s1a01')).status,404);
 const aborted=new AbortController();setTimeout(()=>aborted.abort(),60);
 await assert.rejects(fetch(base+'/api/tts?hang=1',{signal:aborted.signal}));
 await until(()=>lines.length>=forged.length+5);await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(lines.length,forged.length+5);
 const text=lines.join('\n').toLowerCase();
 for(const leak of ['127.0.0.1','203.0.113','pupil','s1a01','r-77','actor-123','login','password','cookie','session','secretpupilname','?'])assert.ok(!text.includes(leak),leak);
 const entries=lines.map(line=>JSON.parse(line));
 for(const entry of entries){
  assert.deepEqual(Object.keys(entry).filter(key=>!['relay','closed'].includes(key)),['event','route','method','status','bodyBytes','bodyMs','handlerMs','totalMs']);
  for(const key of ['bodyBytes','totalMs'])assert.ok(Number.isInteger(entry[key])&&entry[key]>=0,key);
 }
 assert.deepEqual(entries.map(entry=>[entry.event,entry.route,entry.method,entry.status,entry.relay]),[
  ['api','school-auth','POST',201,'hk:3101'],['api','research-events','POST',201,'hop-gz:3100'],
  ...forged.map(()=>['api','challenge-result','GET',201,undefined]),['api','health','GET',200,undefined],['api','unknown','GET',404,undefined],['api','tts','GET',499,undefined]]);
 assert.equal(entries[0].bodyBytes,Buffer.byteLength(login));
 assert.equal(entries.at(-1).closed,true);assert.equal(entries.filter(entry=>entry.closed).length,1);
 assert.equal(entries.at(-3).bodyMs,null);assert.equal(entries.at(-3).handlerMs,null);
});
