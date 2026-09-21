'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const engines=require(process.env.PLAYWRIGHT_MODULE||'playwright'),engine=process.env.BROWSER_ENGINE||'chromium';
const repo=path.resolve(__dirname,'..'),mime={'.mjs':'text/javascript','.js':'text/javascript','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><style>[hidden]{display:none!important}</style><main id="holder"></main>');return;}
 const file=path.resolve(repo,'.'+decodeURIComponent(url.pathname));
 if(!file.startsWith(repo+path.sep)||!url.pathname.startsWith('/maanshan/')||!mime[path.extname(file)]){res.writeHead(404).end();return;}
 fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)]);res.end(data);});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await engines[engine].launch({...engine==='chromium'?{channel:'msedge'}:{},headless:true}),results=[];
 try{
  for(const test of [{file:'zeng',mount:'mountFarewell',retry:'[data-fs-retry]',loading:'.fs-loading',control:'[data-fs-boat]',images:2},{file:'goose',mount:'mountGoose',retry:'[data-goose-retry]',loading:'.goose-loading',control:'[data-goose-color]',images:4}]){
   const page=await browser.newPage(),errors=[],held=[];let holding=true;
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{const original=setTimeout;window.setTimeout=(callback,delay,...args)=>original(callback,[12000,15000].includes(delay)?40:delay,...args);});
   await page.route('**/*',route=>{if(holding&&route.request().resourceType()==='image')held.push(route);else void route.continue();});
   await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
   await page.evaluate(async({file,mount})=>{const mod=await import(`/maanshan/poem-games/${file}.mjs`);window.events=[];window.game=mod[mount](document.querySelector('#holder'),{onResearch:(type,data)=>events.push({type,...data})});},test);
   await page.waitForFunction(selector=>!document.querySelector(selector).hidden,test.retry);
   assert.equal(held.length,test.images,`${test.file}: all required requests are held`);
   assert(await page.locator(test.control).first().isDisabled(),`${test.file}: timed-out assets keep controls disabled`);
   const last=held.pop();await Promise.all(held.splice(0).map(route=>route.continue()));
   // Flush image decode and UI tasks while one required image remains missing.
   await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,60)));
   assert(await page.locator(test.control).first().isDisabled(),`${test.file}: one missing image must still block interaction`);
   holding=false;await last.continue();
   await page.waitForFunction(selector=>document.querySelector(selector).hidden,test.loading);
   assert.equal(await page.locator(test.control).first().isDisabled(),false,`${test.file}: late images recover without clicking retry`);
   if(test.file==='goose'){
    await page.locator('[data-goose-color="white"]').dispatchEvent('click');
    assert.equal(await page.locator('[data-goose-part="feather"]').isDisabled(),false,'goose mask preparation finished before enabling painting');
   }
   assert.deepEqual(errors,[]);results.push({game:test.file,lateRecovery:true,partialBlocked:true,pageErrors:0});
   await page.evaluate(()=>game.destroy());await page.close();
  }
  console.log(JSON.stringify({ok:true,engine,results},null,2));
 }finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
})().catch(error=>{console.error(error);process.exitCode=1;});
