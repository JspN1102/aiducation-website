'use strict';
// 下週挑戰句 (school74): the weekly report's weakest line opens in 朗讀 at that line.
// Real app with synthetic, fully intercepted APIs; no school data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),checks=[],evidence=process.env.WEEKLY_EVIDENCE_DIR;
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.mp3':'audio/mpeg'};
const check=(label,pass)=>{assert(pass,label);checks.push(label);};
const report={id:'w2026-10-25',week:{start:'2026-10-25',end:'2026-10-31'},days:[false,true,true,false,false,false,false],reading:{lines:6,poems:1},writing:{chars:0},challenge:{count:1},chat:{count:0},
  best:null,improved:null,fixedChars:[],badges:[],challengeLine:{poemId:4,slug:'bo-chuan-gua-zhou',title:'泊船瓜洲',label:'第2句',lineIndex:1,line:'鍾山祇隔數重山',score:62}};
(async()=>{
 for(const engine of ['chromium','webkit']){
  const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  try{
   for(const viewport of [{width:390,height:844},{width:1180,height:820}]){
    const context=await browser.newContext({viewport,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',async route=>{
     const url=new URL(route.request().url());
     if(url.pathname.startsWith('/api/')){
      let data={ok:true};const action=url.searchParams.get('action');
      if(url.pathname.includes('school-auth'))data=action==='progress'?{enabled:true,userId:'s_weekly',poems:{}}:action==='weekly-report'?{ok:true,reports:[report]}
       :{enabled:true,authenticated:true,user:{id:'s_weekly',displayName:'示範同學',role:'student',grade:4,cls:'A',researchEnabled:false},csrfToken:'synthetic'};
      if(url.pathname.includes('school-recordings'))data={ok:true,userId:'s_weekly',recordings:[]};
      return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
     }
     let relative=url.pathname.replace(/^\/(school|maanshan)\//,'');if(!relative)relative='index.html';
     const file=path.resolve(root,'maanshan',decodeURIComponent(relative));
     if(!file.startsWith(path.join(root,'maanshan')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
     const ext=path.extname(file);let body=fs.readFileSync(file);if(['.mjs','.js','.html','.json','.css'].includes(ext))body=Buffer.from(body.toString('utf8').replace(/(["'`])\/maanshan\//g,'$1/school/'));
     return route.fulfill({contentType:types[ext]||'application/octet-stream',body}).catch(()=>{});
    });
    const label=engine+' '+viewport.width;
    await page.goto('https://weekly.invalid/school/');await page.locator('.weekly-bell').waitFor();
    await page.locator('.weekly-bell').click();await page.locator('.weekly-next').waitFor();
    check(label+' the report shows 下週挑戰句 with its line and score',await page.locator('.weekly-next').evaluate(el=>el.textContent.includes('下週挑戰句')&&el.textContent.includes('鍾山祇隔數重山')&&el.textContent.includes('62')));
    check(label+' 去挑戰 is a large enough button',await page.locator('[data-weekly=challenge]').evaluate(el=>{const b=el.getBoundingClientRect();return b.height>=44&&b.width>=88;}));
    if(evidence){await page.locator('.weekly-next').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,`weekly-${engine}-${viewport.width}.png`)});}
    await page.locator('[data-weekly=challenge]').click();
    await page.waitForFunction(()=>location.hash==='#bo-chuan-gua-zhou/record');
    await page.locator('#record-tool .verse').first().waitFor();
    check(label+' 去挑戰 closes the report and opens that line to read',await page.evaluate(()=>!document.querySelector('.weekly-dialog').open&&document.querySelector('#record-tool').textContent.startsWith('第 2 / 4 句')));
    check(label+' no browser errors',errors.length===0);
    await context.close();
   }
  }finally{await browser.close();}
 }
 console.log(JSON.stringify({ok:true,checks:checks.length}));
})().catch(error=>{console.error(error);process.exitCode=1;});
