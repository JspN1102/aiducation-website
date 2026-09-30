'use strict';
// aiducation.hk.cn showcase: every grade opens without an account, with no profile or
// teacher entry, and account-only actions explain themselves without any school API
// request leaving the page. The student entrance on the same files still asks to sign in.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),checks=[];
const sources=[...fs.readFileSync(path.join(root,'scripts/build-maanshan-css.cjs'),'utf8').match(/const files = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(match=>fs.readFileSync(path.join(root,'maanshan',match[1]),'utf8')).join('\n');
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
const poemData=require(path.join(root,'maanshan/poems.json')),poems=Array.isArray(poemData)?poemData:poemData.poems;

async function serve(context,apiRequests){
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(!['aiducation.hk.cn','mandarin.aiducation.asia'].includes(url.hostname))return route.abort();
    if(/^\/(?:api|school-api)\//.test(url.pathname)){
      apiRequests.push(url.hostname+url.pathname);
      return route.fulfill({contentType:'application/json',body:JSON.stringify({enabled:true,authenticated:false})});
    }
    if(url.pathname.endsWith('/app.bundle.css'))return route.fulfill({contentType:'text/css',body:sources});
    const mediaStart=url.pathname.indexOf('/media/');
    const relative=(mediaStart>=0?url.pathname.slice(mediaStart+1):url.pathname.replace(/^\/school\//,''))||'index.html',file=path.resolve(root,'maanshan',decodeURIComponent(relative));
    if(!file.startsWith(path.join(root,'maanshan')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
    return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
}

async function expectNotice(page){
  const dialog=page.locator('#showcase-dialog');
  await page.waitForFunction(()=>document.querySelector('#showcase-dialog')?.open===true);
  assert.match(await dialog.innerText(),/學校帳戶/);
  await dialog.getByRole('button',{name:'知道了'}).click();
  await page.waitForFunction(()=>!document.querySelector('#showcase-dialog').open);
  // The notice is throttled per burst; the next deliberate tap comes later.
  await page.waitForTimeout(1600);
}

(async()=>{
  for(const [engine,width] of [['chromium',1180],['chromium',390],['webkit',390]]){
    const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
    const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<700}),page=await context.newPage(),apiRequests=[],errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    try{
      await serve(context,apiRequests);
      await page.goto('https://aiducation.hk.cn/school/');
      await page.locator('.poem-card').nth(poems.length-1).waitFor();
      assert.equal(await page.locator('.poem-card').count(),poems.length,'every grade is listed');
      assert.equal(await page.locator('#school-login').count(),0,'no sign-in screen');
      assert(await page.locator('#profile-open').isHidden(),'no profile button');
      assert.equal(await page.locator('.teacher-entry').count(),0,'no teacher dashboard');
      assert.equal((await page.locator('.showcase-tag').innerText()).trim(),'展示版');
      assert(await page.locator('#icp-footer').isVisible(),'ICP number shown');
      const last=poems[poems.length-1];
      await page.goto('https://aiducation.hk.cn/school/#'+last.slug+'/record');
      await page.locator('[data-action="record-start"]').first().click();
      await expectNotice(page);
      assert.equal(await page.locator('[data-action="record-stop"]').count(),0,'recording never began');
      await page.goto('https://aiducation.hk.cn/school/#'+last.slug+'/chat');
      await page.locator('#chat-input').fill('你好');
      await page.locator('#chat-form').evaluate(form=>form.requestSubmit());
      await expectNotice(page);
      assert.equal(await page.locator('.showcase-tag').count(),1,'one label after navigation');
      assert.deepEqual(apiRequests,[],'no school API request left the page');
      assert.deepEqual(errors,[]);
      // The same files on the student entrance still ask pupils to sign in.
      await page.goto('https://mandarin.aiducation.asia/school/');
      await page.locator('#school-login-title').waitFor();
      assert.equal(await page.locator('.showcase-tag').count(),0);
      assert(apiRequests.some(request=>request.startsWith('mandarin.aiducation.asia/api/school-auth')),'student entrance checks the account');
      checks.push({engine,width,poems:poems.length});
    }finally{await context.close();await browser.close();}
  }
  console.log(JSON.stringify({ok:true,checks}));
})().catch(error=>{console.error(error);process.exitCode=1;});
