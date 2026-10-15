'use strict';
// Play every poem game in the real app (synthetic account, no student or API data)
// and check that no text lands on other text, on a control or panel, or gets clipped,
// at phone, tablet and desktop sizes, from the first screen to the finished picture.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),origin='https://games-overlap.invalid';
const poems=['poems.json','poems-preview.json'].flatMap(f=>JSON.parse(fs.readFileSync(path.join(repo,'maanshan',f),'utf8')).poems);
const source=fs.readFileSync(path.join(repo,'scripts/build-maanshan-css.cjs'),'utf8');
const css=[...source.match(/const files = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m=>fs.readFileSync(path.join(repo,'maanshan',m[1]),'utf8')).join('\n');
const evidence=process.env.POEM_GAMES_OVERLAP_EVIDENCE_DIR,checks=[],errors=[],problems=[];
// Phones (portrait, landscape), iPads (portrait, short and tall landscape), desktop.
const VIEWS=(process.env.POEM_GAMES_OVERLAP_VIEWS||'320x568,390x844,844x390,768x1024,1024x690,1180x820,1366x1024,1440x900').split(',').map(v=>v.split('x').map(Number));
const STEPS=Number(process.env.POEM_GAMES_OVERLAP_STEPS||8);
const ONLY=process.env.POEM_GAMES_OVERLAP_ONLY?process.env.POEM_GAMES_OVERLAP_ONLY.split(','):null;
const check=(name,ok,detail)=>{assert(ok,name+' '+JSON.stringify(detail));checks.push(name);};

// Runs in the page. Text is measured on the em box of each line (line boxes are taller
// than the glyphs); rects in different scroll containers are clipped to what is visible.
function detectOverlap(rootSelector){
 const root=document.querySelector(rootSelector);if(!root)return[{kind:'missing',root:rootSelector}];
 const problems=[];
 const label=el=>{const cls=typeof el.className==='string'?el.className.trim().split(/\s+/).slice(0,2).join('.'):'';return el.tagName.toLowerCase()+(cls?'.'+cls:'');};
 const shown=el=>{for(let n=el;n&&n!==document.documentElement;n=n.parentElement){const s=getComputedStyle(n);if(n.hidden||s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0||s.clipPath==='inset(50%)'||(s.clip&&s.clip.startsWith('rect(0')))return false;}return true;};
 const inter=(a,b)=>{const w=Math.min(a.right,b.right)-Math.max(a.left,b.left),h=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);return w>0&&h>0?{w,h}:null;};
 const scroller=el=>{for(let n=el.parentElement;n&&n!==document.body;n=n.parentElement){const s=getComputedStyle(n);if(/(auto|scroll)/.test(s.overflowX+s.overflowY)&&(n.scrollHeight>n.clientHeight+1||n.scrollWidth>n.clientWidth+1))return n;}return null;};
 const clipTo=(r,sc)=>{if(!sc)return r;const c=sc.getBoundingClientRect(),o={left:Math.max(r.left,c.left),right:Math.min(r.right,c.right),top:Math.max(r.top,c.top),bottom:Math.min(r.bottom,c.bottom)};return o.right-o.left>1&&o.bottom-o.top>1?o:null;};
 const absOf=el=>{for(let n=el;n&&n!==root;n=n.parentElement){const p=getComputedStyle(n).position;if(p==='absolute'||p==='fixed')return n;}return null;};
 const texts=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
 for(let node;(node=walker.nextNode());){
  if(!node.data.trim())continue;const el=node.parentElement;if(!shown(el)||el.closest('svg'))continue;
  const range=document.createRange();range.selectNodeContents(node);const fs=parseFloat(getComputedStyle(el).fontSize)||16;
  for(const r of range.getClientRects()){if(r.width<=1||r.height<=1)continue;const mid=(r.top+r.bottom)/2,top=Math.max(r.top,mid-fs/2),bottom=Math.min(r.bottom,mid+fs/2);
   texts.push({el,r:{left:r.left,right:r.right,top,bottom,height:bottom-top},t:node.data.trim().slice(0,14),sc:scroller(el)});}
 }
 for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++){
  const a=texts[i],b=texts[j];if(a.el===b.el||(a.el.closest('ruby')&&a.el.closest('ruby')===b.el.closest('ruby')))continue;
  const same=a.sc===b.sc,ar=same?a.r:clipTo(a.r,a.sc),br=same?b.r:clipTo(b.r,b.sc);if(!ar||!br)continue;
  const x=inter(ar,br);if(!x||x.h<Math.min(a.r.height,b.r.height)*.3||x.w<3)continue;
  problems.push({kind:'text-over-text',a:label(a.el)+' "'+a.t+'"',b:label(b.el)+' "'+b.t+'"'});
 }
 const boxes=[...root.querySelectorAll('button,input,select,textarea,[class*="tray"],[class*="board"]')].filter(e=>shown(e)&&e.getClientRects().length);
 for(const t of texts)for(const box of boxes){
  // Captions laid over a picture may cover its hotspots by design.
  if(box.contains(t.el)||t.el.contains(box)||(absOf(t.el)&&absOf(box)))continue;
  const bs=scroller(box),same=bs===t.sc,tr=same?t.r:clipTo(t.r,t.sc),r=same?box.getBoundingClientRect():clipTo(box.getBoundingClientRect(),bs);if(!tr||!r)continue;
  const x=inter(tr,r);if(!x||x.h<t.r.height*.3||x.w<3)continue;
  problems.push({kind:'text-over-box',a:label(t.el)+' "'+t.t+'"',b:label(box)});
 }
 for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
  const a=boxes[i],b=boxes[j];if(a.contains(b)||b.contains(a))continue;
  // Hotspots placed on a picture may overlap each other by design.
  if(getComputedStyle(a).position==='absolute'&&getComputedStyle(b).position==='absolute')continue;
  const as=scroller(a),bs=scroller(b),same=as===bs,ra=same?a.getBoundingClientRect():clipTo(a.getBoundingClientRect(),as),rb=same?b.getBoundingClientRect():clipTo(b.getBoundingClientRect(),bs);if(!ra||!rb)continue;
  const x=inter(ra,rb);if(!x||x.w<4||x.h<4)continue;
  problems.push({kind:'box-over-box',a:label(a),b:label(b)});
 }
 for(const t of texts){
  if(t.r.left<-1||t.r.right>innerWidth+1)problems.push({kind:'text-offscreen-x',a:label(t.el)+' "'+t.t+'"'});
  for(let n=t.el.parentElement;n&&n!==document.body;n=n.parentElement){
   const s=getComputedStyle(n);if(/(auto|scroll)/.test(s.overflowX+s.overflowY))break;
   const hides=v=>v==='hidden'||v==='clip';if(!hides(s.overflowX)&&!hides(s.overflowY))continue;
   const r=n.getBoundingClientRect();
   if((hides(s.overflowY)&&(t.r.top<r.top-1||t.r.bottom>r.bottom+1))||(hides(s.overflowX)&&(t.r.left<r.left-1||t.r.right>r.right+1))){problems.push({kind:'text-clipped',a:label(t.el)+' "'+t.t+'"',b:label(n)});break;}
  }
 }
 // Text spilling out of its own block (a fixed-height box whose text grew).
 for(const el of new Set(texts.map(t=>t.el.closest('p,h1,h2,h3,h4,b,strong,span,button,label,figcaption,li,div')))){
  if(!el)continue;const d=getComputedStyle(el).display;if(d.startsWith('inline')&&!['inline-block','inline-flex','inline-grid'].includes(d))continue;
  const r=el.getBoundingClientRect();
  const out=texts.find(t=>el.contains(t.el)&&(t.r.bottom>r.bottom+Math.max(4,t.r.height*.35)||t.r.top<r.top-Math.max(4,t.r.height*.35)||t.r.right>r.right+4||t.r.left<r.left-4));
  if(out)problems.push({kind:'text-outside-own-box',a:label(out.el)+' "'+out.t+'"',b:label(el)});
 }
 // A picture frame with overflow:hidden is still scrollable by focus/scrollIntoView; once scrolled,
 // the whole painting slides inside its frame and labels near its edge are cut (絕句 at 568x320).
 for(const el of root.querySelectorAll('*')){
  if(!el.scrollTop&&!el.scrollLeft)continue;const s=getComputedStyle(el);
  if(/(auto|scroll)/.test(s.overflowX+s.overflowY))continue;
  problems.push({kind:'frame-scrolled',a:label(el),by:Math.round(el.scrollTop)+','+Math.round(el.scrollLeft)});
 }
 const seen=new Set();return problems.filter(p=>{const k=JSON.stringify(p);return !seen.has(k)&&seen.add(k);});
}

