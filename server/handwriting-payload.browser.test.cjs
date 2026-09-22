'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {gunzipSync}=require('node:zlib');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),requests=[];
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/handwriting/'){
    let body='';for await(const chunk of req)body+=chunk;
    const data=JSON.parse(body);requests.push(data);
    res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({candidates:['\u4e00']}));
  }
  if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><title>Handwriting transport</title>');}
  const file=path.resolve(repo,'.'+url.pathname);
  if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{for(const engine of ['chromium','webkit']){
    const browser=engine==='chromium'?await chromium.launch({channel:'msedge',headless:true}):await webkit.launch({headless:true});
    try{
      const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
      const before=requests.length;
      const result=await page.evaluate(async()=>{
        const {requestJSON}=await import('/maanshan/network.mjs');
        const ink=Array.from({length:12},(_,s)=>[
          Array.from({length:200},(_,p)=>Math.round(100+p*1.4)),Array.from({length:200},()=>50+s*35),Array.from({length:200},(_,p)=>s*1500+p*5)
        ]);
        const payload={ink,poemId:6,researchContext:{mode:'review',itemId:'synthetic'}},started=performance.now();
        const packed=await requestJSON('/api/handwriting',payload);const elapsedMs=Math.round(performance.now()-started);
        window.CompressionStream=undefined;
        const legacy=await requestJSON('/api/handwriting',payload);
        return{payload,packed,legacy,elapsedMs};
      });
      assert.equal(requests.length-before,2,'each check sends one request');
      const [packed,legacy]=requests.slice(before);
      assert.equal(packed.ink,undefined);assert.equal(typeof packed.inkGzip,'string');
      assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(packed.inkGzip,'base64')).toString('utf8')),result.payload.ink);
      assert.deepEqual(packed.researchContext,result.payload.researchContext);
      assert.deepEqual(legacy,result.payload);
      assert.deepEqual(result.packed.candidates,result.legacy.candidates);
      console.log(JSON.stringify({engine,ok:true,originalBytes:JSON.stringify(result.payload).length,packedBytes:JSON.stringify(packed).length,localRequestMs:result.elapsedMs}));
    }finally{await browser.close();}
  }}finally{server.closeAllConnections();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
