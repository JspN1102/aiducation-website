// Pupil report score colours: each word card and the score ring carry the band
// of their score (80+ green, 60-79 yellow, below 60 red, unscored grey), the
// bands look different from each other, and every score chip - including the
// two-character 未測 - stays on one line so the word cards keep their layout.
// Synthetic pupil and local routes only; no production requests.
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),origin='https://report-score-bands.invalid',actor='synthetic-score-bands';
// Preview poems too: 鄭人買履 has the only six-column line (twelve characters) and the longest clauses.
const poems=['poems.json','poems-preview.json'].flatMap(file=>JSON.parse(fs.readFileSync(path.join(repo,'maanshan',file),'utf8')).poems);
const key='maanshan-learning-v2:'+actor,checks=[],errors=[];let browser;
function check(label,value){assert(value,label);checks.push({label,passed:true});}
const band=score=>score===null?'unknown':score<60?'error':score<80?'warn':'ok';
// Band edges with unscored words between scored neighbours.
const pattern=[59,60,79,80,100,null,0,100,null,85];
const plans={'zeng-wang-lun':[84,59,70,100],'gui-yuan-tian-ju':[100,100,100,100],'zheng-ren-mai-lu':[90,70,55,85]};
function seed(){return Object.fromEntries(poems.map(p=>[p.id,{reading:p.lines.map((line,i)=>{
 const total=plans[p.slug]?.[i];if(total===undefined)return null;
 return {total_score:total,grade:'繼續進步',dimensions:{phone_score:total,fluency_score:total,integrity_score:100},
  words:[...line.text].filter(c=>/\p{Script=Han}/u.test(c)).map((c,j)=>{const score=pattern[(j+i)%pattern.length];return {c,p:line.pinyin[j],i:j,score,status:band(score),phones:[]};})};
}),writing:[],chat:[],quiz:[],readingVersion:p.readingVersion,pronunciationVersion:p.pronunciationVersion}]));}
async function setup(width,height){
 const context=await browser.newContext({viewport:{width,height},hasTouch:width<1400,isMobile:width<700,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 await context.addInitScript(({key,progress})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(progress));},{key,progress:seed()});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url()),endpoint=url.pathname.replace(/\/$/,''),send=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  if(endpoint.startsWith('/api/')){
   if(endpoint==='/api/school-auth')return send(url.searchParams.get('action')==='progress'?{enabled:true,userId:actor,poems:{}}:{enabled:true,authenticated:true,user:{id:actor,role:'student',displayName:'示範同學',grade:1,cls:'A',classNo:1,isTest:true,learningScope:'all-grades',researchEnabled:false,previewPoems:true},csrfToken:'synthetic-csrf'});
   if(endpoint==='/api/school-recordings')return send({ok:true,userId:actor,recordings:[]});
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
 return {page,context};
}
async function reports(width,height){const {page,context}=await setup(width,height);try{
 for(const [slug,totals] of Object.entries(plans)){
  const poem=poems.find(p=>p.slug===slug);
  await page.evaluate(s=>{location.hash='#'+s+'/report';},slug);await page.locator('.report-line').first().waitFor();
  const ring=await page.locator('.score-ring').evaluate(el=>({cls:el.className,text:el.querySelector('strong').textContent.trim()}));
  const shown=Math.round(totals.reduce((a,b)=>a+b,0)/totals.length);
  check(width+'px '+slug+' score ring shows '+shown+' in its band '+JSON.stringify(ring),ring.text===String(shown)&&ring.cls.split(/\s+/).includes(band(shown)));
  for(let n=0;n<totals.length;n++){
   await page.locator('[data-action="score-line"][data-value="'+n+'"]').click();
   const state=await page.locator('.report-line:visible').evaluate(el=>{
    const cards=[...el.querySelectorAll('.word-grid .word-result')];
    return {noOverflow:document.documentElement.scrollWidth<=innerWidth+1,cards:cards.map(card=>{
     const strong=card.querySelector('strong'),s=strong.getBoundingClientRect(),c=card.getBoundingClientRect(),r=card.querySelector('ruby').getBoundingClientRect(),style=getComputedStyle(strong);
     return {cls:card.className,text:strong.textContent.trim(),oneLine:s.height<=parseFloat(style.lineHeight)*1.5,inside:s.left>=c.left-.5&&s.right<=c.right+.5,
      chip:style.backgroundColor+'|'+style.color,card:[Math.round(c.top),Math.round(c.height)],rubyTop:Math.round(r.top)};
    })};
   });
   const label=width+'px '+slug+' sentence '+n,words=[...poem.lines[n].text].filter(c=>/\p{Script=Han}/u.test(c));
   check(label+' every word card carries the band of its score',state.cards.length===words.length&&state.cards.every((card,j)=>{const score=pattern[(j+n)%pattern.length];return card.cls.split(/\s+/).includes(band(score))&&card.text===(score===null?'未測':String(score));}));
   check(label+' every score chip (未測 included) stays on one line inside its card '+JSON.stringify(state.cards.filter(c=>!c.oneLine||!c.inside).map(c=>c.text)),state.noOverflow&&state.cards.every(c=>c.oneLine&&c.inside));
   const rows=new Map();for(const card of state.cards){const row=rows.get(card.card[0])||[];row.push(card);rows.set(card.card[0],row);}
   check(label+' cards in a row keep one height and their characters stay level',[...rows.values()].every(row=>Math.max(...row.map(c=>c.card[1]))-Math.min(...row.map(c=>c.card[1]))<=1&&Math.max(...row.map(c=>c.rubyTop))-Math.min(...row.map(c=>c.rubyTop))<=1));
   const chips=new Map();for(const card of state.cards){const b=['ok','warn','error','unknown'].find(x=>card.cls.split(/\s+/).includes(x));(chips.get(b)||chips.set(b,new Set()).get(b)).add(card.chip);}
   const looks=[...chips.values()].map(set=>[...set]);
   check(label+' each band has one chip look and the bands look different '+JSON.stringify(Object.fromEntries([...chips].map(([b,set])=>[b,[...set]]))),looks.every(l=>l.length===1)&&new Set(looks.flat()).size===looks.length);
  }
 }
}finally{await context.close();}}
(async()=>{browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']});
 for(const size of [[320,740],[360,780],[375,812],[390,844],[414,896],[744,1133],[768,1024],[820,1180],[1024,768],[1440,900]])await reports(...size);
 assert.deepEqual(errors,[]);
})().catch(error=>{checks.push({label:'suite',passed:false,error:error.stack});process.exitCode=1;}).finally(async()=>{await browser?.close();const result={passed:checks.every(c=>c.passed),checks:checks.length,failed:checks.filter(c=>!c.passed),errors};console.log(JSON.stringify(result,null,1));});
