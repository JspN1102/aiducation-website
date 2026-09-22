'use strict';
// Real bootstrap/app/quiz/sync queue with synthetic, fully intercepted APIs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),checks=[];
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
const check=(label,pass)=>{assert(pass,label);checks.push(label);};
async function draw(page){const canvas=page.locator('.cw-board canvas');await canvas.scrollIntoViewIfNeeded();const b=await canvas.boundingBox();await page.mouse.move(b.x+b.width*.25,b.y+b.height*.35);await page.mouse.down();await page.mouse.move(b.x+b.width*.73,b.y+b.height*.65,{steps:8});await page.mouse.up();}
(async()=>{
 const [{newAttempt,attemptItems,recordAnswer},{CHALLENGE_SETS}]=await Promise.all([import('../maanshan/challenge-state.mjs'),import('../maanshan/challenge-data.mjs')]);
 const set=CHALLENGE_SETS['zao-chun'],saved=newAttempt(set,{seed:'app-correction-upload'}),items=attemptItems(saved,set),index=items.findIndex(item=>item.type==='dictation'),item=items[index];
 for(let i=0;i<index;i++)recordAnswer(saved,set,i,{status:i===0?'skipped':'correct'});saved.cursor=index;
 for(const engine of ['chromium','webkit']){
  const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true}),page=await context.newPage(),saves=[],answers=[],handwriting=[],errors=[];
  let nextCandidate='口';page.on('pageerror',error=>errors.push(error.message));
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
    if(!file.startsWith(path.join(root,'maanshan')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
    const ext=path.extname(file);let body=fs.readFileSync(file);if(['.mjs','.js','.html','.json','.css'].includes(ext))body=Buffer.from(body.toString('utf8').replace(/(["'`])\/maanshan\//g,'$1/school/'));
    return route.fulfill({contentType:types[ext]||'application/octet-stream',body}).catch(()=>{});
   });
   await page.goto('https://app-correction.invalid/school/#zao-chun/quiz');await page.locator('.cw-board').waitFor();
   await draw(page);await page.locator('[data-cw=submit]').click();await page.locator('.cw-review:not([hidden])').waitFor();
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('ms_pending_sync:s_app_correction')||'[]').length===0);
   await page.waitForTimeout(100);
   check(engine+' first wrong answer reaches actual app sync queue once',saves.length===1&&answers.length===1&&saves[0].payload.learningState.challenge.answers[index].status==='incorrect');
   check(engine+' actual first handwriting request stays standard',handwriting.length===1&&handwriting[0].researchContext.context.mode==='standard');
   nextCandidate=item.target.char;await page.locator('[data-cw=practise]').click();await draw(page);await page.locator('[data-cw=submit]').click();await page.locator('[data-ch=next]:not([hidden])').waitFor();
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('ms_pending_sync:s_app_correction')||'[]').length===0);await page.waitForTimeout(100);
   const final=saves.at(-1);
   check(engine+' correction callback uploads compact learning marker',saves.length===2&&final.payload.learningState.challenge.writingCorrections[item.id].status==='corrected');
   check(engine+' correction keeps original wrong grade and never repeats answer submission',answers.length===1&&final.payload.learningState.challenge.answers[index].status==='incorrect'&&final.payload.challenge.answers.find(answer=>answer.itemId===item.id).status==='incorrect');
   check(engine+' real app sends correction recognition as review evidence',handwriting.length===2&&handwriting[1].researchContext.context.mode==='review'&&!('phase' in handwriting[1].researchContext.context));
   check(engine+' progress save binds the signed in actor and poem',final.studentId==='s_app_correction'&&final.poemId===6&&final.section==='reading');
   await page.reload();await page.locator('[data-ch=next]:not([hidden])').waitFor();await page.waitForTimeout(100);
   check(engine+' actual app refresh keeps correction and creates no duplicate upload',saves.length===2&&answers.length===1);
   check(engine+' full app correction flow has no browser errors',errors.length===0);
  }finally{await context.close();await browser.close();}
 }
 console.log(JSON.stringify({ok:true,checks},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
