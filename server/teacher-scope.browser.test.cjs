// Synthetic accounts only. Exercises the real dashboard's request races/cache.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const demo=require('../api/_lib/teacher-demo-data.cjs');
const repo=path.resolve(__dirname,'..'),requests=[],delays=new Map();let authenticated=true,reportFilters,reportPolls=0,reportStarts=0;
const reportId='ta_'+'a'.repeat(64);
const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.svg':'image/svg+xml'};
const auth=()=>({enabled:true,authenticated,user:authenticated?{id:'t_synthetic_browser',role:'teacher',displayName:'測試教師'}:null,csrfToken:authenticated?'synthetic-csrf':undefined});
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');const json=value=>{if(!res.destroyed){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));}};
 if(url.pathname==='/api/school-auth'){
   if(req.method==='POST'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));authenticated=body.action==='login';return json(auth());}
   return json(auth());
 }
 if(url.pathname==='/api/teacher-tools'){
   const tool=url.searchParams.get('tool');
   if(tool==='demo-analysis'){
    if(req.method==='POST'){const chunks=[];for await(const chunk of req)chunks.push(chunk);reportFilters=JSON.parse(Buffer.concat(chunks)).filters;reportStarts++;res.statusCode=202;return json({ok:true,status:'generating',reportId,retryAfterSeconds:1});}
    reportPolls++;
    if(reportPolls===1){res.statusCode=503;return json({ok:false,code:'ORIGIN_UNAVAILABLE'});}
    return json({ok:true,reportId,report:{reportId,filters:reportFilters,analysis:{overview:'下一課先安排原句跟讀。'}}});
   }
   if(tool==='demo-export'){
    const {Document,Packer,Paragraph}=require('docx'),bytes=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('普通話教研報告：下一課先安排原句跟讀。')]}]}));
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');res.setHeader('Content-Disposition','attachment; filename="synthetic-report.docx"');return res.end(bytes);
   }
   if(url.searchParams.get('kind')==='roster')return json({students:demo.demoRoster(),teachers:[],demo:true});
   const filters=Object.fromEntries([...url.searchParams].filter(([key])=>!['kind','tool'].includes(key))),key=[filters.grade,filters.poemId,filters.cls||''].join('/');
   requests.push({...filters,key});
   const dataset=demo.createDemoDataset(filters);const wait=delays.get(key)||0;
   return setTimeout(()=>json(dataset.analytics),wait);
 }
 const file=path.resolve(repo,'.'+decodeURIComponent(url.pathname));
 if(!file.startsWith(repo+path.sep)||!mime[path.extname(file)])return res.writeHead(404).end();
 fs.readFile(file,(error,bytes)=>{if(error)return res.writeHead(404).end();res.setHeader('Content-Type',mime[path.extname(file)]);res.end(bytes);});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],checks=[];
 page.on('pageerror',error=>errors.push(error.message));
 const count=key=>requests.filter(request=>!key||request.key===key).length;
 async function loaded(scope){await page.waitForFunction(scope=>document.querySelector('#view-title')?.textContent.includes(scope)&&!!document.querySelector('.kpi')&&!document.querySelector('.data-loading'),scope);}
 try{
   await page.goto(`http://127.0.0.1:${server.address().port}/maanshan/teacher-demo.html`);await page.locator('#filter-grade').waitFor();
   assert.equal(count(),0);assert.equal(await page.locator('#filter-poem').isDisabled(),true);assert.equal(await page.locator('#filter-class').isDisabled(),true);
   await page.selectOption('#filter-grade','3');assert.equal(count(),0);assert.equal(await page.locator('#filter-class').isDisabled(),true);
   await page.selectOption('#filter-poem','3');await loaded('題西林壁');assert.equal(count('3/3/'),1);
   checks.push('grade then poem required; no whole-school request');
   delays.set('3/3/A',280);delays.set('3/3/B',20);
   await page.selectOption('#filter-class','A');await page.waitForFunction(()=>document.querySelector('.data-loading'));
   await page.selectOption('#filter-class','B');await loaded('B 班');await page.waitForTimeout(320);
   assert.match(await page.locator('#view-title').innerText(),/B 班/);
   await page.locator('#student-list summary').click();assert.ok((await page.locator('.student-meta').allInnerTexts()).every(value=>value.startsWith('3B')));
   checks.push('late class A response cannot overwrite newer class B');
   delays.clear();await page.selectOption('#filter-class','A');await loaded('A 班');const before=count();
   await page.selectOption('#filter-class','B');await loaded('B 班');await page.selectOption('#filter-class','A');await loaded('A 班');assert.equal(count(),before);
   checks.push('returning to a loaded scope uses the bounded in-memory cache');
   await page.locator('#student-list summary').click();const detailsBefore=count();await page.locator('[data-student-words]').first().click();
   await page.locator('.student-practice').waitFor();assert.equal(count(),detailsBefore);assert.match(await page.locator('#student-dialog-title').innerText(),/3A/);
   await page.locator('[data-action=close-dialog]').click();checks.push('student detail opens without a second analytics request');
   await page.locator('[data-action=refresh]').click();await loaded('A 班');assert.equal(count(),before+1);checks.push('Update bypasses the scope cache');
   await page.selectOption('#filter-grade','2');assert.equal(await page.locator('#filter-poem').inputValue(),'');assert.equal(await page.locator('#filter-class').isDisabled(),true);assert.equal(await page.locator('.kpi').count(),0);
   await page.selectOption('#filter-poem','2');await loaded('贈汪倫');assert.ok((await page.locator('.poem-character-title').allInnerTexts()).every(value=>value.includes('贈汪倫')));
   checks.push('grade changes clear the old poem and its visible results');
   await page.selectOption('#filter-class','A');await loaded('A 班');const beforeLogout=count('2/2/A');
   await page.locator('#teacher-logout').click();await page.locator('#teacher-login-form').waitFor();
   await page.fill('#teacher-login','synthetic-teacher');await page.fill('#teacher-password','synthetic-browser-password');await page.locator('input[name=termsAccepted]').check();await page.locator('#teacher-login-form button[type=submit]').click();await loaded('A 班');
   assert.equal(count('2/2/A'),beforeLogout+1);checks.push('logout discards private cached data before another login');
   const downloadEvent=page.waitForEvent('download');
   await page.locator('[data-teacher-tool=docx]').click();const file=await downloadEvent;
   assert.equal(await file.failure(),null);assert.equal(file.suggestedFilename(),'synthetic-report.docx');
   assert.equal(reportStarts,1);assert.equal(reportPolls,2);assert.equal(String(reportFilters.grade),'2');assert.equal(String(reportFilters.poemId),'2');
   await page.getByText('Word 報告 已下載',{exact:true}).waitFor();checks.push('a transient report polling failure resumes the same job and downloads Word automatically');
   assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks,requests:requests.length,pageErrors:errors},null,2));
 }finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
})().catch(error=>{console.error(error);process.exitCode=1;server.closeAllConnections();server.close();});
