'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..');
const artwork=['/media/compatible/9518ba9e71e4700d3ceb.jpg','/media/compatible/d51a188501a466d5c216.png'];
(async()=>{
 for(const engine of ['chromium','webkit']){
  const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  try{for(const prefix of ['/maanshan','/school']){
   const context=await browser.newContext({viewport:{width:1180,height:720}}),page=await context.newPage(),images=[];
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname===prefix+'/')return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="game"></div>'});
    if(route.request().resourceType()==='image')images.push(url.pathname);
    const filename=path.join(repo,'maanshan',decodeURIComponent(url.pathname.slice(prefix.length+1)));
    if(!filename.startsWith(path.join(repo,'maanshan')+path.sep)||!fs.existsSync(filename))return route.fulfill({status:404,body:''});
    const ext=path.extname(filename),types={'.mjs':'text/javascript','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp'};
    let body=fs.readFileSync(filename);
    if(prefix==='/school'&&ext==='.mjs')body=Buffer.from(body.toString('utf8').replace(/(["'`])\/maanshan\//g,'$1/school/'));
    return route.fulfill({contentType:types[ext]||'application/octet-stream',body});
   });
   await page.goto('https://images.invalid'+prefix+'/');
   await page.evaluate(async prefix=>{
    const {installImageRecovery}=await import(prefix+'/image-loader.mjs');installImageRecovery();
    const {mountFarewell}=await import(prefix+'/poem-games/zeng.mjs');
    window.game=mountFarewell(document.querySelector('#game'),{});
   },prefix);
   await page.locator('[data-fs-dock]:not([disabled])').waitFor();
   assert.deepEqual(images.slice().sort(),artwork.map(url=>prefix+url).sort(),engine+prefix+' should request only the two compatible images');
   assert.equal(await page.locator('.fs-stage img').evaluateAll(nodes=>nodes.every(img=>img.complete&&img.naturalWidth>0)),true);
   await page.evaluate(()=>window.game.destroy());await context.close();
  }}finally{await browser.close();}
 }
 console.log('Farewell image requests passed in Chromium and WebKit, source and relocated entry: exactly two complete images, no raw duplicate requests.');
})().catch(error=>{console.error(error);process.exitCode=1;});
