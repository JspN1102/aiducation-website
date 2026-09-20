// Uses production game styles and real browser touch/pointer input.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..');
const mime={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml'};
const fixture=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/maanshan/poem-games/garden-river.css"><link rel="stylesheet" href="/maanshan/poem-games/spring-search.css">
<style>*{box-sizing:border-box}body{margin:0;padding:12px;font-family:sans-serif;--sans:sans-serif}[hidden]{display:none!important}#holder{width:100%;max-width:700px;margin:auto}.tail{height:800px}</style>
<main id="holder"></main><div class="tail"></div>`;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return;}
  const file=path.resolve(repo,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(repo+path.sep)||!url.pathname.startsWith('/maanshan/')||!mime[path.extname(file)]){res.writeHead(404).end();return;}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)]);res.end(data);});
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage(),cdp=await context.newCDPSession(page),errors=[],checks=[];
  page.on('pageerror',error=>errors.push(error.message));
  const tick=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y,id:1,radiusX:2,radiusY:2,force:1}]});
  async function mount(file,method,options={}){
    await page.evaluate(async({file,method,options})=>{
      window.game?.destroy();scrollTo(0,0);window.observed=[];window.completed=0;window.states=[];
      const mod=await import(`/maanshan/poem-games/${file}.mjs`);
      window.game=mod[method](document.querySelector('#holder'),{...options,playAudio:async()=>true,onState:state=>states.push(state),onComplete:()=>completed++,onResearch:(type,fields)=>observed.push({type,...fields})});
    },{file,method,options});
    await page.waitForFunction(()=>document.querySelector('.gr-loading,.rc-loading')?.hidden===true);
    await tick();
  }
  const answers=()=>page.evaluate(()=>observed.filter(e=>e.type==='answer_submitted').length);
  async function plantPoint(id){
    return page.evaluate(id=>{
      const b=document.querySelector(`[data-plant="${id}"]`),r=b.getBoundingClientRect();
      for(let y=r.top+r.height*.15;y<r.bottom-4;y+=4)for(let x=r.left+r.width*.1;x<r.right-4;x+=4){
        if(document.elementFromPoint(x,y)?.closest('[data-plant]')===b)return {x,y};
      }
      throw Error(`No touchable point on ${id}`);
    },id);
  }
  async function rainPoint(percent,y=.8){return page.evaluate(({percent,y})=>{const f=document.querySelector('.rc-field'),r=f.getBoundingClientRect();return {x:r.left+f.clientLeft+f.clientWidth*percent/100,y:r.top+f.clientTop+f.clientHeight*y};},{percent,y});}
  async function boatError(x){return page.evaluate(x=>{const r=document.querySelector('.rc-boat').getBoundingClientRect();return Math.abs(r.left+r.width/2-x);},x);}
  try{
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
    await mount('garden','mountGarden');
    let p=await plantPoint('weed-a');
    await touch('touchStart',p.x,p.y);await touch('touchMove',p.x,p.y-18);await tick();
    const lifted=await page.locator('[data-plant="weed-a"]').evaluate(b=>({lift:parseFloat(b.style.getPropertyValue('--lift')),dragging:b.classList.contains('is-pulling')}));
    assert.equal(lifted.dragging,true);assert.ok(lifted.lift<=-17&&lifted.lift>=-19,'Weed follows the finger before being pulled');
    await touch('touchMove',p.x,p.y-70);await tick();
    assert.equal(await page.locator('[data-plant="weed-a"]').getAttribute('aria-hidden'),'true');
    assert.equal(await answers(),1);await touch('touchEnd');assert.equal(await answers(),1);
    assert.equal(await page.evaluate(()=>scrollY),0);checks.push('garden follows upward touch and pulls once before release');
    p=await plantPoint('weed-b');
    await touch('touchStart',p.x,p.y);await touch('touchMove',p.x+35,p.y+12);await touch('touchEnd');
    assert.equal(await answers(),1,'Sideways/downward motion is not a tap');
    p=await plantPoint('weed-b');await touch('touchStart',p.x,p.y);await touch('touchMove',p.x,p.y-15);await touch('touchCancel');
    assert.equal(await page.locator('.is-pulling').count(),0);assert.equal(await answers(),1);
    await page.touchscreen.tap(p.x,p.y);assert.equal(await answers(),2,'Next intentional tap still removes a weed');
    await page.locator('[data-plant="weed-c"]').focus();await page.keyboard.press('Enter');
    await page.locator('[data-plant="weed-d"]').focus();await page.keyboard.press('Space');
    assert.equal(await answers(),4);checks.push('garden cancel, sideways motion, tap and keyboard remain usable');
    p=await plantPoint('bean-a');await page.touchscreen.tap(p.x,p.y);assert.equal(await answers(),5);
    assert.equal(await page.locator('[data-plant="bean-a"]').getAttribute('aria-hidden'),'false');
    for(const id of ['weed-e','weed-f','weed-g','weed-h']){p=await plantPoint(id);await page.touchscreen.tap(p.x,p.y);}
    assert.equal(await page.evaluate(()=>completed),1);
    assert.equal(await page.evaluate(()=>observed.filter(e=>e.type==='answer_submitted'&&e.result.correct).length),8);
    checks.push('garden completion/research emit once and preserve beans');
    await mount('garden','mountGarden');p=await plantPoint('weed-a');await touch('touchStart',p.x,p.y);await touch('touchMove',p.x,p.y-12);
    await page.evaluate(()=>dispatchEvent(new Event('blur')));await touch('touchEnd');assert.equal(await answers(),0);
    p=await plantPoint('weed-a');await touch('touchStart',p.x,p.y);await page.evaluate(()=>game.destroy());await touch('touchEnd');await tick();assert.equal(await answers(),0);
    await mount('garden','mountGarden',{readOnly:true});assert.equal(await page.locator('[data-plant]:not(:disabled)').count(),0);
    checks.push('garden blur, destroy and readonly cancel gestures');

    await mount('rain','mountRain',{reducedMotion:true});await page.locator('[data-rc-start]').click();
    await page.evaluate(()=>{const f=document.querySelector('.rc-field'),original=f.getBoundingClientRect.bind(f);window.fieldReads=0;f.getBoundingClientRect=()=>{fieldReads++;return original();};window.laneWrites=0;window.ariaWrites=0;window.motionObserver=new MutationObserver(records=>{for(const r of records){if(r.attributeName==='data-lane')laneWrites++;if(r.attributeName==='aria-label')ariaWrites++;}});motionObserver.observe(document.querySelector('.rain-catcher'),{attributes:true,subtree:true});});
    const points=await Promise.all([50,54,58].map(n=>rainPoint(n)));
    await page.evaluate(()=>fieldReads=0);await touch('touchStart',points[0].x,points[0].y);
    for(const point of points.slice(1)){await touch('touchMove',point.x,point.y);await tick();assert.ok(await boatError(point.x)<2,'Boat follows continuous positions inside one lane');}
    assert.equal(await page.locator('.rain-catcher').getAttribute('data-lane'),'1');
    assert.deepEqual(await page.evaluate(()=>({reads:fieldReads,laneWrites,ariaWrites})),{reads:1,laneWrites:0,ariaWrites:0});
    assert.equal(await page.evaluate(()=>scrollY),0);
    await touch('touchEnd');await page.waitForTimeout(180);assert.ok(await boatError(points[0].x)<2);
    assert.equal(await answers(),0);checks.push('rain tracks continuously without scroll, repeated layout or repeated ARIA writes');
    p=await rainPoint(67);await touch('touchStart',p.x,p.y);await touch('touchMove',p.x+160,p.y-10);await tick();
    assert.equal(await page.locator('.rain-catcher').getAttribute('data-lane'),'2');await touch('touchCancel');
    assert.equal(await page.locator('.rain-catcher.is-dragging').count(),0);assert.equal(await answers(),0);
    await page.locator('.rc-field').focus();await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('.rain-catcher').getAttribute('data-lane'),'1');
    checks.push('rain outside-field capture, cancellation and keyboard');
    await page.evaluate(()=>motionObserver.disconnect());
    await page.evaluate(()=>{
      const targets=['小','酥','色','是','勝'];
      for(let n=0;n<5;n++){
        const root=document.querySelector('.rain-catcher'),index=[...root.querySelectorAll('[data-rc-drop]')].findIndex(el=>el.dataset.char===targets[n]);
        while(+root.dataset.lane!==index)root.querySelector(+root.dataset.lane<index?'[data-rc-right]':'[data-rc-left]').click();
        root.querySelector('[data-rc-main]').click();if(n<4)root.querySelector('[data-rc-main]').click();
      }
    });
    assert.equal(await page.evaluate(()=>completed),1);assert.equal(await answers(),5);
    await page.locator('[data-rc-replay]').click();await page.locator('[data-rc-start]').click();
    assert.equal(await page.evaluate(()=>observed.at(-1).context.mode),'free');checks.push('rain five-word completion and replay events unchanged');
    p=await rainPoint(54);await touch('touchStart',p.x,p.y);await page.evaluate(()=>dispatchEvent(new Event('blur')));await touch('touchEnd');
    assert.equal(await page.locator('.rain-catcher.is-dragging').count(),0);
    p=await rainPoint(54);await touch('touchStart',p.x,p.y);await page.evaluate(()=>game.destroy());await touch('touchEnd');await tick();
    await mount('rain','mountRain');await page.locator('[data-rc-start]').click();await tick();
    await page.evaluate(()=>{window.rainAttrs=[];window.rainObserver=new MutationObserver(records=>rainAttrs.push(...records.map(r=>({target:r.target.className,name:r.attributeName}))));rainObserver.observe(document.querySelector('.rain-catcher'),{attributes:true,subtree:true});});
    await page.waitForTimeout(260);
    const attrs=await page.evaluate(()=>{rainObserver.disconnect();return rainAttrs;});
    assert.ok(attrs.filter(r=>r.target==='rc-drops'&&r.name==='style').length>2);
    assert.ok(!attrs.some(r=>r.name==='aria-label'||r.name==='data-lane'));
    assert.equal(await page.locator('.rc-drops').evaluate(el=>el.style.top),'');
    assert.equal(await page.locator('.rc-boat').evaluate(el=>el.style.left),'');
    await page.setViewportSize({width:768,height:1024});await tick();
    p=await rainPoint(58);await touch('touchStart',p.x,p.y);await tick();assert.ok(await boatError(p.x)<2);await touch('touchEnd');
    await page.evaluate(()=>game.showSolution());assert.equal(await page.locator('.rain-catcher.is-dragging').count(),0);
    await page.evaluate(()=>game.destroy());checks.push('rain animation uses transforms; resize, blur, solution and destroy are clean');
    assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks,pageErrors:errors},null,2));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