async function setup(browser,width,height){
 const context=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:width<700,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(`${width}x${height} ${e.message}`));
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url()),endpoint=u.pathname.replace(/\/$/,'');
  if(endpoint.startsWith('/api/')){
   // Speech stays offline so the games fall back to text, as on a bad network.
   if(endpoint==='/api/tts')return route.fulfill({status:503,contentType:'application/json',body:'{"error":"offline"}'});
   const body=endpoint==='/api/school-auth'?(u.searchParams.get('action')==='progress'?{enabled:true,userId:'games-overlap',poems:{}}:{enabled:true,authenticated:true,user:{id:'games-overlap',role:'student',displayName:'測試同學',grade:1,cls:'A',classNo:1,isTest:true,previewPoems:true,learningScope:'all-grades',researchEnabled:false},csrfToken:'synthetic'}):endpoint==='/api/school-recordings'?{ok:true,userId:'games-overlap',recordings:[]}:{ok:true};
   return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  }
  if(endpoint==='/maanshan/app.bundle.css')return route.fulfill({contentType:'text/css',body:css});
  // The 3D mountain is replaced by a still frame; its layout is what is checked here.
  if(endpoint.endsWith('/poem-games/mountain-viewer.mjs'))return route.fulfill({contentType:'text/javascript',body:'export async function createMountainViewer(){return {setAngle(){},capture(){return "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"},destroy(){}}}'});
  let relative=u.pathname;if(relative==='/maanshan/')relative+='index.html';
  if(relative.includes('/published/')&&relative.includes('/maanshan/media/'))relative=relative.slice(relative.indexOf('/maanshan/media/'));
  const file=path.resolve(repo,'.'+decodeURIComponent(relative));
  if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
  const type={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2','.glb':'model/gltf-binary','.mp3':'audio/mpeg'}[path.extname(file)]||'application/octet-stream';
  return route.fulfill({contentType:type,body:fs.readFileSync(file)}).catch(()=>{});
 });
 await page.goto(origin+'/maanshan/');await page.locator('.poem-entry').first().waitFor();await page.evaluate(()=>document.fonts.ready);
 return{page,context};
}
const frame=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));

