'use strict';
// The library's pack controls with synthetic accounts: each poem card's round
// download button (in the poem's colour, where the grade ribbon was), the big
// button's size following the poems shown, and the teachers' grade filter,
// which keeps the catalogue order. No network, no account data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),origin='https://library-pack.invalid',evidence=process.env.LIBRARY_PACK_EVIDENCE_DIR;
const read=file=>JSON.parse(fs.readFileSync(path.join(repo,'maanshan',file),'utf8'));
const published=read('poems.json').poems,preview=read('poems-preview.json').poems,manifest=read('pack-manifest.json');
const everyPoem=[...published,...preview].sort((a,b)=>a.grade-b.grade||a.id-b.id);
const GRADES=['','一','二','三','四','五','六'];
const mb=ids=>Math.max(1,Math.round(manifest.assets.filter(asset=>!asset.poems||asset.poems.some(id=>ids.includes(id))).reduce((sum,asset)=>sum+asset.bytes,0)/1048576));
const checks=[],errors=[];let browser;
function check(label,value){assert(value,label);checks.push(label);}
const TEACHER={id:'t_synthetic_library',role:'teacher',displayName:'示範老師',previewPoems:true};
const PUPIL={id:'s_synthetic_library',role:'student',displayName:'示範同學',grade:3,cls:'A',classNo:1,isTest:true,researchEnabled:false};
async function open(user,width,height){
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<700,isMobile:width<700,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url()),endpoint=url.pathname.replace(/\/$/,''),send=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    if(endpoint.startsWith('/api/')){
      if(endpoint==='/api/school-auth')return send(url.searchParams.get('action')==='progress'?{enabled:true,userId:user.id,poems:{}}:{enabled:true,authenticated:true,user,csrfToken:'synthetic-csrf'});
      if(endpoint==='/api/school-recordings')return send({ok:true,userId:user.id,recordings:[]});
      return send({ok:true});
    }
    let relative=url.pathname;if(relative==='/maanshan/')relative+='index.html';
    if(relative.includes('/published/')&&relative.includes('/maanshan/'))relative=relative.slice(relative.indexOf('/maanshan/'));
    const file=path.resolve(repo,'.'+decodeURIComponent(relative));
    if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
    const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.mp3':'audio/mpeg','.m4a':'audio/mp4','.mp4':'video/mp4','.glb':'model/gltf-binary'}[path.extname(file)]||'application/octet-stream';
    await route.fulfill({contentType:mime,body:fs.readFileSync(file)}).catch(()=>{});
  });
  await page.goto(origin+'/maanshan/');await page.locator('.poem-entry').first().waitFor();await page.evaluate(()=>document.fonts.ready);
  await page.waitForFunction(()=>/約 \d+ MB/.test(document.querySelector('.pack-button')?.textContent||''));
  return {page,context};
}
const cardIds=page=>page.$$eval('.poem-download',buttons=>buttons.map(button=>Number(button.dataset.value)));
const shot=async(page,name)=>{if(evidence)await page.screenshot({path:path.join(evidence,name)});};

