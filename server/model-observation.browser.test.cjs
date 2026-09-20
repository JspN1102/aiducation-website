// Actual GLBs and browser touch events; no camera permission, native AR, or paid APIs.
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),evidence=process.env.MODEL_OBSERVATION_EVIDENCE_DIR;
const source=fs.readFileSync(path.join(root,'scripts/build-maanshan-css.cjs'),'utf8');
const cssFiles=[...source.match(/const files = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
const css=cssFiles.map(file=>fs.readFileSync(path.join(root,'maanshan',file),'utf8')).join('\n');
const poems=JSON.parse(fs.readFileSync(path.join(root,'maanshan/poems.json'),'utf8')).poems;
const mime={'.html':'text/html','.json':'application/json','.mjs':'text/javascript','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.glb':'model/gltf-binary','.woff2':'font/woff2'};
const fixture='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/maanshan/app.bundle.css"><style>body{overflow:auto}.workspace{height:auto;min-height:100dvh}#holder{width:100%;max-width:1148px;margin:16px auto}</style><main class="workspace view-explore"><div id="view"><div id="holder"></div></div></main>';
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/maanshan/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return;}
  if(url.pathname==='/maanshan/app.bundle.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root+path.sep)||!mime[path.extname(file)]){res.writeHead(404).end();return;}
  fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)]);res.end(bytes);});
});
let browser;const checks=[],errors=[];
const check=(label,value)=>{assert(value,label);checks.push({label,passed:true});};
async function touch(page,context,{pinch=false}={}){
  const canvas=page.locator('.explore-canvas canvas');await canvas.scrollIntoViewIfNeeded();
  const box=await canvas.boundingBox(),cdp=await context.newCDPSession(page),x=box.x+box.width*.5,y=box.y+box.height*.6;
  const points=distance=>pinch?[{x:x-distance,y,id:1},{x:x+distance,y,id:2}]:[{x:x+distance,y,id:1}];
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(pinch?22:0)});
  for(let n=1;n<=6;n++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points((pinch?22:0)+n*8)});await page.evaluate(()=>new Promise(requestAnimationFrame));}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
}
async function setup(width,height){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,hasTouch:true,reducedMotion:'reduce'}),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.cameraRequests=0;window.xrRequests=0;window.drawCalls=0;
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia(){window.cameraRequests++;throw new Error('Observation must not request the camera');}}});
    Object.defineProperty(navigator,'xr',{configurable:true,value:{isSessionSupported:async()=>true,requestSession(){window.xrRequests++;throw new Error('Observation must not open native AR');}}});
    for(const prototype of [window.WebGLRenderingContext?.prototype,window.WebGL2RenderingContext?.prototype].filter(Boolean)){
      for(const method of ['drawElements','drawArrays']){const native=prototype[method];prototype[method]=function(...args){window.drawCalls++;return native.apply(this,args);};}
    }
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/maanshan/fixture`);
  await page.evaluate(()=>document.fonts.ready);
  const mount=async poem=>page.evaluate(async poem=>{
    window.activity?.destroy();window.events=[];window.completed=0;
    const {mountExploration}=await import('/maanshan/exploration.mjs');
    window.activity=mountExploration(document.querySelector('#holder'),{poem,onResearch:(type,fields)=>events.push({type,...fields}),onComplete:()=>completed++});
  },poem);
  return {context,page,mount};
}
async function verifyModels(){
  const {page,context,mount}=await setup(1180,820);
  try{
    for(const poem of poems.filter(p=>p.grade>=4)){
      await mount(poem);check(poem.slug+' model remains lazy',await page.locator('canvas').count()===0);
      await page.locator('[data-explore=ar]').click();await page.locator('.explore.is-model').waitFor({timeout:25000});
      await page.waitForFunction(()=>window.drawCalls>0);
      check(poem.slug+' model shown without camera/native AR',await page.evaluate(()=>!cameraRequests&&!xrRequests&&!document.querySelector('video,.explore-ar-overlay')));
      check(poem.slug+' model entry makes way for gesture controls',!await page.locator('[data-explore=ar]').isVisible()&&await page.locator('.explore-model-hint').isVisible());
      const pixel=await page.locator('canvas').evaluate(canvas=>({width:canvas.width,height:canvas.height,cssWidth:canvas.getBoundingClientRect().width}));
      check(poem.slug+' retina buffer remains bounded',pixel.width/pixel.cssWidth>1.8&&pixel.width*pixel.height<=2400001);
      await page.waitForTimeout(180);const idle=await page.evaluate(()=>drawCalls);await page.waitForTimeout(200);
      check(poem.slug+' idle viewer does not render continuously',await page.evaluate(()=>drawCalls)===idle);
      await touch(page,context);check(poem.slug+' touch rotates the model',await page.evaluate(()=>events.some(e=>e.interaction==='camera_rotate')));
      const beforePinch=await page.locator('canvas').screenshot();await touch(page,context,{pinch:true});
      check(poem.slug+' pinch visibly changes the model',!beforePinch.equals(await page.locator('canvas').screenshot()));
      check(poem.slug+' two fingers zoom the model',await page.evaluate(()=>events.some(e=>e.interaction==='camera_zoom')));
      await page.locator('[data-explore=reset]').click();check(poem.slug+' reset is actionable',await page.evaluate(()=>events.some(e=>e.interaction==='camera_reset')));
      if(evidence){fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,poem.slug+'-tablet.png'),fullPage:true});}
      await page.locator('[data-explore=expand]').click();check(poem.slug+' expanded view hides the question',!await page.locator('.explore-card').isVisible());
      await page.keyboard.press('Escape');check(poem.slug+' Escape restores the question',await page.locator('.explore-card').isVisible());
      await page.evaluate(()=>{window.savedCanvas=document.querySelector('canvas');window.lost=0;savedCanvas.addEventListener('webglcontextlost',()=>window.lost++);activity.destroy();});
      await page.waitForFunction(()=>window.lost>0);check(poem.slug+' leaving disposes the GPU context',await page.locator('canvas').count()===0);
    }
    for(const poem of poems.filter(p=>p.grade<=3)){await mount(poem);check(poem.slug+' retains the lower-grade rule',await page.locator('.explore-unavailable').count()===1&&await page.locator('[data-explore=ar],canvas').count()===0);}
    let failures=1;await page.route('**/*.glb*',route=>failures-- >0?route.fulfill({status:503,body:''}):route.continue());
    await mount(poems[3]);await page.locator('[data-explore=ar]').click();await page.locator('.explore-notice').waitFor();
    check('failed model preserves the picture and a retry button',await page.locator('[data-explore=ar]').isEnabled()&&await page.locator('.explore-card').isVisible());
    await page.locator('[data-explore=ar]').click();await page.locator('.is-model').waitFor();check('model retry succeeds',await page.locator('canvas').isVisible());
    await page.unroute('**/*.glb*');
    // A response that arrives after the child leaves must not restore a canvas.
    let release;await page.route('**/*.glb*',async route=>{await new Promise(resolve=>release=resolve);await route.continue().catch(()=>{});});
    await mount(poems[3]);await page.locator('[data-explore=ar]').click();
    for(let n=0;!release&&n<30;n++)await page.waitForTimeout(20);
    assert(release);await page.evaluate(()=>activity.destroy());release();await page.waitForTimeout(180);
    check('late model response cannot reopen a destroyed activity',await page.locator('canvas,.explore').count()===0);
    check('the entire observation session issued zero camera/native requests',await page.evaluate(()=>cameraRequests===0&&xrRequests===0));
  }finally{await context.close();}
}
async function layoutChecks(){
  for(const [width,height] of [[320,740],[390,844],[844,390],[768,1024],[1024,768],[1440,1000]]){
    const {page,context,mount}=await setup(width,height);
    try{
      await mount(poems[5]);await page.locator('[data-explore=ar]').click();await page.locator('.is-model').waitFor({timeout:25000});
      const state=await page.evaluate(()=>{
        const stage=document.querySelector('.explore-stage').getBoundingClientRect(),card=document.querySelector('.explore-card').getBoundingClientRect();
        return {noOverflow:document.documentElement.scrollWidth<=innerWidth+1,stage:{x:stage.x,y:stage.y,width:stage.width,height:stage.height},card:{x:card.x,y:card.y},hintSize:parseFloat(getComputedStyle(document.querySelector('.explore-model-hint')).fontSize),pinyin:parseFloat(getComputedStyle(document.querySelector('.explore-word small')).fontSize),targets:[...document.querySelectorAll('.explore-zoom button')].map(el=>el.getBoundingClientRect().height)};
      });
      check(width+'px observation fits and keeps readable touch controls',state.noOverflow&&state.hintSize>=17&&state.pinyin>=16&&state.targets.every(h=>h>=44));
      if(width>height)check(width+'px landscape uses side-by-side observation',state.card.x>state.stage.x+state.stage.width);
      await touch(page,context);check(width+'px actual browser touch rotates the model',await page.evaluate(()=>events.some(e=>e.interaction==='camera_rotate')));
      if(evidence)await page.screenshot({path:path.join(evidence,'observation-'+width+'x'+height+'.png'),fullPage:true});
    }finally{await context.close();}
  }
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader','--no-proxy-server']});
  await verifyModels();await layoutChecks();assert.deepEqual(errors,[]);
  const result={passed:true,checks,errors};if(evidence)fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({passed:true,checks:checks.length,errors}));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
