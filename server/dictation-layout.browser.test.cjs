'use strict';
// Local layout fixture only: no account, recognition or research requests.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(repo,'scripts/build-maanshan-css.cjs'),'utf8');
const css=[...source.match(/const files = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m=>fs.readFileSync(path.join(repo,'maanshan',m[1]),'utf8')).join('\n');
const icon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m10 5-5 4H2v6h3l5 4ZM14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
const fixture=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="app"><div class="workspace lesson-shell view-quiz"><div class="lesson-bar"><a class="back-library">返回</a><div class="lesson-title"><h1>練習小遊戲</h1></div></div><main class="study-main" id="main"><section id="view" class="view-section"><section class="challenge-shell challenge-type-dictation"><header class="challenge-header"><div><span class="challenge-eyebrow">聽寫一個字</span><span class="challenge-count">3<small> / 5</small></span></div><div class="challenge-steps"><i class="done"></i><i class="done"></i><i class="current"></i><i></i><i></i></div></header><div class="challenge-body"><div class="challenge-writing-layout"><div class="challenge-writing-heading"><h2 class="challenge-prompt">聽一聽，寫出指定的字。</h2><div class="challenge-writing-prompts"><button class="challenge-listen" data-ch="listen">${icon}<span>聽詞語</span></button><button class="challenge-strokes" data-cw="strokes">${icon}<span>看筆順</span></button></div><p class="challenge-audio-status">可以聽詞語，也可以直接寫。</p><div class="cw-review" hidden><div class="cw-review-actions"><button data-cw="practise">再寫一次</button></div></div></div><div class="challenge-writing-holder"><div class="challenge-writing cw-expanded"><p class="cw-status">在田字格再寫一次，寫好後按「檢查」。</p><div class="cw-board"></div><div class="cw-actions"><div class="cw-controls"><button data-cw="clear">清空</button><button class="cw-primary" data-cw="submit">檢查</button><button class="cw-skip" data-cw="skip">跳過</button></div></div></div></div></div></div><footer class="challenge-footer" hidden></footer></section></section></main></div></div>`;
const checks=[],metrics=[],evidence=process.env.DICTATION_LAYOUT_EVIDENCE_DIR;
const check=(name,ok,data)=>{assert(ok,name+' '+JSON.stringify(data));checks.push(name);};
(async()=>{
 if(evidence)fs.mkdirSync(evidence,{recursive:true});
 for(const engine of ['chromium','webkit']){
  const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  try{for(const [width,height]of [[320,740],[375,667],[390,844],[768,1024],[820,1180],[1024,768],[1180,820],[1366,768],[844,390]]){
   const page=await browser.newPage({viewport:{width,height},hasTouch:true,isMobile:width<701});
   await page.route('**/*',route=>route.abort());await page.setContent(fixture);
   await page.evaluate(()=>document.fonts.ready);
   for(const showReview of [false,true]){
    await page.locator('.cw-review').evaluate((el,show)=>el.hidden=!show,showReview);
    const data=await page.evaluate(()=>{
     const box=selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect(),style=getComputedStyle(el);return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,font:parseFloat(style.fontSize),textAlign:style.textAlign};};
     return{board:box('.cw-board'),status:box('.cw-status'),prompt:box('.challenge-prompt'),listen:box('[data-ch=listen]'),strokes:box('[data-cw=strokes]'),clear:box('[data-cw=clear]'),submit:box('[data-cw=submit]'),skip:box('[data-cw=skip]'),actions:box('.cw-actions'),body:box('.challenge-body'),layout:box('.challenge-writing-layout'),overflow:document.documentElement.scrollWidth>innerWidth+1};
    });
    const label=`${engine} ${width}x${height} review=${showReview}`;metrics.push({label,...data});
    check(label+' guidance centered over writing square',data.status.textAlign==='center'&&Math.abs(data.status.x+data.status.width/2-data.board.x-data.board.width/2)<1,data);
    check(label+' listening and stroke controls share a row',Math.abs(data.listen.y-data.strokes.y)<1&&data.listen.right<=data.strokes.x+1,data);
    check(label+' actions are readable touch targets',[data.listen,data.strokes,data.clear,data.submit,data.skip].every(b=>b.width>=44&&b.height>=44&&b.font>=20),data);
    check(label+' check is visually primary',data.submit.height>data.clear.height&&data.submit.font>data.clear.font,data);
    check(label+' no horizontal overflow',!data.overflow&&data.board.x>=0&&data.actions.right<=width,data);
    if(height>=700)check(label+' all working controls fit without internal scrolling',data.layout.y>=data.body.y-1&&data.layout.bottom<=data.body.bottom+1&&data.actions.bottom<=height,data);
    if(width>=1000)check(label+' larger landscape prompt',data.prompt.font>=32,data);
    if(evidence&&!showReview)await page.screenshot({path:path.join(evidence,`${engine}-${width}x${height}.png`)});
   }
   await page.close();
  }}finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{const result={ok:!process.exitCode,checks:checks.length,metrics};if(evidence)fs.writeFileSync(path.join(evidence,'layout-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({ok:result.ok,checks:result.checks}));});
