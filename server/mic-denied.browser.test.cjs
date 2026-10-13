// A refused microphone must leave this browser's one step to allow it on the
// reading page (not a passing toast) until a retry, another line or page.
// getUserMedia is stubbed to refuse; synthetic pupil and local routes only, no production requests.
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {validateEvent}=require('../api/_lib/research-store.cjs');
const repo=path.resolve(__dirname,'..'),origin='https://mic-denied.invalid',actor='s_'+'7'.repeat(24),results=[],errors=[];
const DESKTOP='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0';
// iPadOS Safari asks for desktop pages: a Mac user agent, told apart only by its touch points. iPadOS 18+ keeps Safari under 「App」.
const IPAD='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DESKTOP_HELP='按網址列左邊的圖示 ›「麥克風」選「允許」，再按「重新載入」。',SAFARI_HELP='到「設定」›「Safari」›「麥克風」選「允許」，再按「重新載入」。',IPAD_HELP='到「設定」›「App」›「Safari」›「麥克風」選「允許」，再按「重新載入」。';
let browser;
function check(label,value){assert(value,label);results.push({label,passed:true});}
async function until(test,label,timeout=15000){const end=Date.now()+timeout;while(!(await test())){if(Date.now()>end)throw new Error('Timed out: '+label);await new Promise(resolve=>setTimeout(resolve,50));}}
async function setup({userAgent,viewport={width:1280,height:900},touchPoints=0}){
 const context=await browser.newContext({viewport,userAgent,serviceWorkers:'block'});
 await context.grantPermissions(['microphone'],{origin});
 const state={soe:[],held:[],soeFail:0,saves:[],events:new Map(),unexpected:[]};
 // window.__mic.deny refusals (each after hold ms), then the fake device as usual.
 await context.addInitScript(points=>{
  if(points)Object.defineProperty(Navigator.prototype,'maxTouchPoints',{configurable:true,get:()=>points});
  window.__mic={deny:0,hold:0,calls:0};const devices=navigator.mediaDevices,original=devices.getUserMedia.bind(devices);
  devices.getUserMedia=async constraints=>{
   window.__mic.calls++;if(window.__mic.hold)await new Promise(resolve=>setTimeout(resolve,window.__mic.hold));
   if(window.__mic.deny>0){window.__mic.deny--;throw new DOMException('Permission denied','NotAllowedError');}
   return original(constraints);
  };
 },touchPoints);
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),endpoint=url.pathname.replace(/\/$/,''),method=request.method();
  const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});
  if(endpoint.startsWith('/api/')){
   if(endpoint==='/api/school-auth'){
    if(url.searchParams.get('action')==='progress')return send({enabled:true,userId:actor,poems:{}});
    return send({enabled:true,authenticated:true,user:{id:actor,role:'student',displayName:'示範同學',grade:1,cls:'A',classNo:1,isTest:true,learningScope:'all-grades',researchEnabled:true},csrfToken:'synthetic-csrf'});
   }
   if(endpoint==='/api/soe'){
    const body=request.postDataJSON();state.soe.push({poemId:body.poemId});
    if(state.soeFail>0){state.soeFail--;return send({error:'busy'},503);}
    await new Promise(resolve=>state.held.push(resolve));
    return send({PronAccuracy:93,PronFluency:.95,PronCompletion:1,SuggestedScore:93,Words:[...body.refText].filter(c=>/\p{Script=Han}/u.test(c)).map(Word=>({Word,PronAccuracy:93,PhoneInfos:[]}))});
   }
   if(endpoint==='/api/maanshan-save'){state.saves.push(request.postDataJSON());return send({ok:true,stored:'db'});}
   if(endpoint==='/api/school-recordings'){
    if(method==='POST'){const {audio,...recording}=request.postDataJSON();return send({ok:true,userId:actor,recording});}
    return send({ok:true,userId:actor,recordings:[]});
   }
   if(endpoint==='/api/research-events'){const body=request.postDataJSON();for(const event of body.events)state.events.set(event.eventId,event);return send({accepted:true,batchId:body.batchId,eventIds:body.events.map(event=>event.eventId)});}
   state.unexpected.push(method+' '+endpoint);return send({error:'blocked'},500);
  }
  let relative=url.pathname;if(relative==='/maanshan/')relative+='index.html';
  if(relative.includes('/published/')&&relative.includes('/maanshan/media/'))relative=relative.slice(relative.indexOf('/maanshan/media/'));
  const file=path.resolve(repo,'.'+decodeURIComponent(relative));
  if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
  const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';
  await route.fulfill({contentType:mime,body:fs.readFileSync(file)}).catch(()=>{});
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/maanshan/',{waitUntil:'domcontentloaded'});await page.locator('.poem-entry').first().waitFor();
 const go=async hash=>{await page.evaluate(value=>{location.hash=value;},hash);if(hash)await page.locator('#record-controls').waitFor();else await page.locator('.poem-entry').first().waitFor();};
 const mic=settings=>page.evaluate(value=>Object.assign(window.__mic,value),settings);
 const panel=page.locator('#record-controls .record-mic-denied');
 // What the panel says and offers, or null when it is not on screen.
 const shown=async()=>await panel.count()===0||!(await panel.isVisible())?null:{title:await panel.locator('.record-mic-title').innerText(),help:await panel.locator('#record-status').innerText(),buttons:await panel.locator('button').allInnerTexts(),retry:await panel.locator('[data-action=record-start]').count(),reload:await panel.locator('[data-action=record-reload]').count()};
 const refuse=async(settings={})=>{await mic({deny:1,...settings});await page.locator('#record-controls [data-action=record-start]').click();await panel.waitFor({timeout:15000});};
 const plainMic=()=>page.locator('#record-controls .mic-button[data-action=record-start]').count();
 const visibility=value=>page.evaluate(v=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>v});Object.defineProperty(document,'hidden',{configurable:true,get:()=>v==='hidden'});document.dispatchEvent(new Event('visibilitychange'));},value);
 // Uploaded and still-queued research events, deduplicated by id.
 const researchEvents=async()=>{const stored=await page.evaluate(prefix=>Object.keys(localStorage).filter(k=>k.startsWith(prefix)).map(k=>JSON.parse(localStorage.getItem(k))),'maanshan-research-v1:'+actor+':event:');const all=new Map(state.events);for(const event of stored)all.set(event.eventId,event);return [...all.values()];};
 return {context,page,state,go,mic,panel,shown,refuse,plainMic,visibility,researchEvents,release:()=>state.held.splice(0).forEach(resolve=>resolve()),close:async()=>{state.held.splice(0).forEach(resolve=>resolve());await context.close();}};
}
async function desktop(){
 const env=await setup({userAgent:DESKTOP}),{page,state,go,mic,shown,refuse,plainMic,visibility}=env;try{
  await go('#yong-e/record');
  await mic({deny:1,hold:1500});await page.locator('#record-controls [data-action=record-start]').click();
  await page.locator('#record-controls .record-status',{hasText:'正在開啟麥克風…看到提示請按「允許」'}).waitFor({timeout:1000});
  check('while the browser asks, the pupil is told to press 允許',true);
  await env.panel.waitFor({timeout:15000});const first=await shown();
  check('a refused microphone shows a panel with the desktop browser step and both buttons, 再試一次 first',await env.panel.locator('[data-action=record-start].primary').count()===1&&first&&first.title==='麥克風未開啟'&&first.help===DESKTOP_HELP&&first.retry===1&&first.reload===1&&first.buttons.map(text=>text.trim()).join('|')==='再試一次|重新載入');
  await page.waitForTimeout(5500);
  check('the panel is still on screen after 5 seconds',JSON.stringify(await shown())===JSON.stringify(first));
  check('the refusal is shown on the page, not as a passing toast',!(await page.locator('#toast').textContent()).includes('麥克風'));
  await visibility('hidden');await visibility('visible');
  check('the panel stays while the pupil leaves for the settings and comes back',(await shown())?.help===DESKTOP_HELP);
  await until(async()=>(await env.researchEvents()).some(event=>event.type==='error'&&event.error?.code==='permission_denied'),'refusal research event');
  const denied=(await env.researchEvents()).filter(event=>event.type==='error'&&event.itemId==='p1.l0'&&event.error?.code==='permission_denied');
  let valid=true;try{validateEvent(denied[0]);}catch{valid=false;}
  check('the refusal is recorded once as mic-denied with how long it took, and the server schema accepts it',denied.length===1&&denied[0].activity==='read'&&denied[0].context?.errorDetail==='mic-denied'&&Number.isInteger(denied[0].metrics?.latencyMs)&&denied[0].metrics.latencyMs>=1400&&denied[0].metrics.latencyMs<=600000&&valid);
  await page.locator('[data-action=record-step][data-value="1"]').click();
  check('stepping to the next line clears the panel',await shown()===null&&await plainMic()===1&&(await page.locator('#record-tool .record-counter').innerText()).includes('第 2 / 4 句'));
  await page.locator('[data-action=record-step][data-value="-1"]').click();
  check('stepping back does not bring the old panel back',await shown()===null&&await plainMic()===1);
  await refuse();
  check('refused again on the same line',(await shown())?.help===DESKTOP_HELP);
  const calls=await page.evaluate(()=>window.__mic.calls);
  await page.locator('#record-controls .record-mic-denied [data-action=record-start]').click();
  await page.locator('[data-action=record-stop]').waitFor();
  check('再試一次 asks for the microphone again and recording starts once it is allowed',await page.evaluate(()=>window.__mic.calls)===calls+1&&await shown()===null);
  await page.waitForTimeout(900);await page.locator('[data-action=record-stop]').click();
  await until(()=>state.held.length===1,'score in flight');env.release();await page.locator('.record-result').waitFor({timeout:15000});
  check('the retried reading is scored as usual',(await page.locator('.record-result').innerText()).includes('93')&&state.soe.length===1);
  await go('');await go('#yong-e/record');await refuse();
  await go('');await go('#yong-e/record');
  check('leaving the page clears the panel',await shown()===null&&await plainMic()===1);
  await refuse();await page.evaluate(()=>{window.__beforeReload=true;});
  await Promise.all([page.waitForEvent('load'),page.locator('#record-controls .record-mic-denied [data-action=record-reload]').click()]);
  await page.locator('#record-controls').waitFor();
  check('重新載入 reloads the page back to the reading line',await page.evaluate(()=>window.__beforeReload===undefined)&&await shown()===null&&await plainMic()===1);
  // A kept recording keeps its resend; the browser step is only a toast then.
  state.soeFail=2;await page.locator('#record-controls [data-action=record-start]').click();await page.locator('[data-action=record-stop]').waitFor();
  await page.waitForTimeout(900);await page.locator('[data-action=record-stop]').click();
  await page.locator('#record-controls [data-action=record-send]').waitFor({timeout:15000});
  await mic({deny:1});await page.locator('#record-controls [data-action=record-start]').click();
  await page.waitForFunction(text=>document.querySelector('#toast')?.textContent===text,'請先允許使用麥克風：按網址列左邊的圖示 ›「麥克風」選「允許」。',{timeout:15000});
  check('a refusal while a recording is kept leaves 再送一次 and tells the step in a toast, without a reload that would lose it',await shown()===null&&await page.locator('#record-controls [data-action=record-send]').count()===1);
  check('no unexpected requests',state.unexpected.length===0);
 }finally{await env.close();}
}
async function ipad(){
 const env=await setup({userAgent:IPAD,viewport:{width:1024,height:768},touchPoints:5}),{page,go,shown,refuse}=env;try{
  await go('#yong-e/record');await refuse();
  check('on an iPad the panel names the Safari setting',(await shown())?.help===IPAD_HELP);
  await page.waitForTimeout(5500);
  check('on an iPad the panel is still on screen after 5 seconds',(await shown())?.help===IPAD_HELP);
  // Safari keeps refusing on this page until it is reloaded, so 重新載入 leads.
  const boxes=await Promise.all([env.panel.locator('[data-action=record-reload]'),env.panel.locator('[data-action=record-start]')].map(button=>button.boundingBox()));
  check('on an iPad 重新載入 is the main button, left of 再試一次, both on screen',(await shown())?.buttons.map(text=>text.trim()).join('|')==='重新載入|再試一次'&&await env.panel.locator('[data-action=record-reload].primary').count()===1&&await env.panel.locator('[data-action=record-start].primary').count()===0&&boxes.every(box=>box&&box.x>=0&&box.x+box.width<=1024&&box.height>=40)&&boxes[0].x+boxes[0].width<=boxes[1].x);
  await page.locator('#record-controls .record-mic-denied [data-action=record-start]').click();await page.locator('[data-action=record-stop]').waitFor();
  check('on an iPad 再試一次 starts recording once the microphone is allowed',await shown()===null);
 }finally{await env.close();}
}
async function phone(){
 const env=await setup({userAgent:IPHONE,viewport:{width:375,height:667},touchPoints:5}),{page,go,shown,refuse}=env;try{
  await go('#yong-e/record');await refuse();
  check('on an iOS 17 iPhone the panel names the Safari setting',(await shown())?.help===SAFARI_HELP);
  const boxes=await Promise.all([env.panel.locator('.record-mic-title'),env.panel.locator('#record-status'),env.panel.locator('[data-action=record-start]'),env.panel.locator('[data-action=record-reload]')].map(item=>item.boundingBox()));
  check('on a small phone the panel fits the screen width',boxes.every(box=>box&&box.x>=0&&box.x+box.width<=375)&&await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Held sideways the panel shares a short column with the verse; both buttons must still be in view.
  for(const [width,height] of [[667,375],[844,390]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(300);
   const buttons=await Promise.all([env.panel.locator('[data-action=record-reload]'),env.panel.locator('[data-action=record-start]')].map(item=>item.boundingBox()));
   check('on a '+width+'x'+height+' phone held sideways both buttons are in view without scrolling',buttons.every(box=>box&&box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=height&&box.height>=40));
  }
 }finally{await env.close();}
}
// school62b: a browser without any recording API (here a WeChat iPad) keeps one notice, with nothing to press again, until reloaded.
const WECHAT_IPAD='Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50(0x1800323a) NetType/WIFI Language/zh_HK';
async function unsupported(){
 const env=await setup({userAgent:WECHAT_IPAD,viewport:{width:1024,height:768},touchPoints:5}),{page,go,shown,plainMic}=env;try{
  await env.context.addInitScript(()=>{delete window.MediaRecorder;});await page.reload({waitUntil:'domcontentloaded'});await page.locator('.poem-entry').first().waitFor();
  await go('#yong-e/record');await page.locator('#record-controls [data-action=record-start]').click();await env.panel.waitFor({timeout:15000});
  const first=await shown();
  check('a browser that cannot record shows a notice naming Safari, with no button to press again',first?.title==='這個瀏覽器不能錄音'&&first.help==='請改用 Safari 開啟本網站。'&&first.buttons.length===0&&await plainMic()===0);
  await page.waitForTimeout(5500);
  check('the notice is still on screen after 5 seconds',JSON.stringify(await shown())===JSON.stringify(first));
  await page.locator('[data-action=record-step][data-value="1"]').click();
  check('the notice stays on the next line',(await shown())?.title==='這個瀏覽器不能錄音'&&await plainMic()===0);
  await go('');await go('#yong-e/record');
  check('the notice stays after leaving and coming back',(await shown())?.title==='這個瀏覽器不能錄音'&&await plainMic()===0);
  await until(async()=>(await env.researchEvents()).some(event=>event.type==='error'&&event.error?.code==='unsupported'),'unsupported research event');
  const refused=(await env.researchEvents()).filter(event=>event.type==='error'&&event.error?.code==='unsupported');
  let valid=true;try{validateEvent(refused[0]);}catch{valid=false;}
  check('the press is recorded once as unsupported, accepted by the server schema, without asking for the microphone',refused.length===1&&refused[0].context?.errorDetail==='unsupported'&&valid&&await page.evaluate(()=>window.__mic.calls)===0);
 }finally{await env.close();}
}
(async()=>{
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 await desktop();await ipad();await phone();await unsupported();
 check('no browser exceptions',errors.length===0);
})().catch(error=>{results.push({label:'suite',passed:false,error:error.stack});process.exitCode=1;}).finally(async()=>{await browser?.close();console.log(JSON.stringify({ok:results.every(r=>r.passed),syntheticOnly:true,noProductionRequests:true,checks:results,errors},null,2));});
