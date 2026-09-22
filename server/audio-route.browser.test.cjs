'use strict';
// Published recordings have two hosts; the production player must switch to
// the other copy when the first errors or stays silent, and remember the host
// that worked. Real audio bytes from the repository through the real app,
// synthetic account, every API intercepted, nothing leaves the machine.
// WebKit loads media outside Playwright's request routing, so the public host
// is folded into the local server by a URL shim on the media element and both
// engines take the same path.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),actor='synthetic-audio-route';
const poems=JSON.parse(fs.readFileSync(path.join(repo,'maanshan/poems.json'),'utf8')).poems;
const cssSource=fs.readFileSync(path.join(repo,'scripts/build-maanshan-css.cjs'),'utf8');
const css=[...cssSource.match(/const files = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m=>fs.readFileSync(path.join(repo,'maanshan',m[1]),'utf8')).join('\n');
const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.glb':'model/gltf-binary'};
const cosHost='aiducation-mandarin-media-1427410149.cos.ap-guangzhou.myqcloud.com',mirror='/__cos/';
let origin,browser;const checks=[],errors=[];
// The server plays both hosts for recordings: the page's own copy under
// /maanshan/media/ and the public copy under /__cos/<COS path>.
const scene={fail:null,requests:[],hanging:[]};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),publicCopy=url.pathname.startsWith(mirror);
 let relative=url.pathname;if(publicCopy)relative=relative.slice(relative.indexOf('/maanshan/media/'));
 const file=path.resolve(repo,'.'+decodeURIComponent(relative));
 if(!file.startsWith(repo+path.sep)||!file.endsWith('.mp3')||!fs.existsSync(file)){res.writeHead(404).end();return;}
 const host=publicCopy?'public':'local';scene.requests.push({host,path:relative,range:req.headers.range||null});
 if(scene.fail?.host===host){if(scene.fail.how==='404'){res.writeHead(404).end();return;}scene.hanging.push(res);return;}
 const audio=fs.readFileSync(file),range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');let start=0,end=audio.length-1;
 res.setHeader('Content-Type','audio/mpeg');res.setHeader('Accept-Ranges','bytes');
 if(range){start=Number(range[1]);end=range[2]?Math.min(end,Number(range[2])):end;res.statusCode=206;res.setHeader('Content-Range','bytes '+start+'-'+end+'/'+audio.length);}
 res.setHeader('Content-Length',end-start+1);res.end(audio.subarray(start,end+1));
});
const check=(name,ok,detail='')=>{assert(ok,detail?name+' '+detail:name);checks.push(name);};
// Each scenario: which host fails and how, and which host must end up playing.
const scenarios=[
 {name:'public copy errors',memory:null,fail:{host:'public',how:'404'},expect:'local',remember:'local'},
 {name:'deployed copy errors',memory:'local',fail:{host:'local',how:'404'},expect:'public',remember:'public'},
 {name:'public copy stays silent',memory:'public',fail:{host:'public',how:'hang'},expect:'local',remember:'local'}
];
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const {mapAssessment}=await import('../maanshan/core.mjs');
 const stored=Object.fromEntries(poems.map(poem=>[poem.id,{reading:poem.lines.map(line=>mapAssessment({SuggestedScore:85,PronAccuracy:85,Words:[...line.simplified].filter(c=>/\p{Script=Han}/u.test(c)).map(Word=>({Word,PronAccuracy:85}))},line))}]));
 const poem=poems.find(p=>p.grade===1);
 for(const engine of (process.env.AUDIO_TEST_ENGINE?[process.env.AUDIO_TEST_ENGINE]:['chromium','webkit'])){
  browser=engine==='chromium'?await chromium.launch({channel:'msedge',headless:true}):await webkit.launch({headless:true});
  for(const scenario of scenarios){
   scene.fail=scenario.fail;scene.requests=[];scene.hanging=[];
   const context=await browser.newContext({viewport:{width:1180,height:720},serviceWorkers:'block'}),page=await context.newPage();
   page.on('pageerror',e=>errors.push(engine+' '+scenario.name+': '+e.message));
   await context.addInitScript(({actor,stored,memory,cosHost,mirror})=>{
    localStorage.setItem('maanshan-learning-v2:'+actor,JSON.stringify(stored));window.mediaEvents=[];window.audioElements=0;
    if(memory)sessionStorage.setItem('maanshan:media-route',memory);
    // The public host lives on the local server for this test; the app still chooses between the two URLs itself.
    const publicPrefix='https://'+cosHost+'/';
    const fold=value=>typeof value==='string'&&value.startsWith(publicPrefix)?location.origin+mirror+value.slice(publicPrefix.length):value;
    const src=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');
    Object.defineProperty(HTMLMediaElement.prototype,'src',{configurable:true,get(){return src.get.call(this);},set(value){src.set.call(this,fold(value));}});
    const NativeAudio=window.Audio;
    window.Audio=function(...args){const audio=new NativeAudio();if(args.length)audio.src=args[0];if(String(args[0]||'').includes('.mp3'))window.audioElements++;for(const type of ['playing','ended','error'])audio.addEventListener(type,()=>mediaEvents.push({type,url:audio.currentSrc||audio.src}));return audio;};
    window.Audio.prototype=NativeAudio.prototype;
   },{actor,stored,memory:scenario.memory,cosHost,mirror});
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url()),endpoint=url.pathname.replace(/\/$/,'');
    if(endpoint.startsWith('/api/')){
     let data={ok:true};
     if(endpoint==='/api/school-auth')data=url.searchParams.get('action')==='progress'?{enabled:true,userId:actor,poems:{}}:{enabled:true,authenticated:true,user:{id:actor,role:'student',displayName:'測試同學',grade:1,cls:'A',classNo:1,isTest:true,learningScope:'all-grades',researchEnabled:false},csrfToken:'synthetic-csrf'};
     if(endpoint==='/api/school-recordings')data={ok:true,userId:actor,recordings:[]};
     if(endpoint==='/api/tts')return route.fulfill({status:500,contentType:'application/json',body:'{"error":"No TTS expected"}'});
     return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    }
    if(endpoint==='/maanshan/app.bundle.css')return route.fulfill({contentType:'text/css',body:css});
    // Recordings reach the local server on both hosts; nothing may reach the real public host.
    if(url.pathname.endsWith('.mp3'))return url.origin===origin?route.continue():route.fulfill({status:404,body:''});
    let relative=url.pathname;if(relative==='/maanshan/')relative+='index.html';
    if(url.hostname===cosHost&&relative.includes('/maanshan/'))relative=relative.slice(relative.indexOf('/maanshan/'));
    const file=path.resolve(repo,'.'+decodeURIComponent(relative));if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
    return route.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
   });
   try{
    await page.goto(origin+'/maanshan/');await page.locator('.poem-entry').first().waitFor();
    await page.evaluate(slug=>location.hash='#'+slug+'/record',poem.slug);
    const button=page.locator('[data-action=line-tts]');await button.waitFor();
    if(!scenario.memory)await page.waitForFunction(()=>sessionStorage.getItem('maanshan:public-images')==='1');
    const started=Date.now();await button.click();
    await page.waitForFunction(()=>mediaEvents.some(e=>e.type==='ended'),null,{timeout:40000}).catch(async error=>{throw new Error(`${engine} ${scenario.name}: ${error.message} ${JSON.stringify({events:await page.evaluate(()=>mediaEvents),requests:scene.requests,player:await page.evaluate(()=>{const a=document.querySelector('audio');return a?{src:a.src,readyState:a.readyState,error:a.error?.code,network:a.networkState}:null;})})}`);});
    const events=await page.evaluate(()=>mediaEvents),elements=await page.evaluate(()=>audioElements),memory=await page.evaluate(()=>sessionStorage.getItem('maanshan:media-route'));
    const requests=scene.requests,ended=events.find(e=>e.type==='ended'),file=`grade${poem.grade}-line1.mp3`,detail=JSON.stringify({events,requests,memory});
    const playedHost=ended.url.includes(mirror)?'public':'local';
    check(`${engine} ${scenario.name}: the recording plays to the end from the ${scenario.expect} copy`,ended.url.endsWith('/'+file)&&playedHost===scenario.expect,detail);
    check(`${engine} ${scenario.name}: the failing host was tried first`,requests[0]?.host===scenario.fail.host&&requests.some(r=>r.host===scenario.expect),detail);
    check(`${engine} ${scenario.name}: one player, no second tap needed`,elements===1,detail);
    check(`${engine} ${scenario.name}: the working host is remembered for the session`,memory===scenario.remember,detail);
    const elapsed=Date.now()-started;
    if(scenario.fail.how==='hang')check(`${engine} ${scenario.name}: silence gives up after the short watchdog (${elapsed} ms)`,elapsed>7000&&elapsed<25000);
    else check(`${engine} ${scenario.name}: an error switches at once (${elapsed} ms)`,elapsed<12000);
   }finally{for(const res of scene.hanging)res.destroy();scene.hanging=[];await context.close();}
  }
  await browser.close();browser=null;
 }
 check('no uncaught browser errors',errors.length===0);console.log(JSON.stringify({ok:true,checks,errors,realAudioFiles:true,paidRequests:0},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
