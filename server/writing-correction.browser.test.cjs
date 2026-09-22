'use strict';
// Real pad / renderer, synthetic recognition only. Never writes learning data.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),checks=[],errors=[];
const cssScript=fs.readFileSync(path.join(repo,'scripts/build-maanshan-css.cjs'),'utf8');
const css=[...cssScript.match(/const files = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m=>fs.readFileSync(path.join(repo,'maanshan',m[1]),'utf8')).join('\n');
const fixture='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="app"><div class="workspace lesson-shell view-quiz"><div class="lesson-bar"><a class="back-library">返回</a><div class="lesson-title"><h1>練習小遊戲</h1></div></div><main class="study-main" id="main"><section id="view" class="view-section"><section class="challenge-shell challenge-type-dictation"><header class="challenge-header">第 3 / 5 題</header><div class="challenge-body"><div class="challenge-writing-layout"><div class="challenge-writing-heading"><h2 class="challenge-prompt">聽一聽，寫出指定的字。</h2><button class="challenge-listen">聽詞語</button></div><div class="challenge-writing-holder"></div></div></div><footer class="challenge-footer"><button id="next">下一題</button></footer></section></section></main></div></div>';
const mime={'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname==='/fixture'){res.setHeader('Content-Type','text/html;charset=utf-8');return res.end(fixture);}if(u.pathname==='/fixture.css'){res.setHeader('Content-Type','text/css');return res.end(css);}const file=path.resolve(repo,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(repo+path.sep)||!mime[path.extname(file)])return res.writeHead(404).end();fs.readFile(file,(error,data)=>{if(error)return res.writeHead(404).end();res.setHeader('Content-Type',mime[path.extname(file)]);res.end(data);});});
const check=(label,ok)=>{assert(ok,label);checks.push(label);};
async function mount(page,options={}){
 await page.evaluate(async options=>{
  window.widget?.destroy();window.calls=[];window.answers=[];window.corrections=[];window.states=[];window.audit=[];window.nextCandidates=['土'];window.recognizeMode='ready';
  const {mountChallengeWriting}=await import('/maanshan/challenge-writing.mjs');
  window.widget=mountChallengeWriting(document.querySelector('.challenge-writing-holder'),{target:{char:'岸',pinyin:'àn'},...options,
   recognize:async(ink,context)=>{calls.push({ink,context});if(recognizeMode==='fail')throw Error('Offline');if(recognizeMode==='pending')await new Promise(resolve=>window.releaseRecognition=resolve);return{candidates:nextCandidates};},
   onSubmit:r=>answers.push(r),onCorrection:r=>corrections.push(r),onResearch:(type,fields)=>audit.push({type,...fields}),
   onAdvanceStateChange:state=>{states.push(state);document.querySelector('#next').disabled=!state.canContinue;}
  });
 },options);
 await page.locator('.cw-board').waitFor();
}
async function draw(page){
 await page.locator('canvas').scrollIntoViewIfNeeded();const b=await page.locator('canvas').boundingBox();
 assert(b&&b.width>200&&b.height>200,'usable canvas '+JSON.stringify(b));
 const hit=await page.evaluate(({x,y})=>{const el=document.elementFromPoint(x,y);return{insideBoard:Boolean(el?.closest('.cw-board')),tag:el?.tagName,parents:[...document.querySelectorAll('.challenge-body,.challenge-shell,.study-main,#view')].map(el=>({name:el.className||el.id,height:el.getBoundingClientRect().height,overflow:getComputedStyle(el).overflow}))};},{x:b.x+b.width*.2,y:b.y+b.height*.35});
 assert(hit.insideBoard,'writing square must receive pointer '+JSON.stringify({b,hit}));
 await page.mouse.move(b.x+b.width*.2,b.y+b.height*.35);await page.mouse.down();await page.mouse.move(b.x+b.width*.75,b.y+b.height*.55,{steps:9});await page.mouse.up();
}
async function submit(page){await page.locator('[data-cw=submit]').click();await page.waitForFunction(()=>document.querySelector('.cw-expanded').getAttribute('aria-busy')==='false');}
async function state(page){return page.evaluate(()=>({calls,answers,corrections,audit,result:widget.getResult(),correction:widget.getCorrection(),canContinue:widget.canContinue()}));}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 for(const engine of ['chromium','webkit']){
  const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  try{
   const context=await browser.newContext({viewport:{width:1180,height:820},hasTouch:true}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);await mount(page);
   check(engine+' untouched answer blocks advancement',await page.locator('#next').isDisabled());
   await draw(page);await submit(page);let data=await state(page);
   check(engine+' first wrong answer retained and blocks next',data.answers.length===1&&data.result.status==='incorrect'&&!data.canContinue);
   check(engine+' wrong answer does not reveal the target glyph',await page.locator('.challenge-writing').evaluate(el=>!el.textContent.includes('岸')&&!el.querySelector('.cw-answer')&&el.querySelector('.cw-animation').hidden));
   const original=JSON.stringify(data.result);
   await page.locator('[data-cw=strokes]').click();await page.locator('.cw-animation svg path').first().waitFor({state:'attached'});
   const sizes=await page.locator('.cw-animation svg').evaluate(el=>({svg:el.getBoundingClientRect().width,board:el.closest('.cw-board').getBoundingClientRect().width}));
   check(engine+' enlarged stroke model fills enlarged square',sizes.board>=320&&Math.abs(sizes.svg-sizes.board)<=3);
   await page.locator('[data-cw=practise]').click();await draw(page);data=await state(page);
   check(engine+' drawing any mark never counts as correction',data.calls.length===1&&!data.canContinue&&await page.locator('[data-cw=submit]').isEnabled());
   await page.evaluate(()=>nextCandidates=['土','岸']);await submit(page);data=await state(page);
   check(engine+' wrong correction invokes recognition and lower target cannot pass',data.calls.length===2&&data.calls[1].context.mode==='review'&&data.corrections.at(-1).status==='incorrect'&&!data.canContinue);
   await page.locator('[data-cw=clear]').click();await draw(page);await page.evaluate(()=>recognizeMode='fail');await submit(page);data=await state(page);
   check(engine+' failed correction preserves ink and remains blocked',data.calls.length===3&&!data.canContinue&&await page.locator('[data-cw=submit]').isEnabled());
   await page.evaluate(()=>{recognizeMode='ready';nextCandidates=['岸'];});await submit(page);data=await state(page);
   check(engine+' recognized correct correction opens next',data.calls.length===4&&data.canContinue&&data.correction.status==='corrected');
   check(engine+' correction never rewrites initial independent answer',data.answers.length===1&&JSON.stringify(data.result)===original&&data.corrections.every(r=>r.independent===false&&r.mode==='review'));
   check(engine+' correction events are explicitly review mode',data.audit.filter(e=>e.type==='feedback_shown').every(e=>e.context.mode==='review'&&e.result.score===null));
   const saved={initialResult:data.result,initialCorrection:data.correction};await mount(page,saved);
   check(engine+' corrected state resumes after remount',await page.evaluate(()=>widget.canContinue()&&widget.getResult().status==='incorrect'));
   await mount(page,{initialResult:{status:'incorrect'}});check(engine+' unresolved saved wrong answer stays blocked',await page.locator('#next').isDisabled());await page.locator('[data-cw=skip-correction]').click();data=await state(page);
   check(engine+' explicit skip opens next without fabricating correctness',data.canContinue&&data.result.status==='incorrect'&&data.correction.status==='skipped'&&data.calls.length===0&&data.answers.length===0);
   await mount(page,{initialResult:{status:'skipped'}});await draw(page);check(engine+' learning first touch writes but cannot bypass correction',await page.locator('[data-cw=submit]').isEnabled()&&!await page.evaluate(()=>widget.canContinue()));
   await page.evaluate(()=>{nextCandidates=['岸'];recognizeMode='pending';});await page.locator('[data-cw=submit]').click();await page.waitForFunction(()=>calls.length===1);await page.evaluate(()=>widget.destroy());await page.evaluate(()=>releaseRecognition());
   check(engine+' late correction cannot mutate destroyed widget',await page.evaluate(()=>corrections.length===0));
   for(const [width,height,minimum]of [[390,844,275],[768,1024,400],[1180,820,320]]){
    await page.setViewportSize({width,height});await mount(page);const before=await page.locator('.cw-board').boundingBox();
    await mount(page,{initialResult:{status:'incorrect',recognized:'土'}});const after=await page.locator('.cw-board').boundingBox();
    check(`${engine} ${width}x${height} review preserves a large square`,before.width>=minimum&&after.width>=minimum&&Math.abs(before.width-after.width)<2&&Math.abs(after.width-after.height)<2);
    const feedback=await page.locator('.cw-status').boundingBox();
    check(`${engine} ${width}x${height} recognized character appears above the square`,feedback.y>=0&&feedback.y+feedback.height<=after.y+1&&await page.locator('.cw-status').textContent().then(value=>value.includes('土')));
    await page.locator('[data-cw=practise]').click();
    const layout=await page.evaluate(()=>{const b=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};return{board:b('.cw-board'),status:b('.cw-status'),actions:b('.cw-actions'),body:b('.challenge-body'),buttons:[...document.querySelectorAll('.cw-actions button')].filter(el=>el.getClientRects().length).map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))};});
    check(`${engine} ${width}x${height} rewrite instruction stays above the square without scrolling`,layout.status.y>=layout.body.y-1&&layout.status.bottom<=layout.board.y+1&&layout.board.bottom<=height&&layout.actions.bottom<=height);
    check(`${engine} ${width}x${height} buttons remain comfortable touch targets`,layout.buttons.every(button=>button.width>=44&&button.height>=44));
    if(process.env.WRITING_SCREENSHOTS_DIR){fs.mkdirSync(process.env.WRITING_SCREENSHOTS_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.WRITING_SCREENSHOTS_DIR,`${engine}-${width}x${height}.png`)});}
    check(`${engine} ${width}x${height} no horizontal page overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   }
   await context.close();
  }finally{await browser.close();}
 }
 check('no page errors',errors.length===0);console.log(JSON.stringify({ok:true,checks},null,2));
})().catch(error=>{console.error(error);console.log(JSON.stringify({ok:false,checks,errors}));process.exitCode=1;}).finally(()=>server.close());
