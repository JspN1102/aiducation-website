'use strict';
// Render real reading screens with synthetic accounts; no student or API data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),origin='https://reading-layout.invalid';
const poems=JSON.parse(fs.readFileSync(path.join(repo,'maanshan/poems.json'),'utf8')).poems;
const source=fs.readFileSync(path.join(repo,'scripts/build-maanshan-css.cjs'),'utf8');
const css=[...source.match(/const files = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m=>fs.readFileSync(path.join(repo,'maanshan',m[1]),'utf8')).join('\n');
const evidence=process.env.READING_LAYOUT_EVIDENCE_DIR,checks=[],errors=[];
const check=(name,ok,detail)=>{assert(ok,name+' '+JSON.stringify(detail));checks.push(name);};
async function setup(browser,width,height){
 const context=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:width<700,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url()),endpoint=u.pathname.replace(/\/$/,'');
  if(endpoint.startsWith('/api/')){
   const body=endpoint==='/api/school-auth'?(u.searchParams.get('action')==='progress'?{enabled:true,userId:'reading-layout',poems:{}}:{enabled:true,authenticated:true,user:{id:'reading-layout',role:'student',displayName:'測試同學',grade:1,cls:'A',classNo:1,isTest:true,learningScope:'all-grades',researchEnabled:false},csrfToken:'synthetic'}):endpoint==='/api/school-recordings'?{ok:true,userId:'reading-layout',recordings:[]}:{ok:true};
   return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  }
  if(endpoint==='/maanshan/app.bundle.css')return route.fulfill({contentType:'text/css',body:css});
  let relative=u.pathname;if(relative==='/maanshan/')relative+='index.html';
  if(relative.includes('/published/')&&relative.includes('/maanshan/media/'))relative=relative.slice(relative.indexOf('/maanshan/media/'));
  const file=path.resolve(repo,'.'+decodeURIComponent(relative));
  if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
  const type={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';
  return route.fulfill({contentType:type,body:fs.readFileSync(file)}).catch(()=>{});
 });
 await page.goto(origin+'/maanshan/');await page.locator('.poem-entry').first().waitFor();await page.evaluate(()=>document.fonts.ready);
 return{page,context};
}
(async()=>{
 if(evidence)fs.mkdirSync(evidence,{recursive:true});
 for(const engine of ['chromium','webkit']){
  const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
  try{for(const [width,height]of [[320,740],[360,780],[390,844],[844,390],[768,1024],[1180,820]]){
   const {page,context}=await setup(browser,width,height);
   try{for(const poem of poems){
    await page.evaluate(slug=>location.hash='#'+slug+'/record',poem.slug);await page.locator('.record-tool[data-step="read"]>.verse').waitFor();
    for(let line=0;line<poem.lines.length;line++){
     if(line)await page.locator('[data-action="record-step"][data-value="1"]').click();
     await page.waitForFunction(text=>document.querySelector('.record-tool[data-step="read"]>.verse')?.getAttribute('aria-label')===text,poem.lines[line].text+(poem.lines[line].punctuation||''));
     await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
     const metrics=await page.locator('.record-tool[data-step="read"]>.verse').evaluate(el=>{
      const box=node=>{const b=node.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom,right:b.right};};
      const verse=box(el),rubies=[...el.querySelectorAll('ruby')],clauses=[...el.querySelectorAll('.verse-clause')];
      return{verse,rubies:rubies.map(r=>({...box(r),size:parseFloat(getComputedStyle(r).fontSize)})),paired:clauses.map(c=>[...c.querySelectorAll('ruby')].map(r=>box(r).x)),
       controls:box(document.querySelector('#record-controls')),demo:box(document.querySelector('.record-model')),view:box(document.querySelector('#view')),noOverflow:document.documentElement.scrollWidth<=innerWidth+1,
       pinyin:rubies.map(r=>({r:box(r),rt:box(r.querySelector('rt')),size:parseFloat(getComputedStyle(r.querySelector('rt')).fontSize)}))};
     });
     const label=`${engine} ${width}x${height} ${poem.slug} line ${line+1}`;
     const minimum=height<=560?36:width<=360?36:width<700?40:48;
     check(label+' readable large characters without horizontal overflow',metrics.noOverflow&&metrics.rubies.every(r=>r.size>=minimum&&r.x>=0&&r.right<=width),metrics);
     check(label+' pinyin remains distinct and above its character',metrics.pinyin.every(p=>p.size>=16&&p.rt.x>=p.r.x-2&&p.rt.right<=p.r.right+2),metrics.pinyin);
     check(label+' whole sentence and recording control fit the screen',metrics.verse.y>=metrics.view.y-1&&metrics.demo.y>=metrics.verse.bottom-1&&metrics.controls.y>=metrics.demo.bottom-1&&metrics.controls.bottom<=Math.min(height-3,metrics.view.bottom+1),metrics);
     if(metrics.paired.length>1)check(label+' paired five-character lines have matching columns',metrics.paired.every(row=>row.every((x,i)=>Math.abs(x-metrics.paired[0][i])<=1)),metrics.paired);
    }
    if(evidence&&[2,5].includes(poem.grade))await page.screenshot({path:path.join(evidence,`${engine}-${width}x${height}-${poem.slug}.png`)});
   }}finally{await context.close();}
  }}finally{await browser.close();}
 }
 check('no browser exceptions',!errors.length,errors);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{const result={ok:!process.exitCode,checks:checks.length,errors};if(evidence)fs.writeFileSync(path.join(evidence,'reading-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));});
