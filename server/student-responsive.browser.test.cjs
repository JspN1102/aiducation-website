'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),origin='https://student-responsive.invalid',evidence=process.env.STUDENT_RESPONSIVE_EVIDENCE_DIR;
const poems=JSON.parse(fs.readFileSync(path.join(repo,'maanshan/poems.json'),'utf8')).poems;
const key='maanshan-learning-v2:synthetic-responsive',checks=[],errors=[];let browser;
function check(label,value){assert(value,label);checks.push({label,passed:true});}
function seed(){return Object.fromEntries(poems.map(p=>[p.id,{reading:p.lines.map(line=>({total_score:93,grade:'表現良好',dimensions:{phone_score:93,fluency_score:93,integrity_score:93},words:[...line.text].filter(c=>/\p{Script=Han}/u.test(c)).map((c,j)=>({c,p:line.pinyin[j],score:93,status:'ok',phones:[]}))})),writing:[],chat:[],quiz:[],readingVersion:p.readingVersion,pronunciationVersion:p.pronunciationVersion}]))}
async function setup(width,height){
 const context=await browser.newContext({viewport:{width,height},hasTouch:width<1400,isMobile:width<700,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 await context.addInitScript(({key,progress})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(progress));},{key,progress:seed()});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url()),endpoint=url.pathname.replace(/\/$/,''),send=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  if(endpoint==='/fixture-reset')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic fixture reset</title>'});
  if(endpoint.startsWith('/api/')){
   if(endpoint==='/api/school-auth')return send(url.searchParams.get('action')==='progress'?{enabled:true,userId:'synthetic-responsive',poems:{}}:{enabled:true,authenticated:true,user:{id:'synthetic-responsive',role:'student',displayName:'示範同學',grade:1,cls:'A',classNo:1,isTest:true,learningScope:'all-grades',researchEnabled:false},csrfToken:'synthetic-csrf'});
   if(endpoint==='/api/school-recordings')return send({ok:true,userId:'synthetic-responsive',recordings:[]});
   return route.fulfill({status:500,body:'Unexpected API blocked'});
  }
  let relative=url.pathname;if(relative==='/maanshan/')relative+='index.html';
  if(relative.includes('/published/')&&relative.includes('/maanshan/media/'))relative=relative.slice(relative.indexOf('/maanshan/media/'));
  const file=path.resolve(repo,'.'+decodeURIComponent(relative));
  if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
  const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';
  await route.fulfill({contentType:mime,body:fs.readFileSync(file)}).catch(()=>{});
 });
 await page.goto(origin+'/maanshan/');await page.locator('.poem-entry').first().waitFor();await page.evaluate(()=>document.fonts.ready);
 return{page,context};
}
async function reports(width,height){const {page,context}=await setup(width,height);try{
 for(const poem of poems){
  await page.evaluate(slug=>location.hash='#'+slug+'/report',poem.slug);await page.waitForFunction(title=>document.title.startsWith(title),poem.title);await page.locator('.report-line').first().waitFor();
  for(let n=0;n<4;n++){
   await page.locator('[data-action="score-line"][data-value="'+n+'"]').click();
   const state=await page.locator('.report-line:visible').evaluate(el=>{
    const grid=el.querySelector('.word-grid'),cards=[...grid.querySelectorAll('.word-result')],rows=[];
    for(const card of cards){const b=card.getBoundingClientRect(),row=rows.find(r=>Math.abs(r.y-b.y)<2);if(row)row.count++;else rows.push({y:b.y,count:1});}
    const view=document.querySelector('#view'),next=document.querySelector('.report-animation-next'),nextBox=next.getBoundingClientRect(),sentence=el.querySelector('.report-sentence').getBoundingClientRect();
    return {columns:Number(grid.dataset.columns),rows:rows.map(r=>r.count),count:cards.length,noOverflow:document.documentElement.scrollWidth<=innerWidth+1,
     tabletFits:view.scrollHeight<=view.clientHeight+2&&document.documentElement.scrollHeight<=innerHeight+2&&nextBox.bottom<=innerHeight&&sentence.height>=innerHeight*.28,
     nextLabel:next.textContent,nextHeight:nextBox.height,nextHref:next.getAttribute('href'),backLabel:document.querySelector('.back-library').textContent,
     ownReading:el.querySelectorAll('[data-action="replay"]').length,originalReading:el.querySelectorAll('[data-action="report-line-tts"]').length,
     pinyin:cards.map(card=>{const b=card.getBoundingClientRect(),rt=card.querySelector('rt'),r=rt.getBoundingClientRect();return {size:parseFloat(getComputedStyle(rt).fontSize),fits:r.left>=b.left-1&&r.right<=b.right+1,text:rt.textContent,scoreCentred:getComputedStyle(card.querySelector('strong')).textAlign==='center'};}),
     actions:[...el.querySelectorAll('.report-line-actions .button')].map(button=>{const s=getComputedStyle(button),b=button.getBoundingClientRect();return{centred:s.justifyContent==='center',height:b.height,inside:b.left>=0&&b.right<=innerWidth};})};
   });
   const groups=state.count/state.columns,perGroup=state.columns===7&&width<=520?[4,3]:state.columns===5&&width<=360?[3,2]:[state.columns],expected=Array.from({length:groups},()=>perGroup).flat();
   assert.deepEqual(state.rows,expected,width+'px '+poem.slug+' sentence '+n+' balanced groups');
   check(width+'px '+poem.slug+' sentence '+n+' readable pinyin and centred buttons',state.noOverflow&&state.pinyin.every(p=>p.size>=16&&p.fits&&p.scoreCentred)&&state.actions.every(a=>a.centred&&a.height>=44&&a.inside));
   check(width+'px '+poem.slug+' sentence '+n+' keeps distinct audio actions and the animation continuation',state.ownReading===1&&state.originalReading===1&&state.nextLabel==='去看動畫'&&state.nextHeight>=44&&state.nextHref==='#'+poem.slug+'/animation'&&state.backLabel==='返回');
   if(width>=701&&height>=560)check(width+'px '+poem.slug+' sentence '+n+' uses tablet height without scrolling',state.tabletFits);
  }
  if(evidence&&[2,5].includes(poem.id))await page.screenshot({path:path.join(evidence,'report-'+width+'x'+height+'-'+poem.slug+'.png'),fullPage:true});
 }
 // Sparse progress preserves original sentence labels; an empty result never creates a score.
 const partial=seed(),last=poems.at(-1);partial[last.id].reading[2]=null;
 await page.goto(origin+'/fixture-reset');
 await page.evaluate(({key,partial})=>localStorage.setItem(key,JSON.stringify(partial)),{key,partial});await page.goto(origin+'/maanshan/#'+last.slug+'/report');
 await page.locator('.report-line:visible').waitFor();
 const partialLabels=await page.locator('[data-action="score-line"]').allTextContents();
 check(width+'px incomplete reading keeps only first second and fourth sentence '+JSON.stringify(partialLabels),JSON.stringify(partialLabels)===JSON.stringify(['第一句','第二句','第四句']));
 await page.locator('.report-animation-next').click();await page.locator('.animation-lesson,.animation-pending').waitFor();
 check(width+'px continuation opens this poem animation',await page.evaluate(slug=>location.hash==='#'+slug+'/animation',last.slug));
 partial[last.id].reading=last.lines.map(()=>null);
 await page.goto(origin+'/fixture-reset');
 await page.evaluate(({key,partial})=>localStorage.setItem(key,JSON.stringify(partial)),{key,partial});await page.goto(origin+'/maanshan/#'+last.slug+'/report');
 await page.locator('.report-empty').waitFor();
 check(width+'px no reading does not invent a score or expose result controls',await page.locator('.score-ring,.report-line,.report-animation-next').count()===0);
 // Use the real writing component under the existing quiz layout to verify
 // the enlarged help text and real browser touch without recognition calls.
 await page.evaluate(async()=>{
  document.querySelector('.workspace').className='workspace lesson-shell view-quiz';
  document.querySelector('#view').innerHTML='<section class="challenge-shell"><div class="challenge-body"><div class="challenge-writing-layout"><div class="challenge-writing-heading"><p class="challenge-prompt">請寫出「滋潤」的「潤」。</p></div><div id="writing-fixture"></div></div></div></section>';
  const {mountChallengeWriting}=await import('/maanshan/challenge-writing.mjs');
  window.writing=mountChallengeWriting(document.querySelector('#writing-fixture'),{target:{char:'潤',pinyin:'rùn'},recognize:async()=>({candidates:['潤']})});
 });
 await page.locator('.cw-board').scrollIntoViewIfNeeded();
 const writing=await page.locator('.challenge-writing').evaluate(el=>({skip:parseFloat(getComputedStyle(el.querySelector('.cw-skip')).fontSize),status:parseFloat(getComputedStyle(el.querySelector('.cw-status')).fontSize),targets:[...el.querySelectorAll('button')].filter(b=>b.getClientRects().length).map(b=>b.getBoundingClientRect().height),white:[...el.querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data],noOverflow:document.documentElement.scrollWidth<=innerWidth+1}));
 check(width+'px writing keeps readable hints, white paper and large buttons '+JSON.stringify(writing),writing.noOverflow&&writing.skip>=17&&writing.status>=17&&writing.targets.every(h=>h>=44)&&writing.white.join(',')==='255,255,255,255');
 if(width<1400){
  const cdp=await context.newCDPSession(page),box=await page.locator('.cw-board').boundingBox();
  const before=await page.evaluate(()=>({page:scrollY,view:document.querySelector('#view').scrollTop,body:document.querySelector('.challenge-body').scrollTop}));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*.3,y:box.y+box.height*.25,id:1}]});
  for(let n=1;n<=8;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width*(.3+n*.04),y:box.y+box.height*(.25+n*.05),id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const after=await page.evaluate(()=>({page:scrollY,view:document.querySelector('#view').scrollTop,body:document.querySelector('.challenge-body').scrollTop}));
  check(width+'px touch writes without dragging the page',JSON.stringify(before)===JSON.stringify(after)&&await page.locator('[data-cw=undo]').isEnabled());
 }
 await page.locator('[data-cw=skip]').click();
 check(width+'px learning character fits its review square',await page.locator('.cw-animation').evaluate(el=>{const board=el.parentElement.getBoundingClientRect(),svg=el.querySelector('svg').getBoundingClientRect();return Math.abs(board.width-svg.width)<=3&&Math.abs(board.height-svg.height)<=3&&Math.abs((board.left+board.right)-(svg.left+svg.right))<=3;}));
 if(evidence)await page.screenshot({path:path.join(evidence,'writing-'+width+'x'+height+'.png'),fullPage:true});
 }finally{await context.close();}}
(async()=>{if(evidence)fs.mkdirSync(evidence,{recursive:true});browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']});
 for(const size of [[320,740],[360,780],[390,844],[844,390],[768,1024],[1024,600],[1180,820],[1440,1000]])await reports(...size);
 assert.deepEqual(errors,[]);
})().catch(error=>{checks.push({label:'suite',passed:false,error:error.stack});process.exitCode=1;}).finally(async()=>{await browser?.close();const result={passed:checks.every(c=>c.passed),checks,errors};if(evidence)fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,checks:checks.length,failures:checks.filter(c=>!c.passed),errors},null,2));});