async function inspect(page,label,state,engine,width,height,slug){
 await frame(page);
 const found=await page.evaluate(`(${detectOverlap})('.challenge-shell')`);
 for(const p of found)problems.push({label,state,...p});
 if(evidence&&found.length)await page.screenshot({path:path.join(evidence,`${engine}-${width}x${height}-${slug}-${state}.png`)});
 checks.push(`${label} ${state}`);
}

// 《泊船瓜洲》: wrong cells first (the long status that once pushed the tray over the heading), then solve.
async function playRiver(page,see){
 await page.locator('[data-river-slot]:not([disabled])').first().waitFor({timeout:25000});
 await see('start');
 for(const [piece,slot] of [[4,0],[1,1],[5,2]]){await page.locator(`.river-puzzle-tray [data-piece="${piece}"]`).tap();await page.locator(`[data-river-slot="${slot}"]`).tap();await see(`piece${piece}-slot${slot}`);}
 for(const piece of [0,3,2,4,5])if(await page.locator(`.river-puzzle-tray [data-piece="${piece}"]`).count()){await page.locator(`.river-puzzle-tray [data-piece="${piece}"]`).tap();await page.locator(`[data-river-slot="${piece}"]`).tap();await see(`piece${piece}`);}
 for(let i=0;i<8&&!await page.locator('.river-puzzle-game.is-complete').count();i++){
  const slots=await page.locator('[data-river-slot]').evaluateAll(n=>n.map(s=>s.querySelector('[data-piece]')?.dataset.piece??null));
  const wrong=slots.findIndex((p,i)=>p!==String(i));if(wrong<0)break;
  await page.locator(`[data-river-slot="${wrong}"]`).tap();await page.locator(`[data-river-slot="${slots[wrong]}"]`).tap();
 }
 await page.locator('.river-puzzle-game.is-complete').waitFor();await page.waitForTimeout(300);await see('complete');
}

