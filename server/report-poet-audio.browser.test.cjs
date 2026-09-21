'use strict';
// Real app clicks, synthetic accounts and audio. No live API/provider requests.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),origin='https://report-poet-audio.invalid',actor='synthetic-report-poet',checks=[],errors=[];
const poems=JSON.parse(fs.readFileSync(path.join(repo,'maanshan/poems.json'),'utf8')).poems,poem=poems.find(p=>p.grade===5);
const wav=Buffer.alloc(8044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const cssSource=fs.readFileSync(path.join(repo,'scripts/build-maanshan-css.cjs'),'utf8'),css=[...cssSource.match(/const files = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m=>fs.readFileSync(path.join(repo,'maanshan',m[1]),'utf8')).join('\n');
const check=(name,value)=>{assert(value,name);checks.push(name);};let browser;
(async()=>{
 const {mapAssessment}=await import('../maanshan/core.mjs'),{getWordAudioURL}=await import('../maanshan/word-audio.mjs');
 const reading=poem.lines.map(line=>mapAssessment({SuggestedScore:85,PronAccuracy:85,Words:[...line.simplified].filter(c=>/\p{Script=Han}/u.test(c)).map(Word=>({Word,PronAccuracy:85}))},line));
 browser=await chromium.launch({channel:'msedge',headless:true});
 for(const failWords of [false,true]){
  const context=await browser.newContext({viewport:{width:1180,height:820},hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),calls=[],audio=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(({actor,poem,reading})=>localStorage.setItem('maanshan-learning-v2:'+actor,JSON.stringify({[poem.id]:{reading,chat:[{role:'assistant',content:poem.lines[1].text},{role:'assistant',content:'我們一起看看田裏的豆苗吧。'}]}})),{actor,poem,reading});
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url()),endpoint=u.pathname.replace(/\/$/,'');
   if(endpoint.startsWith('/api/')){
    requests.push(endpoint);
    if(endpoint==='/api/tts'){
     if(route.request().method()==='GET'){audio.push(endpoint);return route.fulfill({contentType:'audio/wav',body:wav});}
     calls.push(route.request().postDataJSON());return route.fulfill({contentType:'application/json',body:JSON.stringify({url:'/api/tts/?key='+'a'.repeat(64)+'&sig='+'b'.repeat(64)})});
    }
    let data={ok:true};
    if(endpoint==='/api/school-auth')data=u.searchParams.get('action')==='progress'?{enabled:true,userId:actor,poems:{}}:{enabled:true,authenticated:true,user:{id:actor,role:'student',displayName:'測試同學',grade:5,cls:'A',classNo:1,isTest:true,researchEnabled:false},csrfToken:'synthetic-csrf'};
    if(endpoint==='/api/school-recordings')data={ok:true,userId:actor,recordings:[]};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   if(endpoint.endsWith('.mp3')&&(endpoint.includes('/media/words/')||endpoint.includes('/media/recitations/'))){audio.push(endpoint);return route.fulfill(failWords&&endpoint.includes('/media/words/')?{status:404,body:''}:{contentType:'audio/wav',body:wav});}
   if(endpoint==='/maanshan/app.bundle.css')return route.fulfill({contentType:'text/css',body:css});
   let relative=u.pathname;if(relative==='/maanshan/')relative+='index.html';if(relative.includes('/published/')&&relative.includes('/maanshan/media/'))relative=relative.slice(relative.indexOf('/maanshan/media/'));
   const file=path.resolve(repo,'.'+decodeURIComponent(relative));if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
   const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';return route.fulfill({contentType:mime,body:fs.readFileSync(file)});
  });
  try{
   await page.goto(origin+'/maanshan/#'+poem.slug+'/report');await page.locator('.report-line-actions').first().waitFor({state:'attached'});
   for(const [line,char,pinyin,numbered]of [[1,'荷','hè','he4'],[2,'長','cháng','chang2']]){
    await page.locator('[data-action=score-line][data-value="'+line+'"]').click();const word=page.locator('.report-line:not([hidden]) [data-action=word-tts][data-value="'+char+'"]');
    check((failWords?'fallback ':'static ')+char+' button retains assessed pinyin',await word.getAttribute('data-pinyin')===pinyin&&await word.evaluate(e=>e.tagName)==='BUTTON');
    const previous=calls.length;await word.click();await page.waitForFunction(({char})=>!document.querySelector('.report-line:not([hidden]) [data-action=word-tts][data-value="'+char+'"]').hasAttribute('aria-busy'),{char});
    if(failWords){const call=calls[previous];check(char+' fallback uses ordinary female voice and exact phoneme',call?.voice===403001&&call.allowSSML===true&&call.text.includes('ph="'+numbered+'"')&&call.text.includes('>'+char+'</phoneme>')&&!call.purpose);}
    else check(char+' static pronunciation is correct without a TTS request',calls.length===previous&&audio.some(p=>p.endsWith('/'+path.basename(getWordAudioURL(char,pinyin)))));
   }
   const beforeLine=calls.length;await page.locator('.report-line:not([hidden]) [data-action=report-line-tts]').click();await page.waitForFunction(()=>!document.querySelector('.report-line:not([hidden]) [data-action=report-line-tts]').hasAttribute('aria-busy'));
   check((failWords?'fallback ':'static ')+'report sentence uses official recording',calls.length===beforeLine&&audio.at(-1).endsWith('/grade5-line3.mp3'));
   await page.evaluate(slug=>location.hash='#'+slug+'/chat',poem.slug);await page.locator('[data-action=chat-speak][data-value="0"]').waitFor();
   check('poet playback button sits compactly outside and directly below its reply',await page.locator('[data-action=chat-speak][data-value="0"]').evaluate(button=>{const bubble=button.parentElement.querySelector('.chat-bubble'),a=button.getBoundingClientRect(),b=bubble.getBoundingClientRect();return !button.closest('.chat-bubble')&&a.top>=b.bottom&&a.top-b.bottom<=6&&a.width<=48&&a.height<=44&&a.left===b.left;}));
   for(const [index,text]of [[0,poem.lines[1].text],[1,'我們一起看看田裏的豆苗吧。']]){
    const before=calls.length,staticBefore=audio.filter(p=>p.includes('/media/recitations/')).length,button=page.locator('[data-action=chat-speak][data-value="'+index+'"]');await button.click();await page.waitForFunction(index=>!document.querySelector('[data-action=chat-speak][data-value="'+index+'"]').hasAttribute('aria-busy'),index);
    const call=calls[before];check((failWords?'fallback ':'static ')+'poet reply '+index+' uses male purpose and skips official interception',call?.text===text&&call.voice===101021&&call.purpose==='poet-chat'&&call.allowSSML===false&&audio.filter(p=>p.includes('/media/recitations/')).length===staticBefore);
   }
   check((failWords?'fallback ':'static ')+'no unexpected scoring or chat generation calls',!requests.some(endpoint=>['/api/soe','/api/chat','/api/maanshan-chat'].includes(endpoint)));
  }catch(error){console.error(JSON.stringify({url:page.url(),screen:await page.locator('#app').innerText(),calls,audio},null,2));throw error;}finally{await context.close();}
 }
 check('no browser errors',errors.length===0);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();console.log(JSON.stringify({ok:!process.exitCode,checks,errors,syntheticOnly:true,paidRequests:0},null,2));});
