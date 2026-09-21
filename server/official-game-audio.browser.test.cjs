'use strict';
// Real audio bytes and touch events through the production app; synthetic account only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const http=require('node:http');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),actor='synthetic-official-audio';
const poems=JSON.parse(fs.readFileSync(path.join(repo,'maanshan/poems.json'),'utf8')).poems;
const cssSource=fs.readFileSync(path.join(repo,'scripts/build-maanshan-css.cjs'),'utf8');
const css=[...cssSource.match(/const files = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m=>fs.readFileSync(path.join(repo,'maanshan',m[1]),'utf8')).join('\n');
let origin;const checks=[],errors=[];let browser;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),file=path.resolve(repo,'.'+decodeURIComponent(url.pathname));
 if(!file.startsWith(repo+path.sep)||!file.endsWith('.mp3')||!fs.existsSync(file)){res.writeHead(404).end();return;}
 const audio=fs.readFileSync(file),range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');let start=0,end=audio.length-1;
 res.setHeader('Content-Type','audio/mpeg');res.setHeader('Accept-Ranges','bytes');
 if(range){start=Number(range[1]);end=range[2]?Math.min(end,Number(range[2])):end;res.statusCode=206;res.setHeader('Content-Range','bytes '+start+'-'+end+'/'+audio.length);}
 res.setHeader('Content-Length',end-start+1);res.end(audio.subarray(start,end+1));
});
const check=(name,ok)=>{assert(ok,name);checks.push(name);};
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const {mapAssessment}=await import('../maanshan/core.mjs'),{getWordAudioURL}=await import('../maanshan/word-audio.mjs');
 const stored=Object.fromEntries(poems.map(poem=>[poem.id,{reading:poem.lines.map(line=>mapAssessment({SuggestedScore:85,PronAccuracy:85,Words:[...line.simplified].filter(c=>/\p{Script=Han}/u.test(c)).map(Word=>({Word,PronAccuracy:85}))},line))}]));
 for(const engine of (process.env.AUDIO_TEST_ENGINE?[process.env.AUDIO_TEST_ENGINE]:['chromium','webkit'])){
  browser=engine==='chromium'?await chromium.launch({channel:'msedge',headless:true}):await webkit.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1180,height:720},hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),tts=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(({actor,stored})=>{
   localStorage.setItem('maanshan-learning-v2:'+actor,JSON.stringify(stored));window.mediaEvents=[];
   const nativePlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){const audio=this;return nativePlay.call(this).catch(e=>{mediaEvents.push({type:'rejected',name:e.name,message:e.message,url:audio.src});throw e;});};const NativeAudio=window.Audio;window.Audio=function(...args){const audio=new NativeAudio(...args);for(const type of ['playing','ended','error','pause'])audio.addEventListener(type,()=>mediaEvents.push({type,url:audio.currentSrc||audio.src,time:audio.currentTime,duration:audio.duration}));return audio;};window.Audio.prototype=NativeAudio.prototype;
  },{actor,stored});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url()),endpoint=url.pathname.replace(/\/$/,'');
   if(endpoint.startsWith('/api/')){
    if(endpoint==='/api/tts'){tts.push(route.request().postData());return route.fulfill({status:500,contentType:'application/json',body:'{"error":"No TTS expected"}'});}
    let data={ok:true};if(endpoint==='/api/school-auth')data=url.searchParams.get('action')==='progress'?{enabled:true,userId:actor,poems:{}}:{enabled:true,authenticated:true,user:{id:actor,role:'student',displayName:'測試同學',grade:1,cls:'A',classNo:1,isTest:true,learningScope:'all-grades',researchEnabled:false},csrfToken:'synthetic-csrf'};
    if(endpoint==='/api/school-recordings')data={ok:true,userId:actor,recordings:[]};return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   if(endpoint==='/maanshan/app.bundle.css')return route.fulfill({contentType:'text/css',body:css});
   let relative=url.pathname;if(relative==='/maanshan/')relative+='index.html';if(relative.includes('/published/')&&relative.includes('/maanshan/media/'))relative=relative.slice(relative.indexOf('/maanshan/media/'));
   const file=path.resolve(repo,'.'+decodeURIComponent(relative));if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
   if(path.extname(file)==='.mp3')return route.continue();
   const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.mp3':'audio/mpeg','.glb':'model/gltf-binary'}[path.extname(file)]||'application/octet-stream';return route.fulfill({contentType:mime,body:fs.readFileSync(file)}).catch(()=>{});
  });
  const reset=()=>page.evaluate(()=>mediaEvents.length=0);
  async function playback(button,file,seconds){await reset();await button.click();try{await page.waitForFunction(file=>mediaEvents.some(e=>e.type==='ended'&&e.url.endsWith('/'+file)),file,{timeout:35000});}catch(e){console.error(JSON.stringify({engine,file,events:await page.evaluate(()=>mediaEvents),toast:await page.locator('#toast').innerText(),tts}));throw e;}const ended=await page.evaluate(()=>mediaEvents.filter(e=>e.type==='ended'));check(engine+' '+file+' reaches its recorded end',ended.length===1&&ended[0].time>=seconds&&Math.abs(ended[0].duration-ended[0].time)<.06);}
  try{
   await page.goto(origin+'/maanshan/');await page.locator('.poem-entry').first().waitFor();
   for(const poem of poems){await page.evaluate(slug=>location.hash='#'+slug+'/record',poem.slug);await playback(page.locator('[data-action=line-tts]'),`grade${poem.grade}-line1.mp3`,2);}
   for(const [grade,line,char,pinyin]of [[3,2,'目','mù'],[4,3,'何','hé'],[5,2,'木','mù'],[6,2,'最','zuì']]){
    const poem=poems.find(p=>p.grade===grade);await page.evaluate(slug=>location.hash='#'+slug+'/report',poem.slug);await page.locator('[data-action=score-line][data-value="'+line+'"]').click();const word=page.locator('.report-line:not([hidden]) [data-action=word-tts][data-value="'+char+'"]');await playback(word,path.basename(getWordAudioURL(char,pinyin)),1.2);
   }
   await page.evaluate(()=>location.hash='#bo-chuan-gua-zhou/quiz');await page.locator('[data-river-audio]:not([disabled])').waitFor({timeout:20000});await playback(page.locator('[data-river-audio]'),'grade4-poem.mp3',16);
   await page.evaluate(()=>location.hash='#gui-yuan-tian-ju/quiz');await page.locator('[data-garden-audio]').waitFor();await page.waitForFunction(()=>document.querySelector('.gr-loading').hidden);await playback(page.locator('[data-garden-audio]'),'grade5-verse2.mp3',3);
   check(engine+' garden button disables native scrolling',await page.locator('[data-plant="weed-a"]').evaluate(b=>getComputedStyle(b).touchAction==='none'));
   if(engine==='chromium'){
    const cdp=await context.newCDPSession(page);const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1,radiusX:2,radiusY:2,force:1}]});
    const point=await page.locator('[data-plant="weed-a"]').evaluate(b=>{const r=b.getBoundingClientRect();for(let y=r.top+r.height*.18;y<r.bottom-4;y+=4)for(let x=r.left+r.width*.1;x<r.right-4;x+=4)if(document.elementFromPoint(x,y)?.closest('[data-plant]')===b)return {x,y};throw Error('No weed target');});
    const scroll=await page.evaluate(()=>({page:scrollY,body:document.querySelector('.challenge-body').scrollTop}));await touch('touchStart',point.x,point.y);await touch('touchMove',point.x,point.y-18);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    check('production tablet weed follows the finger',await page.locator('[data-plant="weed-a"]').evaluate(b=>b.classList.contains('is-pulling')&&parseFloat(b.style.getPropertyValue('--lift'))<=-17));
    await touch('touchMove',point.x,point.y-80);await touch('touchEnd');check('production tablet upward swipe removes weed',await page.locator('[data-plant="weed-a"]').getAttribute('aria-hidden')==='true');
    assert.deepEqual(await page.evaluate(()=>({page:scrollY,body:document.querySelector('.challenge-body').scrollTop})),scroll);checks.push('production tablet weed gesture never scrolls the page');
   }
   check(engine+' no synthetic speech requests for poem/game/static characters',tts.length===0);
  }finally{await context.close();await browser.close();browser=null;}
 }
 check('no uncaught browser errors',errors.length===0);console.log(JSON.stringify({ok:true,checks,errors,realAudioFiles:true,paidRequests:0},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
