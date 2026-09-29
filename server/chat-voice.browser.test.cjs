'use strict';
// Speech input in the poet conversation, with a synthetic microphone (a tone
// from Web Audio) and a synthetic speech API; no provider is called.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),origin='https://chat-voice.invalid',checks=[],errors=[];
const check=(name,value)=>{assert(value,name);checks.push(name);};
const poem=require('../maanshan/poems.json').poems[0];
const QUESTION='駱賓王，你幾歲寫《詠鵝》？';
// Replace the microphone with a tone so MediaRecorder encodes real audio in each engine.
const fakeMicrophone=()=>{
 window.__mic={denied:false,tracks:[]};
 const devices=navigator.mediaDevices||(Object.defineProperty(navigator,'mediaDevices',{value:{},configurable:true}),navigator.mediaDevices);
 devices.getUserMedia=async()=>{
  if(window.__mic.denied)throw new DOMException('denied','NotAllowedError');
  const Audio=window.AudioContext||window.webkitAudioContext,context=new Audio(),oscillator=context.createOscillator(),destination=context.createMediaStreamDestination();
  oscillator.frequency.value=440;oscillator.connect(destination);oscillator.start();await context.resume().catch(()=>{});
  window.__mic.tracks.push(...destination.stream.getTracks());return destination.stream;
 };
};
(async()=>{
 for(const [name,engine,viewport] of [['edge',chromium,{width:1180,height:820}],['edge-phone',chromium,{width:360,height:740}],['webkit',webkit,{width:390,height:844}]]){
  const browser=await engine.launch(engine===chromium?{channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required']}:{headless:true});
  try{
   const context=await browser.newContext({viewport,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),speech=[],chat=[];
   let speechReply=null;
   page.on('pageerror',e=>errors.push(name+': '+e.message));
   await context.addInitScript(fakeMicrophone);
   await context.route('**/*',async route=>{
    const u=new URL(route.request().url()),endpoint=u.pathname.replace(/\/$/,'');
    if(endpoint.startsWith('/api/')){
     if(endpoint==='/api/speech-to-text'){
      const body=route.request().postDataJSON();speech.push({body,csrf:route.request().headers()['x-csrf-token']});
      const reply=speechReply?.(body)||{status:200,body:{text:QUESTION}};
      return route.fulfill({status:reply.status,contentType:'application/json',body:JSON.stringify(reply.body)});
     }
     if(endpoint==='/api/maanshan-chat'){chat.push(route.request().postDataJSON());return route.fulfill({contentType:'application/json',body:JSON.stringify({reply:'我七歲寫的。'})});}
     let data={ok:true};
     if(endpoint==='/api/school-auth')data=u.searchParams.get('action')==='progress'?{enabled:true,userId:'synthetic-voice',learningEpoch:'initial',poems:{}}:{enabled:true,authenticated:true,user:{id:'synthetic-voice',role:'teacher',displayName:'測試老師',grade:null,cls:null,classNo:null,isTest:false,researchEnabled:false,learningScope:'all-grades'},csrfToken:'synthetic-csrf',learningEpoch:'initial'};
     if(endpoint==='/api/school-recordings')data={ok:true,userId:'synthetic-voice',learningEpoch:'initial',recordings:[]};
     return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    }
    let relative=u.pathname;
    if(relative==='/maanshan/')relative+='index.html';
    if(relative.includes('/published/')&&relative.includes('/maanshan/media/'))relative=relative.slice(relative.indexOf('/maanshan/media/'));
    const file=path.resolve(root,'.'+decodeURIComponent(relative));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
    const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';
    return route.fulfill({contentType:mime,body:fs.readFileSync(file)});
   });
   await page.goto(origin+'/maanshan/#'+poem.slug+'/chat');
   const mic=page.locator('#chat-voice');await mic.waitFor();
   const layout=await page.evaluate(()=>{const box=s=>document.querySelector(s).getBoundingClientRect();const form=box('#chat-form'),input=box('#chat-input'),voice=box('#chat-voice'),send=box('#chat-send');return {input:input.width,voice:[voice.width,voice.height],inside:[voice,send].every(b=>b.left>=form.left-1&&b.right<=form.right+1),apart:voice.right<=send.left,scroll:document.documentElement.scrollWidth<=innerWidth};});
   check(name+' microphone sits beside send inside the box with room to read the text',layout.inside&&layout.apart&&layout.voice[0]>=40&&layout.voice[1]>=40&&layout.input>=120&&layout.scroll);
   const supported=await page.evaluate(()=>Boolean(window.MediaRecorder&&navigator.mediaDevices?.getUserMedia));

   // Speak, stop, and the recognised question waits in the box for the pupil.
   await mic.click();
   if(!supported){
    await page.waitForFunction(()=>/更新瀏覽器/.test(document.querySelector('#chat-voice-status').textContent));
    check(name+' without MediaRecorder explains typing is still available',true);continue;
   }
   await page.waitForFunction(()=>document.querySelector('#chat-voice').classList.contains('recording'));
   check(name+' listening state shows a stop button and a running timer',await page.evaluate(()=>document.querySelector('#chat-voice').getAttribute('aria-label')==='說完了'&&/正在聽你說 0:0\d/.test(document.querySelector('#chat-voice-status').textContent)));
   await page.waitForTimeout(1200);await mic.click();
   await page.waitForFunction(q=>document.querySelector('#chat-input').value===q,QUESTION);
   const first=speech[0].body;
   check(name+' sends the compact recording once with the school session',speech.length===1&&speech[0].csrf==='synthetic-csrf'&&typeof first.audio==='string'&&first.audio.length>500&&['webm','mp4','ogg'].includes(first.audioFormat)&&!('poemId' in first));
   check(name+' leaves the text to check and send, and returns to the microphone',await page.evaluate(()=>/看看對不對/.test(document.querySelector('#chat-voice-status').textContent)&&!document.querySelector('#chat-voice').disabled&&!document.querySelector('#chat-voice').classList.contains('recording')));
   check(name+' releases the microphone after recording',await page.evaluate(()=>window.__mic.tracks.every(t=>t.readyState==='ended')));
   await page.locator('#chat-send').click();await page.waitForFunction(()=>!document.querySelector('#chat-send').disabled&&document.querySelectorAll('.chat-message').length>=3);
   check(name+' sending the spoken question reaches the poet unchanged',chat.at(-1)?.messages.at(-1).content===QUESTION);

   // A refused compact upload is sent again once as browser PCM.
   speechReply=body=>body.audioFormat?{status:422,body:{error:'Audio transcode failed',code:'AUDIO_TRANSCODE_FAILED'}}:null;
   await mic.click();await page.waitForFunction(()=>document.querySelector('#chat-voice').classList.contains('recording'));await page.waitForTimeout(900);await mic.click();
   await page.waitForFunction(q=>document.querySelector('#chat-input').value===q,QUESTION);
   const pcm=speech.at(-1).body,wave=pcm.audioCompression==='gzip'?null:Buffer.from(pcm.audio,'base64');
   check(name+' falls back to PCM WAV after a refused compact upload',speech.length===3&&speech[1].body.audioFormat&&!pcm.audioFormat&&(pcm.audioCompression==='gzip'||wave.toString('ascii',0,4)==='RIFF'));
   await page.locator('#chat-input').fill('');

   // Nothing heard, a service failure and a refused microphone each say what to do next.
   speechReply=()=>({status:200,body:{text:''}});
   await mic.click();await page.waitForFunction(()=>document.querySelector('#chat-voice').classList.contains('recording'));await page.waitForTimeout(700);await mic.click();
   await page.waitForFunction(()=>/聽不清楚/.test(document.querySelector('#chat-voice-status').textContent));
   check(name+' empty recognition keeps the box empty',await page.locator('#chat-input').inputValue()==='');
   speechReply=()=>({status:502,body:{error:'Speech recognition unavailable',code:'SPEECH_UNAVAILABLE'}});
   await mic.click();await page.waitForFunction(()=>document.querySelector('#chat-voice').classList.contains('recording'));await page.waitForTimeout(700);await mic.click();
   await page.waitForFunction(()=>/先打字/.test(document.querySelector('#chat-voice-status').textContent));
   check(name+' service failure suggests trying again or typing',!(await mic.isDisabled()));
   speechReply=()=>({status:429,body:{error:'Too many speech requests',code:'SPEECH_LIMIT'}});
   await mic.click();await page.waitForFunction(()=>document.querySelector('#chat-voice').classList.contains('recording'));await page.waitForTimeout(700);await mic.click();
   await page.waitForFunction(()=>/繁忙/.test(document.querySelector('#chat-voice-status').textContent));
   check(name+' per-pupil limit is explained',true);
   await page.evaluate(()=>{window.__mic.denied=true;});await mic.click();
   await page.waitForFunction(()=>/允許使用麥克風/.test(document.querySelector('#chat-voice-status').textContent));
   check(name+' refused microphone asks for permission',!(await mic.isDisabled()));
   await page.evaluate(()=>{window.__mic.denied=false;});

   // Leaving the page mid-sentence stops the microphone and sends nothing.
   const sent=speech.length;
   await mic.click();await page.waitForFunction(()=>document.querySelector('#chat-voice').classList.contains('recording'));
   await page.goto(origin+'/maanshan/#'+poem.slug+'/read');await page.waitForTimeout(600);
   check(name+' leaving while listening stops the microphone and sends nothing',speech.length===sent&&await page.evaluate(()=>window.__mic.tracks.every(t=>t.readyState==='ended')));
   await context.close();
  } finally {await browser.close();}
 }
 assert.deepEqual(errors,[]);
 console.log(`${checks.length} chat voice checks passed`);
})().catch(error=>{console.error(error);process.exitCode=1;});
