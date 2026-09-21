'use strict';
// Local production modules and browser input; no accounts or paid providers.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),checks=[],errors=[];
const cssSource=fs.readFileSync(path.join(repo,'scripts/build-maanshan-css.cjs'),'utf8');
const css=[...cssSource.match(/const files = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m=>fs.readFileSync(path.join(repo,'maanshan',m[1]),'utf8')).join('\n');
const fixture='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><script src="/maanshan/vendor/hanzi-writer.min.js"></script><div id="app"><div class="workspace lesson-shell poem-color-6 view-quiz"><div class="lesson-bar"><a class="back-library" href="#">返回</a><div class="lesson-title"><div class="lesson-heading"><h1>練習小遊戲</h1><p>六年級</p></div></div><div class="lesson-tools"><span>更多</span></div></div><main class="study-main" id="main"><section id="view" class="view-section"></section></main></div></div>';
const mime={'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fixture);}if(u.pathname==='/fixture.css'){res.setHeader('Content-Type','text/css');return res.end(css);}const file=path.resolve(repo,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(repo+path.sep)||!mime[path.extname(file)])return res.writeHead(404).end();fs.readFile(file,(error,data)=>{if(error)return res.writeHead(404).end();res.setHeader('Content-Type',mime[path.extname(file)]);res.end(data);});});
const check=(name,pass)=>{assert(pass,name);checks.push(name);};
async function mount(page,{audio='failed'}={}){
 await page.evaluate(async({audio})=>{
  window.challenge?.destroy();scrollTo(0,0);window.submissions=[];window.inkRequests=[];window.audit=[];window.audioMode=audio;
  const {mountChallenge}=await import('/maanshan/challenge.mjs'),{CHALLENGE_SETS}=await import('/maanshan/challenge-data.mjs'),{newAttempt,attemptItems,recordAnswer}=await import('/maanshan/challenge-state.mjs');
  const poems=await(await fetch('/maanshan/poems.json')).json(),poem=poems.poems.find(p=>p.grade===6),set=CHALLENGE_SETS[poem.slug],saved=newAttempt(set,{seed:'tablet-writing-input'}),items=attemptItems(saved,set),index=items.findIndex(i=>i.type==='dictation');
  for(let i=0;i<index;i++)recordAnswer(saved,set,i,{status:'skipped'});saved.cursor=index;window.target=items[index].target;
  window.challenge=mountChallenge(document.querySelector('#view'),{poem,saved,onChange:state=>{window.saved=state;},onAnswer:value=>submissions.push(value),onResearch:(type,event)=>audit.push({type,...event}),playAudio:()=>audioMode==='pending'?new Promise(resolve=>window.resolveAudio=resolve):Promise.resolve(audioMode==='success'),recognize:async ink=>{inkRequests.push(ink);return{candidates:[target.char]};}});
 },{audio});
 await page.locator('.cw-board').waitFor();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function draw(page,context,engine,{pointer='touch',cancel=false}={}){
 const canvas=page.locator('.cw-board canvas');await canvas.scrollIntoViewIfNeeded();const b=await canvas.boundingBox(),x=b.x+b.width*.25,y=b.y+b.height*.35;
 const before=await canvas.evaluate(el=>el.toDataURL());const scroll=await canvas.evaluate(el=>{const values=[];for(let node=el;node;node=node.parentElement)values.push([node.scrollLeft,node.scrollTop]);return JSON.stringify(values);});
 if(pointer==='touch'&&engine==='chromium'){
  const cdp=await context.newCDPSession(page);const send=(type,touchPoints)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints});await send('touchStart',[{x,y,id:1,force:1}]);
  for(let i=1;i<=8;i++)await send('touchMove',[{x:x+b.width*.055*i,y:y+b.height*.025*i,id:1,force:1}]);await send(cancel?'touchCancel':'touchEnd',[]);await cdp.detach();
 }else if(pointer==='touch-only'){
  await canvas.evaluate((el,{x,y,width,height,cancel})=>{
   const board=el.closest('.cw-board');
   const emit=(type,px,py)=>{
    const touch={identifier:91,target:el,clientX:px,clientY:py,pageX:px+scrollX,pageY:py+scrollY,radiusX:2,radiusY:2,force:1};
    const ended=type==='touchend'||type==='touchcancel';
    const event=new Event(type,{bubbles:true,cancelable:true});
    Object.defineProperties(event,{changedTouches:{value:[touch]},touches:{value:ended?[]:[touch]},targetTouches:{value:ended?[]:[touch]}});
    board.dispatchEvent(event);
   };
   emit('touchstart',x,y);
   for(let i=1;i<=8;i++)emit('touchmove',x+width*.055*i,y+height*.025*i);
   emit(cancel?'touchcancel':'touchend',x+width*.44,y+height*.2);
  },{x,y,width:b.width,height:b.height,cancel});
 }else if(pointer==='pen'){
  // WebKit's public automation API has no Apple Pencil transport. Exercise the
  // actual pen handlers while keeping physical Pencil testing explicitly open.
  await canvas.dispatchEvent('pointerdown',{pointerType:'pen',pointerId:71,isPrimary:true,button:0,buttons:1,pressure:.5,clientX:x,clientY:y});
  for(let i=1;i<=8;i++)await page.dispatchEvent('body','pointermove',{pointerType:'pen',pointerId:71,isPrimary:true,button:-1,buttons:1,pressure:.6,clientX:x+b.width*.055*i,clientY:y+b.height*.025*i});
  await page.dispatchEvent('body','pointerup',{pointerType:'pen',pointerId:71,isPrimary:true,button:0,buttons:0,clientX:x+b.width*.44,clientY:y+b.height*.2});
 }else if(pointer==='touch')await page.touchscreen.tap(x,y);
 else{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+b.width*.44,y+b.height*.2,{steps:8});await page.mouse.up();}
 const after=await canvas.evaluate(el=>el.toDataURL()),endScroll=await canvas.evaluate(el=>{const values=[];for(let node=el;node;node=node.parentElement)values.push([node.scrollLeft,node.scrollTop]);return JSON.stringify(values);});
 return{ink:before!==after,scrollStable:scroll===endScroll,canvas:b};
}
async function renderedInk(page,label){
 // Inspect the composited screenshot before reading the writing canvas. A
 // toDataURL/getImageData call can synchronize a delayed GPU canvas and hide
 // a real presentation bug while still proving that the backing bitmap changed.
 const board=page.locator('.cw-board'),png=await board.screenshot(),evidence=process.env.HANDWRITING_EVIDENCE_DIR;
 if(evidence){fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,label.replace(/[^a-z0-9_-]/gi,'-')+'.png'),png);}
 return page.evaluate(async base64=>{
  const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();
  const copy=document.createElement('canvas');copy.width=image.naturalWidth;copy.height=image.naturalHeight;
  const context=copy.getContext('2d');context.drawImage(image,0,0);const rgba=context.getImageData(0,0,copy.width,copy.height).data;
  let pixels=0,left=copy.width,right=0,top=copy.height,bottom=0;
  for(let y=2;y<copy.height-2;y++)for(let x=2;x<copy.width-2;x++){const i=(y*copy.width+x)*4;if(rgba[i]<100&&rgba[i+1]<130&&rgba[i+2]<110){pixels++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
  return{pixels,width:copy.width,height:copy.height,inkWidth:Math.max(0,right-left),inkHeight:Math.max(0,bottom-top)};
 },png.toString('base64'));
}
async function drawMixedEvents(page,{dual=false,cancel=false}={}){
 const canvas=page.locator('.cw-board canvas');await canvas.scrollIntoViewIfNeeded();
 await canvas.evaluate((el,{dual,cancel})=>{
  const board=el.closest('.cw-board'),b=el.getBoundingClientRect(),x=b.left+b.width*.2,y=b.top+b.height*.25;
  const pointer=(type,px,py,pressure)=>board.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:83,isPrimary:true,button:type==='pointermove'?-1:0,buttons:type==='pointerup'?0:1,pressure,clientX:px,clientY:py}));
  const touch=(type,px,py,force)=>{
   const point={identifier:31,target:el,clientX:px,clientY:py,pageX:px+scrollX,pageY:py+scrollY,radiusX:3,radiusY:3,force},ended=type==='touchend'||type==='touchcancel',event=new Event(type,{bubbles:true,cancelable:true});
   Object.defineProperties(event,{changedTouches:{value:[point]},touches:{value:ended?[]:[point]},targetTouches:{value:ended?[]:[point]}});board.dispatchEvent(event);
  };
  // Hybrid Android/WebView sequence: a pointer-down is delivered, then only
  // the Touch Events stream carries movement after preventDefault/capture.
  pointer('pointerdown',x,y,.2);touch('touchstart',x,y,.2);
  for(let i=1;i<=8;i++){const px=x+b.width*.055*i,py=y+b.height*.025*i,force=.2+i*.08;if(dual)pointer('pointermove',px,py,force);touch('touchmove',px,py,force);}
  touch(cancel?'touchcancel':'touchend',x+b.width*.44,y+b.height*.2,0);
  pointer(cancel?'pointercancel':'pointerup',x+b.width*.44,y+b.height*.2,0);
 },{dual,cancel});
}
async function audit(engine,width,height){
 const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));const context=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:true}),page=await context.newPage();page.on('pageerror',e=>errors.push(engine+' '+e.message));
 const label=engine+' '+width+'x'+height;
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
  for(const [name,options]of [['pointer-start-touch-moves',{}],['both-event-families',{dual:true}],['mixed-touch-cancel',{cancel:true}]]){
   await mount(page);const before=await renderedInk(page,label+'-'+name+'-before');
   await drawMixedEvents(page,options);const visible=await renderedInk(page,label+'-'+name+'-drawn');
   check(label+' '+name+' visible stroke spans board (not just an invisible dot)',visible.pixels-before.pixels>80&&visible.inkWidth>visible.width*.3&&visible.inkHeight>visible.height*.12);
   await page.locator('[data-cw=submit]').tap();await page.locator('.cw-review:not([hidden])').waitFor();
   const ink=await page.evaluate(()=>inkRequests);
   check(label+' '+name+' recognition gets one complete stroke without duplicated pressure samples',ink.length===1&&ink[0].length===1&&ink[0][0][0].length>=9&&ink[0][0][0].length<=11);
  }
  await mount(page);
  const initial=await draw(page,context,engine);check(label+' can write before playing audio',initial.ink);check(label+' touch writing keeps page still',initial.scrollStable);check(label+' local ink enables submit',await page.locator('[data-cw=submit]').isEnabled());
  await page.locator('[data-ch=listen]').tap();await page.waitForFunction(()=>!document.querySelector('[data-ch=listen]').hasAttribute('aria-busy'));await page.locator('[data-cw=clear]').tap();
  check(label+' failed audio leaves writing available',(await draw(page,context,engine)).ink);
  await page.evaluate(()=>window.audioMode='pending');await page.locator('[data-ch=listen]').tap();await page.locator('[data-cw=clear]').tap();
  check(label+' slow audio leaves writing available',(await draw(page,context,engine,{pointer:'mouse'})).ink);
  await page.locator('[data-cw=submit]').tap();await page.locator('.cw-review:not([hidden])').waitFor();
  const submission=await page.evaluate(()=>({calls:inkRequests.length,strokes:inkRequests[0],answers:saved.answers.length}));check(label+' recognition receives real multi-point ink',submission.calls===1&&submission.strokes[0][0].length>=3);check(label+' one assessed answer is saved',submission.answers===3);
  await page.locator('[data-cw=strokes]').tap();await page.locator('.cw-animation svg path').first().waitFor({state:'attached'});await page.locator('.cw-animation svg').waitFor();
  const bounds=await page.locator('.cw-animation svg').evaluate(el=>{const a=el.getBoundingClientRect(),b=el.closest('.cw-board').getBoundingClientRect();return a.left>=b.left&&a.top>=b.top&&a.right<=b.right+1&&a.bottom<=b.bottom+1;});check(label+' stroke demonstration fits board',bounds);
  await page.locator('[data-cw=practise]').tap();check(label+' practise removes animation overlay',await page.locator('.cw-animation').isHidden());check(label+' practise accepts finger input',(await draw(page,context,engine)).ink);check(label+' free practice leaves original assessment',await page.evaluate(()=>inkRequests.length===1&&saved.answers.length===3));
  await page.locator('[data-cw=clear]').tap();check(label+' pen event path draws',(await draw(page,context,engine,{pointer:'pen'})).ink);
  await page.locator('[data-cw=clear]').tap();const touchOnly=await draw(page,context,engine,{pointer:'touch-only'});check(label+' Touch Events without Pointer Events draw',touchOnly.ink);check(label+' Touch Events keep page still',touchOnly.scrollStable);
  await page.setViewportSize({width:height,height:width});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.locator('[data-cw=clear]').tap();check(label+' after orientation change mouse writes',(await draw(page,context,engine,{pointer:'mouse'})).ink);
  await mount(page);await page.locator('[data-ch=skip]').tap();check(label+' learn-first board accepts the very first touch without another button',(await draw(page,context,engine)).ink);check(label+' learning skip stays ungraded',await page.evaluate(()=>saved.answers.at(-1).status==='skipped'&&inkRequests.length===0));
  await page.locator('[data-cw=clear]').click();await page.locator('[data-cw=strokes]').click();await page.locator('.cw-animation svg').waitFor();check(label+' drawing directly on demonstration begins free practice',(await draw(page,context,engine)).ink);check(label+' touching demonstration removes blocking overlay',await page.locator('.cw-animation').isHidden());
 }catch(error){const evidence=process.env.HANDWRITING_EVIDENCE_DIR;if(evidence){fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,label.replace(/ /g,'-')+'-failure.png'),fullPage:true});}throw error;}finally{await context.close();await browser.close();}
}
(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));for(const engine of ['chromium','webkit'])for(const [width,height]of [[390,844],[768,1024],[1180,820]])await audit(engine,width,height);check('no browser errors',errors.length===0);console.log(JSON.stringify({ok:true,checks,errors},null,2));})().catch(e=>{console.error(e);console.log(JSON.stringify({ok:false,checks,errors},null,2));process.exitCode=1;}).finally(()=>server.close());
