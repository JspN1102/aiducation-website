'use strict';
// Actual index/bootstrap/session modules; an isolated HTTP server hangs only
// the first anonymous GET. No production requests or student writes are made.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),checks=[];
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
let active;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://local');
 if(url.pathname.startsWith('/api/')){
  if(url.pathname!=='/api/school-auth/'||req.method!=='GET'){active.unexpected.push(req.method+' '+url.pathname);res.writeHead(500).end();return;}
  const number=++active.calls;active.events.push('start-'+number);
  if(number===1){
   res.on('close',()=>active.events.push('first-cancelled'));
   if(active.failure==='body'){res.writeHead(200,{'Content-Type':'application/json'});res.write('{"enabled":true,');}
   return;
  }
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({enabled:true,authenticated:false}));return;
 }
 const relative=url.pathname.replace(/^\/school\//,'')||'index.html',file=path.resolve(root,'maanshan',decodeURIComponent(relative));
 if(!file.startsWith(path.join(root,'maanshan')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 try{for(const engine of ['chromium','webkit']){
  const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  try{for(const failure of ['fetch','body']){
   active={engine,failure,calls:0,events:[],unexpected:[]};
   const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   try{
    await context.route('**/*',route=>{
     const url=new URL(route.request().url());if(url.origin===origin)return route.continue();
     const offset=url.pathname.indexOf('/media/'),relative=offset>=0?url.pathname.slice(offset+1):'',file=path.resolve(root,'maanshan',decodeURIComponent(relative));
     if(!relative||!file.startsWith(path.join(root,'maanshan')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
     return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
    });
    const started=Date.now();await page.goto(origin+'/school/',{waitUntil:'domcontentloaded'});
    await page.locator('#school-login-form').waitFor({timeout:10000});
    const elapsed=Date.now()-started;
    assert.equal(active.calls,2,'one first attempt and one retry');
    assert.deepEqual(active.events,['start-1','first-cancelled','start-2'],'first connection cancelled before retry');
    assert(elapsed>=5000&&elapsed<12000,'login recovers before the old 15 second deadline');
    assert.equal(await page.locator('.school-login-recovery').count(),0,'no manual retry screen');
    assert.deepEqual(errors,[]);assert.deepEqual(active.unexpected,[]);
    checks.push({...active,elapsed});
   }finally{await context.close();}
  }}finally{await browser.close();}
 }}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 console.log(JSON.stringify({ok:true,syntheticOnly:true,checks},null,2));
})().catch(error=>{console.error(error);server.closeAllConnections();server.close();process.exitCode=1;});
