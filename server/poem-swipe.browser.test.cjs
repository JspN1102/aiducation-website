// Real browser pointer/touch coverage with local artwork and synthetic accounts only.
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),origin='https://poem-swipe-audit.invalid';
const poems=JSON.parse(fs.readFileSync(path.join(repo,'maanshan/poems.json'),'utf8')).poems;
const key='maanshan-learning-v2:synthetic-swipe-student',results=[],errors=[];
const evidence=process.env.POEM_SWIPE_EVIDENCE_DIR;
const fixture=`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;min-height:1900px;padding-top:100px;background:#fff}#holder{position:relative;width:90%;max-width:720px;aspect-ratio:16/9;margin:auto;overflow:hidden}#holder .scene-stage{height:100%}#index{text-align:center}</style><div id="holder"></div><p id="index"></p><script type="module">
import {mountStage} from './scene-stage.mjs';import {mountPoemSwipe} from './poem-swipe.mjs';
const poem=(await(await fetch('./poems.json')).json()).poems[0],holder=document.querySelector('#holder');
window.index=0;window.steps=[];window.locked=false;
const stage=window.stage=mountStage(holder,{poemSlug:poem.slug,scene:1});
const adjacent=i=>poem.lines[i]?{scene:poem.lines[i].scene,alt:poem.lines[i].text}:null;
window.swipe=mountPoemSwipe(holder,{stage,isLocked:()=>window.locked,getAdjacent:()=>({previous:adjacent(window.index-1),next:adjacent(window.index+1)}),onStep:step=>{window.index=Math.max(0,Math.min(3,window.index+step));window.steps.push(step);document.querySelector('#index').textContent=window.index;stage.show(poem.lines[window.index].scene,poem.lines[window.index].text,{previewImmediately:true});}});
window.clear=()=>{window.swipe.destroy();stage.destroy();holder.remove();};window.ready=true;</script></html>`;
let browser;
function check(label,value){assert(value,label);results.push({label,passed:true});}
async function setup({width=390,height=844,touch=true,slow=false,app=false}={}){
 const context=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch,serviceWorkers:'block'}),page=await context.newPage();
 const state={requests:[],scores:[],blocked:slow,releases:[]};page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(({key,poems})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(Object.fromEntries(poems.map(p=>[p.id,{reading:[],writing:[],chat:[],quiz:[],readingVersion:p.readingVersion,pronunciationVersion:p.pronunciationVersion}]))));},{key,poems});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url()),endpoint=url.pathname.replace(/\/$/,'');
  const send=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  if(url.pathname==='/maanshan/swipe-fixture')return route.fulfill({contentType:'text/html',body:fixture});
  if(endpoint.startsWith('/api/')){
   state.requests.push(endpoint);
   if(endpoint==='/api/school-auth'){
    if(url.searchParams.get('action')==='progress')return send({enabled:true,userId:'synthetic-swipe-student',poems:{}});
    return send({enabled:true,authenticated:true,user:{id:'synthetic-swipe-student',role:'student',displayName:'示範同學',grade:1,cls:'A',classNo:1,isTest:true,learningScope:'all-grades',researchEnabled:false},csrfToken:'synthetic-csrf'});
   }
   if(endpoint==='/api/soe'){
    const body=route.request().postDataJSON();state.scores.push({poemId:body.poemId,refText:body.refText});
    return send({PronAccuracy:93,PronFluency:.95,PronCompletion:1,SuggestedScore:93,Words:[...body.refText].filter(c=>/\p{Script=Han}/u.test(c)).map(Word=>({Word,PronAccuracy:93,PhoneInfos:[]}))});
   }
   if(endpoint==='/api/maanshan-save')return send({ok:true,stored:'synthetic'});
   return route.fulfill({status:500,body:'Unexpected API blocked'});
  }
  let relative=url.pathname;if(relative==='/maanshan/')relative+='index.html';
  if(relative.includes('/published/')&&relative.includes('/maanshan/media/'))relative=relative.slice(relative.indexOf('/maanshan/media/'));
  const file=path.resolve(repo,'.'+decodeURIComponent(relative));
  if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
  if(state.blocked&&route.request().resourceType()==='image')await new Promise(resolve=>state.releases.push(resolve));
  const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';
  await route.fulfill({contentType:mime,body:fs.readFileSync(file)}).catch(()=>{});
 });
 await page.goto(origin+'/maanshan/'+(app?'':'swipe-fixture'),{waitUntil:'domcontentloaded'});
 if(app)await page.locator('.poem-entry').first().waitFor();else await page.waitForFunction(()=>window.ready);
 const cdp=touch?await context.newCDPSession(page):null;
 async function pointer(selector){const box=await page.locator(selector).boundingBox();assert(box);const start={x:box.x+box.width*.55,y:box.y+box.height*.5};let x=start.x,y=start.y;
  const dispatch=async(type,points)=>{await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));};
  return {width:box.width,start:async()=>{if(touch)await dispatch('touchStart',[{x,y,id:1}]);else{await page.mouse.move(x,y);await page.mouse.down();}},
   move:async(dx,dy=0)=>{x=start.x+dx;y=start.y+dy;if(touch)await dispatch('touchMove',[{x,y,id:1}]);else await page.mouse.move(x,y);},
   end:async()=>{if(touch)await dispatch('touchEnd',[]);else await page.mouse.up();},
   cancel:async()=>{if(touch)await dispatch('touchCancel',[]);else{await page.locator(selector).dispatchEvent('pointercancel',{pointerId:1,clientX:x,clientY:y});await page.mouse.up();}}
  };
 }
 async function swipe(selector,delta){const p=await pointer(selector);await p.start();await p.move(delta*p.width);await p.end();await page.waitForTimeout(260);}
 const release=()=>{state.blocked=false;state.releases.splice(0).forEach(resolve=>resolve());};
 return {context,page,state,pointer,swipe,release,close:async()=>{release();await context.close();}};
}
async function fixtureChecks(){
 const env=await setup(),{page,pointer,swipe}=env;try{
  let p=await pointer('#holder');await p.start();await p.move(-12);
  const middle=await page.locator('#holder').evaluate(holder=>{const h=holder.getBoundingClientRect(),current=holder.querySelector('.scene-stage-painting').getBoundingClientRect(),next=holder.querySelector('[data-side=next]')?.getBoundingClientRect();return {dx:current.left-h.left,nextVisible:next?Math.min(h.right,next.right)-Math.max(h.left,next.left):0,index:window.index};});
  check('12px real touch immediately exposes the neighbouring painting',Math.abs(middle.dx+12)<1&&middle.nextVisible>10&&middle.index===0);
  await page.waitForTimeout(160);await p.end();await page.waitForTimeout(260);check('short drag snaps back without changing verse',await page.evaluate(()=>window.index===0&&window.steps.length===0&&document.querySelectorAll('.scene-stage-neighbor').length===0));
  p=await pointer('#holder');await p.start();await p.move(-p.width*.4);
  if(evidence){fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'touch-mid-swipe.png')});}
  check('long drag keeps selected verse until release',await page.evaluate(()=>window.index===0));await p.end();await page.waitForTimeout(260);
  check('release commits exactly one adjacent verse and cleans temporary panels',await page.evaluate(()=>window.index===1&&window.steps.length===1&&window.stage.getState().scene===2&&document.querySelectorAll('.scene-stage-neighbor').length===0));
  p=await pointer('#holder');await p.start();await p.move(-p.width*.4);await p.cancel();await page.waitForTimeout(260);check('pointer cancellation returns to the original verse',await page.evaluate(()=>window.index===1&&window.stage.getState().scene===2));
  await swipe('#holder',.4);await swipe('#holder',.4);check('first verse edge never wraps or steps out of range',await page.evaluate(()=>window.index===0&&window.stage.getState().scene===1));
  await swipe('#holder',-.4);await swipe('#holder',-.4);await swipe('#holder',-.4);await swipe('#holder',-.4);check('last verse edge never wraps or steps out of range',await page.evaluate(()=>window.index===3&&window.stage.getState().scene===4));
  await page.waitForTimeout(450);await page.locator('#holder').tap();check('a tap on the painting does not navigate',await page.evaluate(()=>window.index===3&&document.querySelectorAll('.scene-stage-neighbor').length===0));
  await page.evaluate(()=>{const button=document.createElement('button');button.id='retry-test';button.textContent='重試';button.style.cssText='position:absolute;z-index:5;left:0;top:0;width:80px;height:48px';window.retryClicks=0;button.addEventListener('click',()=>window.retryClicks++);document.querySelector('#holder').append(button);});
  await page.locator('#retry-test').tap();check('interactive controls remain clickable without navigating',await page.evaluate(()=>window.retryClicks===1&&window.index===3));await page.locator('#retry-test').evaluate(el=>el.remove());
  await page.evaluate(()=>window.locked=true);await swipe('#holder',.4);check('recording lock blocks page movement',await page.evaluate(()=>window.index===3&&document.querySelectorAll('.scene-stage-neighbor').length===0));await page.evaluate(()=>window.locked=false);
  p=await pointer('#holder');await p.start();await p.move(1,-35);await p.move(2,-110);await p.end();await page.waitForTimeout(200);
  check('vertical touch scroll remains native',await page.evaluate(()=>scrollY>25&&window.index===3));await page.evaluate(()=>scrollTo(0,0));
  p=await pointer('#holder');await p.start();await p.move(p.width*.4);await p.end();await page.evaluate(()=>window.swipe.cancel());await page.waitForTimeout(260);
  check('external rerender cancels an in-flight snap',await page.evaluate(()=>window.index===3&&window.stage.getState().scene===4));
  p=await pointer('#holder');await p.start();await p.move(p.width*.4);await page.evaluate(()=>window.clear());await p.end();await page.waitForTimeout(260);
  check('page cleanup during dragging prevents delayed navigation',await page.evaluate(()=>window.index===3&&!document.querySelector('.scene-stage')));
 }finally{await env.close();}
}
async function loadingChecks(){const env=await setup({slow:true}),{page,swipe}=env;try{
 await swipe('#holder',-.4);check('pending full artwork still commits a usable embedded preview',await page.evaluate(()=>window.index===1&&window.stage.getState().scene===2&&document.querySelector('.scene-stage-layer img')?.naturalWidth>0));
 await swipe('#holder',-.4);env.release();await page.waitForFunction(()=>window.stage.getState().status==='ready'&&window.stage.getState().quality==='full');
 check('late old images cannot replace the newer selected verse',await page.evaluate(()=>window.index===2&&window.stage.getState().scene===3&&[...document.querySelectorAll('.scene-stage-layer')].every(el=>el.dataset.scene==='3')));
 }finally{await env.close();}}
