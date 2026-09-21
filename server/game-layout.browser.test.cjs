'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),origin='https://game-layout.invalid';
const poems=JSON.parse(fs.readFileSync(path.join(repo,'maanshan/poems.json'),'utf8')).poems;
const cssSource=fs.readFileSync(path.join(repo,'scripts/build-maanshan-css.cjs'),'utf8');
const css=[...cssSource.match(/const files = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m=>fs.readFileSync(path.join(repo,'maanshan',m[1]),'utf8')).join('\n');
const selectors=['.poem-goose-game','.farewell-story','.poem-view-game','.river-puzzle-game','.poem-garden','.rain-catcher'];
const ready=['[data-goose-color]:not([disabled])','[data-fs-dock]:not([disabled])','[data-vg-capture]:not([disabled])','[data-river-slot]:not([disabled])','[data-plant]:not([disabled])','[data-rc-start]:not([disabled])'];
const checks=[],errors=[];let browser;
function check(name,value){assert(value,name);checks.push(name);}
async function setup(width,height){
 const context=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:width<700,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url()),endpoint=url.pathname.replace(/\/$/,'');
  if(endpoint.startsWith('/api/')){
   let data={ok:true};
   if(endpoint==='/api/school-auth')data=url.searchParams.get('action')==='progress'?{enabled:true,userId:'synthetic-game-layout',poems:{}}:{enabled:true,authenticated:true,user:{id:'synthetic-game-layout',role:'student',displayName:'測試同學',grade:1,cls:'A',classNo:1,isTest:true,learningScope:'all-grades',researchEnabled:false},csrfToken:'synthetic-csrf'};
   if(endpoint==='/api/school-recordings')data={ok:true,userId:'synthetic-game-layout',recordings:[]};
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  }
  if(url.pathname==='/maanshan/app.bundle.css')return route.fulfill({contentType:'text/css',body:css});
  let relative=url.pathname;if(relative==='/maanshan/')relative+='index.html';
  if(relative.includes('/published/')&&relative.includes('/maanshan/media/'))relative=relative.slice(relative.indexOf('/maanshan/media/'));
  const file=path.resolve(repo,'.'+decodeURIComponent(relative));
  if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
  const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.glb':'model/gltf-binary'}[path.extname(file)]||'application/octet-stream';
  return route.fulfill({contentType:mime,body:fs.readFileSync(file)}).catch(()=>{});
 });
 await page.goto(origin+'/maanshan/');await page.locator('.poem-entry').first().waitFor();await page.evaluate(()=>document.fonts.ready);
 return {context,page};
}
async function inspect(page,selector){return page.locator(selector).evaluate(el=>{
 const b=el.getBoundingClientRect(),body=document.querySelector('.challenge-body'),v=body.getBoundingClientRect();
 const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const outside=[...el.querySelectorAll('button,input')].filter(visible).filter(e=>{const x=e.getBoundingClientRect();return x.left<-.5||x.right>innerWidth+.5;}).map(e=>e.textContent||e.getAttribute('aria-label'));
 return {outside,scroll:body.scrollHeight-body.clientHeight,box:{x:b.x,y:b.y,w:b.width,h:b.height},viewport:{x:v.x,y:v.y,w:v.width,h:v.height},documentOverflow:document.documentElement.scrollWidth-innerWidth};
});}
(async()=>{
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const [width,height] of [[390,844],[768,1024],[1024,768],[1180,820],[1366,1024]]){
   const {context,page}=await setup(width,height);
   try{for(let i=0;i<poems.length;i++){
    const poem=poems[i];await page.evaluate(slug=>location.hash='#'+slug+'/quiz',poem.slug);await page.locator(selectors[i]).waitFor();await page.locator(ready[i]).first().waitFor({timeout:25000});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    let state=await inspect(page,selectors[i]);check(`${width}x${height} ${poem.slug} no horizontal overflow ${JSON.stringify(state)}`,state.outside.length===0&&state.documentOverflow<=1);
    if(width>=1000)check(`${width}x${height} ${poem.slug} controls fit without inner scrolling ${JSON.stringify(state)}`,state.scroll<=2);
    if(i===0){
     check('goose markers hidden and disabled before colour selection',await page.locator('[data-goose-part]').evaluateAll(nodes=>nodes.every(n=>n.hidden&&n.disabled)));
     await page.locator('[data-goose-color=white]').tap();
     check('goose colour reveals three reachable markers',await page.locator('[data-goose-part]').evaluateAll(nodes=>nodes.every(n=>!n.hidden&&!n.disabled)));
     await page.locator('[data-goose-part=feather]').tap();
     check('goose next fill requires another colour',await page.locator('[data-goose-part]').evaluateAll(nodes=>nodes.every(n=>n.hidden&&n.disabled)));
    }
    if(i===1){
     await page.locator('[data-fs-dock]').tap();await page.locator('[data-fs-next]').tap();
     state=await inspect(page,selectors[i]);check(`${width} farewell rhythm controls fit`,state.outside.length===0&&(width<1000||state.scroll<=2));
     for(const n of [0,1,0,1])await page.locator(`[data-fs-foot="${n}"]`).tap();
     await page.locator('[data-fs-next]').tap();state=await inspect(page,selectors[i]);check(`${width} farewell word tickets fit`,state.outside.length===0&&(width<1000||state.scroll<=2));
    }
    if(i===5){await page.locator('[data-rc-start]').tap();state=await inspect(page,selectors[i]);check(`${width} rain active controls fit`,state.outside.length===0&&(width<1000||state.scroll<=2));}
    if(process.env.GAME_LAYOUT_EVIDENCE_DIR&&width>=1000)await page.screenshot({path:path.join(process.env.GAME_LAYOUT_EVIDENCE_DIR,`${poem.slug}-${width}.png`),fullPage:true});
   }
   if(width>=1000)for(const poem of poems.filter(p=>p.grade>=4)){
    await page.evaluate(slug=>location.hash='#'+slug+'/explore',poem.slug);await page.locator('.explore-card').waitFor();
    const before=await page.locator('#view').evaluate(el=>({scroll:el.scrollHeight-el.clientHeight,cardBottom:el.querySelector('.explore-card').getBoundingClientRect().bottom,viewport:innerHeight}));
    check(`${width} ${poem.slug} AR card stays within view ${JSON.stringify(before)}`,before.scroll<=2&&before.cardBottom<=before.viewport);
    await page.evaluate(async slug=>{
     const {EXPLORATION_CONTENT}=await import('/maanshan/exploration-data.mjs');
     for(const item of EXPLORATION_CONTENT[slug].observations){document.querySelector(`[data-explore=answer][data-answer="${item.answer}"]`).click();document.querySelector('[data-explore=next]').click();}
    },poem.slug);
    const target=page.locator('.explore-finish-actions a');
    check(`${width} ${poem.slug} AR completion leads to practice`,await target.getAttribute('href')==='#'+poem.slug+'/quiz'&&(await target.innerText()).includes('進入練一練'));
    const fits=await target.evaluate(el=>{const b=el.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.height>=44&&b.bottom<=innerHeight;});
    check(`${width} ${poem.slug} AR completion button fits`,fits);
   }
   }finally{await context.close();}
  }
  check('no browser exceptions',errors.length===0);console.log(JSON.stringify({ok:true,checks,pageErrors:errors},null,2));
 }catch(error){console.error(error);process.exitCode=1;}finally{await browser?.close();}
})();
