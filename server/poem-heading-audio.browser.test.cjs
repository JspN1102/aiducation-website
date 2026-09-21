'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),origin='https://poem-heading-audio.invalid',checks=[],errors=[];
const evidence=process.env.POEM_HEADING_AUDIO_EVIDENCE_DIR;
const poems=JSON.parse(fs.readFileSync(path.join(repo,'maanshan/poems.json'),'utf8')).poems;
const cssSource=fs.readFileSync(path.join(repo,'scripts/build-maanshan-css.cjs'),'utf8');
const css=[...cssSource.match(/const files = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m=>fs.readFileSync(path.join(repo,'maanshan',m[1]),'utf8')).join('\n');
const audio=Buffer.alloc(44+8000*2*2);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);audio.writeUInt32LE(16000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(audio.length-44,40);
const check=(name,value)=>{assert(value,name);checks.push(name);};
let browser;
async function setup(width,height){
 const context=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:width<700,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),state={requests:[],audio:[],failAudio:false,holdAudio:false,release:null};
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url()),endpoint=url.pathname.replace(/\/$/,'');
  if(endpoint.startsWith('/api/')){
   state.requests.push({path:endpoint,method:route.request().method()});let body={ok:true};
   if(endpoint==='/api/school-auth')body=url.searchParams.get('action')==='progress'?{enabled:true,userId:'synthetic-heading-audio',poems:{}}:{enabled:true,authenticated:true,user:{id:'synthetic-heading-audio',role:'student',displayName:'測試同學',grade:1,cls:'A',classNo:1,isTest:true,learningScope:'all-grades',researchEnabled:false},csrfToken:'synthetic-csrf'};
   if(endpoint==='/api/school-recordings')body={ok:true,userId:'synthetic-heading-audio',recordings:[]};
   return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  }
  // Play synthetic audio through the real mapping/player, without paid speech
  // or scoring calls and without depending on the concurrent audio-cutting job.
  if(endpoint.includes('/media/recitations/')){
   state.audio.push(endpoint);
   if(state.holdAudio)await new Promise(resolve=>state.release=resolve);
   return route.fulfill(state.failAudio?{status:404,body:''}:{contentType:'audio/wav',body:audio}).catch(()=>{});
  }
  if(endpoint==='/maanshan/app.bundle.css')return route.fulfill({contentType:'text/css',body:css});
  let relative=url.pathname;if(relative==='/maanshan/')relative+='index.html';
  if(relative.includes('/published/')&&relative.includes('/maanshan/media/'))relative=relative.slice(relative.indexOf('/maanshan/media/'));
  const file=path.resolve(repo,'.'+decodeURIComponent(relative));
  if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
  const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';
  return route.fulfill({contentType:mime,body:fs.readFileSync(file)}).catch(()=>{});
 });
 await page.goto(origin+'/maanshan/');await page.locator('.poem-entry').first().waitFor();await page.evaluate(()=>document.fonts.ready);
 return {context,page,state};
}
async function recordPage(page,poem){await page.evaluate(slug=>location.hash='#'+slug+'/record',poem.slug);await page.locator('.view-record').waitFor();await page.locator('[data-action=poem-heading-audio][data-value=title]').waitFor();}
(async()=>{try{
 if(evidence)fs.mkdirSync(evidence,{recursive:true});browser=await chromium.launch({channel:'msedge',headless:true});
 for(const [width,height]of [[320,740],[390,844],[768,1024],[1024,768],[1440,900]]){
  const {context,page,state}=await setup(width,height);
  try{for(const poem of poems){
   await recordPage(page,poem);
   const fits=await page.locator('.lesson-bar').evaluate(el=>{
    const buttons=[...el.querySelectorAll('[data-action=poem-heading-audio]')],others=[...el.querySelectorAll('.back-library,.shishi-touch-slot,.lesson-tools')].map(e=>e.getBoundingClientRect());
    return buttons.length===2&&buttons.every(button=>{const b=button.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight&&others.every(o=>b.right<=o.left+.5||b.left>=o.right-.5||b.bottom<=o.top+.5||b.top>=o.bottom-.5)&&getComputedStyle(button).fontSize===getComputedStyle(button.parentElement).fontSize;})&&document.documentElement.scrollWidth<=innerWidth+1;
   });check(`${width}px grade ${poem.grade} title/author retain type size and do not overlap header controls`,fits);
   if(width===1024||width===390){
    for(const kind of ['title','author']){
     const button=page.locator(`[data-action=poem-heading-audio][data-value=${kind}]`);await button.click();await page.waitForFunction(kind=>document.querySelector(`[data-action=poem-heading-audio][data-value=${kind}]`)?.dataset.audioState==='playing',kind);
     check(`grade ${poem.grade} ${kind} uses its official recording`,state.audio.at(-1).endsWith(`/grade${poem.grade}-${kind}.mp3`));await button.click();
     check('second click stops audio and clears its pressed state',await button.getAttribute('aria-pressed')==='false');
    }
    if(evidence&&poem.grade===5)await page.screenshot({path:path.join(evidence,`heading-${width}.png`)});
   }
  }
  if(width===390){
   const title=page.locator('[data-action=poem-heading-audio][data-value=title]'),author=page.locator('[data-action=poem-heading-audio][data-value=author]');
   state.holdAudio=true;await title.click();await page.waitForFunction(()=>document.querySelector('[data-value=title][data-action=poem-heading-audio]').getAttribute('aria-busy')==='true');
   check('slow audio shows loading without changing the title',await title.innerText()===poems.at(-1).title);state.holdAudio=false;state.release?.();
   await page.waitForFunction(()=>document.querySelector('[data-value=title][data-action=poem-heading-audio]').dataset.audioState==='playing');
   await author.click();await page.waitForFunction(()=>document.querySelector('[data-value=author][data-action=poem-heading-audio]').dataset.audioState==='playing');
   check('switching title to author stops the previous sound',await title.getAttribute('aria-pressed')==='false');
   await page.locator('.back-library').click();check('routing cancels header playback',await page.locator('[data-audio-state]').count()===0);
   await recordPage(page,poems[0]);state.failAudio=true;await page.locator('[data-action=poem-heading-audio][data-value=title]').click();await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('示範錄音暫時未能播放'));
   check('unavailable official audio shows retry feedback without silently switching to TTS',!state.requests.some(r=>r.path==='/api/tts'));state.failAudio=false;
   await recordPage(page,poems[4]);const before=state.audio.length;await page.locator('[data-action=line-tts]').click();await page.waitForFunction(()=>document.querySelector('[data-action=line-tts]').dataset.audioState==='playing');
   await page.waitForTimeout(100);check('grade five reads the complete comma-separated line from one official clip',state.audio.length===before+1&&state.audio.at(-1).endsWith('/grade5-line1.mp3'));await page.locator('[data-action=line-tts]').click();
   state.failAudio=true;await page.locator('[data-action=line-tts]').click();await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('語音暫時無法播放'));
   check('official poem-line failures never fall back to TTS',!state.requests.some(r=>r.path==='/api/tts'));state.failAudio=false;
  }
  check(`${width}px heading playback creates no recording, score or progress write`,state.requests.every(r=>r.method==='GET'&&['/api/school-auth','/api/school-recordings'].includes(r.path)));
  }finally{state.release?.();await context.close();}
 }
 check('no browser exceptions',errors.length===0);
}catch(error){checks.push({failure:error.stack});process.exitCode=1;}finally{await browser?.close();const result={ok:!process.exitCode,syntheticAudio:true,noProductionRequests:true,checks,errors};if(evidence)fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}})();
