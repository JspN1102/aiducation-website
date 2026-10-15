// Weak-word cards after a reading with errors: they turn by swipe, drag, arrows or
// arrow keys; 再讀一次 and 下一句 (and the line arrows) wait until the last card has
// been shown; the choice is logged against the cards shown. A clean reading is unchanged.
// Synthetic pupil and local routes only; no production requests.
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),origin='https://weak-cards.invalid',actor='s_'+'4'.repeat(24);
const results=[],errors=[];
const NOTE='左右滑動看完所有錯字卡，才可以繼續喔',DONE='看完了，可以繼續了';
let browser;
function check(label,value){assert(value,label);results.push({label,passed:true});}
async function until(test,label,timeout=15000){const end=Date.now()+timeout;while(!(await test())){if(Date.now()>end)throw new Error('Timed out: '+label);await new Promise(resolve=>setTimeout(resolve,50));}}
async function setup({progress={},viewport={width:1180,height:820},touch=false}={}){
 const context=await browser.newContext({viewport,hasTouch:touch,serviceWorkers:'block'});
 await context.grantPermissions(['microphone'],{origin});
 const state={soe:0,score:70,weak:[0,1,2],events:new Map(),unexpected:[]};
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),endpoint=url.pathname.replace(/\/$/,''),method=request.method();
  const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});
  if(endpoint.startsWith('/api/')){
   if(endpoint==='/api/school-auth'){
    if(url.searchParams.get('action')==='progress')return send({enabled:true,userId:actor,poems:progress});
    return send({enabled:true,authenticated:true,user:{id:actor,role:'student',displayName:'示範同學',grade:1,cls:'A',classNo:1,isTest:true,learningScope:'all-grades',researchEnabled:true},csrfToken:'synthetic-csrf'});
   }
   if(endpoint==='/api/soe'){
    const body=request.postDataJSON();state.soe++;
    const score=state.score,chars=[...body.refText].filter(c=>/\p{Script=Han}/u.test(c));
    return send({PronAccuracy:score,PronFluency:.95,PronCompletion:1,SuggestedScore:score,Words:chars.map((Word,i)=>({Word,PronAccuracy:state.weak.includes(i)?40:93,PhoneInfos:[]}))});
   }
   if(endpoint==='/api/maanshan-save')return send({ok:true,stored:'db'});
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
 await page.evaluate(()=>{location.hash='#yong-e/record';});await page.locator('#record-controls [data-action=record-start]').waitFor();
 const record=async()=>{
  const before=state.soe;
  await page.locator('#record-controls [data-action=record-start]').click();await page.locator('[data-action=record-stop]').waitFor();
  await page.waitForTimeout(1700);await page.locator('[data-action=record-stop]').click();
  await until(()=>state.soe>before,'score request');
 };
 const tool=page.locator('#record-tool');
 const card=async()=>({heading:(await page.locator('.record-word-heading').innerText()).replace(/\s+/g,' '),retry:await tool.locator('[data-action=record-retry]').isDisabled(),next:await tool.locator('[data-action=record-next]').isDisabled(),
  lineArrow:await page.locator('[data-action=record-step][data-value="1"]').isDisabled(),note:await tool.locator('.record-cards-note').innerText(),dots:await tool.locator('.record-card-dots i').count()});
 const counter=async()=>(await tool.locator('.record-counter').innerText());
 const researchEvents=async()=>{const stored=await page.evaluate(prefix=>Object.keys(localStorage).filter(k=>k.startsWith(prefix)).map(k=>JSON.parse(localStorage.getItem(k))),'maanshan-research-v1:'+actor+':event:');const all=new Map(state.events);for(const event of stored)all.set(event.eventId,event);return [...all.values()];};
 // A sideways drag over the character with the mouse (pointer events).
 const drag=async dx=>{const box=await tool.locator('.record-review').boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();for(let i=1;i<=6;i++)await page.mouse.move(x+dx*i/6,y+i);await page.mouse.up();};
 // A finger swipe (touch events through the browser, so touch-action applies).
 const swipe=async dx=>{
  const box=await tool.locator('.syllable-parts, .record-review').first().boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2,cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/8,y:y+i/2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
 };
 return {context,page,state,record,tool,card,counter,researchEvents,drag,swipe,close:()=>context.close()};
}
async function cardsLockUntilLastThenRetry(){
 const env=await setup(),{page,state,record,tool,card,counter,researchEvents,drag}=env;try{
  await record();await page.locator('.record-word-heading').waitFor();
  let now=await card();
  check('a reading with errors shows the cards with position dots and the hint',now.heading.includes('第 1 / 3 個字')&&now.dots===3&&now.note===NOTE);
  check('再讀一次, 下一句 and the line arrow wait while cards are left',now.retry&&now.next&&now.lineArrow);
  await page.keyboard.press('ArrowRight');
  check('the right arrow key turns to the next card',(await card()).heading.includes('第 2 / 3 個字'));
  await page.locator('#record-art').focus();await page.keyboard.press('ArrowRight');
  check('the painting cannot be turned to the next line while cards are left',(await counter()).includes('第 1 / 4 句'));
  await drag(-160);
  now=await card();
  check('a sideways drag turns to the last card',now.heading.includes('第 3 / 3 個字'));
  check('right after the last card the choices still wait a moment',now.retry&&now.next);
  await drag(160);
  check('dragging the other way goes back a card',(await card()).heading.includes('第 2 / 3 個字'));
  await page.waitForTimeout(450);await tool.locator('[data-action=record-word-step][data-value="1"]').click();
  check('the arrow button turns to the last card',(await card()).heading.includes('第 3 / 3 個字'));
  await page.waitForFunction(()=>!document.querySelector('#record-tool [data-action=record-retry]')?.disabled,null,{timeout:4000});
  now=await card();
  check('once the last card has been shown both choices and the line arrow open, and the hint changes',!now.retry&&!now.next&&!now.lineArrow&&now.note===DONE);
  await tool.locator('[data-action=record-word-step][data-value="-1"]').click();
  check('going back to an earlier card keeps the choices open',!(await card()).retry);
  await tool.locator('[data-action=record-retry]').click();
  check('再讀一次 goes back to reading the same line',await tool.locator('#record-controls [data-action=record-start]').isVisible()&&(await counter()).includes('第 1 / 4 句')&&await tool.getAttribute('data-step')==='read');
  const events=await researchEvents(),shown=events.find(e=>e.type==='item_presented'&&e.itemId==='p1.l0.cards'),chosen=events.filter(e=>e.type==='answer_submitted'&&e.itemId==='p1.l0.cards');
  check('the card order is still logged when the cards are shown',shown&&/^order-(position|tonefirst)$/.test(shown.response.choiceId)&&JSON.stringify([...shown.context.optionOrder].sort())==='["c0","c1","c2"]');
  check('the choice is logged once with the cards viewed, the card count and the time',chosen.length===1&&chosen[0].response.choiceId==='retry'&&chosen[0].context.position===3&&chosen[0].context.total===3&&chosen[0].attemptId===shown.attemptId&&Number.isInteger(chosen[0].metrics?.elapsedMs)&&chosen[0].result.score===null);
  check('no unexpected requests',state.unexpected.length===0);
 }finally{await env.close();}
}
async function swipeThenNext(){
 const env=await setup({viewport:{width:820,height:1180},touch:true}),{page,record,tool,card,counter,researchEvents,swipe}=env;try{
  await record();await page.locator('.record-word-heading').waitFor();
  await swipe(-170);
  check('a finger swipe to the left turns to the next card',(await card()).heading.includes('第 2 / 3 個字'));
  await swipe(-170);
  check('a second swipe reaches the last card',(await card()).heading.includes('第 3 / 3 個字'));
  await page.waitForFunction(()=>!document.querySelector('#record-tool [data-action=record-next]')?.disabled,null,{timeout:4000});
  await tool.locator('[data-action=record-next]').click();
  check('下一句 goes on to the next line',(await counter()).includes('第 2 / 4 句')&&await tool.getAttribute('data-step')==='read');
  const chosen=(await researchEvents()).filter(e=>e.type==='answer_submitted'&&e.itemId==='p1.l0.cards');
  check('下一句 is logged as next',chosen.length===1&&chosen[0].response.choiceId==='next'&&chosen[0].context.position===3);
 }finally{await env.close();}
}
async function oneCardOpensByItself(){
 const env=await setup({viewport:{width:390,height:844},touch:true}),{page,state,record,card}=env;try{
  state.weak=[1];await record();await page.locator('.record-word-heading').waitFor();
  const first=await card();
  check('a single card shows 1 / 1 with its own hint and the choices waiting',first.heading.includes('第 1 / 1 個字')&&first.retry&&first.next&&first.note.includes('才可以繼續'));
  await page.waitForTimeout(1800);
  const later=await card();
  check('a single card counts as seen after a moment',!later.retry&&!later.next&&later.note===DONE);
 }finally{await env.close();}
}
async function cleanReadingUnchanged(){
 const env=await setup(),{page,state,record,tool,counter,researchEvents}=env;try{
  state.score=93;state.weak=[];await record();await page.locator('.record-result').waitFor();
  check('a reading without errors shows the score with both choices ready and no cards',await tool.locator('.record-word-heading').count()===0&&!(await tool.locator('[data-action=record-retry]').isDisabled())&&!(await tool.locator('[data-action=record-next]').isDisabled())&&!(await page.locator('[data-action=record-step][data-value="1"]').isDisabled()));
  await tool.locator('[data-action=record-next]').click();
  check('下一句 goes on to the next line',(await counter()).includes('第 2 / 4 句'));
  check('nothing about cards is logged',(await researchEvents()).every(e=>!String(e.itemId).endsWith('.cards')));
 }finally{await env.close();}
}
async function selfCheckFirst(){
 // The self-check opens when the recording stops; the cards scored behind it wait until it is closed.
 const env=await setup({progress:{1:{reading:{updatedAt:new Date(Date.now()+60000).toISOString(),learningState:{selfCheck:{reads:7,checks:0,gifts:0}}}}}}),{page,state,record,card}=env;try{
  await page.waitForTimeout(800);state.weak=[1];await record();
  const dialog=page.locator('dialog.self-check');await dialog.waitFor();await page.locator('.record-word-heading').waitFor({state:'attached'});
  await page.waitForTimeout(1900);
  check('the cards do not count as seen while the self-check covers them',(await card()).retry);
  await dialog.locator('[data-self-check=good]').click();await dialog.locator('[data-self-check=close]').click();
  await until(async()=>await dialog.count()===0,'self-check closed');
  check('after the self-check the cards still wait',(await card()).retry);
  await page.waitForFunction(()=>!document.querySelector('#record-tool [data-action=record-retry]')?.disabled,null,{timeout:4000});
  check('then the choices open once the card has been shown',!(await card()).next);
 }finally{await env.close();}
}
(async()=>{
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 await cardsLockUntilLastThenRetry();await swipeThenNext();await oneCardOpensByItself();await cleanReadingUnchanged();await selfCheckFirst();
 check('no browser exceptions',errors.length===0);
})().catch(error=>{results.push({label:'suite',passed:false,error:error.stack});process.exitCode=1;}).finally(async()=>{await browser?.close();console.log(JSON.stringify({ok:results.every(r=>r.passed),syntheticOnly:true,noProductionRequests:true,checks:results,errors},null,1));});
