// The one-tap resource pack end to end on a real local HTTP server: download
// into Cache Storage, byte verification, the recovery worker serving cached
// files for both hosts (same-origin and content-addressed COS), Range replies,
// version gating across a deployment, packs chosen by poem (a pupil's own poem,
// a teacher's one poem or every poem shown), pausing, the move from the old
// per-grade wishes, and font route fallback. The COS host is
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
// [path, type, group, poems, grades]: poem 4 is grade four's published poem,
// poem 9 a preview poem; files without poems are shared.
const packed=[
  ['media/words/8c46-dou4-f101001-20260918a.mp3','audio/mpeg','g-9181908b9a88540cf3bd'],
  ['media/bo-chuan-gua-zhou/preview-1.webp','image/webp',null,[4],[4]],
  ['vendor/fonts/noto-sans-hk-variants.woff2','font/woff2',null],
  ['media/yong-xue/avatar.webp','image/webp',null,[9]]
];
const TEACHER=[{id:1,grade:1},{id:4,grade:4},{id:9,grade:3,preview:true}];
const overrides=new Map();
// Files listed here are sent in pieces with pauses, like a big file on a slow line.
const slow=new Map();
let version='a'.repeat(20);
const records=[];
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
function bytesOf(file){return overrides.get(file)||fs.readFileSync(path.join(repo,'maanshan',file));}
function manifest(){
  const assets=packed.map(([file,type,group,poems,grades])=>{const data=bytesOf(file),digest=sha(data);
    return {path:file,remote:cos+'/published/'+(group||digest.slice(0,20))+'/maanshan/'+file,bytes:data.length,sha256:digest,type,...(poems?{poems}:{}),...(grades?{grades}:{})};});
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
      const piece=()=>{if(res.destroyed)return;res.write(data.subarray(offset,offset+size));offset+=size;if(offset<data.length)setTimeout(piece,pace.delay);else res.end();};
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
    const [mp3,webp,font,avatar]=manifest().assets;
    const view=(target,ids)=>target.evaluate(ids=>window.pack.packView(ids||undefined),ids||null);
    const settle=(target,ids,status)=>target.waitForFunction(([ids,status])=>window.pack.packView(ids||undefined).status===status,[ids||null,status],{timeout:30000});
    const keyCount=target=>target.evaluate(async()=>(await (await caches.open('maanshan-pack-v1')).keys()).length);

    // A teacher shows three poems. Nothing is cached until the tap; ordinary fetches reach the server.
    await page.evaluate(poems=>window.pack.resumeResourcePack({poems}),TEACHER);
    await page.waitForFunction(total=>window.pack.packView().totalBytes===total,manifest().totalBytes);
    let state=await view(page);
    check('idle pack knows its size without downloading',state.status==='idle'&&state.bytesDone===0);
    let mark=records.length;
    let reply=await probe(page,'/school/'+webp.path);
    check('uncached file comes from the network',reply.hit===null&&reply.bytes===webp.bytes&&since(mark).some(row=>row.path==='/school/'+webp.path));
    check('no pack cache before the tap',(await page.evaluate(()=>caches.keys())).length===0);
    check('one poem counts the shared files and its own',(await view(page,[4])).totalBytes===mp3.bytes+font.bytes+webp.bytes&&(await view(page,[9])).totalBytes===mp3.bytes+font.bytes+avatar.bytes);

    // One tap on the big button: every poem shown downloads and verifies in the background.
    await page.evaluate(()=>window.pack.togglePack([1,4,9]));
    await settle(page,null,'complete');
    state=await page.evaluate(()=>window.pack.packState());
    check('pack completes with every byte accounted for',state.bytesDone===state.totalBytes&&state.totalBytes===manifest().totalBytes&&state.version===version);
    check('the wish of each poem persists for later visits',await page.evaluate(()=>localStorage.getItem('maanshan:pack'))==='p1,p4,p9');
    const keys=await page.evaluate(async()=>(await (await caches.open('maanshan-pack-v1')).keys()).map(r=>new URL(r.url).pathname).sort());
    assert.deepEqual(keys,['/school/__pack-version','/school/media/bo-chuan-gua-zhou/preview-1.webp','/school/media/words/8c46-dou4-f101001-20260918a.mp3','/school/media/yong-xue/avatar.webp','/school/pack-manifest.json','/school/vendor/fonts/noto-sans-hk-variants.woff2']);
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
    await page.evaluate(poems=>window.pack.resumeResourcePack({poems}),TEACHER);
    await settle(page,null,'complete');
    mark=records.length;
    reply=await probe(page,'/school/'+webp.path);
    check('after the new manifest unchanged files serve from the pack',reply.hit==='hit'&&!since(mark).some(row=>row.path==='/school/'+webp.path));
    check('unchanged files were not downloaded again',records.filter(row=>row.path==='/school/'+webp.path).length===3);

    // A changed file is fetched afresh and the old bytes stop being served. It
    // arrives in pieces, and the count follows the bytes rather than whole files.
    overrides.set(mp3.path,Buffer.concat([bytesOf(mp3.path),Buffer.from([0])]));version='c'.repeat(20);slow.set(mp3.path,{pieces:6,delay:120});
    const changed=manifest().assets[0];
    await page.reload();await ready();
    await page.evaluate(poems=>{window.progress=[];window.pack.onPackChange(()=>{const s=window.pack.packView();window.progress.push({status:s.status,bytesDone:s.bytesDone});});window.pack.resumeResourcePack({poems});},TEACHER);
    await settle(page,null,'complete');
    slow.delete(mp3.path);
    const others=[webp.bytes,font.bytes,avatar.bytes,changed.bytes],wholeFiles=new Set();
    for(let set=0;set<16;set++)wholeFiles.add(others.reduce((sum,bytes,i)=>set&1<<i?sum+bytes:sum,0));
    const progress=await page.evaluate(()=>window.progress);
    check('the count moves while a file is still arriving',progress.some(s=>s.status==='downloading'&&!wholeFiles.has(s.bytesDone)));
    check('the count never runs backwards',progress.every((s,i)=>i===0||s.bytesDone>=progress[i-1].bytesDone));
    check('the count ends on the whole pack',progress.at(-1).status==='complete'&&progress.at(-1).bytesDone===webp.bytes+font.bytes+avatar.bytes+changed.bytes);
    reply=await probe(page,'/school/'+mp3.path);
    check('changed recording re-downloaded and served',reply.hit==='hit'&&reply.bytes===changed.bytes);
    reply=await probe(page,mp3.remote);
    check('group-addressed COS recording follows the manifest',reply.hit==='hit'&&reply.bytes===changed.bytes);
    check('old digest of a changed file is no longer served',(await probe(page,cos+'/published/'+mp3.sha256.slice(0,20)+'/maanshan/'+mp3.path)).hit!=='hit');
    check('old entries pruned',(await keyCount(page))===6);

    // A grade-one pupil on a fresh device whose old page wished 'g1': the wish
    // becomes that grade's poem and resumes; the pack holds the shared files only.
    const scoped=await browser.newContext(),pupil=await scoped.newPage();
    pupil.on('pageerror',error=>errors.push(error.message));
    await pupil.goto(origin+'/school/');await pupil.waitForFunction(()=>Boolean(navigator.serviceWorker.controller&&window.pack));
    mark=records.length;
    await pupil.evaluate(()=>{localStorage.setItem('maanshan:pack','g1,g4');return window.pack.resumeResourcePack({poems:[{id:1,grade:1}]});});
    await settle(pupil,null,'complete');
    state=await view(pupil);
    check('own poem pack counts the shared files only',state.totalBytes===changed.bytes+font.bytes&&state.bytesDone===state.totalBytes);
    check('the old grade wish resumes as the own poem',!since(mark).some(row=>row.path==='/school/'+webp.path||row.path==='/school/'+avatar.path));
    check('the other grade\'s old wish is kept for its pupil',await pupil.evaluate(()=>localStorage.getItem('maanshan:pack'))==='g4,p1');
    reply=await probe(pupil,'/school/'+webp.path);
    check('another poem\'s file still comes from the network',reply.hit===null&&reply.bytes===webp.bytes);
    reply=await probe(pupil,font.remote);
    check('shared file served from the own poem pack',reply.hit==='hit'&&reply.bytes===font.bytes);

    // A teacher on the same device: each poem's round button follows that poem only.
    mark=records.length;
    await pupil.evaluate(poems=>window.pack.resumeResourcePack({poems}),TEACHER);
    await settle(pupil,[1],'complete');
    check('the grade-four wish becomes poem 4 and resumes',await pupil.evaluate(()=>localStorage.getItem('maanshan:pack'))==='p1,p4');
    await settle(pupil,[4],'complete');
    check('a poem not yet wished stays idle, and so does the big button',(await view(pupil,[9])).status==='idle'&&(await view(pupil)).status==='idle');
    slow.set(avatar.path,{pieces:40,delay:150});
    await pupil.evaluate(()=>window.pack.togglePack([9]));
    await settle(pupil,[9],'downloading');
    check('the big button follows the one poem downloading',(await view(pupil)).status==='downloading');
    await pupil.evaluate(()=>window.pack.togglePack([9]));
    await settle(pupil,[9],'paused');
    check('pausing forgets only that poem\'s wish',await pupil.evaluate(()=>localStorage.getItem('maanshan:pack'))==='p1,p4');
    check('the other poems stay complete while one is paused',(await view(pupil,[1])).status==='complete'&&(await view(pupil,[4])).status==='complete');
    slow.delete(avatar.path);
    await pupil.evaluate(()=>window.pack.togglePack([9]));
    await settle(pupil,[9],'complete');
    check('a paused poem resumes and completes',(await view(pupil)).status==='complete'&&await pupil.evaluate(()=>localStorage.getItem('maanshan:pack'))==='p1,p4,p9');
    check('each file was downloaded once per poem pack',since(mark).filter(row=>row.path==='/school/'+webp.path).length===1&&!since(mark).some(row=>row.path==='/school/'+font.path));
    check('files of every poem stay in the cache',(await keyCount(pupil))===6);
    await scoped.close();

    // Fonts: the failing host is skipped and the working route remembered.
    const fonts=await page.evaluate(async cos=>{
      const {fetchFont}=await import('/school/font-source.mjs?v=test');
      const font={family:'Noto Sans HK',path:'/maanshan/vendor/fonts/noto-sans-hk-variants.woff2',version:'test'};
      sessionStorage.removeItem('maanshan:media-route');
      const local='/school/vendor/fonts/noto-sans-hk-variants.woff2';
      const first=await fetchFont(font,{hedgeMs:200,candidates:[{route:'public',url:cos+'/published/deadbeefdeadbeefdead/maanshan/vendor/fonts/noto-sans-hk-variants.woff2'},{route:'local',url:local}]});
      const memory=sessionStorage.getItem('maanshan:media-route');
      const second=await fetchFont(font,{hedgeMs:200,candidates:[{route:'local',url:local},{route:'public',url:cos+'/published/deadbeefdeadbeefdead/maanshan/vendor/fonts/noto-sans-hk-variants.woff2'}]});
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
