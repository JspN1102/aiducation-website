'use strict';
// Challenge audio answers true (played), false (no copy could play) or null (cut off: a newer tap, a pause, the page hiding).
// Only a real failure may send audio_unavailable or tell the child the sound failed. Local files, synthetic audio and account only.
// Run with PLAYWRIGHT_MODULE pointing to a locally installed Playwright package.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),checks=[],errors=[];
const check=(name,value)=>{assert(value,name);checks.push(name);};
const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.glb':'model/gltf-binary','.woff2':'font/woff2','.mp3':'audio/mpeg'};
const fixture='<!doctype html><meta charset="utf-8"><style>[hidden]{display:none!important}#holder{width:560px}img{max-width:100%}.pvg-stage,.fs-stage,.rc-field{width:480px;height:300px;position:relative}.rc-scene{max-height:140px}.rc-boat img{width:90px}</style><div id="holder"></div><section id="view"></section>';
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return;}
  const file=path.resolve(repo,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(repo+path.sep)||!url.pathname.startsWith('/maanshan/')||!mime[path.extname(file)]){res.writeHead(404).end();return;}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)]);res.end(data);});
});
// Each game, its listen button and the words it shows when the sound really failed.
const GAMES=[
  ['garden','mountGarden','[data-garden-audio]','聲音暫時未能播放，稍後再試。'],
  ['river','mountRiver','[data-river-audio]','聲音暫時未能播放，拼圖仍然可以繼續。'],
  ['snow-count','mountSnowCount','[data-sc-listen]','聲音暫時未能播放，可以看着詩句讀一讀。'],
  ['couplet','mountCouplet','[data-pc-listen]','朗讀暫時未能播放，可以先看詩句，稍後再試。'],
  ['guest','mountGuest','[data-gk-listen]','朗讀暫時未能播放，可以先看詩句，稍後再試。'],
  ['rooster','mountRooster','[data-rr-audio]','聲音暫時未能播放，稍後再試。'],
  ['rain','mountRain','[data-rc-listen]','聲音暫時未能播放，看拼音也可以練習。'],
  ['seven-steps','mountSevenSteps','[data-ss-audio]','朗讀暫時未能播放，可以先看詩句，稍後再試。'],
  ['shoe-market','mountShoeMarket','[data-sm-listen]','聲音暫時未能播放，可以先看文字，稍後再試。'],
  ['zeng','mountFarewell','[data-fs-listen]','朗讀暫時未能播放，可以看詩句繼續，再按一次重聽。'],
  ['views','mountMountain','[data-vg-listen]','聲音暫時未能播放，可以再聽，或先看畫面玩。',0]// this game has never sent audio events
];
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
  try{
    const page=await browser.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${origin}/fixture`);
    await page.route('**/mountain-viewer.mjs*',route=>route.fulfill({contentType:'text/javascript',body:'export async function createMountainViewer(){return {setAngle(){},capture(){return "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"},destroy(){}}}'}));
    // Like the app: a new clip cuts off the one still playing, which then answers null.
    await page.evaluate(()=>{
      window.calls=[];window.supersede=true;window.observed=[];
      window.settle=value=>calls.filter(call=>!call.done).forEach(call=>call.settle(value));
      window.fakeAudio=audio=>{if(supersede)settle(null);return new Promise((resolve,reject)=>{const call={audio,done:false,settle(value){if(call.done)return;call.done=true;if(value==='reject')reject(new Error('play failed'));else resolve(value);}};calls.push(call);});};
      window.audioErrors=()=>observed.filter(e=>e.type==='error'&&e.error?.code==='audio_unavailable');
    });
    const look=(selector='#holder')=>page.evaluate(selector=>({errors:audioErrors().length,text:document.querySelector(selector).textContent}),selector);
    async function finish(value){await page.evaluate(value=>settle(value),value);await page.waitForTimeout(80);}
    // Taps a listen button once it can be used; earlier automatic clips are let to finish.
    async function tap(selector){
      await page.waitForTimeout(750);// seven-steps ignores a second tap within 700 ms
      for(let n=0;n<200;n++){
        if(await page.evaluate(s=>{const b=document.querySelector(s);return !!b&&!b.disabled&&b.getAttribute('aria-disabled')!=='true';},selector))break;
        await page.evaluate(()=>settle(true));await page.waitForTimeout(100);
      }
      const before=await page.evaluate(()=>calls.length);
      await page.evaluate(s=>document.querySelector(s).click(),selector);
      await page.waitForFunction(n=>calls.length>n&&!calls.at(-1).done,before,{timeout:5000});
    }
    async function mount(file,method,options={}){
      await page.evaluate(async({file,method,options})=>{
        window.game?.destroy();window.challenge?.destroy();settle(null);window.calls=[];window.supersede=true;window.observed=[];
        const mod=await import(`/maanshan/poem-games/${file}.mjs`);
        window.game=mod[method](document.querySelector('#holder'),{...options,reducedMotion:true,playAudio:fakeAudio,onResearch:(type,fields)=>observed.push({type,...fields})});
      },{file,method,options});
    }

    for(const [file,method,button,message,events=1] of GAMES){
      await mount(file,method);
      await tap(button);await finish(null);
      let state=await look();
      check(`${file}: a cut-off clip sends no audio_unavailable`,state.errors===0);
      check(`${file}: a cut-off clip shows no failure words`,!state.text.includes('未能播放'));
      await tap(button);await finish(false);
      state=await look();
      check(`${file}: a real failure sends audio_unavailable`,state.errors===events);
      check(`${file}: a real failure tells the child`,state.text.includes(message));
    }

    // Garden: a quick second tap restarts the line, and the cut-off first tap is no fault.
    await mount('garden','mountGarden');
    await tap('[data-garden-audio]');await page.evaluate(()=>document.querySelector('[data-garden-audio]').click());
    await page.waitForFunction(()=>calls.length===2);await finish(true);
    let state=await look();
    check('garden: a double tap sends no audio_unavailable',state.errors===0&&!state.text.includes('未能播放'));
    // Even when the older clip fails late, only the latest tap speaks.
    await page.evaluate(()=>{supersede=false;});
    await tap('[data-garden-audio]');await page.evaluate(()=>document.querySelector('[data-garden-audio]').click());
    await page.waitForFunction(()=>calls.filter(c=>!c.done).length===2);
    await page.evaluate(()=>calls.at(-2).settle(false));await page.waitForTimeout(80);
    state=await look();check('garden: a late failure of an older tap is ignored',state.errors===0&&!state.text.includes('未能播放'));
    await page.evaluate(()=>calls.at(-1).settle(false));await page.waitForTimeout(80);
    state=await look();check('garden: the latest tap failing reports once and tells the child',state.errors===1&&state.text.includes('聲音暫時未能播放，稍後再試。'));
    await page.evaluate(()=>{supersede=true;});
    await tap('[data-garden-audio]');await finish('reject');
    state=await look();check('garden: a player error is a real failure',state.errors===2);

    // River: no player answer at all still counts as not heard; finishing the puzzle silences a pending reading.
    await mount('river','mountRiver');
    await tap('[data-river-audio]');await finish(undefined);
    state=await look();check('river: an undefined answer is a real failure',state.errors===1&&state.text.includes('聲音暫時未能播放，拼圖仍然可以繼續。'));
    await tap('[data-river-audio]');
    await page.evaluate(()=>{for(let n=0;n<6;n++){document.querySelector(`[data-river-tray] [data-piece="${n}"]`).click();document.querySelector(`[data-river-slot="${n}"]`).click();}});
    check('river: the puzzle is finished while the reading is pending',(await look()).text.includes('拼好了！'));
    await finish(false);
    state=await look();
    check('river: a late failure after finishing does not cover 「拼好了！」',state.text.includes('拼好了！春風染綠兩岸，明月照着小舟。')&&!state.text.includes('未能播放'));
    check('river: a late failure after finishing sends no event',state.errors===1);
    await page.evaluate(()=>{game.destroy();game=null;});

    // 聽全詩: a line cut off stops the reading; the next line must not start behind a pause or a hidden page.
    await mount('couplet','mountCouplet',{readOnly:true});
    await tap('[data-pc-listen]');const lines=await page.evaluate(()=>calls.length);await finish(null);await page.waitForTimeout(200);
    state=await look();
    check('couplet: a cut-off line stops 聽全詩',await page.evaluate(()=>calls.length)===lines&&state.errors===0&&!state.text.includes('未能播放'));
    await page.evaluate(()=>{game.destroy();game=null;});

    // Challenge listening question: a cut-off clip puts the prompt back; a real failure asks to listen again.
    async function mountChallenge(slug,type){
      await page.evaluate(async([slug,type])=>{
        window.game?.destroy();window.game=null;window.challenge?.destroy();settle(null);window.calls=[];window.supersede=true;window.observed=[];
        const {mountChallenge}=await import('/maanshan/challenge.mjs'),{CHALLENGE_SETS}=await import('/maanshan/challenge-data.mjs'),{newAttempt,attemptItems,recordAnswer}=await import('/maanshan/challenge-state.mjs');
        const lists=await Promise.all(['/maanshan/poems.json','/maanshan/poems-preview.json'].map(async url=>(await(await fetch(url)).json()).poems));
        const poem=lists.flat().find(p=>p.slug===slug),set=CHALLENGE_SETS[slug],saved=newAttempt(set,{seed:'audio-interrupt'}),items=attemptItems(saved,set),index=items.findIndex(item=>item.type===type);
        for(let i=0;i<index;i++)recordAnswer(saved,set,i,{status:items[i].type==='microgame'?'skipped':'correct'});
        saved.cursor=index;
        window.challenge=mountChallenge(document.querySelector('#view'),{poem,saved,onChange:()=>{},onAnswer:()=>{},onCorrectionProgress:()=>{},onResearch:(type,event)=>observed.push({type,...event}),playAudio:fakeAudio,stopAudio:()=>settle(null),recognize:async()=>({candidates:['口']})});
      },[slug,type]);
    }
    const sound=()=>page.evaluate(()=>({status:document.querySelector('.challenge-audio-status').textContent,locked:[...document.querySelectorAll('[data-option]')].every(b=>b.disabled),events:observed.filter(e=>e.type==='error').length}));
    async function listen(){const n=await page.evaluate(()=>calls.length);await page.evaluate(()=>document.querySelector('[data-ch="listen"]').click());await page.waitForFunction(n=>calls.length>n,n);}
    await mountChallenge('yong-e','sound');
    const prompt=(await sound()).status;
    await listen();check('challenge: tapping shows 聽一聽…',(await sound()).status==='聽一聽…');
    await page.evaluate(()=>challenge.pause());await page.waitForTimeout(80);
    let heard=await sound();
    check('challenge: a pause puts the prompt back',heard.status===prompt&&!heard.status.includes('沒播完'));
    check('challenge: a pause does not count as heard',heard.locked);
    await listen();await finish(false);
    heard=await sound();check('challenge: a real failure asks to listen again',heard.status.includes('還沒播完')&&heard.locked);
    await listen();await finish(true);
    const ready=await sound();check('challenge: a played clip opens the choices',!ready.locked);
    await listen();await finish(null);
    heard=await sound();check('challenge: a cut-off replay keeps the choices and the prompt',heard.status===ready.status&&!heard.locked);
    check('challenge: listening sends no error events',heard.events===0);
    // A choice changed during a replay keeps its words when the replay is then cut off.
    const choose=n=>page.evaluate(n=>{document.querySelectorAll('[data-option]')[n].click();return document.querySelector('.challenge-audio-status').textContent;},n);
    const first=await choose(0);await listen();const second=await choose(1);
    await page.evaluate(()=>challenge.pause());await page.waitForTimeout(80);
    heard=await sound();
    check('challenge: a pause after a new choice keeps that choice’s words',first!==second&&second.startsWith('已選')&&heard.status===second&&await page.evaluate(()=>document.querySelectorAll('[data-option]')[1].getAttribute('aria-pressed')==='true'));

    // A poem game inside the challenge gets null through, and its real failure reaches research.
    await mountChallenge('gui-yuan-tian-ju','microgame');
    await page.waitForSelector('[data-garden-audio]',{timeout:20000});
    await tap('[data-garden-audio]');await finish(null);
    state=await look('#view');check('challenge garden: a cut-off clip sends nothing',state.errors===0&&!state.text.includes('未能播放'));
    await tap('[data-garden-audio]');await finish(false);
    state=await look('#view');
    check('challenge garden: a real failure is reported as game.garden.audio',state.errors===1&&await page.evaluate(()=>audioErrors()[0].itemId==='game.garden.audio'));
    check('challenge garden: a real failure tells the child',state.text.includes('聲音暫時未能播放，稍後再試。'));
    await page.evaluate(()=>{challenge.destroy();challenge=null;});
    await page.close();

    // The production app: real clips, TTS answering 500, a synthetic pupil without research upload.
    await appContract(browser,origin);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,checks:checks.length,names:checks,pageErrors:errors},null,2));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});

async function appContract(browser,origin){
  const actor='synthetic-audio-interrupt',poems=JSON.parse(fs.readFileSync(path.join(repo,'maanshan/poems.json'),'utf8')).poems;
  const {mapAssessment}=await import('../maanshan/core.mjs');
  const stored=Object.fromEntries(poems.map(poem=>[poem.id,{reading:poem.lines.map(line=>mapAssessment({SuggestedScore:85,PronAccuracy:85,Words:[...line.simplified].filter(c=>/\p{Script=Han}/u.test(c)).map(Word=>({Word,PronAccuracy:85}))},line))}]));
  const cssSource=fs.readFileSync(path.join(repo,'scripts/build-maanshan-css.cjs'),'utf8');
  const css=[...cssSource.match(/const files = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m=>fs.readFileSync(path.join(repo,'maanshan',m[1]),'utf8')).join('\n');
  // Test hook, appended to the served copy only: the app's own player, stopMedia and every research event.
  const hook='\n;window.__audioTest={play:target=>playChallengeAudio(target),stop:()=>stopMedia(),events:[]};{const emit=research.emit;research.emit=(type,fields)=>{window.__audioTest.events.push({type,...fields});return emit(type,fields);};}\n';
  const context=await browser.newContext({viewport:{width:1180,height:720},serviceWorkers:'block'}),page=await context.newPage(),tts=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.addInitScript(({actor,stored})=>{
    localStorage.setItem('maanshan-learning-v2:'+actor,JSON.stringify(stored));window.mediaEvents=[];
    const NativeAudio=window.Audio;window.Audio=function(...args){const audio=new NativeAudio(...args);for(const type of ['playing','ended','error','pause'])audio.addEventListener(type,()=>mediaEvents.push({type,url:audio.currentSrc||audio.src}));return audio;};window.Audio.prototype=NativeAudio.prototype;
  },{actor,stored});
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url()),endpoint=url.pathname.replace(/\/$/,'');
    if(endpoint.startsWith('/api/')){
      if(endpoint==='/api/tts'){tts.push(1);return route.fulfill({status:500,contentType:'application/json',body:'{"error":"No TTS in this test"}'});}
      let data={ok:true};if(endpoint==='/api/school-auth')data=url.searchParams.get('action')==='progress'?{enabled:true,userId:actor,poems:{}}:{enabled:true,authenticated:true,user:{id:actor,role:'student',displayName:'測試同學',grade:1,cls:'A',classNo:1,isTest:true,learningScope:'all-grades',researchEnabled:false},csrfToken:'synthetic-csrf'};
      if(endpoint==='/api/school-recordings')data={ok:true,userId:actor,recordings:[]};return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    }
    if(endpoint==='/maanshan/app.bundle.css')return route.fulfill({contentType:'text/css',body:css});
    let relative=url.pathname;if(relative==='/maanshan/')relative+='index.html';if(relative.includes('/published/')&&relative.includes('/maanshan/media/'))relative=relative.slice(relative.indexOf('/maanshan/media/'));
    const file=path.resolve(repo,'.'+decodeURIComponent(relative));if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
    if(path.extname(file)==='.mp3')return route.continue();
    const body=relative==='/maanshan/app.js'?fs.readFileSync(file,'utf8')+hook:fs.readFileSync(file);
    return route.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body}).catch(()=>{});
  });
  const events=()=>page.evaluate(()=>__audioTest.events.filter(e=>e.type==='error'&&e.itemId==='game.garden.audio'&&e.error?.code==='audio_unavailable').length);
  const feedback=()=>page.locator('.gr-feedback').innerText();
  try{
    await page.goto(origin+'/maanshan/');await page.locator('.poem-entry').first().waitFor();
    await page.evaluate(()=>location.hash='#gui-yuan-tian-ju/quiz');await page.locator('[data-garden-audio]').waitFor({timeout:20000});
    await page.waitForFunction(()=>document.querySelector('.gr-loading').hidden,null,{timeout:20000});
    const contract=await page.evaluate(async()=>{
      const t=window.__audioTest,first=t.play({text:'草盛豆苗稀'}),second=t.play({text:'草盛豆苗稀'});
      const cut=await first;await new Promise(resolve=>setTimeout(resolve,300));t.stop();const stopped=await second;
      const missing=await t.play({text:'這一句沒有錄音'});const played=await t.play({text:'草盛豆苗稀'});
      return {cut,stopped,missing,played};
    });
    check('app: a newer tap cuts the older clip off (null)',contract.cut===null);
    check('app: stopMedia cuts a clip off (null)',contract.stopped===null);
    check('app: no recording and no TTS is a real failure (false)',contract.missing===false&&tts.length>0);
    check('app: a recorded clip plays to the end (true)',contract.played===true);
    // The garden double tap and the page hiding mid-line: the false alarms seen in game.garden.audio.
    await page.evaluate(()=>{__audioTest.events.length=0;mediaEvents.length=0;});
    await page.locator('[data-garden-audio]').click();await page.waitForTimeout(150);await page.locator('[data-garden-audio]').click();
    await page.waitForFunction(()=>mediaEvents.some(e=>e.type==='ended'&&e.url.endsWith('/grade5-verse2.mp3')),null,{timeout:20000});await page.waitForTimeout(150);
    check('app garden: a double tap sends no audio_unavailable',await events()===0&&!(await feedback()).includes('未能播放'));
    await page.evaluate(()=>mediaEvents.length=0);
    await page.locator('[data-garden-audio]').click();
    await page.waitForFunction(()=>mediaEvents.some(e=>e.type==='playing'),null,{timeout:20000});
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForTimeout(400);
    await page.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
    check('app garden: the page hiding mid-line sends no audio_unavailable',await events()===0&&!(await feedback()).includes('未能播放'));
    // A clip that cannot load is still reported, and the child is told.
    await page.route('**/grade5-verse2.mp3',route=>route.fulfill({status:404,body:''}));
    await page.locator('[data-garden-audio]').click();
    await page.waitForFunction(()=>document.querySelector('.gr-feedback').textContent.includes('未能播放'),null,{timeout:20000});
    check('app garden: a clip that cannot play is reported once',await events()===1);
    check('app garden: the child is told',(await feedback())==='聲音暫時未能播放，稍後再試。');
  }finally{await context.close();}
}
