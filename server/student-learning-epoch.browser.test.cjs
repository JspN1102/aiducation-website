'use strict';
// Synthetic student account, API and queues; never touches school data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),origin='https://student-epoch.invalid',actor='s_'+'a'.repeat(24),epoch='b'.repeat(32),nextEpoch='c'.repeat(32);
const poems=JSON.parse(fs.readFileSync(path.join(repo,'maanshan/poems.json'),'utf8')).poems;
const checks=[],errors=[],mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2'};
const check=(name,ok)=>{assert(ok,name);checks.push(name);};
async function setup(browser,{serverEpoch=epoch}={}){
 const context=await browser.newContext({viewport:{width:1180,height:820},hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),state={epoch:serverEpoch,requests:[],authLoads:0,reject:null,progressEpoch:null};
 page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(({actor,poems})=>{
  if(localStorage.getItem('epoch-fixture-seeded'))return;localStorage.setItem('epoch-fixture-seeded','1');
  const progress=Object.fromEntries(poems.map(p=>[p.id,{reading:p.lines.map(()=>({total_score:91,grade:'表現良好',dimensions:{phone_score:91,fluency_score:91,integrity_score:91},words:[]})),writing:[],chat:[{role:'assistant',content:'old test reply'}],quiz:[],updatedAt:1,readingVersion:p.readingVersion,pronunciationVersion:p.pronunciationVersion}]));
  const eventId='10000000-0000-4000-8000-000000000001',requestId='20000000-0000-4000-8000-000000000001',sessionId='30000000-0000-4000-8000-000000000001';
  const values={
   ['maanshan-learning-v2:'+actor]:JSON.stringify(progress),
   ['ms_pending_sync:'+actor]:JSON.stringify([{syncId:'old-progress',studentId:actor,poemId:1,section:'reading',payload:{marker:'historical'},queuedAt:Date.now()}]),
   ['maanshan-answer-v1:'+actor+':'+requestId]:JSON.stringify({poemId:1,itemId:'old-item',status:'correct',response:{choiceId:'old-choice'},researchContext:{actorId:actor,requestId,requestedAt:new Date().toISOString()}}),
   ['maanshan-research-v1:'+actor+':event:'+eventId]:JSON.stringify({eventId,sessionId,seq:0,clientAt:new Date().toISOString(),activeMs:0,poemId:1,activity:'read',type:'activity_start',appVersion:'old',contentVersion:'old'})};
  for(const [key,value]of Object.entries(values))localStorage.setItem(key,value);
  localStorage.setItem('epoch-fixture-originals',JSON.stringify(values));
 },{actor,poems});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),endpoint=url.pathname.replace(/\/$/,''),send=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{});
  if(endpoint.startsWith('/api/')){
   const body=req.method()==='POST'?req.postDataJSON():null,header=req.headers()['x-learning-epoch'];state.requests.push({endpoint,body,header,method:req.method()});
   if(endpoint==='/api/school-auth'){
    if(url.searchParams.get('action')==='progress')return send({enabled:true,userId:actor,poems:{},...(state.progressEpoch||state.epoch?{learningEpoch:state.progressEpoch||state.epoch}:{})});
    state.authLoads++;return send({enabled:true,authenticated:true,user:{id:actor,role:'student',displayName:'測試同學',grade:1,cls:'A',classNo:1,researchEnabled:true},csrfToken:'synthetic',...(state.epoch?{learningEpoch:state.epoch}:{})});
   }
   if(endpoint===state.reject)return send({ok:false,code:'LEARNING_RESET',error:'Learning generation changed'},409);
   if(endpoint==='/api/maanshan-save')return send({ok:false,code:'SYNTHETIC_OFFLINE'},503);
   if(endpoint==='/api/school-recordings')return send({ok:true,userId:actor,recordings:[]});
   if(endpoint==='/api/research-events')return send({accepted:true,batchId:body.batchId,eventIds:body.events.map(e=>e.eventId)});
   if(endpoint==='/api/challenge-result')return send({ok:true,researchRecorded:true});
   if(endpoint==='/api/soe')return send({SuggestedScore:90});
   return send({ok:true});
  }
  let relative=url.pathname;if(relative==='/maanshan/')relative+='index.html';
  if(relative.includes('/published/')&&relative.includes('/maanshan/media/'))relative=relative.slice(relative.indexOf('/maanshan/media/'));
  const file=path.resolve(repo,'.'+decodeURIComponent(relative));
  if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
  return route.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)}).catch(()=>{});
 });
 await page.goto(origin+'/maanshan/');await page.locator('.poem-entry').waitFor();await page.waitForFunction(()=>Object.keys(localStorage).some(k=>k.startsWith('maanshan-research-v1:')));
 return{page,context,state};
}
async function originalsIntact(page){return page.evaluate(()=>Object.entries(JSON.parse(localStorage.getItem('epoch-fixture-originals'))).every(([key,value])=>localStorage.getItem(key)===value));}
(async()=>{
 for(const engine of ['chromium','webkit']){
  const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  try{
   const {page,context,state}=await setup(browser);
   try{
    await page.evaluate(()=>location.hash='#yong-e/report');await page.locator('.report-empty').waitFor();
    check(engine+' new student generation starts without old scores',await page.locator('.score-ring,.report-line').count()===0);
    check(engine+' old progress, research and answer queues remain byte-identical',await originalsIntact(page));
    check(engine+' startup does not upload historical progress or answers',!state.requests.some(r=>r.endpoint==='/api/maanshan-save'||r.endpoint==='/api/challenge-result'||r.body?.events?.some(e=>e.appVersion==='old')));
    check(engine+' fresh progress key uses the server generation',await page.evaluate(({actor,epoch})=>localStorage.getItem('maanshan-learning-v2:'+actor+':'+epoch)!==null,{actor,epoch}));
    await page.evaluate(()=>location.hash='');await page.locator('.poem-entry').waitFor();await page.locator('#profile-open').click();check(engine+' students never receive teacher reset UI',await page.locator('#account-reset-progress,#teacher-reset-dialog').count()===0);await page.keyboard.press('Escape');
    await page.evaluate(async()=>{const node=[...performance.getEntriesByType('resource')].find(r=>new URL(r.name).pathname.endsWith('/network.mjs'));const {requestJSON}=await import(node.name);await requestJSON('/api/soe/',{refText:'synthetic'});});
    check(engine+' paid request uses current epoch through schoolFetch',state.requests.some(r=>r.endpoint==='/api/soe'&&r.header===epoch));
    // The real app's current generation records remain separate on reload.
    await page.evaluate(()=>location.hash='#yong-e/report');await page.locator('.report-empty').waitFor();await page.reload();await page.locator('.report-empty').waitFor();check(engine+' reload does not merge the historical assessment',await originalsIntact(page));
    state.epoch=nextEpoch;state.reject='/api/soe';const loaded=page.waitForEvent('domcontentloaded');
    await page.evaluate(async()=>{const node=[...performance.getEntriesByType('resource')].find(r=>new URL(r.name).pathname.endsWith('/school-session.mjs'));await import(node.name).then(m=>m.schoolFetch('/api/soe/',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).catch(()=>{});}).catch(error=>{if(!/context|navigation/i.test(error.message))throw error;});
    await loaded;await page.locator('.poem-entry').waitFor();
    check(engine+' stale provider response reloads into new epoch without deleting history',state.authLoads>=3&&await originalsIntact(page)&&await page.evaluate(({actor,epoch})=>JSON.parse(localStorage.getItem('ms_learning_epoch:'+actor))===epoch,{actor,epoch:nextEpoch}));
    check(engine+' current research namespace is distinct after reset',await page.evaluate(({actor,epoch})=>Object.keys(localStorage).some(key=>key.startsWith('maanshan-research-v1:'+actor+':epoch:'+epoch+':event:')),{actor,epoch:nextEpoch}));
    check(engine+' stale reset does not present login or teacher reset panels',await page.locator('.school-session-expired,#teacher-reset-dialog').count()===0);
   }finally{await context.close();}
   const legacy=await setup(browser,{serverEpoch:null});try{
    await legacy.page.evaluate(()=>location.hash='#yong-e/report');await legacy.page.locator('.score-ring').waitFor();
    check(engine+' pre-reset student continues to use legacy progress',await legacy.page.locator('.report-empty').count()===0);
    check(engine+' pre-reset API calls carry no fabricated epoch',legacy.state.requests.every(r=>r.header===undefined));
   }finally{await legacy.context.close();}
  }finally{await browser.close();}
 }
 check('no browser exceptions',!errors.length);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>console.log(JSON.stringify({ok:!process.exitCode,checks,errors},null,2)));
