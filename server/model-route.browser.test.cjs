'use strict';
// Every 3D model has two routes: the deployed copy on the page's origin and
// the public COS copy. This drives the real download module in a real browser
// against a local server whose routes can hang, refuse, stall half way, send
// garbage or answer slowly, and checks that the page receives one valid model
// whenever either route works, that a healthy route is never duplicated, and
// that the page only sees an error when every route failed.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const engines=require(process.env.PLAYWRIGHT_MODULE||'playwright'),engine=process.env.BROWSER_ENGINE||'chromium';
const repo=path.resolve(__dirname,'..');
const mime={'.mjs':'text/javascript','.js':'text/javascript'};
// A self-contained GLB: header, JSON chunk, no binary chunk. The padding string
// makes it large enough to arrive in several network chunks.
function buildGLB(extraBytes){
 const json=Buffer.from(JSON.stringify({asset:{version:'2.0'},buffers:[],extras:{pad:'x'.repeat(extraBytes)}}));
 const chunk=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]),header=Buffer.alloc(20);
 header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(20+chunk.length,8);header.writeUInt32LE(chunk.length,12);header.writeUInt32LE(0x4e4f534a,16);
 return Buffer.concat([header,chunk]);
}
const model=buildGLB(256*1024);
const held=[],requests=[],closed=[],debug=!!process.env.MODEL_TEST_DEBUG;
function sendModel(res,{delay=0}={}){
 const send=()=>{res.setHeader('Content-Type','model/gltf-binary');res.setHeader('Content-Length',model.length);res.end(model);};
 if(delay)setTimeout(send,delay);else send();
}
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 requests.push(url.pathname);res.on('close',()=>closed.push(url.pathname));
 if(debug)console.error('request',req.method,url.pathname);
 if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><main id="holder"></main>');return;}
 if(url.pathname==='/model/ok.glb'||url.pathname==='/model/ok2.glb')return sendModel(res);
 if(url.pathname==='/model/slow.glb')return sendModel(res,{delay:900});
 if(url.pathname==='/model/hang.glb'||url.pathname==='/model/hang2.glb'){held.push(res);return;}
 if(url.pathname==='/model/missing.glb'){res.writeHead(404).end();return;}
 if(url.pathname==='/model/bad.glb'){res.setHeader('Content-Type','model/gltf-binary');res.end('this is not a model');return;}
 if(url.pathname==='/model/huge.glb'){res.writeHead(200,{'Content-Type':'model/gltf-binary','Content-Length':13*1024*1024});res.flushHeaders();held.push(res);return;}
 if(url.pathname==='/model/half.glb'){
  // Half the bytes arrive, then nothing more: a stalled connection, not an error.
  res.writeHead(200,{'Content-Type':'model/gltf-binary','Content-Length':model.length});res.write(model.subarray(0,model.length>>1));held.push(res);return;
 }
 if(url.pathname==='/model/progress.glb'){
  // Most of the bytes arrive at once and the rest a little later: a slow but
  // working route that must not be duplicated.
  res.writeHead(200,{'Content-Type':'model/gltf-binary','Content-Length':model.length});const cut=Math.floor(model.length*.6);res.write(model.subarray(0,cut));
  setTimeout(()=>res.end(model.subarray(cut)),450);return;
 }
 const file=path.resolve(repo,'.'+decodeURIComponent(url.pathname));
 if(!file.startsWith(repo+path.sep)||!url.pathname.startsWith('/maanshan/')||!mime[path.extname(file)]){res.writeHead(404).end();return;}
 fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)]);res.end(data);});
});
async function run(page,candidates,options={}){
 return page.evaluate(async({candidates,options})=>{
  const mod=await import('/maanshan/model-source.mjs?v=test');
  const started=performance.now(),controller=new AbortController();
  if(options.abortAfter)setTimeout(()=>controller.abort(),options.abortAfter);
  let route=null,url=null;
  const snapshot=()=>({route,url,elapsed:Math.round(performance.now()-started),remembered:sessionStorage.getItem('maanshan:media-route')});
  try{
   const buffer=await mod.fetchModel('media/example/model.glb',{...options,candidates,signal:controller.signal,onRoute:(r,u)=>{route=r;url=u;}});
   return {ok:true,bytes:buffer.byteLength,valid:!!mod.validateGLB(buffer),...snapshot()};
  }catch(error){return {ok:false,error:error.message,name:error.name,...snapshot()};}
 },{candidates,options});
}
const since=mark=>requests.slice(mark);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await engines[engine].launch({...engine==='chromium'?{channel:'msedge',args:['--no-proxy-server']}:{},headless:true}),results={};
 try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  if(debug)page.on('console',message=>console.error('page',message.text()));
  await page.goto(`${origin}/fixture`);

  // Candidate order is a pure decision: session memory wins, then the image probe result.
  results.ordering=await page.evaluate(async()=>{
   const mod=await import('/maanshan/model-source.mjs?v=test');
   const source='media/exploration/ti-xi-lin-bi/model.glb?v=20260914-restored';
   const routes=options=>mod.modelCandidates(source,options).map(c=>c.route);
   return {
    publicFirst:routes({preferPublic:true,memory:null}),localFirst:routes({preferPublic:false,memory:null}),
    memoryWins:routes({preferPublic:false,memory:'public'}),memoryLocal:routes({preferPublic:true,memory:'local'}),
    candidates:mod.modelCandidates(source,{preferPublic:false,memory:null,cache:'no-cache'}),
    unmapped:mod.modelCandidates('media/example/none.glb',{preferPublic:true,memory:null}),
    foreign:mod.modelCandidates('https://other.example/maanshan/media/exploration/ti-xi-lin-bi/model.glb',{preferPublic:true,memory:null}),
    invalid:mod.modelCandidates('http://',{preferPublic:true,memory:null})
   };
  });
  assert.deepEqual(results.ordering.publicFirst,['public','local']);
  assert.deepEqual(results.ordering.localFirst,['local','public']);
  assert.deepEqual(results.ordering.memoryWins,['public','local']);
  assert.deepEqual(results.ordering.memoryLocal,['local','public']);
  assert.deepEqual(results.ordering.candidates[0],{route:'local',url:`${origin}/maanshan/media/exploration/ti-xi-lin-bi/model.glb?v=20260914-restored`,cache:'no-cache'},'the deployed copy keeps its exact URL and cache mode');
  assert.equal(results.ordering.candidates[1].route,'public');
  assert.equal(results.ordering.candidates[1].cache,'default','public objects are content-addressed and immutable');
  assert.match(results.ordering.candidates[1].url,/^https:\/\/[a-z0-9.-]+\.myqcloud\.com\/published\/[0-9a-f]{20}\/maanshan\/media\/exploration\/ti-xi-lin-bi\/model\.glb$/);
  assert.deepEqual(results.ordering.unmapped,[{route:'local',url:`${origin}/maanshan/media/example/none.glb`,cache:'default'}]);
  assert.deepEqual(results.ordering.foreign.map(c=>c.route),['local'],'only this origin\'s models have a public copy');
  assert.deepEqual(results.ordering.invalid,[]);

  // 1. The preferred route never answers: the other copy starts after the hedge window and wins.
  let mark=requests.length;
  results.hang=await run(page,[{route:'public',url:'/model/hang.glb'},{route:'local',url:'/model/ok.glb'}],{hedgeMs:300});
  assert.equal(results.hang.ok,true,'the model arrived');
  assert.equal(results.hang.valid,true);
  assert.equal(results.hang.bytes,model.length);
  assert.equal(results.hang.route,'local','the deployed copy covered the hanging route');
  assert.deepEqual(since(mark),['/model/hang.glb','/model/ok.glb'],'the preferred route was really tried first');
  assert(results.hang.elapsed>=280,'the second route only starts after the hedge window');
  assert.equal(results.hang.remembered,'local','the working route is remembered for the session, shared with animations');
  await pause(300);assert(closed.includes('/model/hang.glb'),'the losing request is cancelled, not left downloading');

  // 2. The preferred route fails outright: the other copy starts at once, well before the hedge window.
  await page.evaluate(()=>sessionStorage.clear());mark=requests.length;
  results.refused=await run(page,[{route:'public',url:'/model/missing.glb'},{route:'local',url:'/model/ok.glb'}],{hedgeMs:5000});
  assert.equal(results.refused.ok,true);assert.equal(results.refused.route,'local');
  assert(results.refused.elapsed<2000,'a refusal does not wait for the hedge window');
  assert.deepEqual(since(mark),['/model/missing.glb','/model/ok.glb']);

  // 3. A healthy preferred route is left alone: the second copy is never requested.
  mark=requests.length;
  results.healthy=await run(page,[{route:'public',url:'/model/ok.glb'},{route:'local',url:'/model/ok2.glb'}],{hedgeMs:300});
  assert.equal(results.healthy.route,'public');await pause(500);
  assert.deepEqual(since(mark),['/model/ok.glb'],'no duplicate download for a working route');
  assert.equal(results.healthy.remembered,'public');

  // 4. A slow route that is already past half way keeps going: no duplicate download either.
  mark=requests.length;
  results.progress=await run(page,[{route:'public',url:'/model/progress.glb'},{route:'local',url:'/model/ok.glb'}],{hedgeMs:300});
  assert.equal(results.progress.ok,true);assert.equal(results.progress.route,'public');
  await pause(400);assert.deepEqual(since(mark),['/model/progress.glb'],'a route past the halfway mark is not hedged');

  // 5. Half the bytes arrive and then nothing: the stalled route is dropped and the other copy wins.
  mark=requests.length;
  results.stalled=await run(page,[{route:'public',url:'/model/half.glb'},{route:'local',url:'/model/ok.glb'}],{hedgeMs:5000,stallMs:300});
  assert.equal(results.stalled.ok,true);assert.equal(results.stalled.route,'local');
  assert.deepEqual(since(mark),['/model/half.glb','/model/ok.glb']);
  assert(results.stalled.elapsed<3000,'a stall is detected long before the hedge window');

  // 5b. The same stall on the last remaining route is tolerated: a weak link can
  // take longer than the stall window before its first byte, and dropping the
  // only route left would guarantee failure. The page's own timeout ends it.
  mark=requests.length;
  results.lastStalled=await run(page,[{route:'public',url:'/model/missing.glb'},{route:'local',url:'/model/half.glb'}],{hedgeMs:5000,stallMs:300,abortAfter:1200});
  assert.equal(results.lastStalled.ok,false);assert.equal(results.lastStalled.name,'AbortError','the last route waited for the caller instead of reporting a stall');
  assert(results.lastStalled.elapsed>=1100,'the last route was kept past several stall windows');
  assert.deepEqual(since(mark),['/model/missing.glb','/model/half.glb']);
  await pause(300);assert(closed.includes('/model/half.glb'),'the caller abort still cancels the request');

  // 6. Garbage or an oversized answer is not a model: the other copy wins without an error.
  for(const [name,url] of [['garbage','/model/bad.glb'],['oversized','/model/huge.glb']]){
   mark=requests.length;
   results[name]=await run(page,[{route:'public',url},{route:'local',url:'/model/slow.glb'}],{hedgeMs:5000});
   assert.equal(results[name].ok,true,name+' is covered');assert.equal(results[name].route,'local');assert.equal(results[name].valid,true);
   assert.deepEqual(since(mark),[url,'/model/slow.glb']);
  }

  // 7. Both routes fail: the page sees one error, describing the first route's failure.
  await page.evaluate(()=>sessionStorage.clear());
  results.bothFail=await run(page,[{route:'public',url:'/model/missing.glb'},{route:'local',url:'/model/bad.glb'}],{hedgeMs:300});
  assert.equal(results.bothFail.ok,false);assert.equal(results.bothFail.error,'model-unavailable');
  assert.equal(results.bothFail.route,null);assert.equal(results.bothFail.remembered,null,'a failure remembers nothing');

  // 8. Leaving the page cancels every attempt at once, as an abort rather than a failure.
  mark=requests.length;
  results.aborted=await run(page,[{route:'public',url:'/model/hang.glb'},{route:'local',url:'/model/hang2.glb'}],{hedgeMs:100,abortAfter:400});
  assert.equal(results.aborted.ok,false);assert.equal(results.aborted.name,'AbortError');
  assert.deepEqual(since(mark),['/model/hang.glb','/model/hang2.glb']);
  await pause(300);assert(closed.includes('/model/hang2.glb'),'the hedged request is cancelled too');

  // 9. No candidates at all is the only way to fail without trying.
  results.none=await run(page,[],{});
  assert.equal(results.none.error,'model-unavailable');

  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,engine,results},null,2));
  await page.close();
 }finally{
  for(const res of held)res.destroy();
  await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
