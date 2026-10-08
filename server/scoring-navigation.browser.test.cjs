// A pronunciation score that is already being paid for must survive the pupil
// leaving the line, be saved exactly once, and never be re-sent while in flight.
// Synthetic pupil and local routes only; no production requests.
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),origin='https://scoring-navigation.invalid',actor='s_'+'7'.repeat(24);
const storeKey='maanshan-learning-v2:'+actor,results=[],errors=[];
let browser;
function check(label,value){assert(value,label);results.push({label,passed:true});}
async function until(test,label,timeout=15000){const end=Date.now()+timeout;while(!(await test())){if(Date.now()>end)throw new Error('Timed out: '+label);await new Promise(resolve=>setTimeout(resolve,50));}}
async function setup(){
 const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
 await context.grantPermissions(['microphone'],{origin});
 const state={soe:[],held:[],soeFail:0,refuse:0,score:93,saves:[],uploads:[],events:new Map(),logouts:0,unexpected:[]};
 // Observe (without changing) the score request's abort signal and the save timeout.
 await context.addInitScript(()=>{
  const timeout=AbortSignal.timeout,limits=new WeakMap();
  AbortSignal.timeout=function(ms){const signal=timeout.call(this,ms);limits.set(signal,ms);return signal;};
  window.__audit={soe:[],saveTimeouts:[]};const original=window.fetch;
  window.fetch=function(input,options={}){
   const url=String(input?.url||input);
   if(url.includes('/api/soe')){const entry={aborted:false};options.signal?.addEventListener('abort',()=>{entry.aborted=true;});window.__audit.soe.push(entry);}
   if(url.includes('/api/maanshan-save'))window.__audit.saveTimeouts.push(limits.get(options.signal)??null);
   return original.call(this,input,options);
  };
 });
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),endpoint=url.pathname.replace(/\/$/,''),method=request.method();
  const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});
  if(url.pathname==='/blank')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>other tab</title>'});
  if(endpoint.startsWith('/api/')){
   if(endpoint==='/api/school-auth'){
    if(method==='POST'){state.logouts++;return send({error:'unavailable'},503);}
    if(url.searchParams.get('action')==='progress')return send({enabled:true,userId:actor,poems:{}});
    return send({enabled:true,authenticated:true,user:{id:actor,role:'student',displayName:'示範同學',grade:1,cls:'A',classNo:1,isTest:true,learningScope:'all-grades',researchEnabled:true},csrfToken:'synthetic-csrf'});
   }
   if(endpoint==='/api/soe'){
    const body=request.postDataJSON();state.soe.push({poemId:body.poemId,refText:body.refText,audioFormat:body.audioFormat??null,requestId:body.requestId});
    if(state.soeFail>0){state.soeFail--;return send({error:'busy'},503);}
    await new Promise(resolve=>state.held.push(resolve));
    // The origin's definite pre-scoring refusal of a compact upload it could not transcode.
    if(state.refuse>0){state.refuse--;return send({error:'transcode',code:'AUDIO_TRANSCODE_FAILED'},422);}
    const score=state.score;
    return send({PronAccuracy:score,PronFluency:.95,PronCompletion:1,SuggestedScore:score,Words:[...body.refText].filter(c=>/\p{Script=Han}/u.test(c)).map(Word=>({Word,PronAccuracy:score,PhoneInfos:[]}))});
   }
   if(endpoint==='/api/maanshan-save'){state.saves.push(request.postDataJSON());return send({ok:true,stored:'db'});}
   if(endpoint==='/api/school-recordings'){
    if(method==='POST'){const {audio,...recording}=request.postDataJSON();state.uploads.push(recording);return send({ok:true,userId:actor,recording});}
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
 const record=async()=>{await page.locator('#record-controls [data-action=record-start]').click();await page.locator('[data-action=record-stop]').waitFor();await page.waitForTimeout(900);await page.locator('[data-action=record-stop]').click();};
 const reading=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'{}')[1]?.reading||[],storeKey);
 const readingSaves=(line=0)=>state.saves.filter(item=>item.section==='reading'&&item.poemId===1&&item.payload?.lineIdx===line);
 const controls=async()=>({text:await page.locator('#record-controls').innerText(),send:await page.locator('#record-controls [data-action=record-send]').count(),start:await page.locator('#record-controls [data-action=record-start]').count()});
 const soeAborted=index=>page.evaluate(i=>window.__audit.soe[i]?.aborted===true,index);
 const visibility=value=>page.evaluate(v=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>v});Object.defineProperty(document,'hidden',{configurable:true,get:()=>v==='hidden'});document.dispatchEvent(new Event('visibilitychange'));},value);
 // Uploaded and still-queued research events, deduplicated by id.
 const researchEvents=async()=>{const stored=await page.evaluate(prefix=>Object.keys(localStorage).filter(k=>k.startsWith(prefix)).map(k=>JSON.parse(localStorage.getItem(k))),'maanshan-research-v1:'+actor+':event:');const all=new Map(state.events);for(const event of stored)all.set(event.eventId,event);return [...all.values()];};
 return {context,page,state,go,record,reading,readingSaves,controls,soeAborted,visibility,researchEvents,release:()=>state.held.splice(0).forEach(resolve=>resolve()),close:async()=>{state.held.splice(0).forEach(resolve=>resolve());await context.close();}};
}
async function leavingKeepsScore(){
 const env=await setup(),{page,state,go,record,reading,readingSaves,controls,soeAborted}=env;try{
  await go('#yong-e/record');await record();await until(()=>state.held.length===1,'score request in flight');
  await go('');
  check('leaving the reading page does not abort the score being paid for',!(await soeAborted(0))&&!(await reading())[0]);
  await go('#yong-e/record');const waiting=await controls();
  check('back on the line while scoring: no resend or re-record button, only the waiting status',waiting.send===0&&waiting.start===0&&waiting.text.includes('正在等候評測'));
  await go('');env.release();
  await until(async()=>readingSaves().length===1&&state.uploads.length===1&&(await reading())[0],'score saved after leaving');
  await page.waitForTimeout(600);
  const line=(await reading())[0];
  check('a score that arrives after leaving is kept on this device',line?.total_score===93&&typeof line.recordingId==='string');
  check('the score is scored once, saved once and its recording uploaded once',state.soe.length===1&&readingSaves().length===1&&readingSaves()[0].payload.lineScore===93&&state.uploads.length===1&&state.uploads[0].recordingId===line.recordingId);
  const feedback=(await env.researchEvents()).filter(event=>event.type==='feedback_shown'&&event.itemId==='p1.l0');
  check('exactly one assessment research event for that line, attributed to reading',feedback.length===1&&feedback[0].activity==='read'&&feedback[0].poemId===1&&feedback[0].result?.score===93);
  const limits=await page.evaluate(()=>window.__audit.saveTimeouts);
  check('learning saves wait 30 seconds before giving up',limits.length>=1&&limits.every(ms=>ms===30000));
  await go('#yong-e/record');
  check('returning marks the scored line done and continues from the next unread line',await page.locator('.record-progress i.done').count()===1&&await page.locator('.record-progress i:first-child').getAttribute('class')==='done '&&(await page.locator('#record-tool .record-counter').innerText()).includes('第 2 / 4 句'));
 }finally{await env.close();}
}
async function hiddenPageKeepsScore(){
 const env=await setup(),{page,state,go,record,reading,readingSaves,controls,soeAborted,visibility}=env;try{
  await go('#yong-e/record');await record();await until(()=>state.held.length===1,'score request in flight');
  await visibility('hidden');const waiting=await controls();
  check('hiding the page keeps the score request and shows no resend button',!(await soeAborted(0))&&waiting.send===0&&waiting.text.includes('正在等候評測'));
  await visibility('visible');env.release();
  await page.locator('.record-result').waitFor({timeout:15000});
  check('the score that arrives after the page was hidden is shown on the same line',(await page.locator('.record-result').innerText()).includes('93')&&(await reading())[0]?.total_score===93);
  await page.waitForTimeout(400);
  check('hidden-page score is saved exactly once',state.soe.length===1&&readingSaves().length===1&&state.uploads.length===1);
 }finally{await env.close();}
}
async function retryHiddenWhileScoring(){
 const env=await setup(),{page,state,go,record,reading,readingSaves,controls}=env;try{
  // A 503 is resent once by itself; only a second one hands the recording back to the pupil.
  state.soeFail=2;await go('#yong-e/record');await record();
  await page.locator('#record-controls [data-action=record-send]').waitFor();
  await page.locator('#record-controls [data-action=record-send]').click();await until(()=>state.held.length===1,'resend in flight');
  check('while a resend is scored on the line there is no resend button',(await controls()).send===0);
  await go('');await go('#yong-e/record');const waiting=await controls();
  check('after leaving and returning during a resend there is still no resend button',waiting.send===0&&waiting.start===0&&waiting.text.includes('正在等候評測'));
  env.release();await page.locator('.record-result').waitFor({timeout:15000});
  await page.waitForTimeout(400);
  check('the resent score appears on the line it belongs to and is saved once',(await reading())[0]?.total_score===93&&state.soe.length===3&&readingSaves().length===1&&state.uploads.length===1);
  check('every send of one recording carries the same requestId',/^[0-9a-f-]{36}$/.test(state.soe[0].requestId)&&state.soe.every(entry=>entry.requestId===state.soe[0].requestId));
 }finally{await env.close();}
}
async function refusedCompactResend(){
 const env=await setup(),{page,state,go,record,reading,readingSaves}=env;try{
  state.refuse=1;await go('#yong-e/record');await record();await until(()=>state.held.length===1,'compact upload in flight');
  await go('');env.release();
  await go('#yong-e/record');await page.locator('#record-controls [data-action=record-send]').waitFor({timeout:5000});
  check('a compact upload refused after leaving leaves the recording ready to send again',state.soe.length===1&&state.soe[0].audioFormat==='webm');
  await page.locator('#record-controls [data-action=record-send]').click();await until(()=>state.held.length===1,'converted resend in flight');
  env.release();await page.locator('.record-result').waitFor({timeout:15000});await page.waitForTimeout(400);
  check('the resend converts the recording in the browser, then it is scored and saved once',state.soe.length===2&&state.soe[1].audioFormat===null&&(await reading())[0]?.total_score===93&&readingSaves().length===1&&state.uploads.length===1);
 }finally{await env.close();}
}
async function lateScoreReplacesShownResult(){
 const env=await setup(),{page,state,go,record,reading,visibility}=env;try{
  await go('#yong-e/record');await record();await until(()=>state.held.length===1,'first score in flight');
  env.release();await page.locator('.record-result').waitFor({timeout:15000});
  await page.locator('[data-action=record-retry]').click();state.score=88;await record();await until(()=>state.held.length===1,'second score in flight');
  await visibility('hidden');await visibility('visible');
  await page.locator('[data-action=record-feedback]').click();
  check('while the new reading is scored the pupil can open the older result',(await page.locator('.record-result').innerText()).includes('93'));
  env.release();await until(async()=>(await reading())[0]?.total_score===88,'second score saved');
  await page.waitForFunction(()=>document.querySelector('.record-result')?.textContent.includes('88'),null,{timeout:5000}).catch(()=>{});
  check('a score that lands while the older result is open replaces it on screen',(await page.locator('.record-result').innerText()).includes('88')&&state.soe.length===2);
 }finally{await env.close();}
}
async function lateScoreOnReport(){
 const env=await setup(),{page,state,go,record,reading,readingSaves}=env;try{
  const report=async()=>{await page.evaluate(()=>{location.hash='#yong-e/report';});await page.locator('.report-summary').waitFor();};
  const tabs=()=>page.locator('[data-action=score-line]').count();
  await go('#yong-e/record');await record();await until(()=>state.held.length===1,'line 1 score in flight');
  env.release();await page.locator('.record-result').waitFor({timeout:15000});
  await page.locator('[data-action=record-next]').click();state.score=88;await record();await until(()=>state.held.length===1,'line 2 score in flight');
  await report();const before=await tabs();env.release();
  await until(async()=>await tabs()===2,'report redrawn with the late line');
  check('a late score is added to the open report when nothing is playing',before===1&&(await reading())[1]?.total_score===88&&readingSaves(1).length===1);
  // The pupil's own recording keeps "playing" (it never ends) while the next late score lands.
  await page.evaluate(()=>{HTMLMediaElement.prototype.play=function(){setTimeout(()=>this.onplaying?.(),0);return Promise.resolve();};});
  state.score=77;await go('#yong-e/record');await record();await until(()=>state.held.length===1,'re-read score in flight');
  await report();const button=page.locator('.report-line:not([hidden]) [data-action=replay]');await button.click();
  await page.waitForFunction(()=>document.querySelector('.report-line:not([hidden]) [data-action=replay]')?.dataset.audioState==='playing');
  const playing=await button.elementHandle();env.release();
  await until(async()=>(await reading())[1]?.total_score===77,'re-read score saved');await page.waitForTimeout(300);
  check('a late score does not cut off the recording the pupil is listening to on the report',await playing.evaluate(node=>node.isConnected&&node.dataset.audioState==='playing'));
 }finally{await env.close();}
}
async function logoutAbortsScore(){
 const env=await setup(),{page,state,go,record,reading,readingSaves,controls,soeAborted}=env;try{
  await go('#yong-e/record');await record();await until(()=>state.held.length===1,'score request in flight');
  await go('');await page.locator('#profile-open').click();await page.locator('#account-logout').click();
  await until(()=>soeAborted(0),'logout aborts the score request');
  await until(()=>state.logouts===1,'logout request');
  // What the logout upload carried before the sign-out request was made.
  const uploaded=[...state.events.values()],isAbort=event=>event.type==='error'&&event.itemId==='p1.l0'&&event.error?.code==='aborted';
  const closing=Math.max(...uploaded.filter(event=>event.type==='activity_end').map(event=>event.seq));
  check('the aborted score is recorded before the closing span and uploaded with it, ahead of the sign-out',uploaded.filter(isAbort).length===1&&uploaded.find(isAbort).seq<closing);
  await page.waitForFunction(()=>!document.querySelector('#account-logout').disabled);
  env.release();await page.waitForTimeout(600);
  check('logging out aborts the score and nothing is committed for the next pupil',(await reading()).every(line=>!line)&&readingSaves().length===0&&state.uploads.length===0);
  await page.evaluate(()=>document.querySelector('#account-dialog').close());await go('#yong-e/record');
  const kept=await controls();
  check('after a failed logout the kept recording can be sent again',kept.send===1&&state.soe.length===1);
  check('the abort is recorded once (uploaded or still queued)',(await env.researchEvents()).filter(isAbort).length===1);
 }finally{await env.close();}
}
async function otherTabSignOutAbortsScore(){
 const env=await setup(),{page,state,go,record,reading,readingSaves,soeAborted,context}=env;try{
  await go('#yong-e/record');await record();await until(()=>state.held.length===1,'score request in flight');
  await go('');
  const other=await context.newPage();await other.goto(origin+'/blank');
  await other.evaluate(()=>{const channel=new BroadcastChannel('maanshan-school-session');channel.postMessage({kind:'signed-out'});channel.close();});
  await until(()=>soeAborted(0),'session loss aborts the score request');
  env.release();await page.waitForTimeout(600);
  check('signing out in another tab aborts the score and commits nothing',await page.locator('.school-session-expired').isVisible()&&(await reading()).every(line=>!line)&&readingSaves().length===0&&state.uploads.length===0);
 }finally{await env.close();}
}
(async()=>{
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 await leavingKeepsScore();await hiddenPageKeepsScore();await retryHiddenWhileScoring();await refusedCompactResend();await lateScoreReplacesShownResult();await lateScoreOnReport();await logoutAbortsScore();await otherTabSignOutAbortsScore();
 check('no browser exceptions',errors.length===0);
})().catch(error=>{results.push({label:'suite',passed:false,error:error.stack});process.exitCode=1;}).finally(async()=>{await browser?.close();console.log(JSON.stringify({ok:results.every(r=>r.passed),syntheticOnly:true,noProductionRequests:true,checks:results,errors},null,2));});
