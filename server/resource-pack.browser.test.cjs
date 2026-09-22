// The one-tap resource pack end to end on a real local HTTP server: download
// into Cache Storage, byte verification, the recovery worker serving cached
// files for both hosts (same-origin and content-addressed COS), Range replies,
// version gating across a deployment, and font route fallback. The COS host is
// pinned to 127.0.0.1 so nothing leaves the machine; no account data is used.
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..');
const index=fs.readFileSync(path.join(repo,'maanshan/index.html'),'utf8');
const registration=index.match(/<script id="school-navigation-recovery">([\s\S]*?)<\/script>/)[1];
const worker=fs.readFileSync(path.join(repo,'maanshan/recovery-sw.js'),'utf8');
const host='mandarin.aiducation.asia',cosHost='aiducation-mandarin-media-1427410149.cos.ap-guangzhou.myqcloud.com',cos='https://'+cosHost;
const mime={'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.woff2':'font/woff2','.webp':'image/webp','.mp3':'audio/mpeg'};
const packed=[
  ['media/words/8c46-dou4-f101001-20260918a.mp3','audio/mpeg','g-9181908b9a88540cf3bd'],
  ['media/bo-chuan-gua-zhou/preview-1.webp','image/webp',null,[4]],
  ['vendor/fonts/noto-sans-tc-variants.woff2','font/woff2',null]
];
const overrides=new Map();
// Files listed here are sent in pieces with pauses, like a big file on a slow line.
const slow=new Map();
let version='a'.repeat(20);
const records=[];
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
function bytesOf(file){return overrides.get(file)||fs.readFileSync(path.join(repo,'maanshan',file));}
function manifest(){
  const assets=packed.map(([file,type,group,grades])=>{const data=bytesOf(file),digest=sha(data);
    return {path:file,remote:cos+'/published/'+(group||digest.slice(0,20))+'/maanshan/'+file,bytes:data.length,sha256:digest,type,...(grades?{grades}:{})};});
  return {schemaVersion:1,version,cache:'maanshan-pack-v1',totalBytes:assets.reduce((sum,asset)=>sum+asset.bytes,0),assets};
}
function fixture(){
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="school-pack" content="${version}"><body><div id="app">Pack fixture</div><script>${registration}</script><script type="module">import * as pack from '/school/resource-pack.mjs?v=test';window.pack=pack;</script>`;
}
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  records.push({path:url.pathname,range:req.headers.range||null});
  res.setHeader('Cache-Control','no-store');
  if(url.pathname==='/school/recovery-sw.js'){res.setHeader('Content-Type','text/javascript');res.setHeader('Service-Worker-Allowed','/');res.end(worker);return;}
  if(url.pathname==='/school/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture());return;}
  if(url.pathname==='/school/pack-manifest.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(manifest()));return;}
  if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end('{"ok":true}');return;}
  if(url.pathname.startsWith('/school/')){
    const relative=url.pathname.slice('/school/'.length),file=path.resolve(repo,'maanshan',relative);
    if(file.startsWith(path.join(repo,'maanshan')+path.sep)&&mime[path.extname(file)]&&fs.existsSync(file)){
      const data=bytesOf(relative);
      res.setHeader('Content-Type',mime[path.extname(file)]);res.setHeader('Content-Length',data.length);
      const pace=slow.get(relative);
      if(!pace){res.end(data);return;}
      let offset=0;const size=Math.ceil(data.length/pace.pieces);
      const piece=()=>{res.write(data.subarray(offset,offset+size));offset+=size;if(offset<data.length)setTimeout(piece,pace.delay);else res.end();};
      piece();return;
    }
  }
  res.writeHead(404).end();
});
const results=[];
const check=(label,ok)=>{assert(ok,label);results.push(label);};
const since=mark=>records.slice(mark);
const probe=(page,url,init)=>page.evaluate(async([url,init])=>{
  try{const r=await fetch(url,init);return {status:r.status,hit:r.headers.get('x-pack'),range:r.headers.get('content-range'),bytes:(await r.arrayBuffer()).byteLength};}
  catch(error){return {failed:true,name:error.name};}
},[url,init||{}]);

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://${host}:${server.address().port}`;
  const browser=await chromium.launch({channel:'msedge',headless:true,args:[
    '--no-proxy-server',`--host-resolver-rules=MAP ${host} 127.0.0.1, MAP ${cosHost} 127.0.0.1`,
    `--unsafely-treat-insecure-origin-as-secure=${origin}`
  ]});
  try{
    const context=await browser.newContext(),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const ready=async()=>{await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller&&window.pack));};
    await page.goto(origin+'/school/');await ready();
    const [mp3,webp,font]=manifest().assets;

    // Nothing is cached until the pupil asks; ordinary fetches reach the server.
    await page.evaluate(()=>window.pack.resumeResourcePack());
    await page.waitForFunction(()=>window.pack.packState().total===3);
    let state=await page.evaluate(()=>window.pack.packState());
    check('idle pack knows its size without downloading',state.status==='idle'&&state.done===0&&state.totalBytes===manifest().totalBytes);
    let mark=records.length;
    let reply=await probe(page,'/school/'+webp.path);
    check('uncached file comes from the network',reply.hit===null&&reply.bytes===webp.bytes&&since(mark).some(row=>row.path==='/school/'+webp.path));
    check('no pack cache before the tap',(await page.evaluate(()=>caches.keys())).length===0);

    // One tap: everything downloads and verifies in the background.
    await page.evaluate(()=>window.pack.requestResourcePack());
    await page.waitForFunction(()=>window.pack.packState().status==='complete',null,{timeout:30000});
    state=await page.evaluate(()=>window.pack.packState());
    check('pack completes with every byte accounted for',state.done===3&&state.bytesDone===state.totalBytes&&state.version===version);
    check('the wish persists for later visits',await page.evaluate(()=>localStorage.getItem('maanshan:pack'))==='all');
    const keys=await page.evaluate(async()=>(await (await caches.open('maanshan-pack-v1')).keys()).map(r=>new URL(r.url).pathname).sort());
    assert.deepEqual(keys,['/school/__pack-version','/school/media/bo-chuan-gua-zhou/preview-1.webp','/school/media/words/8c46-dou4-f101001-20260918a.mp3','/school/pack-manifest.json','/school/vendor/fonts/noto-sans-tc-variants.woff2']);
    results.push('cache holds exactly the packed files, the manifest and the version note');
    const stored=await page.evaluate(async path=>{const r=await (await caches.open('maanshan-pack-v1')).match(path);return {sha:r.headers.get('X-Pack-Sha256'),type:r.headers.get('Content-Type'),bytes:(await r.arrayBuffer()).byteLength};},'/school/'+mp3.path);
    check('stored entry carries the verified digest',stored.sha===mp3.sha256&&stored.type==='audio/mpeg'&&stored.bytes===mp3.bytes);

    // From now on both copies of each file are answered from the cache.
    mark=records.length;
    reply=await probe(page,'/school/'+webp.path);
    check('same-origin copy served from the pack',reply.hit==='hit'&&reply.status===200&&reply.bytes===webp.bytes);
    reply=await probe(page,webp.remote);
    check('content-addressed COS copy served from the pack',reply.hit==='hit'&&reply.bytes===webp.bytes);
    reply=await probe(page,mp3.remote);
    check('group-addressed COS recording served from the pack',reply.hit==='hit'&&reply.bytes===mp3.bytes);
    reply=await probe(page,font.remote);
    check('font served from the pack',reply.hit==='hit'&&reply.bytes===font.bytes);
    reply=await probe(page,'/school/'+mp3.path,{headers:{Range:'bytes=100-199'}});
    check('Range requests get partial content',reply.status===206&&reply.bytes===100&&reply.range==='bytes 100-199/'+mp3.bytes);
    reply=await probe(page,'/school/'+mp3.path,{headers:{Range:'bytes=-50'}});
    check('suffix Range served',reply.status===206&&reply.bytes===50);
    reply=await probe(page,'/school/'+mp3.path+'?v=cache-bust');
    check('query strings do not defeat the cache',reply.hit==='hit');
    check('no media request reached the server',!since(mark).some(row=>row.path.includes('/media/')||row.path.includes('/vendor/')));
    reply=await probe(page,'/school/media/words/missing-recording.mp3');
    check('unknown files still go to the network',reply.status===404&&since(mark).some(row=>row.path==='/school/media/words/missing-recording.mp3'));
    mark=records.length;await probe(page,'/api/school-auth/');
    check('API requests never touch the cache',since(mark).some(row=>row.path==='/api/school-auth/'));

    // A deployment with a new version: unchanged files serve again as soon as
    // the new manifest is stored; until then only exact-digest COS URLs do.
    version='b'.repeat(20);
    await page.reload();await ready();
    await page.waitForFunction(()=>caches.open('maanshan-pack-v1').then(c=>c.match('/school/__pack-version')).then(r=>r&&r.text()).then(v=>v==='b'.repeat(20)));
    reply=await probe(page,'/school/'+webp.path);
    check('stale manifest: same-origin copy goes to the network',reply.hit===null&&reply.bytes===webp.bytes);
    reply=await probe(page,webp.remote);
    check('stale manifest: exact-digest COS copy still served',reply.hit==='hit');
    await page.evaluate(()=>window.pack.resumeResourcePack());
    await page.waitForFunction(()=>window.pack.packState().status==='complete',null,{timeout:30000});
    mark=records.length;
    reply=await probe(page,'/school/'+webp.path);
    check('after the new manifest unchanged files serve from the pack',reply.hit==='hit'&&!since(mark).some(row=>row.path==='/school/'+webp.path));
    check('unchanged files were not downloaded again',records.filter(row=>row.path==='/school/'+webp.path).length===3);

    // A changed file is fetched afresh and the old bytes stop being served. It
    // arrives in pieces, and the count follows the bytes rather than whole files.
    overrides.set(mp3.path,Buffer.concat([bytesOf(mp3.path),Buffer.from([0])]));version='c'.repeat(20);slow.set(mp3.path,{pieces:6,delay:120});
    const changed=manifest().assets[0];
    await page.reload();await ready();
    await page.evaluate(()=>{window.progress=[];window.pack.onPackChange(s=>window.progress.push({status:s.status,done:s.done,bytesDone:s.bytesDone}));window.pack.resumeResourcePack();});
    await page.waitForFunction(()=>window.pack.packState().status==='complete',null,{timeout:30000});
    slow.delete(mp3.path);
    const progress=await page.evaluate(()=>window.progress),wholeFiles=new Set([0,webp.bytes,font.bytes,changed.bytes,webp.bytes+font.bytes,webp.bytes+changed.bytes,font.bytes+changed.bytes,webp.bytes+font.bytes+changed.bytes]);
    check('the count moves while a file is still arriving',progress.some(s=>s.status==='downloading'&&!wholeFiles.has(s.bytesDone)));
    check('the count never runs backwards',progress.every((s,i)=>i===0||s.bytesDone>=progress[i-1].bytesDone));
    check('the count ends on the whole pack',progress.at(-1).status==='complete'&&progress.at(-1).bytesDone===webp.bytes+font.bytes+changed.bytes);
    reply=await probe(page,'/school/'+mp3.path);
    check('changed recording re-downloaded and served',reply.hit==='hit'&&reply.bytes===changed.bytes);
    reply=await probe(page,mp3.remote);
    check('group-addressed COS recording follows the manifest',reply.hit==='hit'&&reply.bytes===changed.bytes);
    check('old digest of a changed file is no longer served',(await probe(page,cos+'/published/'+mp3.sha256.slice(0,20)+'/maanshan/'+mp3.path)).hit!=='hit');
    check('old entries pruned',(await page.evaluate(async()=>(await (await caches.open('maanshan-pack-v1')).keys()).length))===5);
    await page.evaluate(()=>window.pack.cancelResourcePack());
    check('cancelling forgets the wish',await page.evaluate(()=>localStorage.getItem('maanshan:pack'))===null);

    // A grade-one pupil on a fresh device: the pack holds the shared files only;
    // the grade-four picture is neither counted nor downloaded.
    const scoped=await browser.newContext(),pupil=await scoped.newPage();
    pupil.on('pageerror',error=>errors.push(error.message));
    await pupil.goto(origin+'/school/');await pupil.waitForFunction(()=>Boolean(navigator.serviceWorker.controller&&window.pack));
    await pupil.evaluate(()=>window.pack.resumeResourcePack({scope:{grades:[1]}}));
    await pupil.waitForFunction(()=>window.pack.packState().total===2);
    state=await pupil.evaluate(()=>window.pack.packState());
    check('own-grade scope counts the shared files only',state.status==='idle'&&state.scope==='g1'&&state.totalBytes===changed.bytes+font.bytes);
    mark=records.length;
    await pupil.evaluate(()=>window.pack.requestResourcePack());
    await pupil.waitForFunction(()=>window.pack.packState().status==='complete',null,{timeout:30000});
    state=await pupil.evaluate(()=>window.pack.packState());
    check('own-grade pack completes without the other grade\'s file',state.done===2&&!since(mark).some(row=>row.path==='/school/'+webp.path));
    check('the wish is kept per scope',await pupil.evaluate(()=>localStorage.getItem('maanshan:pack'))==='g1');
    reply=await probe(pupil,'/school/'+webp.path);
    check('the other grade\'s file still comes from the network',reply.hit===null&&reply.bytes===webp.bytes);
    reply=await probe(pupil,font.remote);
    check('shared file served from the own-grade pack',reply.hit==='hit'&&reply.bytes===font.bytes);
    // A grade-four pupil on the same device adds that grade's file; nothing already held is removed.
    await pupil.evaluate(()=>window.pack.resumeResourcePack({scope:{grades:[4]}}));
    await pupil.waitForFunction(()=>window.pack.packState().total===3&&window.pack.packState().status==='idle');
    await pupil.evaluate(()=>window.pack.requestResourcePack());
    await pupil.waitForFunction(()=>window.pack.packState().status==='complete',null,{timeout:30000});
    check('the second grade downloads only its own file',since(mark).filter(row=>row.path==='/school/'+webp.path).length===2&&since(mark).filter(row=>row.path==='/school/'+font.path).length===1);
    check('wishes of both grades are kept',await pupil.evaluate(()=>localStorage.getItem('maanshan:pack'))==='g1,g4');
    check('files of both grades stay in the cache',(await pupil.evaluate(async()=>(await (await caches.open('maanshan-pack-v1')).keys()).length))===5);
    await scoped.close();

    // Fonts: the failing host is skipped and the working route remembered.
    const fonts=await page.evaluate(async cos=>{
      const {fetchFont}=await import('/school/font-source.mjs?v=test');
      const font={family:'Noto Sans TC',path:'/maanshan/vendor/fonts/noto-sans-tc-variants.woff2',version:'test'};
      sessionStorage.removeItem('maanshan:media-route');
      const local='/school/vendor/fonts/noto-sans-tc-variants.woff2';
      const first=await fetchFont(font,{hedgeMs:200,candidates:[{route:'public',url:cos+'/published/deadbeefdeadbeefdead/maanshan/vendor/fonts/noto-sans-tc-variants.woff2'},{route:'local',url:local}]});
      const memory=sessionStorage.getItem('maanshan:media-route');
      const second=await fetchFont(font,{hedgeMs:200,candidates:[{route:'local',url:local},{route:'public',url:cos+'/published/deadbeefdeadbeefdead/maanshan/vendor/fonts/noto-sans-tc-variants.woff2'}]});
      let failed=null;try{await fetchFont(font,{hedgeMs:50,candidates:[{route:'public',url:cos+'/x.woff2'},{route:'public',url:cos+'/y.woff2'}]});}catch(error){failed=error.message||error.name;}
      return {first:{route:first.route,bytes:first.buffer.byteLength},memory,second:{route:second.route,bytes:second.buffer.byteLength},failed};
    },cos);
    check('font falls back to the deployed copy',fonts.first.route==='local'&&fonts.first.bytes===font.bytes);
    check('the working font route is remembered for the session',fonts.memory==='local');
    check('preferred font route wins when it works',fonts.second.route==='local'&&fonts.second.bytes===font.bytes);
    check('font with no working host rejects',typeof fonts.failed==='string');
    check('no uncaught page errors',errors.length===0);
    await context.close();
    console.log(JSON.stringify({ok:true,results},null,2));
  }finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
})().catch(error=>{console.error(error);process.exitCode=1;});
