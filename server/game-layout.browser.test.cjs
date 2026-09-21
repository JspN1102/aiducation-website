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
 const buttons=[...el.querySelectorAll('button,input')].filter(visible);
 const outside=buttons.filter(e=>{const x=e.getBoundingClientRect();return x.left<-.5||x.right>innerWidth+.5;}).map(e=>e.textContent||e.getAttribute('aria-label'));
 const vertical=buttons.filter(e=>!e.closest('.gr-picture,.fs-stage,.goose-picture,.pvg-stage,.rc-field,.river-puzzle-board')).filter(e=>{const x=e.getBoundingClientRect();return x.top<v.top-.5||x.bottom>v.bottom+.5||x.top<0||x.bottom>innerHeight;}).map(e=>e.textContent||e.getAttribute('aria-label'));
 const textOutside=[...el.querySelectorAll('.gr-instruction p,.gr-count,.gr-method,.gr-feedback')].filter(visible).filter(e=>{
  const x=e.getBoundingClientRect(),panel=e.closest('.gr-instruction,.gr-actionline'),p=panel?.getBoundingClientRect();
  return x.top<v.top-.5||x.bottom>v.bottom+.5||(p&&(x.top<p.top-.5||x.bottom>p.bottom+.5));
 }).map(e=>e.className);
 return {outside,vertical,textOutside,scroll:body.scrollHeight-body.clientHeight,box:{x:b.x,y:b.y,w:b.width,h:b.height},viewport:{x:v.x,y:v.y,w:v.width,h:v.height},documentOverflow:document.documentElement.scrollWidth-innerWidth};
});}
async function inspectAR(page){return page.locator('#view').evaluate(el=>{
 const box=el.getBoundingClientRect(),card=el.querySelector('.explore-card').getBoundingClientRect();
 const outside=[...el.querySelectorAll('button,a')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').filter(e=>{const b=e.getBoundingClientRect();return b.left<0||b.right>innerWidth||b.top<box.top-.5||b.bottom>box.bottom+.5;}).map(e=>e.textContent||e.getAttribute('aria-label'));
 return {scroll:el.scrollHeight-el.clientHeight,cardBottom:card.bottom,viewBottom:box.bottom,bottomGap:box.bottom-card.bottom,outside,viewport:innerHeight};
});}
(async()=>{
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  if(process.env.GAME_LAYOUT_EVIDENCE_DIR)fs.mkdirSync(process.env.GAME_LAYOUT_EVIDENCE_DIR,{recursive:true});
  for(const [width,height] of [[390,844],[768,1024],[900,620],[1024,650],[1024,768],[1180,720],[1180,820],[1366,1024]]){
   const {context,page}=await setup(width,height);
   try{for(let i=0;i<poems.length;i++){
    const poem=poems[i];await page.evaluate(slug=>location.hash='#'+slug+'/quiz',poem.slug);await page.locator(selectors[i]).waitFor();await page.locator(ready[i]).first().waitFor({timeout:25000});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    let state=await inspect(page,selectors[i]);check(`${width}x${height} ${poem.slug} no horizontal overflow ${JSON.stringify(state)}`,state.outside.length===0&&state.documentOverflow<=1);
    if(width>=900)check(`${width}x${height} ${poem.slug} controls fit without inner scrolling ${JSON.stringify(state)}`,state.scroll<=2&&state.vertical.length===0);
    if(i===0){
     check('goose markers hidden and disabled before colour selection',await page.locator('[data-goose-part]').evaluateAll(nodes=>nodes.every(n=>n.hidden&&n.disabled)));
     await page.locator('[data-goose-color=white]').tap();
     check('goose colour reveals three reachable markers',await page.locator('[data-goose-part]').evaluateAll(nodes=>nodes.every(n=>!n.hidden&&!n.disabled)));
     await page.locator('[data-goose-part=feather]').tap();
     check('goose next fill requires another colour',await page.locator('[data-goose-part]').evaluateAll(nodes=>nodes.every(n=>n.hidden&&n.disabled)));
    }
    if(i===1){
     await page.locator('[data-fs-dock]').tap();await page.locator('[data-fs-next]').tap();
     state=await inspect(page,selectors[i]);check(`${width}x${height} farewell rhythm controls fit ${JSON.stringify(state)}`,state.outside.length===0&&(width<900||state.scroll<=2&&state.vertical.length===0));
     for(const n of [0,1,0,1])await page.locator(`[data-fs-foot="${n}"]`).tap();
     await page.locator('[data-fs-next]').tap();state=await inspect(page,selectors[i]);check(`${width}x${height} farewell word tickets fit ${JSON.stringify(state)}`,state.outside.length===0&&(width<900||state.scroll<=2&&state.vertical.length===0));
    }
    if(i===2){
     await page.locator('[data-vg-capture]').tap();
     await page.locator('[data-vg-angle]').fill('100');await page.locator('[data-vg-capture]').tap();
     check(`${width}x${height} mountain photographs show above angle, listen and feedback controls`,await page.locator('.mountain-game').evaluate(el=>{const tray=el.querySelector('.pvg-photo-tray').getBoundingClientRect(),slider=el.querySelector('.pvg-camera-control').getBoundingClientRect(),actions=el.querySelector('.pvg-actions').getBoundingClientRect(),status=el.querySelector('.pvg-status').getBoundingClientRect();return tray.bottom<=slider.top+1&&slider.bottom<=actions.top+1&&actions.bottom<=status.top+1;}));
     if(width>=900)check(`${width}x${height} mountain photos fill their frames`,await page.locator('.pvg-photo-tray').evaluate(el=>[...el.querySelectorAll('figure')].every(f=>{const frame=f.getBoundingClientRect(),img=f.querySelector('img').getBoundingClientRect();return img.width>=frame.width-20&&img.height>=frame.height-72;})));
     state=await inspect(page,selectors[i]);check(`${width}x${height} mountain completion controls fit ${JSON.stringify(state)}`,state.outside.length===0&&(width<900||state.scroll<=2&&state.vertical.length===0));
    }
    if(i===3){
     const trayBox=await page.locator('.river-puzzle-tray').boundingBox();
     for(const piece of [4,1,5,0,3,2]){
      await page.locator(`.river-puzzle-tray [data-piece="${piece}"]`).tap();await page.locator(`[data-river-slot="${piece}"]`).tap();
      if(piece!==2)check(`${width}x${height} river remaining pieces stay inside six-position tray after piece ${piece}`,await page.locator('.river-puzzle-tray').evaluate((el,before)=>{const b=el.getBoundingClientRect();return Math.abs(b.width-before.width)<1&&[...el.children].every(n=>{const p=n.getBoundingClientRect();return p.left>=b.left&&p.right<=b.right+.5&&p.top>=b.top&&p.bottom<=b.bottom+.5;});},trayBox));
     }
     check(`${width}x${height} river audio action does not overlap completed picture`,await page.locator('.river-puzzle-game').evaluate(el=>{const a=el.querySelector('.river-puzzle-board').getBoundingClientRect(),b=el.querySelector('[data-river-audio]').getBoundingClientRect();return a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top;}));
    }
    if(i===4){
     await page.locator('[data-plant="bean-a"]').press('Enter');state=await inspect(page,selectors[i]);
     check(`${width}x${height} garden bean reminder fits ${JSON.stringify(state)}`,state.outside.length===0&&(width<900||state.scroll<=2&&state.vertical.length===0&&state.textOutside.length===0));
     check(`${width}x${height} garden preserves beans after wrong choice`,await page.locator('.gr-count').innerText()==='0 / 8'&&(await page.locator('.gr-feedback').innerText()).includes('這是豆苗'));
     for(const letter of 'abcdefgh')await page.locator(`[data-plant="weed-${letter}"]`).press('Enter');
     await page.locator('.poem-garden.is-done').waitFor();state=await inspect(page,selectors[i]);
     check(`${width}x${height} garden completion feedback fits ${JSON.stringify(state)}`,state.outside.length===0&&(width<900||state.scroll<=2&&state.vertical.length===0&&state.textOutside.length===0));
     check(`${width}x${height} garden completes all eight weeds`,await page.locator('.gr-count').innerText()==='8 / 8');
    }
    if(i===5){await page.locator('[data-rc-start]').tap();state=await inspect(page,selectors[i]);check(`${width}x${height} rain active controls fit ${JSON.stringify(state)}`,state.outside.length===0&&(width<900||state.scroll<=2&&state.vertical.length===0));}
    if(process.env.GAME_LAYOUT_EVIDENCE_DIR&&width>=900)await page.screenshot({path:path.join(process.env.GAME_LAYOUT_EVIDENCE_DIR,`${poem.slug}-${width}x${height}.png`),fullPage:true});
   }
   if(width>=900)for(const poem of poems.filter(p=>p.grade>=4)){
    await page.evaluate(slug=>location.hash='#'+slug+'/explore',poem.slug);await page.locator('.explore-card').waitFor();
    await page.waitForFunction(()=>{const image=document.querySelector('.explore-scene');return image?.complete&&image.naturalWidth>0;});
    const before=await inspectAR(page);
    check(`${width}x${height} ${poem.slug} AR card fills available height without overflow ${JSON.stringify(before)}`,before.scroll<=2&&before.cardBottom<=before.viewport&&before.bottomGap<=8&&before.outside.length===0);
    if(process.env.GAME_LAYOUT_EVIDENCE_DIR)await page.screenshot({path:path.join(process.env.GAME_LAYOUT_EVIDENCE_DIR,`ar-${poem.slug}-${width}x${height}.png`)});
    if(poem.grade===4&&[900,1366].includes(width)){
     await page.locator('[data-explore=ar]').tap();await page.locator('.explore.is-model').waitFor({timeout:30000});
     const model=await inspectAR(page);check(`${width}x${height} AR model controls fit ${JSON.stringify(model)}`,model.scroll<=2&&model.outside.length===0);
     await page.locator('[data-explore=expand]').tap();
     const expanded=await page.locator('#view').evaluate(el=>{
      const v=el.getBoundingClientRect(),s=el.querySelector('.explore-stage').getBoundingClientRect();
      const outside=[...el.querySelectorAll('button')].filter(e=>e.getClientRects().length).some(e=>{const b=e.getBoundingClientRect();return b.top<v.top-.5||b.bottom>v.bottom+.5||b.left<0||b.right>innerWidth;});
      return {scroll:el.scrollHeight-el.clientHeight,stageHeight:s.height,stageFits:s.top>=v.top&&s.bottom<=v.bottom,outside};
     });
     check(`${width}x${height} expanded AR model fits ${JSON.stringify(expanded)}`,expanded.scroll<=2&&expanded.stageHeight>150&&expanded.stageFits&&!expanded.outside);
     if(process.env.GAME_LAYOUT_EVIDENCE_DIR)await page.screenshot({path:path.join(process.env.GAME_LAYOUT_EVIDENCE_DIR,`ar-model-expanded-${width}x${height}.png`)});
     await page.locator('[data-explore=expand]').tap();const returned=await inspectAR(page);
     check(`${width}x${height} AR returns to full-height observation card`,returned.bottomGap<=8&&returned.scroll<=2&&returned.outside.length===0);
    }
    const answers=await page.evaluate(async slug=>(await import('/maanshan/exploration-data.mjs')).EXPLORATION_CONTENT[slug].observations.map(item=>item.answer),poem.slug);
    for(const answer of answers){
     await page.locator(`[data-explore=answer][data-answer="${1-answer}"]`).tap();let state=await inspectAR(page);
     check(`${width}x${height} ${poem.slug} AR retry feedback fits ${JSON.stringify(state)}`,state.scroll<=2&&state.outside.length===0);
     await page.locator(`[data-explore=answer][data-answer="${answer}"]`).tap();state=await inspectAR(page);
     check(`${width}x${height} ${poem.slug} AR correct feedback and next action fit ${JSON.stringify(state)}`,state.scroll<=2&&state.outside.length===0);
     if(process.env.GAME_LAYOUT_EVIDENCE_DIR)await page.screenshot({path:path.join(process.env.GAME_LAYOUT_EVIDENCE_DIR,`ar-answer-${poem.slug}-${width}x${height}.png`)});
     await page.locator('[data-explore=next]').tap();
    }
    const target=page.locator('.explore-finish-actions a');
    check(`${width} ${poem.slug} AR completion leads to practice`,await target.getAttribute('href')==='#'+poem.slug+'/quiz'&&(await target.innerText()).includes('進入練一練'));
    const fits=await target.evaluate(el=>{const b=el.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.height>=44&&b.bottom<=innerHeight;});
    check(`${width} ${poem.slug} AR completion button fits`,fits);
   }
   }finally{await context.close();}
  }
  check('no browser exceptions',errors.length===0);const result={ok:true,checks,pageErrors:errors};if(process.env.GAME_LAYOUT_EVIDENCE_DIR)fs.writeFileSync(path.join(process.env.GAME_LAYOUT_EVIDENCE_DIR,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }catch(error){console.error(error);process.exitCode=1;}finally{await browser?.close();}
})();