// Every other game: keep tapping whichever usable control has been tapped least, so each
// game moves through its stages the same way on every run, then reveal the finished picture.
async function playAny(page,see){
 await page.waitForTimeout(1200);await see('start');
 const taps={};
 for(let step=1;step<=STEPS;step++){
  const pick=await page.evaluate(taps=>{
   const holder=document.querySelector('.challenge-game-holder');
   const ok=b=>{if(b.disabled||b.getAttribute('aria-disabled')==='true'&&!b.dataset.smShoe||!b.getClientRects().length)return false;
    for(let n=b;n&&n!==holder;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||n.hidden)return false;}
    return !/listen|audio|retry|replay|load/.test(Object.keys(b.dataset).join(' ').toLowerCase());};
   const key=b=>b.tagName+':'+Object.entries(b.dataset).map(([k,v])=>k+'='+v).join(',')+':'+(b.textContent||'').trim().slice(0,8);
   const all=[...holder.querySelectorAll('button,[role=button],input[type=range]')].filter(ok).sort((a,b)=>(taps[key(a)]||0)-(taps[key(b)]||0));
   document.querySelectorAll('[data-overlap-pick]').forEach(n=>n.removeAttribute('data-overlap-pick'));
   if(!all.length)return null;all[0].setAttribute('data-overlap-pick','1');return{key:key(all[0]),range:all[0].type==='range'};
  },taps);
  if(!pick)break;taps[pick.key]=(taps[pick.key]||0)+1;
  const target=page.locator('[data-overlap-pick="1"]');
  if(pick.range)await target.evaluate((s,v)=>{s.value=v;s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));},String(taps[pick.key]*37%101));
  else await target.tap({timeout:1500}).catch(()=>target.evaluate(b=>b.click()).catch(()=>{}));
  await page.waitForTimeout(250);await see('step'+step);
 }
 if(await page.locator('[data-ch=skip]:visible').count()){
  await page.locator('[data-ch=skip]').click();await page.waitForTimeout(300);await see('skipped');
  if(await page.locator('[data-ch=show-solution]:visible').count()){await page.locator('[data-ch=show-solution]').click();await page.waitForTimeout(800);await see('solution');}
 }else await see('end');
}

async function run(engine){
 const browser=await(engine==='chromium'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
 try{for(const [width,height]of VIEWS){
  const {page,context}=await setup(browser,width,height);
  try{for(const poem of poems){
   if(ONLY&&!ONLY.includes(poem.slug))continue;
   const label=`${engine} ${width}x${height} ${poem.slug}`,see=state=>inspect(page,label,state,engine,width,height,poem.slug);
   await page.evaluate(slug=>location.hash='#'+slug+'/quiz',poem.slug);
   await page.locator('.challenge-game-holder>section, .challenge-game-holder>div:not(.poem-game-loading)').first().waitFor({timeout:25000});
   await(poem.slug==='bo-chuan-gua-zhou'?playRiver(page,see):playAny(page,see));
  }}finally{await context.close();}
 }}finally{await browser.close();}
}

(async()=>{
 if(evidence)fs.mkdirSync(evidence,{recursive:true});
 await Promise.all(['chromium','webkit'].map(run));
 check('every game screen keeps its text apart from other text and controls',!problems.length,problems.slice(0,20));
 check('no browser exceptions',!errors.length,errors);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{const result={ok:!process.exitCode,checks:checks.length,problems:problems.length,errors};if(evidence)fs.writeFileSync(path.join(evidence,'poem-games-overlap-results.json'),JSON.stringify({...result,problems},null,2));console.log(JSON.stringify(result));});
