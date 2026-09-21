'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(repo,'maanshan/app.js'),'utf8');
const runtime=app.slice(app.indexOf('let activityModuleHints;'),app.indexOf('async function renderQuiz()'));
const metadata=JSON.parse(fs.readFileSync(path.join(repo,'maanshan/index.html'),'utf8').match(/id="school-module-preloads" type="application\/json">([\s\S]*?)<\/script>/)[1]);
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const prefix of ['/maanshan/','/school/']){
   const page=await browser.newPage(),requests=[];
   await page.route('**/*',route=>{
    const url=new URL(route.request().url());requests.push(url.pathname+url.search);
    if(url.pathname===prefix)return route.fulfill({contentType:'text/html',body:`<head><script id="school-module-preloads" type="application/json">${JSON.stringify(metadata)}</script></head><body></body>`});
    if(url.pathname===prefix+'preload-test.mjs')return route.fulfill({contentType:'text/javascript',body:runtime+'\nwindow.hint=preloadActivityModules;'});
    return route.fulfill({contentType:'text/javascript',body:'window.hintedModuleEvaluated=true;'});
   });
   await page.goto('https://preloads.invalid'+prefix);
   await page.evaluate(prefix=>import(prefix+'preload-test.mjs'),prefix);
   assert.equal(await page.locator('link[rel=modulepreload]').count(),0);
   await page.evaluate(()=>window.hint('quiz','zeng-wang-lun'));
   const wanted=[...new Set([...metadata.quiz.common,...metadata.quiz.games['zeng-wang-lun']])].map(url=>prefix+url).sort();
   const actual=await page.locator('link[rel=modulepreload]').evaluateAll(nodes=>nodes.map(node=>new URL(node.href).pathname+new URL(node.href).search).sort());
   assert.deepEqual(actual,wanted);
   await page.evaluate(()=>window.hint('quiz','zeng-wang-lun'));
   assert.equal(await page.locator('link[rel=modulepreload]').count(),wanted.length);
   assert.equal(await page.evaluate(()=>window.hintedModuleEvaluated),undefined,'Hints must not evaluate modules');
   assert(!actual.some(url=>url.includes('three')||url.includes('.glb')||/\/(goose|rain|garden|river)\.mjs/.test(url)));
   await page.evaluate(()=>window.hint('explore'));
   assert.equal(await page.evaluate(()=>window.hintedModuleEvaluated),undefined);
   await page.close();
  }
  const quiz=app.slice(app.indexOf('async function renderQuiz()'),app.indexOf('async function renderExploration()'));
  assert(quiz.indexOf("preloadActivityModules('quiz'")<quiz.indexOf('await loadActivity('));
  console.log('Module preload browser checks passed: source and relocated URLs, selected game, no evaluation, no 3D, deduplication, hints before activity import.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
