// Real local HTTP failures: no production accounts, services or DNS are used.
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),vm=require('node:vm');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..');
const index=fs.readFileSync(path.join(repo,'maanshan/index.html'),'utf8');
const registration=index.match(/<script id="school-navigation-recovery">([\s\S]*?)<\/script>/)[1];
const worker=fs.readFileSync(path.join(repo,'maanshan/recovery-sw.js'),'utf8');
const mainHost='mandarin.aiducation.asia',backupHost='aiducation.asia';
const mime={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.webp':'image/webp','.png':'image/png'};
const signedIn={enabled:true,authenticated:true,user:{id:'s_'+'1'.repeat(24),role:'student',displayName:'Synthetic pupil',grade:2,cls:'A'},csrfToken:'x'.repeat(43)};
const records=[];
let failEntries=false,failAPI=false,entryStatus=200,workerRevision=1,authStatus=200;
function fixture() {
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><body data-server="normal"><div id="app">Checking session</div><script>${registration}</script><script type="module">import {initializeSchoolSession} from '/school/school-session.mjs';initializeSchoolSession(document.querySelector('#app')).then(session=>{if(session.authenticated)document.querySelector('#app').textContent='Synthetic private screen';window.sessionReady=true;});</script></body></html>`;
}
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'),host=req.headers.host.split(':')[0];
  records.push({host,path:url.pathname,method:req.method});
  res.setHeader('Cache-Control','no-store');
  if(url.pathname==='/school/recovery-sw.js'){
    res.setHeader('Content-Type','text/javascript');
    res.setHeader('Service-Worker-Allowed',host===mainHost?'/':'/school/');
    res.end(worker+'\n// synthetic update '+workerRevision);return;
  }
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/school-api/')){
    if(failAPI){req.socket.destroy();return;}
    res.setHeader('Content-Type','application/json');res.statusCode=authStatus;
    res.end(JSON.stringify(authStatus===200?signedIn:{code:'AUTH_REQUIRED'}));return;
  }
  if(['/school/','/school/index.html'].includes(url.pathname)){
    if(failEntries){req.socket.destroy();return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.statusCode=entryStatus;
    res.end(entryStatus===200?fixture():'<h1>Server maintenance</h1>');return;
  }
  if(['/','/maanshan','/maanshan/','/company/','/school/teacher.html'].includes(url.pathname)){
    res.setHeader('Content-Type','text/html');res.end('<h1>Original page '+url.pathname+'</h1>');return;
  }
  if(url.pathname.startsWith('/school/')){
    const file=path.resolve(repo,'maanshan',url.pathname.slice('/school/'.length));
    if(file.startsWith(path.join(repo,'maanshan')+path.sep)&&mime[path.extname(file)]&&fs.existsSync(file)){
      res.setHeader('Content-Type',mime[path.extname(file)]);
      let data=fs.readFileSync(file);
      if(host===backupHost&&['.mjs','.js'].includes(path.extname(file)))data=Buffer.from(data.toString('utf8').replaceAll("'/api/","'/school-api/"));
      res.end(data);return;
    }
  }
  res.writeHead(404).end();
});

async function controlled(page,origin) {
  await page.goto(origin+'/school/');
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  await page.waitForFunction(()=>window.sessionReady===true);
}
async function noCache(page) {assert.deepEqual(await page.evaluate(()=>caches.keys()),[]);}
async function recovery(page) {
  await page.getByRole('heading',{name:'暫時未能連線'}).waitFor();
  assert.equal(await page.locator('input,script,#app').count(),0);
  assert.equal(await page.getByText('Synthetic private screen',{exact:true}).count(),0);
  assert.equal(await page.getByRole('link',{name:'重新連線',exact:true}).getAttribute('href'),'/school/');
  await noCache(page);
}

(async()=>{
  // Registration is optional and cannot break login when blocked/unsupported.
  for(const navigator of [{},{serviceWorker:{register(){throw new Error('blocked');}}},{serviceWorker:{register(){return Promise.reject(new Error('blocked'));}}}]){
    vm.runInNewContext(registration,{location:{hostname:mainHost},navigator});
  }
  let called=false;
  vm.runInNewContext(registration,{location:{hostname:'unrelated.invalid'},navigator:{serviceWorker:{register(){called=true;}}}});
  assert.equal(called,false);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port,main=`http://${mainHost}:${port}`,backup=`http://${backupHost}:${port}`;
  const browser=await chromium.launch({channel:'msedge',headless:true,args:[
    '--no-proxy-server',`--host-resolver-rules=MAP ${mainHost} 127.0.0.1, MAP ${backupHost} 127.0.0.1`,
    `--unsafely-treat-insecure-origin-as-secure=${main},${backup}`
  ]});
  const results=[];
  try{
    // A clean profile has no worker and still gets a browser network failure.
    const virgin=await browser.newContext(),first=await virgin.newPage();failEntries=true;
    await assert.rejects(first.goto(main+'/school/'),/net::ERR_(?:EMPTY_RESPONSE|CONNECTION_RESET)/);
    assert.equal(await first.getByRole('heading',{name:'暫時未能連線'}).count(),0);
    await virgin.close();failEntries=false;results.push('first visit limitation');

    const context=await browser.newContext(),page=await context.newPage();
    await controlled(page,main);await noCache(page);
    const registrationState=await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return {scope:r.scope,updateViaCache:r.updateViaCache};});
    assert.deepEqual(registrationState,{scope:main+'/',updateViaCache:'none'});
    failEntries=true;
    const response=await page.reload();assert.equal(response.status(),503);await recovery(page);
    assert.equal(await page.getByRole('link',{name:'使用備用入口'}).getAttribute('href'),'https://aiducation.asia/school/');
    for(const entry of ['/','/maanshan','/maanshan/']){
      const count=records.filter(row=>row.host===mainHost&&row.path===entry).length;
      await page.goto(main+entry);await recovery(page);assert.equal(page.url(),main+'/school/');
      assert.equal(records.filter(row=>row.host===mainHost&&row.path===entry).length,count,'entry redirect must not need the network');
    }
    await page.goto(main+'/school/index.html');await recovery(page);
    results.push('known main entrance and root bookmarks recover after reset');

    // Subresource GET and POST requests to the entry still reach the server.
    // The recovery document itself intentionally disallows connect-src.
    await page.goto(main+'/company/');
    const bypass=await page.evaluate(async()=>{
      const outcomes=[];
      for(const [url,options] of [['/school/',{}],['/school/',{method:'POST'}],['/api/school-auth/',{}],['/api/school-auth/',{method:'POST'}]]){
        try{const response=await fetch(url,options);outcomes.push({url,status:response.status,body:await response.text()});}catch{outcomes.push({url,failed:true});}
      }
      return outcomes;
    });
    assert.equal(bypass[0].failed,true);assert.equal(bypass[1].failed,true);
    assert.equal(JSON.parse(bypass[2].body).user.displayName,'Synthetic pupil');
    assert.equal(JSON.parse(bypass[3].body).user.displayName,'Synthetic pupil');
    failAPI=true;
    assert.equal(await page.evaluate(()=>fetch('/api/school-auth/').then(()=>false,()=>true)),true);
    failAPI=false;failEntries=false;entryStatus=503;
    await page.goto(main+'/school/');await page.getByRole('heading',{name:'Server maintenance'}).waitFor();
    entryStatus=200;await page.goto(main+'/school/');await page.getByText('Synthetic private screen',{exact:true}).waitFor();
    const reads=records.filter(row=>row.host===mainHost&&row.path==='/api/school-auth/').length;
    authStatus=401;await page.reload();await page.getByRole('heading',{name:'正在等候帳戶服務'}).waitFor();
    assert.equal(await page.getByText('Synthetic private screen',{exact:true}).count(),0);
    assert(records.filter(row=>row.host===mainHost&&row.path==='/api/school-auth/').length>reads);
    await noCache(page);results.push('API and auth responses remain live, HTTP errors untouched');

    // Updating this worker cannot restore any previously authenticated screen.
    workerRevision++;
    await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await new Promise(async(resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('worker update did not activate')),8000);navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve();},{once:true});try{await r.update();}catch(error){clearTimeout(timer);reject(error);}});});
    await page.reload();await page.getByRole('heading',{name:'正在等候帳戶服務'}).waitFor();
    assert.equal(await page.getByText('Synthetic private screen',{exact:true}).count(),0);await noCache(page);
    results.push('worker update does not bypass auth');
    authStatus=200;

    const company=await context.newPage();await controlled(company,backup);await noCache(company);
    assert.equal(await company.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).scope),backup+'/school/');
    assert.equal(await company.evaluate(()=>navigator.serviceWorker.register('/school/recovery-sw.js',{scope:'/'}).then(()=>false,error=>error.name==='SecurityError')),true,
      'the backup response header must reject a root scope even if registration code is wrong');
    failEntries=true;await company.reload();await recovery(company);
    assert.equal(await company.getByRole('link',{name:'使用主要入口'}).getAttribute('href'),'https://mandarin.aiducation.asia/school/');
    for(const entry of ['/','/maanshan','/maanshan/','/company/','/school/teacher.html']){
      await company.goto(backup+entry);assert.equal(await company.locator('h1').textContent(),'Original page '+entry);
      if(!entry.startsWith('/school/'))assert.equal(await company.evaluate(()=>navigator.serviceWorker.controller),null);
    }
    await company.goto(backup+'/school/');await recovery(company);
    await company.goto(backup+'/school/teacher.html');
    assert.equal(await company.evaluate(()=>fetch('/school-api/school-auth/').then(r=>r.json()).then(r=>r.authenticated)),true);
    await noCache(company);results.push('backup scope preserves company pages and APIs');
    await context.close();console.log(JSON.stringify({ok:true,results},null,2));
  }finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
})().catch(error=>{console.error(error);process.exitCode=1;});
