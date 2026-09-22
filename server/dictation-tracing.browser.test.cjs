'use strict';
// Exercise bundled HanziWriter with real median paths and browser input.
// Only the later independent recognition provider is synthetic. Tracing is not.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),checks=[],errors=[],evidence=process.env.DICTATION_TRACING_EVIDENCE_DIR;
const source=fs.readFileSync(path.join(repo,'scripts/build-maanshan-css.cjs'),'utf8');
const css=[...source.match(/const files = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m=>fs.readFileSync(path.join(repo,'maanshan',m[1]),'utf8')).join('\n');
const fixture='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><script src="/maanshan/vendor/hanzi-writer.min.js"></script><div id="app"><div class="workspace lesson-shell view-quiz"><div class="lesson-bar"><a class="back-library">返回</a><div class="lesson-title"><h1>練習小遊戲</h1></div></div><main class="study-main" id="main"><section id="view" class="view-section"><section class="challenge-shell challenge-type-dictation"><header class="challenge-header">第 3 / 5 題</header><div class="challenge-body"><div class="challenge-writing-layout"><div class="challenge-writing-heading"><h2 class="challenge-prompt">聽一聽，寫出指定的字。</h2><div class="challenge-writing-prompts"><button class="challenge-listen" data-ch="listen">聽詞語</button><button class="challenge-strokes" data-cw="strokes">看筆順</button></div><p class="challenge-audio-status"></p><div class="cw-review" hidden><div class="cw-review-actions"><button data-cw="practise">再寫一次</button></div></div></div><div class="challenge-writing-holder"></div></div></div><footer class="challenge-footer" hidden></footer></section></section></main></div></div>';
const mime={'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname==='/fixture'){res.setHeader('Content-Type','text/html;charset=utf-8');return res.end(fixture);}if(u.pathname==='/fixture.css'){res.setHeader('Content-Type','text/css');return res.end(css);}const file=path.resolve(repo,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(repo+path.sep)||!mime[path.extname(file)])return res.writeHead(404).end();fs.readFile(file,(error,data)=>{if(error)return res.writeHead(404).end();res.setHeader('Content-Type',mime[path.extname(file)]);res.end(data);});});
const check=(name,ok,data)=>{assert(ok,name+' '+JSON.stringify(data));checks.push(name);};
const phase=page=>page.locator('.challenge-writing').getAttribute('data-phase');
async function mount(page,char='岸'){
 await page.evaluate(async char=>{
  window.widget?.destroy();window.recognitions=[];window.answers=[];window.states=[];window.traceEvents=[];window.traceWriter=null;
  if(!window.instrumentedWriter){
   const create=HanziWriter.create;
   HanziWriter.create=function(...args){
    const writer=create.apply(this,args),quiz=writer.quiz;
    writer.quiz=function(options){
     return quiz.call(this,{...options,onCorrectStroke:event=>{traceEvents.push({type:'correct',...event});options?.onCorrectStroke?.(event);},onMistake:event=>{traceEvents.push({type:'mistake',...event});options?.onMistake?.(event);},onComplete:event=>{traceEvents.push({type:'complete',...event});options?.onComplete?.(event);}});
    };
    window.traceWriter=writer;return writer;
   };
   window.instrumentedWriter=true;
  }
  const {mountChallengeWriting}=await import('/maanshan/challenge-writing.mjs');
  window.widget=mountChallengeWriting(document.querySelector('.challenge-writing-holder'),{target:{char,pinyin:char==='一'?'yī':'àn'},recognize:async(ink,options)=>{recognitions.push({ink,options});return{candidates:[char]};},onSubmit:result=>answers.push(result),onAdvanceStateChange:state=>states.push(state)});
 },char);
 await page.locator('.challenge-writing[data-phase]').waitFor();
}
async function mappedMedian(page,char,index){
 const data=JSON.parse(fs.readFileSync(path.join(repo,'maanshan/vendor/hanzi-data',char.codePointAt(0).toString(16)+'.json'),'utf8'));
 await page.locator('.cw-board').scrollIntoViewIfNeeded();
 return page.locator('.cw-animation svg g[transform]').first().evaluate((group,median)=>{
  const matrix=group.getScreenCTM();return median.map(([x,y])=>({x:matrix.a*x+matrix.c*y+matrix.e,y:matrix.b*x+matrix.d*y+matrix.f}));
 },data.medians[index]);
}
function densify(points){const result=[points[0]];for(let i=1;i<points.length;i++){const previous=points[i-1],next=points[i],steps=Math.max(2,Math.ceil(Math.hypot(next.x-previous.x,next.y-previous.y)/5));for(let j=1;j<=steps;j++)result.push({x:previous.x+(next.x-previous.x)*j/steps,y:previous.y+(next.y-previous.y)*j/steps});}return result;}
async function drawPath(page,context,points,touch=false){
 const dense=densify(points),start=dense[0];
 if(touch){const cdp=await context.newCDPSession(page);try{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:1,force:1}]});for(const point of dense.slice(1))await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,id:1,force:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}finally{await cdp.detach();}}
 else{await page.mouse.move(start.x,start.y);await page.mouse.down();for(const point of dense.slice(1))await page.mouse.move(point.x,point.y);await page.mouse.up();}
}
async function run(browser,engine,width,height,char){
 const context=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:width<701}),page=await context.newPage(),label=`${engine} ${width}x${height} ${char}`;
 page.on('pageerror',error=>errors.push(label+' '+error.message));
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);await mount(page,char);
  check(label+' first step demonstrates without assessment',await phase(page)==='demonstrating'&&await page.locator('[data-cw=submit]').isDisabled()&&await page.evaluate(()=>!recognitions.length&&!answers.length));
  check(label+' rewrite control cannot bypass unfinished demonstration',await page.locator('[data-cw=practise]').isHidden());
  check(label+' required demonstration has no skip action',await page.locator('[data-cw=skip]').isHidden());
  await page.locator('[data-cw=skip]').dispatchEvent('click');
  check(label+' hidden skip cannot bypass required learning',await page.evaluate(()=>answers.length===0&&!widget.canContinue()));
  await page.waitForFunction(()=>document.querySelector('.challenge-writing').dataset.phase==='tracing',null,{timeout:60000});
  const dimensions=await page.locator('.cw-board').evaluate(board=>{const b=board.getBoundingClientRect(),svg=board.querySelector('svg');return{width:b.width,height:b.height,svg:svg.getBoundingClientRect().width,attributeWidth:Number(svg.getAttribute('width'))};});
  check(label+' writer coordinates match visible board pixels',Math.abs(dimensions.svg-dimensions.width)<3&&Math.abs(dimensions.attributeWidth-dimensions.width)<3,dimensions);
  check(label+' tracing does not call recognition or enable check',await page.locator('[data-cw=submit]').isDisabled()&&await page.evaluate(()=>!recognitions.length&&!answers.length));
  check(label+' required tracing has no skip action',await page.locator('[data-cw=skip]').isHidden());
  const b=await page.locator('.cw-board').boundingBox(),eventCount=await page.evaluate(()=>traceEvents.length);
  await drawPath(page,context,[{x:b.x+b.width*.15,y:b.y+b.height*.9},{x:b.x+b.width*.8,y:b.y+b.height*.9}],engine==='chromium');
  await page.waitForFunction(count=>traceEvents.length>count,eventCount);
  check(label+' unrelated marks are rejected by real quiz',await phase(page)==='tracing'&&await page.evaluate(()=>traceEvents.at(-1).type==='mistake'&&!recognitions.length&&!answers.length));
  const data=JSON.parse(fs.readFileSync(path.join(repo,'maanshan/vendor/hanzi-data',char.codePointAt(0).toString(16)+'.json'),'utf8'));
  for(let stroke=0;stroke<data.medians.length;stroke++){
   await drawPath(page,context,await mappedMedian(page,char,stroke),engine==='chromium');
   await page.waitForFunction(expected=>traceEvents.filter(e=>e.type==='correct').length>=expected,stroke+1,{timeout:10000});
   if(stroke===0&&data.medians.length>1)check(label+' first stroke alone cannot complete a multi-stroke character',await phase(page)==='tracing'&&await page.evaluate(()=>!recognitions.length&&!answers.length));
  }
  await page.waitForFunction(()=>document.querySelector('.challenge-writing').dataset.phase==='assessment',null,{timeout:10000});
  check(label+' all real strokes clear model and open independent writing',await page.locator('.cw-animation').isHidden()&&await page.evaluate(()=>!recognitions.length&&!answers.length&&traceEvents.some(e=>e.type==='complete')));
  check(label+' tracing itself never stores an assessment or enables next',await page.evaluate(()=>!widget.canContinue()&&!widget.getResult())&&await page.locator('[data-cw=submit]').isDisabled());
  if(width===768){await page.locator('[data-cw=skip]').click();check(label+' independent phase permits explicit unscored skip',await page.evaluate(()=>answers.length===1&&answers[0].status==='skipped'&&!answers[0].correct&&recognitions.length===0));return;}
  const board=await page.locator('canvas').boundingBox();await drawPath(page,context,[{x:board.x+board.width*.2,y:board.y+board.height*.4},{x:board.x+board.width*.8,y:board.y+board.height*.55}],engine==='chromium');
  await page.locator('[data-cw=submit]').click();await page.waitForFunction(()=>answers.length===1);
  check(label+' independent writing alone reaches recognition',await page.evaluate(()=>recognitions.length===1&&answers.length===1&&answers[0].correct&&widget.canContinue()));
  if(evidence)await page.screenshot({path:path.join(evidence,`${engine}-${width}x${height}-${char.codePointAt(0).toString(16)}.png`)});
 }catch(error){if(evidence)await page.screenshot({path:path.join(evidence,`${engine}-${width}x${height}-failure.png`),fullPage:true});throw error;}finally{await context.close();}
}
(async()=>{
 if(evidence)fs.mkdirSync(evidence,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const single=fs.existsSync(path.join(repo,'maanshan/vendor/hanzi-data/4e00.json'))?'一':'岸';
 const cases=process.env.DICTATION_TRACING_CHARACTER?[[1180,820,process.env.DICTATION_TRACING_CHARACTER]]:[[390,844,single],[768,1024,single],[1180,820,'岸'],[1180,820,'峯']];
 for(const engine of ['chromium','webkit']){const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));try{for(const [width,height,char]of cases)await run(browser,engine,width,height,char);}finally{await browser.close();}}
 check('no browser exceptions',errors.length===0,errors);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{const result={ok:!process.exitCode,checks,errors};if(evidence)fs.writeFileSync(path.join(evidence,'tracing-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));server.close();});
