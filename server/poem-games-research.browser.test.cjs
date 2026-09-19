// Run with PLAYWRIGHT_MODULE pointing to a locally installed Playwright package.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {validateEvent,aggregateEvents}=require('../api/_lib/research-store.cjs');
const repo=path.resolve(__dirname,'..');
const mime={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.glb':'model/gltf-binary'};
const fixture='<!doctype html><meta charset="utf-8"><style>[hidden]{display:none!important}#holder{width:560px}img{max-width:100%}.pvg-stage,.fs-stage,.rc-field{width:480px;height:300px;position:relative}.rc-scene{max-height:140px}.rc-boat img{width:90px}</style><div id="holder"></div>';
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return;}
  const file=path.resolve(repo,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(repo+path.sep)||!url.pathname.startsWith('/maanshan/')||!mime[path.extname(file)]){res.writeHead(404).end();return;}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)]);res.end(data);});
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage(),errors=[],results=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
    await page.route('**/mountain-viewer.mjs*',route=>route.fulfill({contentType:'text/javascript',body:'export async function createMountainViewer(){return {setAngle(){},capture(){return "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"},destroy(){}}}'}));
    async function mount(file,method,options={}){
      await page.evaluate(async({file,method,options})=>{
        window.game?.destroy();window.observed=[];window.completed=0;
        window.click=selector=>document.querySelector(selector).click();
        const mod=await import(`/maanshan/poem-games/${file}.mjs`);
        window.game=mod[method](document.querySelector('#holder'),{...options,reducedMotion:true,playAudio:async()=>true,onComplete:()=>window.completed++,onResearch:(type,fields)=>window.observed.push({type,...fields})});
      },{file,method,options});
    }
    async function verify(name,expectedCorrect,{completed=true}={}){
      const state=await page.evaluate(()=>({events:window.observed,completed:window.completed}));
      let seq=0;const sessionId=randomUUID();
      const rows=state.events.map(fields=>{
        const event={eventId:randomUUID(),sessionId,seq:++seq,clientAt:new Date().toISOString(),activeMs:seq*10,poemId:1,appVersion:'browser-test',contentVersion:'v1',...fields,context:{mode:'standard',...fields.context}};
        validateEvent(event);
        assert.equal(event.context.itemType,'microgame');
        assert.ok(event.result?.score==null);
        assert.ok(!JSON.stringify(event).includes('data:image'));
        return {researchId:'test-pupil',grade:1,cls:'A',source:'client',qualityFlags:[],serverReceivedAt:event.clientAt,event};
      });
      assert.equal(state.events.filter(e=>e.type==='answer_submitted'&&e.result.correct).length,expectedCorrect,name);
      if(completed){assert.equal(state.completed,1,name);assert.equal(state.events.filter(e=>e.response?.choiceId==='completed').length,1,name);}
      const summary=aggregateEvents(rows,{from:'2020-01-01',to:'2030-01-01'}).summary;
      assert.equal(summary.clientReported.measuredN,0,name);
      assert.equal(summary.clientReported.correctN,0,name);
      results.push({name,eventCount:state.events.length,correctSteps:expectedCorrect});
      return state.events;
    }
    await mount('goose','mountGoose');await page.waitForSelector('[data-goose-color="red"]:not([disabled])');
    await page.evaluate(()=>{click('[data-goose-color="red"]');click('[data-goose-part="feather"]');click('[data-goose-color="white"]');click('[data-goose-part="feather"]');click('[data-goose-color="red"]');click('[data-goose-part="palm"]');click('[data-goose-color="green"]');click('[data-goose-part="water"]');});
    let events=await verify('goose',3);assert.equal(events.filter(e=>e.type==='retry').length,1);
    await mount('garden','mountGarden');await page.waitForSelector('[data-plant="bean-a"]:not([disabled])');
    await page.evaluate(()=>{click('[data-plant="bean-a"]');click('[data-plant="bean-a"]');for(const b of document.querySelectorAll('[data-plant^="weed-"]'))b.click();});
    await verify('garden',8);
    await mount('zeng','mountFarewell');await page.waitForSelector('[data-fs-dock]:not([disabled])');
    await page.evaluate(()=>{click('[data-fs-dock]');click('[data-fs-next]');click('[data-fs-foot="1"]');for(const n of [0,1,0,1])click(`[data-fs-foot="${n}"]`);click('[data-fs-next]');click('[data-fs-ticket="2"]');for(const n of [0,1,2])click(`[data-fs-ticket="${n}"]`);});
    await verify('farewell',8);
    await mount('river','mountRiver');await page.waitForSelector('[data-river-slot="0"]:not([disabled])');
    await page.evaluate(()=>{click('[data-river-tray] [data-piece="0"]');click('[data-river-slot="1"]');click('[data-river-slot="1"]');click('[data-river-slot="0"]');for(let n=1;n<6;n++){click(`[data-river-tray] [data-piece="${n}"]`);click(`[data-river-slot="${n}"]`);}});
    await verify('river',6);
    await mount('rain','mountRain');await page.waitForSelector('[data-rc-start]:not([disabled])');
    await page.evaluate(()=>{
      const targets=['小','酥','色','是','勝'];
      function catchWord(wrong=false){const root=document.querySelector('.rain-catcher'),n=+root.dataset.round;
        let index=[...root.querySelectorAll('[data-rc-drop]')].findIndex(el=>el.dataset.char===targets[n]);if(wrong)index=(index+1)%3;
        let lane=+root.dataset.lane;while(lane!==index){click(lane<index?'[data-rc-right]':'[data-rc-left]');lane=+root.dataset.lane;}click('[data-rc-main]');}
      click('[data-rc-start]');catchWord(true);click('[data-rc-main]');
      for(let n=0;n<5;n++){catchWord();if(n<4)click('[data-rc-main]');}
    });
    await verify('rain-five-words',5);
    await page.evaluate(()=>{click('[data-rc-replay]');click('[data-rc-start]');});
    assert.equal((await page.evaluate(()=>window.observed.at(-1))).context.mode,'free');
    await mount('views','mountMountain');await page.waitForSelector('[data-vg-capture]:not([disabled])');
    await page.evaluate(()=>{const slider=document.querySelector('[data-vg-angle]');slider.value=50;slider.dispatchEvent(new Event('input'));window.beforeMove=observed.length;for(let n=50;n<70;n++){slider.value=n;slider.dispatchEvent(new Event('input'));}window.afterMove=observed.length;slider.dispatchEvent(new Event('change'));click('[data-vg-capture]');slider.value=0;slider.dispatchEvent(new Event('input'));slider.dispatchEvent(new Event('change'));click('[data-vg-capture]');slider.value=100;slider.dispatchEvent(new Event('input'));slider.dispatchEvent(new Event('change'));click('[data-vg-capture]');});
    assert.deepEqual(await page.evaluate(()=>[beforeMove,afterMove]),[1,1]);
    events=await verify('mountain',2);assert.equal(events.filter(e=>e.interaction==='camera_rotate').length,3);
    await page.evaluate(async()=>{game.destroy();observed=[];completed=0;const {mountExploration}=await import('/maanshan/exploration.mjs');window.game=mountExploration(document.querySelector('#holder'),{poem:{id:4,grade:4,slug:'bo-chuan-gua-zhou'},speakWord:async()=>true,onComplete:()=>completed++,onResearch:(type,fields)=>observed.push({type,...fields})});click('[data-explore="answer"][data-answer="0"]');click('[data-explore="answer"][data-answer="1"]');click('[data-explore="next"]');click('[data-explore="answer"][data-answer="1"]');click('[data-explore="answer"][data-answer="0"]');click('[data-explore="next"]');});
    events=await verify('exploration',2);assert.ok(events.every(e=>e.context.mode==='free'));
    const count=await page.evaluate(()=>{const n=observed.length;game.destroy();game.showSolution?.();return n;});
    assert.equal(await page.evaluate(()=>observed.length),count);
    await mount('rain','mountRain',{initialState:{version:6,caught:[1,1,1,1,1],completed:true,gameCompleted:true},readOnly:true});
    await page.waitForSelector('[data-rc-replay]:not([disabled])');
    assert.equal(await page.evaluate(()=>observed.filter(e=>e.type==='answer_submitted'||e.response?.choiceId==='completed').length),0);
    await page.evaluate(()=>{game.destroy();document.querySelector('#holder').innerHTML='<div id="viewer-stage" style="width:480px;height:320px"><div id="viewer-holder"></div></div>';});
    await page.evaluate(async()=>{
      const {THREE,OrbitControls}=await import('/maanshan/vendor/poetry-three.mjs');
      const {createViewer}=await import('/maanshan/exploration.mjs');
      class Controls extends OrbitControls{constructor(...args){super(...args);window.testControls=this;}}
      const scene=new THREE.Group();scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial()));
      window.cameraEvents=[];window.game=createViewer({THREE,OrbitControls:Controls,gltf:{scene},holder:document.querySelector('#viewer-holder'),stage:document.querySelector('#viewer-stage'),content:{object:'test'},onInteractionEnd:kind=>cameraEvents.push(kind)});
      testControls.dispatchEvent({type:'start'});for(let n=0;n<40;n++){testControls.object.position.applyAxisAngle(new THREE.Vector3(0,1,0),.01);testControls.dispatchEvent({type:'change'});}window.beforeEnd=cameraEvents.length;testControls.dispatchEvent({type:'end'});
      testControls.dispatchEvent({type:'start'});testControls.object.position.multiplyScalar(.8);testControls.dispatchEvent({type:'end'});
    });
    assert.equal(await page.evaluate(()=>beforeEnd),0);
    assert.deepEqual(await page.evaluate(()=>cameraEvents),['camera_rotate','camera_zoom']);
    await page.evaluate(()=>game.destroy());
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,results,cameraGestureCallbacks:'only on end',pageErrors:errors},null,2));
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
