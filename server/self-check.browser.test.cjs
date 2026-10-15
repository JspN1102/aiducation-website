// 輕量自查 (school69): every 8 recordings of a poem, any lines in any mix, open the
// self-check; the n-th painting given is the poem's n-th line (round and round),
// 跳過 gives none, the count travels with the poem's progress, and the card order is logged.
// Synthetic pupil and local routes only; no production requests.
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),origin='https://self-check.invalid',actor='s_'+'6'.repeat(24);
const storeKey='maanshan-learning-v2:'+actor,results=[],errors=[];
let browser;
function check(label,value){assert(value,label);results.push({label,passed:true});}
async function until(test,label,timeout=15000){const end=Date.now()+timeout;while(!(await test())){if(Date.now()>end)throw new Error('Timed out: '+label);await new Promise(resolve=>setTimeout(resolve,50));}}
async function setup({progress={}}={}){
 const context=await browser.newContext({viewport:{width:1180,height:820},serviceWorkers:'block'});
 await context.grantPermissions(['microphone'],{origin});
 const state={soe:[],held:[],hold:false,score:93,weak:null,saves:[],events:new Map(),unexpected:[]};
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),endpoint=url.pathname.replace(/\/$/,''),method=request.method();
  const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});
  if(endpoint.startsWith('/api/')){
   if(endpoint==='/api/school-auth'){
    if(url.searchParams.get('action')==='progress')return send({enabled:true,userId:actor,poems:progress});
    return send({enabled:true,authenticated:true,user:{id:actor,role:'student',displayName:'示範同學',grade:1,cls:'A',classNo:1,isTest:true,learningScope:'all-grades',researchEnabled:true},csrfToken:'synthetic-csrf'});
   }
   if(endpoint==='/api/soe'){
    const body=request.postDataJSON();state.soe.push(body.refText);
    if(state.hold)await new Promise(resolve=>state.held.push(resolve));
    const score=state.score,chars=[...body.refText].filter(c=>/\p{Script=Han}/u.test(c));
    return send({PronAccuracy:score,PronFluency:.95,PronCompletion:1,SuggestedScore:score,Words:chars.map((Word,i)=>({Word,PronAccuracy:state.weak?.includes(i)?40:score,PhoneInfos:[]}))});
   }
   if(endpoint==='/api/maanshan-save'){state.saves.push(request.postDataJSON());return send({ok:true,stored:'db'});}
   if(endpoint==='/api/school-recordings'){
    if(method==='POST'){const {audio,...recording}=request.postDataJSON();return send({ok:true,userId:actor,recording});}
    return send({ok:true,userId:actor,recordings:[]});
   }
   if(endpoint==='/api/research-events'){const body=request.postDataJSON();for(const event of body.events)state.events.set(event.eventId,event);return send({accepted:true,batchId:body.batchId,eventIds:body.events.map(event=>event.eventId)});}
   if(endpoint==='/api/tts')return send({error:'offline'},503);
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
 const go=async hash=>{await page.evaluate(value=>{location.hash=value;},hash);await page.locator('#record-controls').waitFor();};
 const line=()=>page.evaluate(()=>Number(document.querySelector('.record-counter span')?.textContent.match(/第 (\d+)/)?.[1])-1);
 // Read the shown line for ms milliseconds; returns once the score is in (unless held).
 const record=async(ms=1700)=>{
  const before=state.soe.length;
  await page.locator('#record-controls [data-action=record-start]').click();await page.locator('[data-action=record-stop]').waitFor();
  await page.waitForTimeout(ms);await page.locator('[data-action=record-stop]').click();
  await until(()=>state.soe.length>before,'score request');
  if(!state.hold)await page.locator('[data-action=record-retry], .record-word-heading').first().waitFor();
 };
 // Move to a line through the arrows under the painting.
 const toLine=async target=>{
  if(await page.locator('[data-action=record-retry]').count())await page.locator('[data-action=record-retry]').click();
  while((await line())!==target){await page.locator(`[data-action=record-step][data-value="${(await line())<target?1:-1}"]`).click();}
  await page.locator('#record-controls [data-action=record-start]').waitFor();
 };
 const counter=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'{}')[1]?.selfCheck||null,storeKey);
 const researchEvents=async()=>{const stored=await page.evaluate(prefix=>Object.keys(localStorage).filter(k=>k.startsWith(prefix)).map(k=>JSON.parse(localStorage.getItem(k))),'maanshan-research-v1:'+actor+':event:');const all=new Map(state.events);for(const event of stored)all.set(event.eventId,event);return [...all.values()];};
 return {context,page,state,go,record,toLine,line,counter,researchEvents,release:()=>state.held.splice(0).forEach(resolve=>resolve()),close:async()=>{state.held.splice(0).forEach(resolve=>resolve());await context.close();}};
}
const dialog=page=>page.locator('dialog.self-check');
async function eighthRecordingOpensWithPictureByTurn(){
 const env=await setup(),{page,state,go,record,toLine,counter,researchEvents}=env;try{
  await go('#yong-e/record');
  // Seven recordings over different lines, plus one too short to count.
  for(const target of [0,1,2,3,0,0,2]){await toLine(target);await record();}
  await toLine(1);await record(600);
  check('seven readings over mixed lines do not open it, and a very short one does not count',await dialog(page).count()===0&&JSON.stringify(await counter())==='{"reads":7,"checks":0,"gifts":0}');
  check('the count goes out with the poem progress',state.saves.filter(s=>s.section==='reading'&&s.poemId===1).at(-1)?.payload?.learningState?.selfCheck?.reads===7);
  await toLine(3);state.hold=true;await record();
  await dialog(page).waitFor();
  const tiles=dialog(page).locator('.self-check-tile');
  check('the eighth reading opens the self-check for the line just read',await tiles.count()===5&&(await tiles.allInnerTexts()).map(t=>t.replace(/\s|[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/g,'')).join('')==='紅掌撥清波');
  check('it asks the agreed question',(await dialog(page).locator('h2').innerText()).includes('你覺得你哪個字讀得不好？點一點。'));
  const done=dialog(page).locator('[data-self-check=done]'),good=dialog(page).locator('[data-self-check=good]');
  const skip=dialog(page).locator('[data-self-check=skip]');
  check('both answers and the small 跳過 are there but wait a moment before they can be pressed',await done.isDisabled()&&await good.isDisabled()&&await skip.isVisible()&&await skip.isDisabled());
  await page.waitForTimeout(1700);
  check('then 全部都讀得好 works and 點好了 waits for a tap',await good.isEnabled()&&await done.isDisabled());
  await tiles.nth(1).click();await tiles.nth(4).click();await tiles.nth(4).click();await tiles.nth(2).click();
  check('tapping again takes a character back off',(await done.innerText()).includes('2 個')&&await done.isEnabled()&&await tiles.nth(4).getAttribute('aria-pressed')==='false');
  await done.click();
  const picture=dialog(page).locator('.self-check-picture img');await picture.waitFor();
  check('the first time for this poem shows the first line painting, whichever line was read',(await picture.getAttribute('src')).includes('media/selfcheck-v2/p1-l1.webp')&&(await dialog(page).locator('figcaption').innerText())==='鵝鵝鵝');
  check('while the score is pending Shishi is listening and no score is shown',(await dialog(page).locator('.self-check-listen').count())===1&&!(await page.locator('.record-result').isVisible().catch(()=>false)));
  env.release();
  const back=dialog(page).locator('[data-self-check=close]');await back.waitFor();
  check('once scored the pupil can go and see the line',(await back.innerText()).includes('看看這句成果'));
  await back.click();await until(async()=>await dialog(page).count()===0,'dialog closed');
  check('the count restarts and the turn is kept',JSON.stringify(await counter())==='{"reads":0,"checks":1,"gifts":1}');
  await until(()=>state.saves.some(s=>s.section==='reading'&&s.payload?.learningState?.selfCheck?.gifts===1),'turn saved');
  const answer=(await researchEvents()).find(e=>e.type==='answer_submitted'&&e.itemId==='p1.l3.selfcheck');
  check('the answer is recorded: tapped characters, the turn, no score',answer&&answer.response.choiceId==='tapped'&&JSON.stringify(answer.response.placements)==='[{"slotId":"c1","choiceId":"tapped"},{"slotId":"c2","choiceId":"tapped"}]'&&answer.result.status==='completed'&&answer.result.score===null&&answer.context.position===1&&answer.context.total===4&&answer.metrics.selectionChanges===4);
  // The next turn shows the second line painting, even after 全部都讀得好.
  state.hold=false;
  for(let i=0;i<7;i++){await toLine(i%4);await record();}
  await toLine(0);await record();
  await dialog(page).waitFor();await page.waitForTimeout(1700);await dialog(page).locator('[data-self-check=good]').click();
  check('the second time shows the second line painting',(await dialog(page).locator('.self-check-picture img').getAttribute('src')).includes('p1-l2.webp')&&(await dialog(page).locator('figcaption').innerText())==='曲項向天歌');
  await dialog(page).locator('[data-self-check=close]').click();await until(async()=>await dialog(page).count()===0,'dialog closed');
  const none=(await researchEvents()).find(e=>e.type==='answer_submitted'&&e.itemId==='p1.l0.selfcheck');
  check('全部都讀得好 is recorded as none',none?.response.choiceId==='none'&&!none.response.placements&&none.context.position===2);
 }finally{await env.close();}
}
async function countFollowsThePupil(){
 // Another device already gave four paintings and seven readings: the next reading is the 5th turn, back to line 1.
 const env=await setup({progress:{1:{reading:{updatedAt:new Date(Date.now()+60000).toISOString(),learningState:{selfCheck:{reads:7,gifts:4}}}}}}),{page,go,record,counter,researchEvents}=env;try{
  await page.waitForTimeout(800);await go('#yong-e/record');
  check('the count from the other device is restored',JSON.stringify(await counter())==='{"reads":7,"checks":4,"gifts":4}');
  await record();await dialog(page).waitFor();
  await page.waitForTimeout(1700);await dialog(page).locator('[data-self-check=good]').click();
  check('the fifth time goes back to the first line painting',(await dialog(page).locator('.self-check-picture img').getAttribute('src')).includes('p1-l1.webp'));
  await dialog(page).locator('[data-self-check=close]').click();
  check('the turn number keeps counting',(await researchEvents()).find(e=>e.itemId==='p1.l0.selfcheck')?.context.position===5);
 }finally{await env.close();}
}
async function skipGivesNoPicture(){
 const env=await setup({progress:{1:{reading:{updatedAt:new Date(Date.now()+60000).toISOString(),learningState:{selfCheck:{reads:7,checks:0,gifts:0}}}}}}),{page,state,go,record,toLine,counter,researchEvents}=env;try{
  await page.waitForTimeout(800);await go('#yong-e/record');await record();await dialog(page).waitFor();
  await page.waitForTimeout(1700);await dialog(page).locator('[data-self-check=skip]').click();
  await until(async()=>await dialog(page).count()===0,'跳過 closes it');
  const skipped=(await researchEvents()).find(e=>e.itemId==='p1.l0.selfcheck');
  check('跳過 closes at once with no painting, recorded as skipped with no score',skipped?.response.choiceId==='skipped'&&skipped.result.status==='skipped'&&skipped.result.score===null&&JSON.stringify(await counter())==='{"reads":0,"checks":1,"gifts":0}');
  for(let i=0;i<7;i++){await toLine(i%4);await record();}
  await toLine(1);await record();await dialog(page).waitFor();
  await page.waitForTimeout(1700);await dialog(page).locator('[data-self-check=good]').click();
  check('the painting not given waits for the next time',(await dialog(page).locator('.self-check-picture img').getAttribute('src')).includes('p1-l1.webp'));
  await dialog(page).locator('[data-self-check=close]').click();
  check('the turn number still counts the skipped time',(await researchEvents()).find(e=>e.itemId==='p1.l1.selfcheck')?.context.position===2);
  await until(()=>state.saves.some(s=>s.section==='reading'&&s.payload?.learningState?.selfCheck?.gifts===1),'painting saved');
 }finally{await env.close();}
}
async function leavingSkips(){
 const env=await setup({progress:{1:{reading:{updatedAt:new Date(Date.now()+60000).toISOString(),learningState:{selfCheck:{reads:7,gifts:0}}}}}}),{page,state,go,record,counter,researchEvents}=env;try{
  await page.waitForTimeout(800);await go('#yong-e/record');state.hold=true;await record();await dialog(page).waitFor();
  await page.evaluate(()=>location.hash='');await until(async()=>await dialog(page).count()===0,'leaving closes it');
  const skipped=(await researchEvents()).find(e=>e.itemId==='p1.l0.selfcheck');
  check('leaving the page records a skip and gives no painting',skipped?.response.choiceId==='skipped'&&(await counter()).gifts===0);
 }finally{await env.close();}
}
async function cardOrderIsLogged(){
 const env=await setup(),{page,state,go,record,researchEvents}=env;try{
  await go('#yong-e/record');state.score=70;state.weak=[0,2];await record();
  const cards=(await researchEvents()).filter(e=>e.type==='item_presented'&&e.itemId==='p1.l0.cards');
  check('the cards shown and their order are logged once',cards.length===1&&['order-position','order-tonefirst'].includes(cards[0].response.choiceId)&&cards[0].context.lineIndex===0&&Array.isArray(cards[0].context.optionOrder)&&cards[0].context.optionOrder.every(id=>/^c\d+$/.test(id)));
  const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key))[1].reading[0].recordingId,storeKey);
  const arm=/^[0-9a-f]$/i.test(String(stored).slice(-1))&&parseInt(String(stored).slice(-1),16)%2?'order-tonefirst':'order-position';
  check('the order follows the recording id',cards[0].response.choiceId===arm);
  check('no unexpected requests',state.unexpected.length===0);
 }finally{await env.close();}
}
(async()=>{
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 await eighthRecordingOpensWithPictureByTurn();await countFollowsThePupil();await skipGivesNoPicture();await leavingSkips();await cardOrderIsLogged();
 check('no browser exceptions',errors.length===0);
})().catch(error=>{results.push({label:'suite',passed:false,error:error.stack});process.exitCode=1;}).finally(async()=>{await browser?.close();console.log(JSON.stringify({ok:results.every(r=>r.passed),syntheticOnly:true,noProductionRequests:true,checks:results},null,1));});
