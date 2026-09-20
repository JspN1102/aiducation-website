// Local browser/device compatibility checks; no student accounts or API writes.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const evidence = process.env.CAMERA_EVIDENCE_DIR;
const mime = {'.mjs':'text/javascript','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.svg':'image/svg+xml','.glb':'model/gltf-binary','.woff2':'font/woff2'};
const fixture = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/maanshan/app.bundle.css"><style>body{overflow:auto}#holder{max-width:1148px;margin:16px auto}.explore-stage{height:400px!important;min-height:200px!important}.explore-canvas canvas{width:100%;height:100%}</style><main class="workspace view-explore"><div id="view"><div id="holder"></div></div></main>';
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/fixture') {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return;}
  const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep) || !mime[path.extname(file)]) {res.writeHead(404).end();return;}
  fs.readFile(file, (error, bytes) => {if (error) {res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)]);res.end(bytes);});
});
let browser;
(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  browser = await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const results = [], errors = [];
  const context = await browser.newContext({viewport:{width:1180,height:820},deviceScaleFactor:2,hasTouch:true});
  const page = await context.newPage();page.on('pageerror',error => errors.push(error.message));
  await page.addInitScript(() => {window.xrRequests=0;Object.defineProperty(navigator,'xr',{configurable:true,value:{isSessionSupported:async()=>true,requestSession(){window.xrRequests++;throw new Error('Native AR installer must never be opened');}}});});
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
  await page.evaluate(()=>{window.cameraTrace=[];const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async options=>{cameraTrace.push('request');try{const value=await gum(options);cameraTrace.push('granted');return value;}catch(error){cameraTrace.push(error.name);throw error;}};const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){cameraTrace.push('play');return play.call(this).then(value=>{cameraTrace.push('playing');return value;},error=>{cameraTrace.push('play:'+error.name);throw error;});};});
  async function mount(slug='bo-chuan-gua-zhou') {
    await page.evaluate(async slug => {
      window.activity?.destroy();
      const {mountExploration} = await import('/maanshan/exploration.mjs');
      window.activity = mountExploration(document.querySelector('#holder'),{poem:{id:4,grade:4,slug}});
    },slug);
  }
  const button = page.locator('[data-explore=ar]');
  for (const slug of ['bo-chuan-gua-zhou','gui-yuan-tian-ju','zao-chun']) {
    await mount(slug);await button.click();
    await page.locator('.explore.is-camera').waitFor({timeout:25000}).catch(async error=>{console.error(JSON.stringify(await page.evaluate(()=>({cameraTrace,notice:document.querySelector('.explore-notice')?.textContent,classes:document.querySelector('.explore')?.className,video:document.querySelector('video')?.readyState,canvas:!!document.querySelector('canvas')}))));console.error(errors);throw error;});
    await page.waitForFunction(()=>document.querySelector('video').currentTime>0,{},{timeout:5000}).catch(async error=>{console.error(JSON.stringify(await page.evaluate(()=>{const v=document.querySelector('video');return{trace:cameraTrace,hidden:document.hidden,currentTime:v.currentTime,paused:v.paused,ready:v.readyState,width:v.videoWidth,height:v.videoHeight,display:getComputedStyle(v).display,visibility:getComputedStyle(v).visibility,settings:v.srcObject?.getVideoTracks().map(t=>({settings:t.getSettings(),ready:t.readyState,muted:t.muted}))};})));throw error;});
    const state = await page.evaluate(()=>{
      const video=document.querySelector('video'),canvas=document.querySelector('.explore-canvas canvas'),box=canvas.getBoundingClientRect();
      window.testTracks=video.srcObject.getTracks();
      return {xrRequests,videoWidth:video.videoWidth,tracks:video.srcObject.getAudioTracks().length,canvasWidth:canvas.width,cssWidth:box.width,ratio:canvas.width/box.width,label:document.querySelector('.explore-scene-name').textContent,button:document.querySelector('[data-explore=ar]').textContent};
    });
    assert.equal(state.xrRequests,0);assert.equal(state.tracks,0);assert(state.videoWidth>0);assert(state.ratio>1.8);assert.match(state.label,/模型跟隨畫面/);assert.match(state.button,/關閉相機/);
    if (evidence && slug==='bo-chuan-gua-zhou') {fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'camera-tablet.png')});}
    await button.click();assert.equal(await page.locator('.is-camera').count(),0);
    assert(await page.evaluate(()=>testTracks.every(track=>track.readyState==='ended')));
    assert(await page.locator('.explore-canvas canvas').isVisible());results.push({name:slug+' camera opens inline, sharp model, clean close',...state});
  }
  await mount();await page.evaluate(()=>{window.realGetUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError');};});
  await button.click();await page.waitForFunction(()=>!document.querySelector('[data-explore=ar]').disabled);
  assert.match(await page.locator('.explore-notice').innerText(),/先用 3D 觀察/);assert(await page.locator('.explore-canvas canvas').isVisible());assert.equal(await page.evaluate(()=>xrRequests),0);
  results.push({name:'denied camera preserves 3D, no native request'});
  await page.evaluate(()=>navigator.mediaDevices.getUserMedia=realGetUserMedia);await button.click();await page.locator('.is-camera').waitFor();
  await page.evaluate(()=>{window.testTracks=document.querySelector('video').srcObject.getTracks();Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  assert(await page.evaluate(()=>testTracks.every(track=>track.readyState==='ended')));assert.equal(await page.locator('.is-camera').count(),0);
  await page.evaluate(()=>delete document.hidden);results.push({name:'background tab releases camera'});
  await button.click();await page.locator('.is-camera').waitFor();await page.evaluate(()=>{window.testTracks=document.querySelector('video').srcObject.getTracks();activity.destroy();});
  assert(await page.evaluate(()=>testTracks.every(track=>track.readyState==='ended')));results.push({name:'leaving activity releases camera'});
  await mount();await page.evaluate(()=>{window.originalMediaDevices=navigator.mediaDevices;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:undefined});});
  await button.click();await page.waitForFunction(()=>!document.querySelector('[data-explore=ar]').disabled);
  assert(await page.locator('.explore-canvas canvas').isVisible());assert.equal(await page.locator('.is-camera').count(),0);results.push({name:'browser without camera API remains usable'});
  assert.deepEqual(errors,[]);
  const result={passed:true,results,errors};if(evidence)fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
