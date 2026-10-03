'use strict';
// The login form's 使用指南 link opens the parents' guide in a dialog and starts
// playing it from the tap. Real index/bootstrap/session modules on an isolated
// server; the account service is synthetic. No production requests.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),checks=[];
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.mp4':'video/mp4'};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://local');
 if(url.pathname==='/api/school-auth/'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({enabled:true,authenticated:false}));return;}
 if(url.pathname.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json'}).end('{}');return;}
 const relative=url.pathname.replace(/^\/school\//,'')||'index.html',file=path.resolve(root,'maanshan',decodeURIComponent(relative));
 if(!file.startsWith(path.join(root,'maanshan')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
 const size=fs.statSync(file).size,type=types[path.extname(file)]||'application/octet-stream',range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');
 if(range){const start=+range[1],end=range[2]?Math.min(+range[2],size-1):size-1;
  res.writeHead(206,{'Content-Type':type,'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1});fs.createReadStream(file,{start,end}).pipe(res);return;}
 res.writeHead(200,{'Content-Type':type,'Accept-Ranges':'bytes','Content-Length':size});fs.createReadStream(file).pipe(res);
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 try{for(const engine of ['chromium','webkit']){if(engine==='webkit'&&!fs.existsSync(webkit.executablePath()))continue;
  const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  try{for(const viewport of [{width:390,height:844},{width:1366,height:900}]){
   const context=await browser.newContext({viewport,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.fulfill({status:404,body:''}));
   try{
    await page.goto(origin+'/school/');await page.locator('#school-login-form').waitFor({timeout:10000});
    const link=page.locator('.school-login-guide');
    assert.equal((await link.textContent()).trim(),'使用指南');
    const below=await page.evaluate(()=>document.querySelector('.school-login-guide').getBoundingClientRect().top>document.querySelector('.school-login-help').getBoundingClientRect().bottom-1);
    assert(below,'the link sits under 忘記密碼');
    await link.click();
    const dialog=page.locator('dialog.school-guide-dialog');await dialog.waitFor({timeout:5000});
    assert(await dialog.evaluate(d=>d.open),'the dialog is open');
    const src=await page.evaluate(()=>document.querySelector('.school-guide-dialog video').currentSrc);
    assert(src.endsWith('/media/guide/parent-guide-20261003.mp4'),src);
    // Edge plays H.264; Playwright's Windows WebKit has no H.264 decoder.
    let played=null;
    if(engine==='chromium'){
     await page.waitForFunction(()=>{const v=document.querySelector('.school-guide-dialog video');return v&&!v.paused&&v.currentTime>1;},null,{timeout:15000});
     played=await page.evaluate(()=>document.querySelector('.school-guide-dialog video').currentTime);
    }
    await page.screenshot({path:path.join(require('node:os').tmpdir(),`parent-guide-${engine}-${viewport.width}.png`)});
    await page.locator('.school-guide-close').click();
    await page.waitForFunction(()=>!document.querySelector('.school-guide-dialog'),null,{timeout:5000});
    await link.click();await dialog.waitFor({timeout:5000});
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('.school-guide-dialog'),null,{timeout:5000});
    assert(await page.locator('#school-login-form').isVisible(),'the login form is still there');
    assert.deepEqual(errors,[]);
    checks.push({engine,viewport:viewport.width,played});
   }finally{await context.close();}
  }}finally{await browser.close();}
 }}finally{server.close();}
 console.log(JSON.stringify(checks));
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