async function realAppChecks(width,height,touch){const env=await setup({width,height,touch,app:true}),{page,pointer,swipe,state,context}=env;try{
 for(const poem of poems){
  await page.evaluate(slug=>location.hash='#'+slug+'/record',poem.slug);await page.locator('#record-art').waitFor();await page.waitForFunction(()=>document.querySelector('.record-progress i.current')===document.querySelector('.record-progress i'));
  const p=await pointer('#record-art');await p.start();await p.move(-p.width*.35);
  check(width+'px '+poem.slug+' shows both paintings during drag',await page.locator('#record-art').evaluate(holder=>{const h=holder.getBoundingClientRect(),a=holder.querySelector('.scene-stage-painting').getBoundingClientRect(),b=holder.querySelector('[data-side=next]')?.getBoundingClientRect();return b&&a.right>h.left+20&&b.left<h.right-20&&document.documentElement.scrollWidth<=innerWidth+1;}));
  if(evidence&&width===390&&poem.id===3){
    fs.writeFileSync(path.join(evidence,'actual-app-neighbor.json'),JSON.stringify(await page.locator('#record-art').evaluate(el=>[el,...el.querySelectorAll('*')].map(node=>{const s=getComputedStyle(node),r=node.getBoundingClientRect();return{class:node.className,scene:node.dataset.scene,side:node.dataset.side,src:node instanceof HTMLImageElement?node.src.slice(0,120):undefined,natural:node instanceof HTMLImageElement?[node.naturalWidth,node.naturalHeight,node.complete]:undefined,rect:{x:r.x,y:r.y,width:r.width,height:r.height},style:node.getAttribute('style'),computed:{opacity:s.opacity,visibility:s.visibility,display:s.display,overflow:s.overflow,objectFit:s.objectFit,zIndex:s.zIndex,contentVisibility:s.contentVisibility}};})),null,2));
    await page.screenshot({path:path.join(evidence,'reading-phone-mid-swipe.png')});
  }
  await p.end();await page.waitForFunction(()=>[...document.querySelectorAll('.record-progress i')].findIndex(el=>el.classList.contains('current'))===1);
  check(width+'px '+poem.slug+' sentence and artwork indices match',await page.locator('#record-art .scene-stage').getAttribute('data-scene')===String(poem.lines[1].scene)&& (await page.locator('#record-tool .record-counter').innerText()).includes('第 2 /'));
  await swipe('#record-art',.35);check(width+'px '+poem.slug+' backward swipe preserves the first verse',await page.locator('#record-art .scene-stage').getAttribute('data-scene')===String(poem.lines[0].scene));
 }
 check(width+'px browsing never creates reading scores',await page.evaluate(key=>Object.values(JSON.parse(localStorage.getItem(key))).every(s=>!(s.reading||[]).some(Boolean)),key));
 if(width===390){
  const poem=poems[1],pending=await pointer('#record-art');await pending.start();await pending.move(-pending.width*.35);await pending.end();
  await page.evaluate(slug=>location.hash='#'+slug+'/record',poem.slug);await page.locator('#record-art').waitFor();await page.waitForTimeout(280);
  check('switching poems during a snap cannot advance the new poem',await page.evaluate(()=>[...document.querySelectorAll('.record-progress i')].findIndex(el=>el.classList.contains('current'))===0&&document.querySelector('#record-art .scene-stage').dataset.scene==='1'));
  await swipe('#record-art',-.35);
  await context.grantPermissions(['microphone'],{origin});await page.locator('[data-action=record-start]').click();await page.locator('[data-action=record-stop]').waitFor();await swipe('#record-art',-.35);
  check('microphone recording pins the selected verse despite touch gestures',await page.locator('#record-art .scene-stage').getAttribute('data-scene')==='2');
  await page.waitForTimeout(1000);await page.locator('[data-action=record-stop]').click();await page.locator('.record-result').waitFor({timeout:15000});
  check('after a swipe the real recorder submits only the selected sentence',state.scores.length===1&&state.scores[0].poemId===poem.id&&state.scores[0].refText===poem.lines[1].simplified);
  check('assessment attaches only to the selected verse index',await page.evaluate(({key,id})=>{const r=JSON.parse(localStorage.getItem(key))[id].reading;return !r[0]&&r[1]?.total_score===93&&!r[2]&&!r[3];},{key,id:poem.id}));
 }
 check(width+'px no unexpected provider or research request',state.requests.every(url=>['/api/school-auth','/api/soe','/api/maanshan-save'].includes(url)));
 }finally{await env.close();}}
(async()=>{browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 await fixtureChecks();await loadingChecks();for(const dimensions of [[390,844,true],[768,1024,true],[1440,1000,false]])await realAppChecks(...dimensions);check('no browser exceptions',errors.length===0);
})().catch(error=>{results.push({label:'suite',passed:false,error:error.stack});process.exitCode=1;}).finally(async()=>{await browser?.close();const output={ok:results.every(r=>r.passed),syntheticOnly:true,noProductionRequests:true,checks:results,errors};if(evidence){fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'swipe-browser-results.json'),JSON.stringify(output,null,2));}console.log(JSON.stringify(output,null,2));});
