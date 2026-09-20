'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),origin='https://recording-fixture.invalid',actor='s_'+'1'.repeat(24),other='s_'+'2'.repeat(24);
function wav(){const b=Buffer.alloc(16044);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
const html=`<!doctype html><html><body><button id="play">Play private recording</button><script type="module">
import {createRecordingLibrary,createRecordingQueue} from '/maanshan/recording-library.mjs';
window.queue=createRecordingQueue();window.uploads=[];window.failUploads=true;
window.make=async(actor,epoch)=>{window.library?.stop();window.actor=actor;window.library=createRecordingLibrary({enabled:true,actorId:actor,learningEpoch:epoch,storage:window.queue,fetch:async(url,options={})=>{if(options.method==='POST'){window.uploads.push(JSON.parse(options.body));if(window.failUploads)throw new TypeError('Offline');}return fetch(url,options);}});await window.library.hydrate();};
document.querySelector('#play').onclick=()=>{const source=window.library.source('1-0');window.audio=new Audio(typeof source==='string'?source:URL.createObjectURL(source));window.audio.onended=()=>window.finished=true;window.audio.onerror=()=>window.playError='media-error-'+window.audio.error?.code;window.audio.play().catch(error=>window.playError=error.name+': '+error.message);};
window.ready=true;</script></body></html>`;
(async()=>{
 const poem=JSON.parse(fs.readFileSync(path.join(repo,'maanshan/poems.json'),'utf8')).poems[0];
 const {mapAssessment}=await import('../maanshan/core.mjs');
 const result=mapAssessment({SuggestedScore:83,PronAccuracy:83,PronFluency:.9,PronCompletion:1,Words:[...poem.lines[0].simplified].map(Word=>({Word,PronAccuracy:83}))},poem.lines[0]);
 const useWebkit=process.env.RECORDING_BROWSER==='webkit';
 const browser=await (useWebkit?webkit:chromium).launch({...(useWebkit?{}:{channel:'msedge'}),headless:true}),context=await browser.newContext({serviceWorkers:'block',...(useWebkit?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{})}),page=await context.newPage(),rows=new Map(),requests=[],errors=[],checks=[];
 let failRecordingUpload=false;
 await context.addInitScript(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(window.__denyRecordingPut&&this.transaction.db.name==='maanshan-private-recordings-v1')throw new DOMException('Synthetic full disk','QuotaExceededError');return put.apply(this,args);};});
 page.on('pageerror',e=>errors.push(e.message));const check=(name,value)=>{assert(value,name);checks.push({name,passed:true});};
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/fixture')return route.fulfill({contentType:'text/html',body:html});
  if(url.pathname==='/maanshan/recording-library.mjs')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(repo,'maanshan/recording-library.mjs'))});
  if(url.pathname.replace(/\/$/,'')==='/api/school-auth'){
   const data=url.searchParams.get('action')==='progress'?{enabled:true,userId:actor,poems:{1:{reading:{updatedAt:new Date().toISOString(),learningState:{reading:[result,null,null,null]}}}}}:
    {enabled:true,authenticated:true,user:{id:actor,role:'student',displayName:'Synthetic pupil',grade:1,cls:'A',classNo:1,isTest:true,researchEnabled:false,learningScope:'own-grade'},csrfToken:'synthetic-csrf'};
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  }
  if(url.pathname.replace(/\/$/,'')==='/api/maanshan-save')return route.fulfill({contentType:'application/json',body:'{"ok":true}'});
  if(url.pathname==='/api/school-recordings/'){
   requests.push({method:route.request().method(),url:url.toString()});
   const identity=url.searchParams.get('actorId'),epoch=url.searchParams.get('learningEpoch')||'student';
   if(route.request().method()==='POST'){if(failRecordingUpload)return route.abort('failed');const item=route.request().postDataJSON(),key=item.actorId+':'+(item.learningEpoch||'student');rows.set(key,{...item});delete rows.get(key).audio;return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,userId:item.actorId,recording:rows.get(key)})});}
   if(url.searchParams.get('action')==='audio')return route.fulfill({contentType:'audio/wav',body:wav()});
   return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,userId:identity,recordings:rows.has(identity+':'+epoch)?[rows.get(identity+':'+epoch)]:[]})});
  }
  let relative=url.pathname;if(relative==='/maanshan/')relative+='index.html';
  if(relative.includes('/published/')&&relative.includes('/maanshan/media/'))relative=relative.slice(relative.indexOf('/maanshan/media/'));
  const file=path.resolve(repo,'.'+decodeURIComponent(relative));
  if(file.startsWith(repo+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()){
   const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';
   const body=fs.readFileSync(file);return route.fulfill({contentType:mime,body:relative==='/maanshan/app.js'?Buffer.concat([body,Buffer.from('\nwindow.__recordingAudit={library:recordings,openProfile};')]):body});
  }
  return route.fulfill({status:404,body:''});
 });
 try{
  const id=crypto.randomUUID(),item={poemId:1,lineIndex:0,recordingId:id,recordedAt:Date.now(),audio:wav().toString('base64')};
  await page.goto(origin+'/fixture');await page.waitForFunction(()=>window.ready);await page.evaluate(a=>window.make(a),actor);
  await page.evaluate(async item=>{await window.library.save(item);await window.library.flush();},item);
  check('real IndexedDB contains one failed upload',await page.evaluate(async a=>(await window.queue.list(a+':student')).length===1,actor));
  await page.reload();await page.waitForFunction(()=>window.ready);await page.evaluate(a=>window.make(a),actor);
  check('refresh restores playable WAV from IndexedDB while offline',await page.evaluate(()=>window.library.source('1-0') instanceof Blob));
  await page.locator('#play').click();await page.waitForFunction(()=>window.finished||window.playError);assert.equal(await page.evaluate(()=>window.playError),undefined,'pending WAV playback');check('restored pending audio actually plays',true);
  await page.evaluate(async()=>{window.failUploads=false;await window.library.flush();});
  check('reconnected upload is acknowledged and local queue removed',await page.evaluate(async a=>(await window.queue.list(a+':student')).length===0,actor));
  await page.reload();await page.waitForFunction(()=>window.ready);await page.evaluate(a=>window.make(a),actor);
  check('refresh recovers private server source after queue removal',await page.evaluate(()=>typeof window.library.source('1-0')==='string'));
  await page.locator('#play').click();await page.waitForFunction(()=>window.finished);check('authenticated server URL actually plays WAV',requests.some(r=>r.url.includes('action=audio'))&&await page.evaluate(()=>!window.playError));
  await page.evaluate(a=>window.make(a),other);check('switching accounts cannot recover the previous recording',await page.evaluate(()=>!window.library.has('1-0')));
  await page.evaluate(({a,e})=>window.make(a,e),{a:actor,e:'a'.repeat(32)});check('reset generation cannot recover earlier audio',await page.evaluate(()=>!window.library.has('1-0')));
  // Acknowledgement of an old upload must not delete a newer local pending row.
  await page.evaluate(async({item,a})=>{const s=a+':student';await window.queue.put(s,item);await window.queue.put(s,{...item,recordingId:crypto.randomUUID(),recordedAt:item.recordedAt+1});await window.queue.remove(s,item);}, {item,a:actor});
  check('old acknowledgement preserves newer queued recording',await page.evaluate(async a=>(await window.queue.list(a+':student')).length===1,actor));
  await page.evaluate(async a=>{for(const row of await window.queue.list(a+':student'))await window.queue.remove(a+':student',row.item);},actor);
  await page.goto(origin+'/maanshan/#yong-e/report');
  await page.waitForFunction(()=>document.querySelector('.report-line-actions [data-action="replay"]:not([disabled])'));
  check('actual report restores remote scores and enables the single own-reading button',(await page.locator('.report-line-actions [data-action="replay"]').count())===1&&await page.locator('.score-ring strong').innerText()==='83');
  await page.locator('.report-line-actions [data-action="replay"]').click();
  await page.waitForFunction(()=>document.querySelector('.report-line-actions [data-action="replay"]')?.getAttribute('aria-pressed')==='false');
  check('actual report plays server recording without a reload-only warning',!(await page.locator('#toast').innerText()).includes('無法播放'));
  await page.reload();await page.waitForFunction(()=>document.querySelector('.report-line-actions [data-action="replay"]:not([disabled])'));
  check('actual report replay remains available after page reload',await page.locator('.report-line-actions [data-action="replay"]').isEnabled());
  failRecordingUpload=true;
  await page.evaluate(async item=>{await window.__recordingAudit.library.save(item);await window.__recordingAudit.library.flush();window.__recordingAudit.openProfile();},{...item,recordingId:crypto.randomUUID(),recordedAt:Date.now()+100});
  check('actual profile keeps offline recording upload visible',await page.locator('#school-record-sync').isVisible()&&await page.evaluate(()=>window.__recordingAudit.library.status().pending===1));
  failRecordingUpload=false;await page.locator('#school-record-sync button').click();
  await page.waitForFunction(()=>document.querySelector('#school-record-sync').hidden);
  check('manual retry uploads audio and only acknowledged completion hides the status',await page.evaluate(()=>window.__recordingAudit.library.pendingCount()===0));
  await page.locator('[data-close="profile-dialog"]').click();failRecordingUpload=true;
  await page.evaluate(async item=>{window.__denyRecordingPut=true;await window.__recordingAudit.library.save(item);await window.__recordingAudit.library.flush();},{...item,recordingId:crypto.randomUUID(),recordedAt:Date.now()+200});
  check('failed IndexedDB and network keep a persistent visible recording warning',await page.locator('#recording-save-warning').isVisible()&&(await page.locator('#recording-save-warning').innerText()).includes('錄音尚未保存，請保留本頁'));
  await page.evaluate(()=>{window.__denyRecordingPut=false;});await page.locator('#recording-save-warning button').click();
  await page.waitForFunction(()=>window.__recordingAudit.library.status().volatile===0&&!window.__recordingAudit.library.status().syncing);
  check('retry restores real IndexedDB before network recovery without claiming upload completion',await page.evaluate(async a=>{const {createRecordingQueue}=await import('/maanshan/recording-library.mjs');return (await createRecordingQueue().list(a+':student')).length===1&&window.__recordingAudit.library.status().pending===1;},actor));
  await page.evaluate(()=>window.__recordingAudit.openProfile());failRecordingUpload=false;await page.locator('#school-record-sync button').click();
  await page.waitForFunction(()=>document.querySelector('#school-record-sync').hidden);
  check('recovered upload removes local outbox and clears the warning',await page.evaluate(async a=>{const {createRecordingQueue}=await import('/maanshan/recording-library.mjs');return (await createRecordingQueue().list(a+':student')).length===0&&document.querySelector('#recording-save-warning').hidden;},actor));
  assert.deepEqual(errors,[],'browser page errors');check('no page errors',true);
  const evidence=process.env.RECORDING_EVIDENCE_DIR;if(evidence){fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({checks,errors,browser:useWebkit?'webkit-mobile-emulation':'edge',syntheticOnly:true,paidProviderCalls:0},null,2));}
  console.log(JSON.stringify({ok:true,checks:checks.length,errors,browser:useWebkit?'webkit-mobile-emulation':'edge',syntheticOnly:true,paidProviderCalls:0}));
 }finally{await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
