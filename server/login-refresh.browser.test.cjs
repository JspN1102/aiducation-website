'use strict';
// Refreshing the school login opens straight on the form, never on the header
// and poem-loading placeholder. Real index/bootstrap/session modules on an
// isolated server; the account service is synthetic. No production requests.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),checks=[];
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
const signedOut={enabled:true,authenticated:false};
const signedIn={enabled:true,authenticated:true,user:{id:'s_'+'1'.repeat(24),role:'student',displayName:'Test pupil',grade:2,cls:'A'},csrfToken:'x'.repeat(43)};
let active;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://local');
 if(url.pathname==='/api/school-auth/'&&req.method==='GET'&&!url.search){
  active.checks++;
  setTimeout(()=>res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(active.session)),active.delay);return;
 }
 if(url.pathname==='/api/school-auth/'&&req.method==='POST'){
  active.logins++;
  setTimeout(()=>res.writeHead(401,{'Content-Type':'application/json'}).end(JSON.stringify({code:'INVALID_CREDENTIALS'})),3000);return;
 }
 if(url.pathname.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json'}).end('{}');return;}
 const relative=url.pathname.replace(/^\/school\//,'')||'index.html',file=path.resolve(root,'maanshan',decodeURIComponent(relative));
 if(!file.startsWith(path.join(root,'maanshan')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
// Every animation frame until the login form exists, note what the pupil could see.
function watchFrames(){
 const seen=window.__seen=new Set();
 const shown=el=>{if(!el||!el.getClientRects().length)return false;for(let node=el;node&&node.nodeType===1;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden')return false;}return true;};
 const look=()=>{
  if(shown(document.querySelector('#app>.loading-page p')))seen.add('poem-loading');
  if(shown(document.querySelector('.site-header')))seen.add('header');
  if(document.querySelector('#school-login-form'))seen.add('login');else requestAnimationFrame(look);
 };
 requestAnimationFrame(look);
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 try{for(const engine of ['chromium','webkit']){
  const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  const scenario=async(name,work)=>{
   const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.fulfill({status:404,body:''}));
   await context.addInitScript(watchFrames);
   try{const detail=await work(page);checks.push({engine,name,errors,...detail});}
   finally{await context.close();}
  };
  try{
   await scenario('first visit, then refresh on the login form',async page=>{
    active={session:signedOut,delay:300,checks:0,logins:0};
    await page.goto(origin+'/school/');await page.locator('#school-login-form').waitFor({timeout:10000});
    assert.equal(await page.evaluate(()=>localStorage.getItem('maanshan:school-login')),'1','the login form is remembered');
    active={session:signedOut,delay:2500,checks:0,logins:0};
    const started=Date.now();await page.reload();await page.locator('#school-login-form').waitFor({timeout:10000});
    const formAfter=Date.now()-started,seen=await page.evaluate(()=>[...window.__seen]);
    assert(formAfter<2400,'the form shows before the account check answers');
    assert.deepEqual(seen,['login'],'no header or poem-loading placeholder before the form');
    await page.waitForTimeout(3000);
    assert.equal(await page.locator('#school-login-form').count(),1,'the unauthenticated answer keeps the same form');
    assert.equal(active.checks,1);
    return {formAfter,seen};
   });
   await scenario('a session still signed in replaces the form',async page=>{
    active={session:signedOut,delay:0,checks:0,logins:0};
    await page.goto(origin+'/school/');await page.locator('#school-login-form').waitFor({timeout:10000});
    active={session:signedIn,delay:1500,checks:0,logins:0};
    await page.reload();await page.locator('#school-login-form').waitFor({timeout:10000});
    await page.locator('#school-login-form').waitFor({state:'detached',timeout:8000});
    const state=await page.evaluate(()=>({hint:localStorage.getItem('maanshan:school-login'),boot:document.documentElement.dataset.schoolBoot??null,screen:document.body.dataset.screen??null}));
    assert.deepEqual({hint:state.hint,boot:state.boot},{hint:null,boot:null},'signed in: no login hint, header allowed');
    assert.notEqual(state.screen,'school-login');
    return {state};
   });
   await scenario('a sign-in already under way is not interrupted',async page=>{
    active={session:signedOut,delay:0,checks:0,logins:0};
    await page.goto(origin+'/school/');await page.locator('#school-login-form').waitFor({timeout:10000});
    active={session:signedIn,delay:1200,checks:0,logins:0};
    await page.reload();await page.locator('#school-login-form').waitFor({timeout:10000});
    await page.locator('input[name=login]').fill('test-pupil');await page.locator('input[name=password]').fill('synthetic-password');
    if(!await page.locator('input[name=termsAccepted]').isChecked())await page.locator('input[name=termsAccepted]').check();
    await page.locator('.school-login-submit').click();
    await page.waitForTimeout(1800);
    assert.equal(await page.locator('#school-login-form[aria-busy=true]').count(),1,'the account check does not replace a form being submitted');
    await page.locator('#school-login-error:not(:empty)').waitFor({timeout:5000});
    assert.equal(active.logins,1);
    return {};
   });
  }finally{await browser.close();}
 }}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 for(const check of checks)assert.deepEqual(check.errors,[],check.engine+' '+check.name);
 console.log(JSON.stringify({ok:true,syntheticOnly:true,checks},null,2));
})().catch(error=>{console.error(error);server.closeAllConnections();server.close();process.exitCode=1;});
