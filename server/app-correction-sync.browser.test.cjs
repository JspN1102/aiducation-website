'use strict';
// Real bootstrap/app/quiz/sync queue with synthetic, fully intercepted APIs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),checks=[];
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
const check=(label,pass)=>{assert(pass,label);checks.push(label);};
const {finishLearning}=require('./dictation-test-learning.cjs');
// Since guided tracing (759a572) a dictation opens with the stroke demonstration and tracing.
// As in dictation-test-learning.cjs, the served library is sped up and its tracing quiz is
// completed synthetically; the real app loads it itself, so the patch rides on the vendor file.
const learningPatch=`;(()=>{const library=window.HanziWriter;if(!library||library.__dictationFixture)return;library.__dictationFixture=true;const create=library.create.bind(library);
library.create=(holder,character,options)=>{const writer=create(holder,character,{...options,strokeAnimationSpeed:50,delayBetweenStrokes:0}),quiz=writer.quiz.bind(writer);
writer.quiz=(options={})=>{window.__completeTracing=()=>options.onComplete?.({character,totalMistakes:0});return quiz(options);};return writer;};})();`;
async function draw(page){const canvas=page.locator('.cw-board canvas');await canvas.scrollIntoViewIfNeeded();const b=await canvas.boundingBox();await page.mouse.move(b.x+b.width*.25,b.y+b.height*.35);await page.mouse.down();await page.mouse.move(b.x+b.width*.73,b.y+b.height*.65,{steps:8});await page.mouse.up();}
(async()=>{
 const [{newAttempt,attemptItems,recordAnswer},{CHALLENGE_SETS}]=await Promise.all([import('../maanshan/challenge-state.mjs'),import('../maanshan/challenge-data.mjs')]);
 const set=CHALLENGE_SETS['zao-chun'],saved=newAttempt(set,{seed:'app-correction-upload'}),items=attemptItems(saved,set),index=items.findIndex(item=>item.type==='dictation'),item=items[index];
 for(let i=0;i<index;i++)recordAnswer(saved,set,i,{status:items[i].type==='microgame'?'skipped':'correct'});saved.cursor=index;
 for(const engine of ['chromium','webkit']){
  const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true}),page=await context.newPage(),saves=[],answers=[],handwriting=[],errors=[];
  let nextCandidate='口',strokeDataGone=false;page.on('pageerror',error=>errors.push(error.message));
  try{
   await context.addInitScript(({saved})=>{const key='maanshan-learning-v2:s_app_correction';if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({6:{challenge:saved,updatedAt:1}}));},{saved});
   await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname.startsWith('/api/')){
     let data={ok:true,researchRecorded:true},body;try{body=request.postDataJSON();}catch{}
     if(url.pathname.includes('school-auth'))data=url.searchParams.get('action')==='progress'?{enabled:true,userId:'s_app_correction',poems:{}}:{enabled:true,authenticated:true,user:{id:'s_app_correction',displayName:'Synthetic Learner',role:'student',grade:6,cls:'A',researchEnabled:true},csrfToken:'synthetic'};
     else if(url.pathname.includes('handwriting')){handwriting.push(body);data={candidates:[nextCandidate],researchRecorded:true};}
     else if(url.pathname.includes('maanshan-save')){saves.push(body);data={ok:true,stored:'db'};}
     else if(url.pathname.includes('challenge-result'))answers.push(body);
     return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    }
    let relative=url.pathname.replace(/^\/(school|maanshan)\//,'');if(!relative)relative='index.html';
    const file=path.resolve(root,'maanshan',decodeURIComponent(relative));
    // After tracing, per-character stroke data is withheld so the school64 neatness check has no
    // verdict (it then passes, as offline): this suite's one-line ink tests correction sync, not neatness.
    if(strokeDataGone&&url.pathname.includes('/vendor/hanzi-data/'))return route.fulfill({status:404,body:''});
    if(!file.startsWith(path.join(root,'maanshan')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
    const ext=path.extname(file);let body=fs.readFileSync(file);if(['.mjs','.js','.html','.json','.css'].includes(ext))body=Buffer.from(body.toString('utf8').replace(/(["'`])\/maanshan\//g,'$1/school/')+(file.endsWith('hanzi-writer.min.js')?learningPatch:''));
    return route.fulfill({contentType:types[ext]||'application/octet-stream',body}).catch(()=>{});
   });
   await page.goto('https://app-correction.invalid/school/#zao-chun/quiz');await page.locator('.cw-board').waitFor();
   await finishLearning(page);
   // Finishing the tracing is itself recorded once (trace-dictation-v1): one completed result and one save.
   for(let i=0;i<200&&!(saves.length&&answers.length);i++)await page.waitForTimeout(50);
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('ms_pending_sync:s_app_correction')||'[]').length===0);await page.waitForTimeout(100);
   check(engine+' tracing completion is recorded once before the answer',saves.length===1&&answers.length===1&&answers[0].itemId===item.id&&answers[0].status==='completed'&&answers[0].researchContext.context.traceCompleted===true&&handwriting.length===0);
   strokeDataGone=true;
   await draw(page);await page.locator('[data-cw=submit]').click();await page.locator('.challenge-writing.is-answered').waitFor();
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('ms_pending_sync:s_app_correction')||'[]').length===0);
   await page.waitForTimeout(100);
   check(engine+' first wrong answer reaches actual app sync queue once',saves.length===2&&answers.length===2&&answers[1].status==='incorrect'&&saves[1].payload.learningState.challenge.answers[index].status==='incorrect');
   check(engine+' actual first handwriting request stays standard',handwriting.length===1&&handwriting[0].researchContext.context.mode==='standard');
   // 再寫一次 only shows after a demonstration now; touching the board starts the rewrite.
   nextCandidate=item.target.char;await draw(page);await page.locator('[data-cw=submit]').click();await page.locator('[data-ch=next]:not([hidden])').waitFor();
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('ms_pending_sync:s_app_correction')||'[]').length===0);await page.waitForTimeout(100);
   const final=saves.at(-1),correctionSaves=saves.slice(2);
   // The app currently queues the same snapshot twice for one correction (onCorrectionProgress and
   // onAnswer both call queueReading); the marker must be in every one of them.
   check(engine+' correction callback uploads compact learning marker',correctionSaves.length>=1&&correctionSaves.every(save=>save.payload.learningState.challenge.writingCorrections[item.id]?.status==='corrected'));
   // In the tracing flow the correction is also sent once as a completion record (the server stores it as
   // completed, unscored): the independent graded answer is still the single incorrect one.
   check(engine+' correction keeps original wrong grade and never repeats answer submission',answers.length===3&&answers.filter(answer=>answer.status==='incorrect').length===1&&answers[2].status==='correct'&&answers[2].researchContext.context.dictationCompleted===true&&final.payload.learningState.challenge.answers[index].status==='incorrect'&&final.payload.challenge.answers.find(answer=>answer.itemId===item.id).status==='incorrect');
   check(engine+' real app sends correction recognition as review evidence',handwriting.length===2&&handwriting[1].researchContext.context.mode==='review'&&!('phase' in handwriting[1].researchContext.context));
   check(engine+' progress save binds the signed in actor and poem',final.studentId==='s_app_correction'&&final.poemId===6&&final.section==='reading');
   const uploaded={saves:saves.length,answers:answers.length};
   await page.reload();await page.locator('[data-ch=next]:not([hidden])').waitFor();await page.waitForTimeout(100);
   check(engine+' actual app refresh keeps correction and creates no duplicate upload',saves.length===uploaded.saves&&answers.length===uploaded.answers);
   check(engine+' full app correction flow has no browser errors',errors.length===0);
  }finally{await context.close();await browser.close();}
 }
 console.log(JSON.stringify({ok:true,checks},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
