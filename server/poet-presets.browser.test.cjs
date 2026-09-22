'use strict';
// Exercise real app buttons/retry/history with isolated synthetic APIs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),origin='https://poet-presets.invalid',checks=[],errors=[];
const poems=require('../maanshan/poems.json').poems;
const check=(name,value)=>{assert(value,name);checks.push(name);};
(async()=>{
 const {matchPoetPreset,getPoetSuggestions}=await import('../maanshan/poet-presets.mjs');
 for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch(name==='chromium'?{channel:'msedge',headless:true}:{headless:true});
  try{
   const context=await browser.newContext({viewport:{width:1180,height:820},hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),requests=[];
   let failNext=false;
   page.on('pageerror',e=>errors.push(e.message));
   await context.route('**/*',async route=>{
    const u=new URL(route.request().url()),endpoint=u.pathname.replace(/\/$/,'');
    if(endpoint.startsWith('/api/')){
     if(endpoint==='/api/maanshan-chat'){
      const body=route.request().postDataJSON();requests.push(body);
      if(failNext){failNext=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'temporary synthetic error'})});}
      return route.fulfill({contentType:'application/json',body:JSON.stringify({reply:'我們一起看一看這首詩。',responseSource:body.presetId?'preset_cache':'live'})});
     }
     let data={ok:true};
     if(endpoint==='/api/school-auth')data=u.searchParams.get('action')==='progress'?{enabled:true,userId:'synthetic-poet',learningEpoch:'initial',poems:{}}:{enabled:true,authenticated:true,user:{id:'synthetic-poet',role:'teacher',displayName:'測試老師',grade:null,cls:null,classNo:null,isTest:false,researchEnabled:false,learningScope:'all-grades'},csrfToken:'synthetic-csrf',learningEpoch:'initial'};
     if(endpoint==='/api/school-recordings')data={ok:true,userId:'synthetic-poet',learningEpoch:'initial',recordings:[]};
     return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    }
    let relative=u.pathname;
    if(relative==='/maanshan/')relative+='index.html';
    if(relative.includes('/published/')&&relative.includes('/maanshan/media/'))relative=relative.slice(relative.indexOf('/maanshan/media/'));
    const file=path.resolve(root,'.'+decodeURIComponent(relative));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
    const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';
    return route.fulfill({contentType:mime,body:fs.readFileSync(file)});
   });
   for(const poem of poems){
    await page.goto(origin+'/maanshan/#'+poem.slug+'/chat');
    await page.waitForFunction(question=>document.querySelector('[data-action=chat-suggestion]')?.textContent===question,getPoetSuggestions(poem)[0]);
    for(let i=0;i<3;i++){
     const button=page.locator('[data-action=chat-suggestion]').nth(i),question=await button.innerText(),before=requests.length;
     await button.click();await page.waitForFunction(()=>!document.querySelector('#chat-send').disabled);
     const request=requests[before],preset=matchPoetPreset(poem.id,question);
     check(`${name} poem ${poem.id} button ${i+1} carries validated independent preset`,preset&&request?.presetId===preset.id&&request.presetVersion===preset.version&&request.poemId===poem.id&&request.messages.at(-1).content===question);
     check(`${name} poem ${poem.id} button ${i+1} keeps provider messages clean`,request.messages.every(m=>Object.keys(m).sort().join(',')==='content,role'));
    }
   }
   // Typed follow-ups retain conversation history and never inherit a preset ID.
   await page.locator('#chat-input').fill('我今天有點不開心，想聊聊。');await page.locator('#chat-send').click();
   await page.waitForFunction(()=>!document.querySelector('#chat-send').disabled);
   check(name+' typed conversation has no preset flag',!requests.at(-1).presetId&&!requests.at(-1).presetVersion&&requests.at(-1).messages.length>1);
   failNext=true;await page.locator('[data-action=chat-suggestion]').first().click();await page.locator('[data-action=chat-retry]').waitFor();
   const failed=requests.at(-1);
   await page.reload();await page.locator('[data-action=chat-retry]').waitFor();
   await page.locator('[data-action=chat-retry]').click();await page.waitForFunction(()=>!document.querySelector('#chat-send').disabled);
   check(name+' reload and retry preserves explicit preset identity',failed.presetId&&requests.at(-1).presetId===failed.presetId&&requests.at(-1).presetVersion===failed.presetVersion);
   await context.close();
  }finally{await browser.close();}
 }
 check('no browser exceptions',errors.length===0);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>console.log(JSON.stringify({ok:!process.exitCode,checks,errors,syntheticOnly:true,paidRequests:0},null,2)));
