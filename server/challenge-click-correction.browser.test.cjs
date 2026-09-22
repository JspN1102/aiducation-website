'use strict';
// Production challenge modules, synthetic recognition/audio, no school writes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {installLearningFixture,finishLearning}=require('./dictation-test-learning.cjs');
const {validateEvent}=require('../api/_lib/research-store.cjs');
const {randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),checks=[];
const sources=[...fs.readFileSync(path.join(root,'scripts/build-maanshan-css.cjs'),'utf8').match(/const files = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(match=>fs.readFileSync(path.join(root,'maanshan',match[1]),'utf8')).join('\n');
const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="app"><div class="workspace lesson-shell poem-color-6 view-quiz"><div class="lesson-bar"><a class="back-library">返回</a><div class="lesson-title"><h1>練習小遊戲</h1></div></div><main class="study-main"><section id="view" class="view-section"></section></main></div></div>';
const mime={'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}if(u.pathname==='/fixture.css'){res.setHeader('Content-Type','text/css');return res.end(sources);}const file=path.resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+path.sep)||!mime[path.extname(file)])return res.writeHead(404).end();fs.readFile(file,(error,data)=>{if(error)return res.writeHead(404).end();res.setHeader('Content-Type',mime[path.extname(file)]);res.end(data);});});
const check=(name,value)=>{assert(value,name);checks.push(name);};
async function mount(page,kind='sound',savedMode='fresh'){
 if(kind==='dictation')await installLearningFixture(page);
 await page.evaluate(async({kind,savedMode})=>{
  window.challenge?.destroy();window.recognitionCalls=[];window.submissions=[];window.correctionSaves=[];window.audit=[];window.candidates=[];window.audioMode='pending';
  const {mountChallenge}=await import('/maanshan/challenge.mjs'),{CHALLENGE_SETS}=await import('/maanshan/challenge-data.mjs'),{newAttempt,attemptItems,recordAnswer}=await import('/maanshan/challenge-state.mjs');
  const poems=await(await fetch('/maanshan/poems.json')).json(),poem=poems.poems.find(p=>p.grade===(kind==='sound'?1:6)),set=CHALLENGE_SETS[poem.slug];
  let saved;if(savedMode==='resume'){
   const {compactLearningSnapshot}=await import('/maanshan/learning-snapshot.mjs');
   saved=JSON.parse(JSON.stringify(compactLearningSnapshot({challenge:window.saved}))).challenge;
  }else{
   saved=newAttempt(set,{seed:'click-correction'});const items=attemptItems(saved,set);const index=savedMode==='last'?items.length-1:items.findIndex(item=>item.type===kind);
   for(let i=0;i<index;i++)recordAnswer(saved,set,i,{status:items[i].type==='microgame'?'skipped':'correct'});
   saved.cursor=index;if(savedMode==='last'){recordAnswer(saved,set,index,{status:'incorrect',recognized:'口'});saved.cursor=items.length;}
  }
  window.currentItems=attemptItems(saved,set);window.challenge=mountChallenge(document.querySelector('#view'),{poem,saved,
   onChange:value=>window.saved=value,onAnswer:value=>submissions.push(value),onCorrectionProgress:value=>correctionSaves.push(value),onResearch:(type,event)=>audit.push({type,...event}),
   playAudio:()=>window.audioMode==='pending'?new Promise(resolve=>window.resolveAudio=resolve):Promise.resolve(window.audioMode==='success'),
   recognize:async(ink,context)=>{recognitionCalls.push({ink,context});return{candidates:[candidates.shift()||'口']};}});
  window.item=window.currentItems[challenge.getAttempt().cursor];
 },{kind,savedMode});
 if(kind==='dictation'&&savedMode==='fresh')await finishLearning(page);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function draw(page){const canvas=page.locator('.cw-board canvas');await canvas.scrollIntoViewIfNeeded();const b=await canvas.boundingBox();await page.mouse.move(b.x+b.width*.25,b.y+b.height*.35);await page.mouse.down();await page.mouse.move(b.x+b.width*.72,b.y+b.height*.65,{steps:8});await page.mouse.up();}
async function assessed(page){await page.waitForFunction(()=>document.querySelector('.challenge-writing')?.getAttribute('aria-busy')==='false'&&document.querySelector('.challenge-writing')?.classList.contains('is-answered'));}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{for(const engine of ['chromium','webkit']){
  const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  try{
   for(const viewport of [{width:390,height:844},{width:1024,height:768},{width:1280,height:800}]){
    const context=await browser.newContext({viewport,hasTouch:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/fixture');await mount(page);
    const label=engine+' '+viewport.width,options=page.locator('[data-option]');
    check(label+' sound choices offer no answer-revealing hint button',await page.locator('[data-ch=skip]:visible').count()===0&&await page.getByRole('button',{name:'看提示'}).count()===0);
    await page.evaluate(()=>{const hint=document.querySelector('[data-ch=skip]');hint.click();});
    check(label+' directly clicking the hidden old hint cannot submit or reveal an answer',await page.evaluate(()=>submissions.length===0&&!document.querySelector('[data-option][aria-pressed="true"]')));
    check(label+' initial answer choices wait for completed audio',await options.evaluateAll(values=>values.every(el=>el.disabled)));
    check(label+' no dragging instructions and native clickable walnut',await page.evaluate(()=>!document.querySelector('.challenge-sound-layout').textContent.includes('拖')&&document.querySelector('.challenge-sound-token').draggable===false&&getComputedStyle(document.querySelector('.challenge-sound-token')).cursor==='pointer'));
    await page.locator('[data-ch=listen]').tap();check(label+' choices remain disabled during audio',await options.evaluateAll(values=>values.every(el=>el.disabled)));
    await page.evaluate(()=>resolveAudio(false));await page.waitForFunction(()=>!document.querySelector('[data-ch=listen]').hasAttribute('aria-busy'));check(label+' failed audio cannot unlock choices',await options.evaluateAll(values=>values.every(el=>el.disabled)));
    await page.locator('[data-ch=listen]').tap();await page.evaluate(()=>resolveAudio(true));await page.waitForFunction(()=>!document.querySelector('[data-option]').disabled);
    const token=await page.locator('[data-ch=listen]').boundingBox(),target=await options.first().boundingBox();
    await page.mouse.move(token.x+token.width/2,token.y+token.height/2);await page.mouse.down();await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:8});await page.mouse.up();
    check(label+' dragging walnut neither moves token nor chooses answer',await page.evaluate(()=>!document.querySelector('[data-option][aria-pressed="true"]')&&!document.querySelector('.challenge-sound-token').style.translate));
    await options.first().tap();check(label+' tapping choice has clear selection',await options.first().getAttribute('aria-pressed')==='true'&&await page.locator('.challenge-audio-status').textContent().then(v=>v.includes('已選')));
    check(label+' all choices meet touch target size',await options.evaluateAll(values=>values.every(el=>{const b=el.getBoundingClientRect();return b.width>=44&&b.height>=44;})));
    await page.locator('[data-ch=submit]').tap();check(label+' confirm records exactly one answer',await page.evaluate(()=>submissions.length===1));check(label+' no browser errors',errors.length===0);await context.close();
   }
   {
    const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/fixture');await mount(page,'dictation');
    check(engine+' listening and stroke controls share the prompt panel',await page.locator('.challenge-writing-prompts [data-ch=listen]').count()===1&&await page.locator('.challenge-writing-prompts [data-cw=strokes]').count()===1);
    check(engine+' writing controls are only clear check and skip',await page.locator('.cw-controls button').evaluateAll(values=>values.map(el=>el.dataset.cw).join(',')==='clear,submit,skip'));
    check(engine+' retry starts hidden',await page.locator('[data-cw=practise]').isHidden());
    check(engine+' tracing saves completion progress without an independent answer or recognition call',await page.evaluate(()=>!saved.answers[2]&&recognitionCalls.length===0&&submissions.length===1&&submissions[0].status==='completed'&&submissions[0].context.traceCompleted===true&&submissions[0].context.dictationCompleted===false));
    await draw(page);await page.locator('[data-cw=submit]').click();await assessed(page);
    check(engine+' first wrong answer blocks next',await page.locator('[data-ch=next]').isHidden());
    await page.evaluate(()=>{const next=document.querySelector('[data-ch=next]');next.hidden=false;next.disabled=false;next.click();});
    check(engine+' next handler rejects direct bypass',await page.evaluate(()=>saved.cursor===2&&submissions.filter(value=>value.status!=='completed').length===1&&saved.answers[2].status==='incorrect'));
    await mount(page,'dictation','resume');check(engine+' saved wrong answer still requires correction',await page.locator('[data-ch=next]').isHidden());
    check(engine+' wrong answer does not show retry before a completed animation',await page.locator('[data-cw=practise]').isHidden());
    await page.locator('[data-cw=clear]').click();await page.evaluate(()=>candidates=['口']);await draw(page);await page.locator('[data-cw=submit]').click();
    await page.waitForFunction(()=>!document.querySelector('.challenge-writing').getAttribute('aria-busy')||document.querySelector('.challenge-writing').getAttribute('aria-busy')==='false');
    check(engine+' incorrect correction remains blocked',await page.locator('[data-ch=next]').isHidden());
    await page.locator('[data-cw=clear]').click();await page.evaluate(()=>candidates=[item.target.char]);await draw(page);await page.locator('[data-cw=submit]').click();await page.locator('[data-ch=next]:not([hidden])').waitFor();
    const corrected=await page.evaluate(()=>({contexts:recognitionCalls.map(call=>call.context.context),first:saved.answers[2],submissions,correction:saved.writingCorrections?.[item.id]}));
    check(engine+' correction recognition has review context and preserves the first independent result',corrected.contexts.every(context=>context.mode==='review')&&corrected.first.status==='incorrect'&&corrected.correction?.status==='corrected');
    check(engine+' new learning flow publishes one completed dictation update after a correct rewrite',corrected.submissions.length===1&&corrected.submissions[0].status==='correct'&&corrected.submissions[0].context.flow==='trace-dictation-v1'&&corrected.submissions[0].context.traceCompleted&&corrected.submissions[0].context.dictationCompleted);
    for(const call of await page.evaluate(()=>recognitionCalls))validateEvent({eventId:randomUUID(),sessionId:randomUUID(),seq:0,clientAt:new Date().toISOString(),activeMs:0,poemId:6,activity:'writing',type:'provider_result',appVersion:'test-v1',contentVersion:'poem-6-v1',provider:'test',model:'test',operation:'handwriting',providerVersion:'v1',context:call.context.context,result:{status:'correct',score:100,correct:true}},true);
    check(engine+' actual correction request context passes server research schema',true);
    check(engine+' newly finished correction triggers one correction progress upload',await page.evaluate(()=>correctionSaves.length===1&&correctionSaves[0].status==='corrected'));
    await mount(page,'dictation','resume');check(engine+' corrected state survives remount',await page.locator('[data-ch=next]').isVisible());
    check(engine+' restored correction does not trigger duplicate uploads',await page.evaluate(()=>correctionSaves.length===0));
    await mount(page,'dictation','last');check(engine+' saved final wrong answer does not jump to summary',await page.locator('.cw-board').count()===1&&await page.locator('[data-ch=next]').isHidden());
    await page.locator('[data-cw=skip]').click();await page.locator('[data-ch=next]:not([hidden])').waitFor();await page.locator('[data-ch=next]').click();
    check(engine+' explicit correction skip allows summary and preserves wrong result',await page.locator('.challenge-results').count()===1&&await page.evaluate(()=>saved.answers.at(-1).status==='incorrect'&&saved.writingCorrections[currentItems.at(-1).id].status==='skipped'));
    await mount(page,'dictation');await page.locator('[data-cw=skip]').click();
    check(engine+' first skip records skipped learning without fabricated correctness',await page.evaluate(()=>saved.answers[2].status==='skipped'&&saved.writingCorrections[item.id].status==='skipped'&&submissions.filter(value=>value.status!=='completed').length===1&&submissions.every(value=>['completed','skipped'].includes(value.status)&&!value.context.dictationCompleted)&&recognitionCalls.length===0));
    await mount(page,'dictation','resume');check(engine+' explicit first skip stays unlocked after reload',await page.locator('[data-ch=next]').isVisible());
    for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1180,height:820},{width:844,height:390}]){
     await page.setViewportSize(viewport);await mount(page,'dictation');await draw(page);await page.locator('[data-cw=submit]').click();await assessed(page);await page.locator('[data-cw=strokes]').click();await page.locator('.cw-animation svg path').first().waitFor({state:'attached'});await page.locator('[data-cw=practise]').waitFor({state:'visible'});await page.locator('[data-cw=practise]').click();
     check(`${engine} ${viewport.width} retry disappears after beginning rewrite`,await page.locator('[data-cw=practise]').isHidden());
     const layout=await page.evaluate(()=>{const b=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};return{status:b('.cw-status'),board:b('.cw-board'),actions:b('.cw-actions'),body:b('.challenge-body'),prompt:b('.challenge-writing-heading'),listen:b('.challenge-writing-prompts [data-ch=listen]'),strokes:b('.challenge-writing-prompts [data-cw=strokes]'),fonts:['.challenge-prompt','.challenge-writing-prompts [data-ch=listen]','.challenge-writing-prompts [data-cw=strokes]'].map(s=>parseFloat(getComputedStyle(document.querySelector(s)).fontSize))};});
     if(process.env.WRITING_SCREENSHOTS_DIR){fs.mkdirSync(process.env.WRITING_SCREENSHOTS_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.WRITING_SCREENSHOTS_DIR,`challenge-${engine}-${viewport.width}x${viewport.height}.png`)});}
     const fits=layout.status.y>=layout.body.y-1&&layout.status.bottom<=layout.board.y+1&&layout.actions.bottom<=layout.body.bottom+1&&layout.board.bottom<=layout.body.bottom+1&&layout.prompt.y>=layout.body.y-1&&layout.prompt.bottom<=layout.body.bottom+1;
     if(!fits)console.error('Dictation layout failure',engine,viewport,layout);
     check(`${engine} ${viewport.width} full challenge keeps rewrite message and controls visible`,fits);
     check(`${engine} ${viewport.width} message is centered above the writing square`,Math.abs(layout.status.x+layout.status.width/2-layout.board.x-layout.board.width/2)<=2);
     check(`${engine} ${viewport.width} listen and stroke buttons sit alongside one another`,Math.abs(layout.listen.y-layout.strokes.y)<=2&&layout.listen.right<=layout.strokes.x+2);
     check(`${engine} ${viewport.width} prompt controls have large readable text and touch targets`,layout.listen.height>=48&&layout.strokes.height>=48&&layout.fonts.every(value=>value>=18));
     check(`${engine} ${viewport.width} no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    }
    check(engine+' correction integration has no browser errors',errors.length===0);await context.close();
   }
  }finally{await browser.close();}
 }}finally{await new Promise(resolve=>server.close(resolve));}
 console.log(JSON.stringify({ok:true,checks},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
