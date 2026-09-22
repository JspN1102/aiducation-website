'use strict';
// The poem animation has two routes: the deployed copy on the page's origin
// and the public COS copy. This drives the real module in a real browser
// against a local server that can hang, refuse or serve a two-second clip, and
// checks that pupils get a playing video whenever either route works and only
// see the page-level failure message when both are broken.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const engines=require(process.env.PLAYWRIGHT_MODULE||'playwright'),engine=process.env.BROWSER_ENGINE||'chromium';
const repo=path.resolve(__dirname,'..'),clip=fs.readFileSync(path.join(__dirname,'fixtures/tiny-animation.mp4'));
const mime={'.mjs':'text/javascript','.js':'text/javascript'};
const held=[],requests=[],debug=!!process.env.ANIMATION_TEST_DEBUG;let repaired=false;
function serveClip(req,res){
 const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range||'');
 res.setHeader('Content-Type','video/mp4');res.setHeader('Accept-Ranges','bytes');
 if(range){
  const start=range[1]?Number(range[1]):Math.max(0,clip.length-Number(range[2])),end=range[1]&&range[2]?Math.min(Number(range[2]),clip.length-1):clip.length-1;
  res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${clip.length}`,'Content-Length':end-start+1});res.end(clip.subarray(start,end+1));return;
 }
 res.setHeader('Content-Length',clip.length);res.end(clip);
}
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 requests.push(url.pathname);if(debug)console.error('request',req.method,url.pathname,req.headers.range||'');
 if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><main id="holder"></main>');return;}
 if(url.pathname==='/clip/ok.mp4')return serveClip(req,res);
 if(url.pathname==='/clip/hang.mp4'){held.push(res);return;}
 if(url.pathname==='/clip/missing.mp4'){if(repaired)return serveClip(req,res);res.writeHead(404).end();return;}
 if(url.pathname==='/clip/broken.mp4'){res.writeHead(404).end();return;}
 const file=path.resolve(repo,'.'+decodeURIComponent(url.pathname));
 if(!file.startsWith(repo+path.sep)||!url.pathname.startsWith('/maanshan/')||!mime[path.extname(file)]){res.writeHead(404).end();return;}
 fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)]);res.end(data);});
});
const STALL_MS=400;
async function mount(page,candidates){
 return page.evaluate(async({candidates,stallMs,debug})=>{
  const mod=await import('/maanshan/animation-source.mjs?v=test');
  const player=document.createElement('video');player.muted=true;player.playsInline=true;player.preload='metadata';document.querySelector('#holder').replaceChildren(player);
  const state={appErrors:0,playing:0,player,route:null};
  if(debug)for(const name of ['loadstart','loadedmetadata','canplay','play','playing','waiting','pause','ended','error','emptied','abort','stalled'])player.addEventListener(name,()=>console.log('event',name,'readyState',player.readyState,'paused',player.paused,'error',player.error?.code||0,'src',player.currentSrc));
  // Registered first, exactly as renderAnimation does, so handled errors stop here.
  state.route=mod.manageAnimationSource(player,'media/example/animation.mp4',{stallMs,candidates});
  player.addEventListener('error',()=>{state.appErrors++;});
  player.addEventListener('playing',()=>{state.playing++;});
  window.animationTest=state;
  player.play().catch(()=>{});
  return state.route.current;
 },{candidates,stallMs:STALL_MS,debug});
}
const settle=page=>page.waitForFunction(()=>animationTest.playing>0||animationTest.appErrors>0,null,{timeout:8000});
const snapshot=page=>page.evaluate(()=>({current:animationTest.route.current,route:animationTest.route.route,appErrors:animationTest.appErrors,playing:animationTest.playing,mediaError:animationTest.player.error?.code||0,paused:animationTest.player.paused,remembered:sessionStorage.getItem('maanshan:animation-route')}));
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await engines[engine].launch({...engine==='chromium'?{channel:'msedge'}:{},headless:true}),results={};
 try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  if(debug)page.on('console',message=>console.error('page',message.text()));
  await page.goto(`${origin}/fixture`);

  // Candidate order is a pure decision: session memory wins, then the image probe result.
  results.ordering=await page.evaluate(async()=>{
   const mod=await import('/maanshan/animation-source.mjs?v=test');
   const source='media/yong-e/animation-20260918c.mp4';
   return {
    publicFirst:mod.animationCandidates(source,{preferPublic:true,memory:null}).map(c=>c.route),
    localFirst:mod.animationCandidates(source,{preferPublic:false,memory:null}).map(c=>c.route),
    memoryWins:mod.animationCandidates(source,{preferPublic:false,memory:'public'}).map(c=>c.route),
    memoryLocal:mod.animationCandidates(source,{preferPublic:true,memory:'local'}).map(c=>c.route),
    urls:mod.animationCandidates(source,{preferPublic:false,memory:null}).map(c=>c.url),
    unmapped:mod.animationCandidates('media/example/none.mp4',{preferPublic:true,memory:null})
   };
  });
  assert.deepEqual(results.ordering.publicFirst,['public','local']);
  assert.deepEqual(results.ordering.localFirst,['local','public']);
  assert.deepEqual(results.ordering.memoryWins,['public','local']);
  assert.deepEqual(results.ordering.memoryLocal,['local','public']);
  assert.equal(results.ordering.urls[0],'media/yong-e/animation-20260918c.mp4');
  assert.match(results.ordering.urls[1],/^https:\/\/[a-z0-9.-]+\.myqcloud\.com\/maanshan\/media\/yong-e\/animation-20260918c\.mp4$/);
  assert.deepEqual(results.ordering.unmapped,[{route:'local',url:'media/example/none.mp4'}]);

  // 1. The preferred route never answers: playback moves to the other copy after the stall window.
  assert.equal(await mount(page,[{route:'public',url:'/clip/hang.mp4'},{route:'local',url:'/clip/ok.mp4'}]),'/clip/hang.mp4');
  await settle(page);
  results.hang=await snapshot(page);
  assert.equal(results.hang.current,'/clip/ok.mp4','stalled route switched to the deployed copy');
  assert.equal(results.hang.appErrors,0,'a stall is not reported as a failure');
  assert(results.hang.playing>0,'the second route plays');
  assert.equal(results.hang.remembered,'local','the working route is remembered for the session');
  assert(requests.includes('/clip/hang.mp4'),'the preferred route was really tried first');

  // 2. The preferred route fails outright: immediate switch, and the page-level error listener never fires.
  await page.evaluate(()=>sessionStorage.clear());
  await mount(page,[{route:'public',url:'/clip/broken.mp4'},{route:'local',url:'/clip/ok.mp4'}]);
  await settle(page);
  results.refused=await snapshot(page);
  assert.equal(results.refused.current,'/clip/ok.mp4');
  assert.equal(results.refused.appErrors,0,'a recoverable error is swallowed before the page sees it');
  assert(results.refused.playing>0);

  // 3. A healthy route is left alone: no switch once playback has started, even after the stall window.
  await page.evaluate(wait=>new Promise(resolve=>setTimeout(resolve,wait)),STALL_MS*3);
  const steady=await snapshot(page);
  assert.equal(steady.current,'/clip/ok.mp4','playing video is never switched away');

  // 4. Both routes fail: the error reaches the page exactly once, and retry starts again from the first route.
  await mount(page,[{route:'public',url:'/clip/missing.mp4'},{route:'local',url:'/clip/broken.mp4'}]);
  await settle(page);
  results.bothFail=await snapshot(page);
  assert.equal(results.bothFail.appErrors,1,'the page is told once, after the last route');
  assert.equal(results.bothFail.current,'/clip/broken.mp4');
  assert.equal(results.bothFail.playing,0);
  assert(results.bothFail.mediaError>0,'the player keeps its error state for the retry button');
  repaired=true;
  await page.evaluate(()=>{animationTest.route.retry();animationTest.player.play().catch(()=>{});});
  await page.waitForFunction(()=>animationTest.playing>0,null,{timeout:8000});
  results.retry=await snapshot(page);
  assert.equal(results.retry.current,'/clip/missing.mp4','retry goes back to the first route');
  assert.equal(results.retry.appErrors,1);

  // 5. dispose() detaches the fallback: a later failure propagates to the page as before.
  await mount(page,[{route:'public',url:'/clip/broken.mp4'},{route:'local',url:'/clip/ok.mp4'}]);
  await settle(page);
  await page.evaluate(()=>{animationTest.route.dispose();animationTest.player.src='/clip/broken.mp4';animationTest.player.load();});
  await page.waitForFunction(()=>animationTest.appErrors>0,null,{timeout:8000});
  results.disposed=await snapshot(page);
  assert.equal(results.disposed.current,'/clip/ok.mp4','a disposed route no longer moves the player');

  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,engine,results},null,2));
  await page.close();
 }finally{
  for(const res of held)res.destroy();
  await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
