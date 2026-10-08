'use strict';
// Speech goes quiet only after two failed phrases in a row, for ten seconds, and
// a phrase that plays clears the count. Local routes only; no provider calls.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),checks=[],actor='synthetic-tts-backoff';
const wav=Buffer.alloc(8044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
function check(label,value){assert(value,label);checks.push(label);}
(async()=>{
 const calls=[],errors=[];let fail=0;
 const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname.startsWith('/api/')){
   const endpoint=u.pathname.split('/')[2];
   if(endpoint==='tts'&&req.method==='GET'){res.setHeader('Content-Type','audio/wav');return res.end(wav);}
   res.setHeader('Content-Type','application/json');
   if(endpoint==='tts'&&req.method==='POST'){calls.push(Date.now());if(fail>0){fail--;res.statusCode=503;return res.end('{"error":"busy"}');}return res.end(JSON.stringify({url:'/api/tts/?key='+'a'.repeat(64)+'&sig='+'b'.repeat(64)}));}
   if(endpoint==='school-auth')return res.end(JSON.stringify(u.searchParams.get('action')==='progress'?{enabled:true,userId:actor,poems:{}}:{enabled:true,authenticated:true,user:{id:actor,role:'student',displayName:'測試同學',grade:5,isTest:true,researchEnabled:false},csrfToken:'synthetic'}));
   if(endpoint==='school-recordings')return res.end(JSON.stringify({ok:true,userId:actor,recordings:[]}));
   return res.end(JSON.stringify({ok:true}));
  }
  let relative=u.pathname;if(relative==='/maanshan/')relative+='index.html';
  const file=path.resolve(repo,'.'+decodeURIComponent(relative));if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true,channel:'msedge'});
 const context=await browser.newContext({viewport:{width:1180,height:820},serviceWorkers:'block'}),page=await context.newPage();
 await context.route(/^https:\/\//,route=>route.abort());
 page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(({actor})=>localStorage.setItem('maanshan-learning-v2:'+actor,JSON.stringify({5:{reading:[],chat:[{role:'assistant',content:'我們一起看看田裏的豆苗吧。'},{role:'user',content:'好'},{role:'assistant',content:'早上我去除草。'},{role:'user',content:'好'},{role:'assistant',content:'晚上帶着月亮回家。'}]}})),{actor});
 try{
  await page.goto(origin+'/maanshan/#gui-yuan-tian-ju/chat');
  const tap=async index=>{const button=page.locator(`[data-action="chat-speak"][data-value="${index}"]`);await button.waitFor();await button.click();await page.waitForFunction(index=>document.querySelector(`[data-action="chat-speak"][data-value="${index}"]`)?.getAttribute('aria-busy')!=='true',index);await page.waitForTimeout(150);};
  fail=2;await tap(0);check('the first failed phrase is asked for',calls.length===1);
  await tap(0);check('one failure does not silence speech: the next tap asks again',calls.length===2);
  await tap(2);check('two failures in a row pause speech requests, for every phrase',calls.length===2);
  await page.waitForTimeout(10300);await tap(2);check('after ten seconds speech is asked for again and plays',calls.length===3);
  fail=1;await tap(4);await tap(4);check('a phrase that played cleared the count: one new failure does not pause speech',calls.length===5);
  check('no page errors',errors.length===0);
 }finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
 console.log(JSON.stringify({checks:checks.length,passed:checks,syntheticOnly:true},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
