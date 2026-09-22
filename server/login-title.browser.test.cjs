'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),checks=[];
const sources=[...fs.readFileSync(path.join(root,'scripts/build-maanshan-css.cjs'),'utf8').match(/const files = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(match=>fs.readFileSync(path.join(root,'maanshan',match[1]),'utf8')).join('\n');
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
(async()=>{
 for(const engine of ['chromium','webkit']){
  const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  try{for(const width of [320,390,768,1180]){
   const context=await browser.newContext({viewport:{width,height:Math.min(1024,Math.max(768,width))},hasTouch:true}),page=await context.newPage();
   try{
    await context.route('**/*',route=>{
     const url=new URL(route.request().url());
     if(url.pathname.startsWith('/api/'))return route.fulfill({contentType:'application/json',body:JSON.stringify({enabled:true,authenticated:false})});
     if(url.pathname.endsWith('/app.bundle.css'))return route.fulfill({contentType:'text/css',body:sources});
     const mediaStart=url.pathname.indexOf('/media/');
     const relative=(mediaStart>=0?url.pathname.slice(mediaStart+1):url.pathname.replace(/^\/school\//,''))||'index.html',file=path.resolve(root,'maanshan',decodeURIComponent(relative));
     if(!file.startsWith(path.join(root,'maanshan')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
     return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
    });
    await page.goto('https://login-title.invalid/school/');await page.locator('#school-login-title').waitFor();await page.evaluate(()=>document.fonts.ready);
    const geometry=await page.locator('#school-login-title').evaluate(el=>{const b=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);const text=range.getBoundingClientRect(),card=el.closest('.school-login-card').getBoundingClientRect();return{text:el.textContent,lineHeight:parseFloat(getComputedStyle(el).lineHeight),fontSize:parseFloat(getComputedStyle(el).fontSize),height:b.height,left:text.left,right:text.right,cardLeft:card.left,cardRight:card.right,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};});
    assert.equal(geometry.text,'AI普通話學習平台');assert(geometry.height<=geometry.lineHeight+1,'single line');assert(geometry.left>=geometry.cardLeft&&geometry.right<=geometry.cardRight,'text fits card');assert(geometry.scrollWidth<=geometry.viewport,'no horizontal overflow');assert(geometry.fontSize>=21,'readable title');
    checks.push({engine,width,geometry});
    if(process.env.LOGIN_TITLE_EVIDENCE_DIR){fs.mkdirSync(process.env.LOGIN_TITLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.LOGIN_TITLE_EVIDENCE_DIR,`login-title-${engine}-${width}.png`)});}
   }finally{await context.close();}
  }}finally{await browser.close();}
 }
 console.log(JSON.stringify({ok:true,checks},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