(async()=>{
  if(evidence)fs.mkdirSync(evidence,{recursive:true});
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']});
  try{
    // A teacher with the preview poems: every poem, each with its round button, and a grade filter.
    let {page,context}=await open(TEACHER,1280,800);
    const allIds=everyPoem.map(p=>p.id);
    check('the library keeps the catalogue order',JSON.stringify(await cardIds(page))===JSON.stringify(allIds));
    check('no card shows a grade label',await page.locator('.poem-grade').count()===0);
    check('the big button counts every poem shown',(await page.locator('.pack-button').innerText())==='一鍵下載資源包（約 '+mb(allIds)+' MB）');
    const rounds=await page.$$eval('.poem-download',buttons=>buttons.map(button=>{const card=button.closest('.poem-card'),art=card.querySelector('.poem-art').getBoundingClientRect(),box=button.getBoundingClientRect(),style=getComputedStyle(button);
      return {visible:!button.hidden&&box.width>0,round:style.borderRadius==='50%'&&Math.abs(box.width-box.height)<1,colour:style.backgroundColor===getComputedStyle(card.querySelector('.poem-entry')).borderLeftColor,
        corner:box.right<=art.right+1&&box.top>=art.top-1&&box.right>art.right-box.width*2&&box.top<art.top+box.height,label:button.getAttribute('aria-label')};}));
    check('every card has a round button in its poem\'s colour at the picture\'s top-right',rounds.length===12&&rounds.every(r=>r.visible&&r.round&&r.colour&&r.corner));
    const first=everyPoem[0];
    check('a round button names its poem and size',rounds[0].label==='下載《'+first.title+'》的圖片、錄音、動畫和模型（約 '+mb([first.id])+' MB）');
    const [filter,big]=await Promise.all([page.locator('.pack-filter').boundingBox(),page.locator('.pack-button').boundingBox()]);
    check('the grade filter sits left of the big button on its row',filter.x+filter.width<=big.x&&Math.abs((filter.y+filter.height/2)-(big.y+big.height/2))<3);
    check('the filter offers every grade shown',JSON.stringify(await page.$$eval('.pack-filter option',options=>options.map(option=>option.textContent)))===JSON.stringify(['全部年級','一年級','二年級','三年級','四年級','五年級','六年級']));
    await shot(page,'library-teacher-desktop.png');
    // Filtering keeps the order and the big button follows the grade.
    await page.selectOption('.pack-filter','3');
    const third=everyPoem.filter(p=>p.grade===3).map(p=>p.id);
    check('a grade filter shows that grade only, in catalogue order',JSON.stringify(await cardIds(page))===JSON.stringify(third));
    check('the big button counts the filtered grade',(await page.locator('.pack-button').innerText())==='一鍵下載三年級資源包（約 '+mb(third)+' MB）');
    await shot(page,'library-teacher-grade3.png');
    // A tap on a round button downloads that poem only; the card stays where it is.
    const hash=await page.evaluate(()=>location.hash);
    const target=third[0],button=page.locator('.poem-download[data-value="'+target+'"]');
    await button.click();
    check('the round button does not open the poem',await page.evaluate(()=>location.hash)===hash);
    await page.waitForFunction(id=>document.querySelector('.poem-download[data-value="'+id+'"]').dataset.state==='complete',target,{timeout:120000});
    check('the finished poem shows as downloaded',(await button.getAttribute('aria-label')).endsWith('資源已下載到本機')&&await button.isDisabled());
    check('only that poem is wished',await page.evaluate(()=>localStorage.getItem('maanshan:pack'))==='p'+target);
    check('the other poem of the grade is untouched',await page.locator('.poem-download[data-value="'+third[1]+'"]').getAttribute('data-state')==='idle');
    await page.selectOption('.pack-filter','0');
    check('back to every grade restores the full order',JSON.stringify(await cardIds(page))===JSON.stringify(allIds));
    check('the poem stays downloaded after re-rendering',await page.locator('.poem-download[data-value="'+target+'"]').getAttribute('data-state')==='complete');
    await shot(page,'library-teacher-one-done.png');
    await context.close();

    // The same teacher on a phone.
    ({page,context}=await open(TEACHER,375,812));
    const phone=await page.$$eval('.poem-download',buttons=>buttons.slice(0,4).map(button=>{const box=button.getBoundingClientRect(),hit=getComputedStyle(button,'::after');return {width:box.width,inset:hit.inset};}));
    check('phone round buttons stay compact with a larger touch area',phone.every(p=>p.width>=30&&p.width<=34&&p.inset.startsWith('-6px')));
    const [phoneFilter,phoneBig]=await Promise.all([page.locator('.pack-filter').boundingBox(),page.locator('.pack-button').boundingBox()]);
    check('phone filter and button fit the screen',phoneFilter.x>=0&&phoneBig.x+phoneBig.width<=375);
    await shot(page,'library-teacher-phone.png');
    await page.locator('#poem-grid').scrollIntoViewIfNeeded();await shot(page,'library-teacher-phone-cards.png');
    await context.close();

    // A grade-3 pupil: own poem only, no filter, the button names the grade's pack.
    ({page,context}=await open(PUPIL,375,812));
    const own=published.filter(p=>p.grade===3).map(p=>p.id);
    check('a pupil sees the own grade\'s poem only',JSON.stringify(await cardIds(page))===JSON.stringify(own));
    check('a pupil has no grade filter',await page.locator('.pack-filter').count()===0);
    check('a pupil\'s big button counts the own poem',(await page.locator('.pack-button').innerText())==='一鍵下載本年級資源包（約 '+mb(own)+' MB）');
    await shot(page,'library-pupil-phone.png');
    await context.close();
    check('no uncaught page errors',errors.length===0);
    console.log(JSON.stringify({ok:true,checks},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);console.error(errors);process.exitCode=1;});
