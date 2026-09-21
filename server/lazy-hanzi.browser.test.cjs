'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),checks=[];
const check=(label,value)=>{assert(value,label);checks.push(label);};
async function fixture(browser,mode='ready'){
 const context=await browser.newContext({viewport:{width:1000,height:760},hasTouch:true}),page=await context.newPage();
 const state={mode,requests:0,releases:[],errors:[]};
 page.on('pageerror',error=>state.errors.push(error.message));
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/fixture')return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="holder"></div>'});
  const file=path.resolve(root,'.'+u.pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
  if(u.pathname.endsWith('/hanzi-writer.min.js')){
   state.requests++;
   if(state.mode==='fail'){state.mode='ready';return route.fulfill({status:503,body:''});}
   if(state.mode==='hold')await new Promise(resolve=>state.releases.push(resolve));
  }
  const type={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json'}[path.extname(file)]||'application/octet-stream';
  return route.fulfill({contentType:type,body:fs.readFileSync(file)}).catch(()=>{});
 });
 await page.goto('https://lazy-hanzi.invalid/fixture');
 const mount=async()=>page.evaluate(async()=>{
  window.widget?.destroy();document.querySelector('#holder').replaceChildren();window.ink=[];
  const {mountChallengeWriting}=await import('/maanshan/challenge-writing.mjs');
  window.widget=mountChallengeWriting(document.querySelector('#holder'),{target:{char:'岸',pinyin:'àn'},recognize:async value=>{ink.push(value);return{candidates:['岸']};}});
 });
 const release=()=>{state.mode='ready';for(const resolve of state.releases.splice(0))resolve();};
 return{page,context,state,mount,release};
}
async function skip(page){await page.locator('[data-cw=skip]').click();}
(async()=>{
 for(const engine of ['chromium','webkit']){
  const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  try{
   {
    const f=await fixture(browser,'hold');await f.mount();
    const box=await f.page.locator('canvas').boundingBox();
    await f.page.mouse.move(box.x+box.width*.2,box.y+box.height*.3);await f.page.mouse.down();await f.page.mouse.move(box.x+box.width*.7,box.y+box.height*.5,{steps:8});await f.page.mouse.up();
    await f.page.locator('[data-cw=submit]').click();await f.page.locator('.cw-review:not([hidden])').waitFor();
    check(engine+' writing and recognition work without Hanzi',f.state.requests===0&&await f.page.evaluate(()=>ink.length===1&&ink[0][0][0].length>4));
    await f.page.locator('[data-cw=strokes]').click();await f.page.waitForFunction(()=>document.querySelector('script[src*="hanzi-writer"]'));
    await f.page.locator('[data-cw=practise]').click();
    f.release();await f.page.waitForFunction(()=>typeof window.HanziWriter?.create==='function');
    check(engine+' cancelled slow demonstration cannot cover writing',await f.page.locator('.cw-animation').isHidden());
    await f.page.locator('[data-cw=strokes]').click();await f.page.locator('.cw-animation svg path').first().waitFor({state:'attached'});
    check(engine+' later stroke demonstration reuses successful library',f.state.requests===1);
    check(engine+' no unhandled errors after cancellation',f.state.errors.length===0);await f.context.close();
   }
   {
    const f=await fixture(browser,'fail');await f.mount();await skip(f.page);
    await f.page.locator('[data-cw=strokes]').click();await f.page.locator('.cw-status').filter({hasText:'筆順暫時無法播放'}).waitFor();
    await f.page.locator('[data-cw=strokes]').click();await f.page.locator('.cw-animation svg path').first().waitFor({state:'attached'});
    check(engine+' failed library retries successfully',f.state.requests===2);check(engine+' retry has no unhandled errors',f.state.errors.length===0);await f.context.close();
   }
   {
    const f=await fixture(browser,'hold');await f.mount();await skip(f.page);await f.page.locator('[data-cw=strokes]').click();
    await f.page.waitForFunction(()=>document.querySelector('script[src*="hanzi-writer"]'));
    await f.page.evaluate(()=>widget.destroy());f.release();await f.page.waitForFunction(()=>window.HanziWriter);
    check(engine+' destroyed view receives no late animation',await f.page.locator('#holder svg').count()===0);check(engine+' destroy has no unhandled errors',f.state.errors.length===0);await f.context.close();
   }
   {
    const f=await fixture(browser,'hold');
    await f.page.evaluate(async()=>{const {loadHanziWriter}=await import('/maanshan/hanzi-library.mjs');window.loadHanzi=loadHanziWriter;window.timeoutResult=loadHanziWriter(window,{timeout:40}).then(()=>false,e=>e.message);});
    check(engine+' loader timeout is bounded',await f.page.evaluate(()=>timeoutResult)==='Stroke library timed out');
    f.release();
    await f.page.evaluate(()=>loadHanzi(window));check(engine+' timeout can retry',await f.page.evaluate(()=>typeof HanziWriter.create==='function'));
    check(engine+' timeout has no unhandled errors',f.state.errors.length===0);await f.context.close();
   }
  }finally{await browser.close();}
 }
 console.log(JSON.stringify({ok:true,checks},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
