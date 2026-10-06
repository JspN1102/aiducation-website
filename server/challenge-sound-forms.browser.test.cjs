'use strict';
// Listening choice forms: poems 1-6 use the little doctor's clinic, poems 7-12 the police line-up.
// Production challenge modules with synthetic audio; no school data or network writes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),checks=[];
const sources=[...fs.readFileSync(path.join(root,'scripts/build-maanshan-css.cjs'),'utf8').match(/const files = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(match=>fs.readFileSync(path.join(root,'maanshan',match[1]),'utf8')).join('\n');
const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="app"><div class="workspace lesson-shell view-quiz"><div class="lesson-bar"><a class="back-library">返回</a><div class="lesson-title"><h1>練習小遊戲</h1></div></div><main class="study-main"><section id="view" class="view-section"></section></main></div></div>';
const mime={'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}if(u.pathname==='/fixture.css'){res.setHeader('Content-Type','text/css');return res.end(sources);}const file=path.resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+path.sep)||!mime[path.extname(file)])return res.writeHead(404).end();fs.readFile(file,(error,data)=>{if(error)return res.writeHead(404).end();res.setHeader('Content-Type',mime[path.extname(file)]);res.end(data);});});
const check=(name,value)=>{assert(value,name);checks.push(name);};
const FORMS={clinic:{kind:'小醫生問診',submit:'開藥',right:'藥開對了，好起來了！',wrong:'差一點，一起看看。',pictures:['clinic-v1.webp','clinic-well-v1.webp','clinic-cry-v1.webp']},police:{kind:'警察抓犯人',submit:'就是他！',right:'抓到了！就是他！',wrong:'不是他，一起看看。',pictures:['police-v1.webp','police-caught-v1.webp','police-sad-v1.webp']}};
async function mount(page,slug){
 await page.evaluate(async slug=>{
  window.challenge?.destroy();window.submissions=[];window.audit=[];
  const {mountChallenge}=await import('/maanshan/challenge.mjs'),{CHALLENGE_SETS}=await import('/maanshan/challenge-data.mjs'),{newAttempt,attemptItems,recordAnswer}=await import('/maanshan/challenge-state.mjs');
  const lists=await Promise.all(['/maanshan/poems.json','/maanshan/poems-preview.json'].map(async url=>(await(await fetch(url)).json()).poems));
  const poem=lists.flat().find(p=>p.slug===slug),set=CHALLENGE_SETS[slug],saved=newAttempt(set,{seed:'sound-forms'}),items=attemptItems(saved,set),index=items.findIndex(item=>item.type==='sound');
  for(let i=0;i<index;i++)recordAnswer(saved,set,i,{status:items[i].type==='microgame'?'skipped':'correct'});
  saved.cursor=index;window.item=items[index];window.poemId=poem.id;
  window.challenge=mountChallenge(document.querySelector('#view'),{poem,saved,onChange:()=>{},onAnswer:value=>submissions.push(value),onCorrectionProgress:()=>{},onResearch:(type,event)=>audit.push({type,...event}),playAudio:()=>Promise.resolve(true),recognize:async()=>({candidates:['口']})});
 },slug);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function answer(page,correct){
 await page.locator('[data-ch=listen]').tap();await page.waitForFunction(()=>!document.querySelector('[data-option]').disabled);
 const id=await page.evaluate(correct=>correct?item.answerId:item.options.find(option=>option.id!==item.answerId).id,correct);
 await page.locator(`[data-option="${id}"]`).tap();await page.locator('[data-ch=submit]').tap();
 await page.locator('.challenge-feedback strong').waitFor();
}
// The scene stacks three pictures: the question scene, the solved one (right answer) and the missed one
// (wrong answer: the bunny cries, the puppy is sad). `shown` names the picture that should be on top.
async function pictures(page,form,shown){
 const opaque={scene:[],solved:['is-after'],missed:['is-missed-pic']}[shown];
 await page.waitForFunction(opaque=>[...document.querySelectorAll('.sound-case-picture')].every(img=>getComputedStyle(img).opacity===(img.classList.length===1||opaque.some(name=>img.classList.contains(name))?'1':'0')),opaque,{timeout:5000}).catch(()=>{});
 await page.waitForFunction(()=>[...document.querySelectorAll('.sound-case-picture')].every(img=>img.complete&&img.naturalWidth>0),null,{timeout:20000}).catch(()=>{});
 const state=await page.evaluate(()=>{const stage=document.querySelector('.sound-case'),scene=stage.querySelector('.sound-case-scene').getBoundingClientRect();
  return {solved:stage.classList.contains('is-solved'),missed:stage.classList.contains('is-missed'),pictures:[...stage.querySelectorAll('.sound-case-picture')].map(img=>{const r=img.getBoundingClientRect(),style=getComputedStyle(img);
   return {className:img.className,file:new URL(img.currentSrc||img.src).pathname.split('/').pop(),opacity:style.opacity,position:style.objectPosition,fit:style.objectFit,loaded:img.complete&&img.naturalWidth>0,
    fills:Math.abs(r.left-scene.left)<1&&Math.abs(r.top-scene.top)<1&&Math.abs(r.width-scene.width)<1&&Math.abs(r.height-scene.height)<1};})};});
 const [scene,solved,missed]=state.pictures,on=shown==='solved'?solved:shown==='missed'?missed:scene;
 return state.pictures.length===3&&scene.className==='sound-case-picture'&&solved.className==='sound-case-picture is-after'&&missed.className==='sound-case-picture is-missed-pic'
  &&state.pictures.every((picture,index)=>picture.file===form.pictures[index]&&picture.loaded&&picture.fills&&picture.fit==='cover'&&picture.position===scene.position)
  &&scene.opacity==='1'&&on.opacity==='1'&&state.pictures.filter(picture=>picture!==scene&&picture!==on).every(picture=>picture.opacity==='0')
  &&state.solved===(shown==='solved')&&state.missed===(shown==='missed');
}
const fits=page=>page.evaluate(()=>{const body=document.querySelector('.challenge-body').getBoundingClientRect(),inside=el=>{const r=el.getBoundingClientRect();return r.left>=body.left-1&&r.right<=body.right+1&&r.top>=body.top-1&&r.bottom<=body.bottom+1;};return document.documentElement.scrollWidth<=innerWidth+1&&[...document.querySelectorAll('.sound-case-scene,.sound-case-option,.sound-case .challenge-prompt')].every(inside)&&[...document.querySelectorAll('.sound-case-option')].every(el=>{const r=el.getBoundingClientRect();return r.width>=56&&r.height>=56;});});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const slugs=['yong-e','zeng-wang-lun','ti-xi-lin-bi','bo-chuan-gua-zhou','gui-yuan-tian-ju','zao-chun','yong-xue','hua-ji','qi-bu-shi','jue-ju','zheng-ren-mai-lu','ke-zhi'];
 try{for(const engine of (process.env.PLAYWRIGHT_ENGINES||'chromium').split(',')){
  const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  try{
   const context=await browser.newContext({viewport:{width:1180,height:820},hasTouch:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/fixture');
   for(const slug of slugs){
    await mount(page,slug);
    const view=await page.evaluate(()=>({id:poemId,form:document.querySelector('.sound-case')?.dataset.soundForm,eyebrow:document.querySelector('.challenge-eyebrow').textContent,submit:document.querySelector('[data-ch=submit]').textContent,text:document.querySelector('#view').textContent,label:document.querySelector('[data-ch=listen]').getAttribute('aria-label'),options:document.querySelectorAll('.sound-case-option').length}));
    const expected=view.id<=6?'clinic':'police',form=FORMS[expected];
    check(`${engine} poem ${view.id} uses the ${expected} form`,view.form===expected&&view.eyebrow===form.kind&&view.submit===form.submit&&!!view.label);
    check(`${engine} poem ${view.id} keeps every option and no walnut wording`,view.options===await page.evaluate(()=>item.options.length)&&!view.text.includes('核桃'));
   }
   for(const [slug,form] of [['yong-e',FORMS.clinic],['zheng-ren-mai-lu',FORMS.police]]){
    await mount(page,slug);check(`${engine} ${slug} question opens on the plain scene`,await pictures(page,form,'scene'));
    await answer(page,true);
    check(`${engine} ${slug} correct answer fades in the solved picture only`,await pictures(page,form,'solved'));
    check(`${engine} ${slug} correct answer shows the solved scene`,await page.evaluate(form=>document.querySelector('.sound-case').classList.contains('is-solved')&&document.querySelector('.challenge-feedback strong').textContent===form.right,form));
    check(`${engine} ${slug} research and answer records are unchanged`,await page.evaluate(()=>submissions.length===1&&submissions[0].status==='correct'&&['item_presented','hint_used','answer_submitted','feedback_shown'].every(type=>audit.some(event=>event.type===type))));
    await mount(page,slug);await answer(page,false);
    check(`${engine} ${slug} wrong answer is gentle`,await page.evaluate(form=>document.querySelector('.sound-case').classList.contains('is-missed')&&document.querySelector('.challenge-feedback strong').textContent===form.wrong&&submissions[0].status==='incorrect',form));
    check(`${engine} ${slug} wrong answer fades in the ${form.pictures[2]} picture only`,await pictures(page,form,'missed'));
   }
   // The next listening question starts again on the plain scene.
   for(const [slug,form] of [['yong-e',FORMS.clinic],['yong-xue',FORMS.police]]){
    await mount(page,slug);await answer(page,false);
    const before=await page.evaluate(()=>document.querySelector('.challenge-prompt').textContent+'|'+document.querySelector('.challenge-count').textContent);
    await page.locator('[data-ch=next]').tap();await page.waitForFunction(before=>document.querySelector('.sound-case')&&document.querySelector('.challenge-prompt').textContent+'|'+document.querySelector('.challenge-count').textContent!==before,before);
    check(`${engine} ${slug} next question after a wrong answer is back on the plain scene`,await pictures(page,form,'scene'));
   }
   for(const viewport of [{width:1180,height:820},{width:820,height:1180},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    for(const slug of ['yong-e','zheng-ren-mai-lu']){
     await mount(page,slug);check(`${engine} ${slug} ${viewport.width}x${viewport.height} fits before answering`,await fits(page));
     await answer(page,false);check(`${engine} ${slug} ${viewport.width}x${viewport.height} fits with feedback`,await fits(page));
     check(`${engine} ${slug} ${viewport.width}x${viewport.height} missed picture covers the scene like the others`,await pictures(page,FORMS[slug==='yong-e'?'clinic':'police'],'missed'));
    }
   }
   check(engine+' no browser errors',errors.length===0);await context.close();
  }finally{await browser.close();}
 }}finally{await new Promise(resolve=>server.close(resolve));}
 console.log(JSON.stringify({ok:true,checks:checks.length},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
