'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),origin='https://learning-ui-audit.invalid',evidence=process.env.TEACHER_LEARNING_EVIDENCE_DIR;
const teacher='t_'+'a'.repeat(24),student='s_'+'b'.repeat(24),other='t_'+'c'.repeat(24),epoch='d'.repeat(32),checks=[],errors=[];
const poems=JSON.parse(fs.readFileSync(path.join(repo,'maanshan/poems.json'),'utf8')).poems;
let browser;
function check(label,value){assert(value,label);checks.push({label,passed:true});}
function wave(){const rate=8000,samples=2400,buf=Buffer.alloc(44+samples*2);buf.write('RIFF');buf.writeUInt32LE(buf.length-8,4);buf.write('WAVEfmt ',8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(rate,24);buf.writeUInt32LE(rate*2,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(samples*2,40);return buf;}
const wav=wave();
async function setup({role='teacher',width=390,height=844,progressDelay=false,failReset=false,failTTS=false,serverEpoch='initial'}={}){
 const context=await browser.newContext({viewport:{width,height},isMobile:width<1000,hasTouch:width<1000,serviceWorkers:'block'}),page=await context.newPage();
 const id=role==='teacher'?teacher:student,state={epoch:serverEpoch,requests:[],resets:[],tts:[],releases:[],holdProgress:progressDelay,failReset,authLoads:0};
 const key='maanshan-learning-v2:'+id,pending='ms_pending_sync:'+id;
 await context.addInitScript(({id,other,student,poems})=>{
  if(sessionStorage.getItem('fixture-seeded'))return;sessionStorage.setItem('fixture-seeded','1');
  const progress=Object.fromEntries(poems.map(p=>[p.id,{reading:[{total_score:89,words:[]}],writing:[],chat:[],quiz:[],updatedAt:1,readingVersion:p.readingVersion,pronunciationVersion:p.pronunciationVersion}]));
  localStorage.setItem('maanshan-learning-v2:'+id,JSON.stringify(progress));
  localStorage.setItem('maanshan-learning-v2:'+other,JSON.stringify({untouched:'other-teacher'}));
  if(id!==student)localStorage.setItem('maanshan-learning-v2:'+student,JSON.stringify({untouched:'student'}));
  localStorage.setItem('ms_pending_sync:'+id,JSON.stringify([{syncId:'old-queue',studentId:id,poemId:1,section:'reading',payload:{marker:'old'},learningEpoch:'initial'}]));
 },{id,other,student,poems});
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url()),endpoint=url.pathname.replace(/\/$/,'');
  const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});
  if(endpoint.startsWith('/api/')){
   state.requests.push(endpoint);
   if(endpoint==='/api/school-auth'){
    const body=route.request().method()==='POST'?route.request().postDataJSON():null;
    if(body?.action==='reset_my_progress'){
     state.resets.push({body,csrf:route.request().headers()['x-csrf-token']});
     if(state.failReset)return send({ok:false,code:'AUTH_UNAVAILABLE'},503);
     state.epoch=epoch;return send({ok:true,userId:id,learningEpoch:epoch,resetAt:new Date().toISOString()});
    }
    if(url.searchParams.get('action')==='progress'){
     const captured=state.epoch;
     if(state.holdProgress)await new Promise(resolve=>state.releases.push(resolve));
     return send({enabled:true,userId:id,learningEpoch:captured,poems:captured==='initial'?{1:{reading:{updatedAt:'2026-09-20T12:00:00Z',learningState:{reading:[{total_score:99,words:[]},null,null,null]}}}}:{}});
    }
    state.authLoads++;return send({enabled:true,authenticated:true,user:{id,role,displayName:role==='teacher'?'示範老師':'示範同學',grade:role==='teacher'?null:1,cls:role==='teacher'?null:'A',classNo:1,isTest:role!=='teacher',researchEnabled:false,learningScope:'all-grades'},csrfToken:'synthetic-csrf',...(role==='teacher'?{learningEpoch:state.epoch}:{})});
   }
   if(endpoint==='/api/tts'){
    state.tts.push(route.request().postDataJSON());if(failTTS)return send({error:'synthetic failure'},503);
    return route.fulfill({contentType:'audio/wav',body:wav});
   }
   if(endpoint==='/api/maanshan-save')return send({ok:false,error:'Synthetic pending queue'},503);
   return send({error:'Unexpected provider or research request'},500);
  }
  let relative=url.pathname;if(relative==='/maanshan/')relative+='index.html';
  if(relative.includes('/published/')&&relative.includes('/maanshan/media/'))relative=relative.slice(relative.indexOf('/maanshan/media/'));
  const file=path.resolve(repo,'.'+decodeURIComponent(relative));
  if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
  const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';
  await route.fulfill({contentType:mime,body:fs.readFileSync(file)}).catch(()=>{});
 });
 await page.goto(origin+'/maanshan/',{waitUntil:'domcontentloaded'});await page.locator('.library-shishi').waitFor();
 return{context,page,state,key,pending,id,release(){state.holdProgress=false;state.releases.splice(0).forEach(resolve=>resolve());},async close(){this.release();await context.close();}};
}
async function welcomeChecks(){
 for(const [width,height] of [[320,740],[360,780],[390,844],[768,1024],[1024,768],[1440,900]]){const env=await setup({width,height});try{
  const {page,state}=env;
  await page.evaluate(()=>document.fonts.ready);
  check(width+'px full-body welcome sits directly after the final title character',await page.locator('.library-heading').evaluate(el=>{const text=el.querySelector('.library-title-end').firstChild,range=document.createRange();range.setStart(text,text.textContent.length-1);range.setEnd(text,text.textContent.length);const a=range.getBoundingClientRect(),b=el.querySelector('.library-shishi').getBoundingClientRect(),image=el.querySelector('img'),style=getComputedStyle(image);return b.left-a.right>=0&&b.left-a.right<=8&&a.top>=b.top&&a.bottom<=b.bottom&&b.height>=90&&b.height<=115&&b.width>=60&&b.width<90&&style.objectFit==='contain'&&document.documentElement.scrollWidth<=innerWidth+1;}));
  if(evidence)await page.screenshot({path:path.join(evidence,'library-'+width+'x'+height+'.png')});
  if(width===390){await page.waitForFunction(()=>document.querySelector('.library-shishi-art')?.dataset.gesture==='wave',{},{timeout:9500});check('homepage automatically waves without audio/provider calls',state.tts.length===0);}
  await page.locator('.library-shishi').click();await page.waitForFunction(()=>document.querySelector('.library-shishi-art')?.dataset.gesture==='book');
  check(width+'px click shows a readable guide and never requests speech',state.tts.length===0&&await page.locator('#library-shishi-guide').evaluate(el=>{const b=el.getBoundingClientRect();return el.open&&b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight;}));
  if(evidence)await page.screenshot({path:path.join(evidence,'library-guide-'+width+'x'+height+'.png')});
  await page.locator('.library-guide-done').click();check(width+'px guide closes and returns focus to Shishi',await page.evaluate(()=>!document.querySelector('#library-shishi-guide').open&&document.activeElement===document.querySelector('.library-shishi')));
  await page.locator('.library-shishi').click();await page.keyboard.press('Escape');check(width+'px Escape also closes the guide',!await page.locator('#library-shishi-guide').isVisible());
  await page.locator('.poem-entry').first().click();await page.locator('.lesson-shell').waitFor();check(width+'px routing removes the welcome and guide while keeping the poem guide',await page.locator('.library-shishi,#library-shishi-guide').count()===0&&await page.locator('#shishi-guide-host').count()===1);
  check(width+'px homepage does not open chat or emit student research data',state.requests.every(url=>['/api/school-auth','/api/maanshan-save','/api/school-recordings'].includes(url)));
 }finally{await env.close();}}
}
async function resetChecks(){
 const env=await setup({progressDelay:true});try{
  const {page,state,key,pending}=env;const before=await page.evaluate(key=>localStorage.getItem(key),key);
  await page.locator('#profile-open').click();await page.locator('#account-reset-progress').click();
  check('reset opens an explicit second confirmation with safe default focus',await page.locator('#teacher-reset-dialog').evaluate(el=>el.open&&document.activeElement===el.querySelector('[data-reset-cancel]')));
  await page.locator('[data-reset-cancel]').click();check('cancel makes no reset request and preserves progress',state.resets.length===0&&await page.evaluate(key=>localStorage.getItem(key),key)===before);
  await page.locator('#profile-open').click();await page.locator('#account-reset-progress').click();state.failReset=true;await page.locator('[data-reset-confirm]').click();await page.locator('#teacher-reset-dialog [role=alert]:not([hidden])').waitFor();
  check('server failure preserves own progress and offers retry',await page.evaluate(key=>localStorage.getItem(key),key)===before&&await page.locator('[data-reset-confirm]').isEnabled());
  const failedId=state.resets[0].body.requestId;state.failReset=false;
  const loaded=page.waitForEvent('domcontentloaded');await page.locator('[data-reset-confirm]').click();await loaded;env.release();await page.locator('.library-shishi').waitFor();await page.waitForTimeout(300);
  check('retry uses the same idempotency key and authenticated CSRF without a target account',state.resets.length===2&&state.resets[1].body.requestId===failedId&&state.resets[1].csrf==='synthetic-csrf'&&Object.keys(state.resets[1].body).sort().join(',')==='action,confirm,learningEpoch,requestId');
  const storage=await page.evaluate(({key,pending,teacher,student,other})=>({own:JSON.parse(localStorage.getItem(key)),pending:JSON.parse(localStorage.getItem(pending)),epoch:JSON.parse(localStorage.getItem('ms_learning_epoch:'+teacher)),student:localStorage.getItem('maanshan-learning-v2:'+student),other:localStorage.getItem('maanshan-learning-v2:'+other)}),{key,pending,teacher,student,other});
  check('successful reset clears own six-poem progress and old outbox despite delayed hydration',Object.values(storage.own).every(p=>!(p.reading||[]).some(Boolean))&&storage.pending.length===0&&storage.epoch===epoch);
  check('reset preserves other teachers and pupils on shared devices',storage.student===JSON.stringify({untouched:'student'})&&storage.other===JSON.stringify({untouched:'other-teacher'}));
  check('reset never writes research or teacher class data',state.requests.every(url=>['/api/school-auth','/api/maanshan-save'].includes(url)));
 }finally{await env.close();}
 const pupil=await setup({role:'student'});try{await pupil.page.locator('#profile-open').click();check('student account menu has no teacher progress reset',await pupil.page.locator('#account-reset-progress').count()===0&&await pupil.page.locator('#teacher-reset-dialog').count()===0);}finally{await pupil.close();}
 const stale=await setup({serverEpoch:epoch});try{const data=await stale.page.evaluate(({key,pending})=>({own:JSON.parse(localStorage.getItem(key)),pending:JSON.parse(localStorage.getItem(pending))}),{key:stale.key,pending:stale.pending});check('startup clears stale local epoch before displaying rehydrated progress',Object.values(data.own).every(p=>!(p.reading||[]).some(Boolean))&&data.pending.length===0);}finally{await stale.close();}
 const tabs=await setup();try{
  const {page,context,state,key,pending}=tabs;await page.waitForTimeout(200);const sibling=await context.newPage();await sibling.goto(origin+'/maanshan/');await sibling.locator('.library-shishi').waitFor();state.epoch=epoch;
  const reloaded=page.waitForEvent('domcontentloaded');await sibling.evaluate(({teacher,epoch,key,pending})=>{localStorage.setItem(key,'{}');localStorage.setItem(pending,'[]');localStorage.setItem('ms_learning_epoch:'+teacher,JSON.stringify(epoch));},{teacher,epoch,key,pending});await reloaded;await page.locator('.library-shishi').waitFor();await page.waitForTimeout(150);
  check('another teacher tab reset reloads this tab without restoring its old memory',await page.evaluate(({key,pending})=>Object.values(JSON.parse(localStorage.getItem(key))).every(p=>!(p.reading||[]).some(Boolean))&&JSON.parse(localStorage.getItem(pending)).length===0,{key,pending}));
 }finally{await tabs.close();}
}
async function delayedWelcomeCheck(){
 const env=await setup({progressDelay:true});try{
  for(let n=0;!env.state.releases.length&&n<30;n++)await env.page.waitForTimeout(20);
  check('welcome fixture holds the initial progress request',env.state.releases.length>0);
  await env.page.locator('.library-shishi').click();
  await env.page.locator('#library-shishi-guide[open]').waitFor();
  await env.page.evaluate(()=>window.pendingWelcome=document.querySelector('#library-shishi-guide'));
  const hydrated=env.page.waitForResponse(response=>new URL(response.url()).searchParams.get('action')==='progress');
  env.release();await (await hydrated).finished();await env.page.waitForTimeout(100);
  check('late progress hydration preserves the open guide and its DOM',await env.page.evaluate(()=>pendingWelcome.isConnected&&pendingWelcome.open&&pendingWelcome===document.querySelector('#library-shishi-guide')));
  await env.page.locator('.library-guide-done').click();
  check('the preserved guide still closes normally',!await env.page.locator('#library-shishi-guide').isVisible());
 }finally{await env.close();}
}
(async()=>{if(evidence)fs.mkdirSync(evidence,{recursive:true});browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']});await welcomeChecks();await delayedWelcomeCheck();await resetChecks();check('no browser exceptions',errors.length===0);})().catch(error=>{checks.push({label:'suite',passed:false,error:error.stack});process.exitCode=1;}).finally(async()=>{await browser?.close();const result={ok:checks.every(item=>item.passed),syntheticOnly:true,noProductionRequests:true,checks,errors};if(evidence)fs.writeFileSync(path.join(evidence,'learning-ui-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));});
