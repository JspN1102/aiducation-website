'use strict';
// Real browser playback through both actual deployment transformations. No
// provider calls or real accounts: APIs and the short PCM fixture are local.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..'),checks=[],actor='synthetic-poet-routing';
const sourceMaps=JSON.parse(execFileSync('python',['-c',[
 "import importlib.util,pathlib,json,sys; sys.path.insert(0,'deploy')",
 "from public_school import public_source",
 "s=importlib.util.spec_from_file_location('fallback','deploy/package-company-fallback.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)",
 "files={p.name:p.read_text(encoding='utf-8') for p in pathlib.Path('maanshan').iterdir() if p.suffix in ['.mjs','.js','.html']}",
 "print(json.dumps({kind:{name:(m.relocate_source(public_source(text)) if kind=='company' else public_source(text)) for name,text in files.items()} for kind in ['main','company']}))"
].join(';')],{cwd:repo,encoding:'utf8',maxBuffer:30*1024*1024}));
const wav=Buffer.alloc(8044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
function check(label,value){assert(value,label);checks.push(label);}
async function run(kind,engine){
 const prefix=kind==='company'?'/school-api/':'/api/',calls=[],gets=[],unexpected=[],errors=[];
 const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(/^\/(?:school-api|api)\//.test(u.pathname)){
   if(!u.pathname.startsWith(prefix)){unexpected.push(req.method+' '+u.pathname);res.writeHead(404);return res.end();}
   const endpoint=u.pathname.split('/')[2];
   if(endpoint==='tts'&&req.method==='GET'){
    gets.push(u.pathname);let start=0,end=wav.length-1;const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
    if(range){start=Number(range[1]);if(range[2])end=Math.min(Number(range[2]),end);res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${wav.length}`);}
    res.setHeader('Content-Type','audio/wav');res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Length',end-start+1);return res.end(wav.subarray(start,end+1));
   }
   res.setHeader('Content-Type','application/json');
   if(endpoint==='tts'&&req.method==='POST'){let body='';req.on('data',c=>body+=c);req.on('end',()=>{calls.push(JSON.parse(body));res.end(JSON.stringify({url:'/api/tts/?key='+'a'.repeat(64)+'&sig='+'b'.repeat(64)}));});return;}
   if(endpoint==='school-auth')return res.end(JSON.stringify(u.searchParams.get('action')==='progress'?{enabled:true,userId:actor,poems:{}}:{enabled:true,authenticated:true,user:{id:actor,role:'student',displayName:'測試同學',grade:5,isTest:true,researchEnabled:false},csrfToken:'synthetic'}));
   if(endpoint==='school-recordings')return res.end(JSON.stringify({ok:true,userId:actor,recordings:[]}));
   if(req.method!=='GET'){unexpected.push(req.method+' '+u.pathname);res.statusCode=500;}
   return res.end(JSON.stringify({ok:true}));
  }
  if(!['GET','HEAD'].includes(req.method)){unexpected.push(req.method+' '+u.pathname);return res.writeHead(405).end();}
  let relative=u.pathname.replace(/^\/school\//,'/maanshan/');if(relative==='/maanshan/')relative+='index.html';
  const file=path.resolve(repo,'.'+decodeURIComponent(relative));if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
  const mapped=relative.startsWith('/maanshan/')&&sourceMaps[kind][relative.slice('/maanshan/'.length)];res.end(typeof mapped==='string'?mapped:fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port,browser=engine==='webkit'?await webkit.launch({headless:true}):await chromium.launch({headless:true,channel:'msedge'});
 const context=await browser.newContext({viewport:{width:1180,height:820},hasTouch:true,serviceWorkers:'block'}),page=await context.newPage();
 await context.route(/^https:\/\//,route=>route.abort());
 page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(({actor})=>localStorage.setItem('maanshan-learning-v2:'+actor,JSON.stringify({5:{reading:[],chat:[{role:'assistant',content:'我們一起看看田裏的豆苗吧。'}]}})),{actor});
 try{
  await page.goto(origin+'/school/#gui-yuan-tian-ju/chat');const button=page.locator('[data-action="chat-speak"][data-value="0"]');await button.waitFor();
  for(let tap=0;tap<2;tap++){
   await button.click();await page.waitForFunction(()=>document.querySelector('[data-action="chat-speak"][data-value="0"]')?.getAttribute('aria-busy')!=='true');
   check(`${kind} ${engine} tap ${tap+1}: no playback error`,!(await page.locator('body').innerText()).includes('語音暫時無法播放'));
  }
  check(`${kind} ${engine}: poet retains 101021 and phrase is synthesized once`,calls.length===1&&calls[0].voice===101021&&calls[0].purpose==='poet-chat');
  check(`${kind} ${engine}: audio GET uses deployed API namespace`,gets.length>=1&&gets.every(url=>url===prefix+'tts/'));
  check(`${kind} ${engine}: no wrong API or student-data writes`,unexpected.length===0);
  check(`${kind} ${engine}: no page errors`,errors.length===0);
 }finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
}
(async()=>{for(const kind of ['main','company'])for(const engine of ['chromium','webkit'])await run(kind,engine);console.log(JSON.stringify({checks:checks.length,passed:checks,syntheticOnly:true},null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
