'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),checks=[];
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
(async()=>{
 for(const engine of ['chromium','webkit']){
  const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  try{for(const prefix of ['/maanshan','/school']){
   const context=await browser.newContext({viewport:{width:1180,height:720}}),page=await context.newPage(),requests=[],errors=[];
   let release;const gate=new Promise(resolve=>release=resolve);
   page.on('pageerror',error=>errors.push(error.message));
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url());requests.push(url.pathname+url.search);
    if(url.pathname.startsWith('/api/')){
     let data={ok:true};
     if(url.pathname.includes('school-auth')){
      if(url.searchParams.get('action')==='progress')data={enabled:true,userId:'startup-test',poems:{}};
      else{await gate;data={enabled:true,authenticated:true,user:{id:'startup-test',displayName:'Test',role:'student',grade:1,cls:'A',researchEnabled:false},csrfToken:'synthetic'};}
     }
     return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    }
    if(url.pathname.includes('lucide-maanshan'))await gate;
    let relative=url.pathname.slice(prefix.length+1);if(!relative)relative='index.html';
    const file=path.resolve(root,'maanshan',decodeURIComponent(relative));
    if(!file.startsWith(path.join(root,'maanshan')+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
    const ext=path.extname(file);let body=fs.readFileSync(file);
    if(prefix==='/school'&&['.mjs','.js','.html','.json','.css'].includes(ext))body=Buffer.from(body.toString('utf8').replace(/(["'`])\/maanshan\//g,'$1/school/'));
    return route.fulfill({contentType:types[ext]||'application/octet-stream',body}).catch(()=>{});
   });
   try{
    await page.goto('https://startup.invalid'+prefix+'/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>['poems.json','pronunciation.json'].every(name=>performance.getEntriesByType('resource').some(resource=>resource.name.includes(name))));
    assert.equal(await page.locator('.poem-entry').count(),0,'Account check is still pending');
    assert(requests.some(url=>url.includes('school-auth')));assert(requests.some(url=>url.includes('lucide-maanshan')));
    assert(!requests.some(url=>url.includes('hanzi-writer')),'Initial login must not download stroke library');
    release();await page.locator('.poem-entry').first().waitFor();
    for(const name of ['poems.json','pronunciation.json'])assert.equal(requests.filter(url=>url.includes(name)).length,1,name+' fetched once across bootstrap and app');
    assert(!requests.some(url=>url.includes('hanzi-writer')),'Opening catalogue must not download stroke library');
    assert.deepEqual(errors,[]);checks.push(engine+prefix+' curriculum fetched during pending auth/icons, reused once, no Hanzi download, catalogue opens');
   }finally{release();await context.close();}
  }}finally{await browser.close();}
 }
 console.log(JSON.stringify({ok:true,checks},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
