'use strict';
// A pupil's poet chat follows them to another device: progress brings it back, each reply saves the whole recent chat.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),origin='https://chat-sync.invalid',checks=[],errors=[];
const poem=require('../maanshan/poems.json').poems[0];
const check=(name,value)=>{assert(value,name);checks.push(name);};
const user={id:'synthetic-chat',role:'teacher',displayName:'測試老師',grade:null,cls:null,classNo:null,isTest:false,researchEnabled:false,learningScope:'all-grades'};
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 let remote={messages:[{role:'user',content:'合成問題一'},{role:'assistant',content:'合成回答一'}],updatedAt:1000};
 const saves=[];
 async function device(){
  const context=await browser.newContext({viewport:{width:1180,height:820},hasTouch:true,serviceWorkers:'block'}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url()),endpoint=u.pathname.replace(/\/$/,'');
   if(endpoint.startsWith('/api/')){
    if(endpoint==='/api/maanshan-chat')return route.fulfill({contentType:'application/json',body:JSON.stringify({reply:'合成回答二',responseSource:'live'})});
    if(endpoint==='/api/maanshan-save'){
     const body=route.request().postDataJSON();
     if(body.section==='chat'){saves.push(body);remote=body.payload;}
     return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,stored:'db'})});
    }
    let data={ok:true};
    if(endpoint==='/api/school-auth')data=u.searchParams.get('action')==='progress'?{enabled:true,userId:user.id,learningEpoch:'initial',poems:{[poem.id]:{chat:remote}}}:{enabled:true,authenticated:true,user,csrfToken:'synthetic-csrf',learningEpoch:'initial'};
    if(endpoint==='/api/school-recordings')data={ok:true,userId:user.id,learningEpoch:'initial',recordings:[]};
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
  return {context,page};
 }
 const bubbles=page=>page.$$eval('#chat-messages .chat-bubble',list=>list.map(b=>b.textContent.trim()));
 try{
  // First device has never chatted: the conversation from elsewhere appears.
  const first=await device();
  await first.page.goto(origin+'/maanshan/#'+poem.slug+'/chat');
  await first.page.waitForFunction(()=>[...document.querySelectorAll('#chat-messages .chat-bubble')].some(b=>b.textContent.includes('合成回答一')));
  check('chat from another device is restored',(await bubbles(first.page)).join('|').includes('合成問題一'));
  await first.page.locator('#chat-input').fill('合成問題二');await first.page.locator('#chat-send').click();
  await first.page.waitForFunction(()=>!document.querySelector('#chat-send').disabled&&document.querySelector('#chat-messages').textContent.includes('合成回答二'));
  for(let i=0;i<50&&!saves.length;i++)await first.page.waitForTimeout(100);
  const saved=saves.at(-1);
  check('a reply saves the whole recent chat',saved&&saved.poemId===poem.id&&saved.payload.messages.length===4&&saved.payload.messages.at(-1).content==='合成回答二'&&saved.payload.updatedAt>1000);
  check('saved messages carry only role and content',saved.payload.messages.every(m=>Object.keys(m).sort().join(',')==='content,role'));
  // An older copy from the server never replaces newer chat on this device.
  const newer=remote;remote={messages:[{role:'assistant',content:'較舊的合成回答'}],updatedAt:500};
  await first.page.reload();await first.page.locator('#chat-messages').waitFor();await first.page.waitForTimeout(800);
  check('older server chat does not overwrite newer local chat',(await bubbles(first.page)).join('|').includes('合成回答二')&&!(await bubbles(first.page)).join('|').includes('較舊'));
  await first.context.close();
  // Second device picks up the conversation saved by the first.
  remote=newer;
  const second=await device();
  await second.page.goto(origin+'/maanshan/#'+poem.slug+'/chat');
  await second.page.waitForFunction(()=>document.querySelector('#chat-messages')?.textContent.includes('合成回答二'));
  check('second device shows the latest chat',(await bubbles(second.page)).filter(t=>t.startsWith('合成')).length===4);
  await second.context.close();
 }finally{await browser.close();}
 check('no browser exceptions',errors.length===0);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>console.log(JSON.stringify({ok:!process.exitCode,checks,errors,syntheticOnly:true,paidRequests:0},null,2)));
