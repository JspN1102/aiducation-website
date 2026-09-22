import {createProcessResearch} from './research.mjs?v=20260920a';
const art=name=>new URL(`../media/poem-games/${name}`,import.meta.url).href;
const speaker='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m11 5-6 4H2v6h3l6 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
const camera='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/></svg>';
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));

function foundation(holder,options,html){
 const controller=new AbortController();let dead=false,speaking=false,audioGeneration=0,ready=false,failed=false,assetTimer=null,readyCallback=()=>{};
 holder.innerHTML=html;const root=holder.firstElementChild,q=s=>root.querySelector(s);
 const say=text=>{if(!dead)q('[data-vg-status]').textContent=text;};
 const listen=async(text,button)=>{
  if(dead||speaking)return;speaking=true;const generation=++audioGeneration;
  button.setAttribute('aria-busy','true');button.disabled=true;
  let ok=false;try{ok=await options.playAudio?.({text});}catch{}
  if(dead||generation!==audioGeneration)return;
  speaking=false;button.disabled=false;button.removeAttribute('aria-busy');
  if(ok===false)say('聲音暫時未能播放，可以再聽，或先看畫面玩。');
 };
 const images=[...root.querySelectorAll('img')];
 function assetFailure(){if(dead)return;ready=false;failed=true;clearTimeout(assetTimer);root.dataset.assets='error';q('[data-vg-stage]').setAttribute('aria-busy','false');q('[data-vg-retry]').hidden=false;say('畫面未能載入，請按「重新載入畫面」。');readyCallback();}
 function checkAssets(){if(dead)return;if(images.every(img=>img.complete&&img.naturalWidth)){ready=true;failed=false;clearTimeout(assetTimer);root.dataset.assets='ready';q('[data-vg-stage]').setAttribute('aria-busy','false');q('[data-vg-retry]').hidden=true;if(q('[data-vg-status]').textContent==='小畫卷正在展開…')say('畫卷打開了，動手試一試吧。');readyCallback();}}
 function waitForAssets(){ready=false;failed=false;root.dataset.assets='loading';q('[data-vg-stage]').setAttribute('aria-busy','true');clearTimeout(assetTimer);assetTimer=setTimeout(assetFailure,12000);queueMicrotask(checkAssets);}
 root.addEventListener('load',e=>{if(e.target instanceof HTMLImageElement)checkAssets();},{capture:true,signal:controller.signal});
 root.addEventListener('error',e=>{if(e.target instanceof HTMLImageElement)assetFailure();},{capture:true,signal:controller.signal});
 q('[data-vg-retry]').addEventListener('click',()=>{q('[data-vg-retry]').hidden=true;waitForAssets();images.forEach(img=>{const src=img.src;img.removeAttribute('src');img.src=src;});readyCallback();say('小畫卷正在展開…');},{signal:controller.signal});
 waitForAssets();
 return {root,q,say,listen,signal:controller.signal,get dead(){return dead;},get ready(){return ready;},get failed(){return failed;},onReady(fn){readyCallback=fn;},destroy(){dead=true;audioGeneration++;clearTimeout(assetTimer);controller.abort();holder.replaceChildren();}};
}

export function mountMountain(holder,options={}){
 const initial=options.initialState||{};
 let photos=Array.isArray(initial.photos)?[...new Set(initial.photos.filter(n=>n==='ridge'||n==='peak'))]:[];
 let angle=clamp(initial.angle??0),done=initial.completed===true&&photos.length===2,readonly=!!options.readOnly,notified=done,solved=false;
 let model=null,modelReady=false,loadGeneration=0,pending=null,dead=false;
 const research=createProcessResearch(options.onResearch,{prefix:'game.mountain',alive:()=>!dead});
 const currentStep=()=>!photos.includes('ridge')?'ridge':'peak';
 const angleLabel=()=>angle<=18?'ridge':angle>=82?'peak':'middle';
 const photoAngles={ridge:clamp(initial.photoAngles?.ridge??0),peak:clamp(initial.photoAngles?.peak??100)};
 const f=foundation(holder,options,`<section class="poem-view-game mountain-game" data-model="loading"><header class="pvg-heading"><span class="pvg-kicker">山中小攝影師</span><h3 data-vg-title></h3></header><div class="pvg-stage mountain-stage" data-vg-stage><div class="mountain-model" data-mountain-model></div><div class="pvg-viewfinder" aria-hidden="true"><i></i><i></i><i></i><i></i></div><span class="pvg-location" data-vg-location></span><div class="pvg-shutter" aria-hidden="true"></div><p class="mountain-loading" data-mountain-loading role="status">正在走進山中…</p></div><div class="pvg-photo-tray" aria-label="收集的山景"><figure data-vg-photo="ridge"><span class="pvg-photo-image" data-photo-image="ridge">${camera}</span><figcaption>橫看成嶺</figcaption></figure><figure data-vg-photo="peak"><span class="pvg-photo-image" data-photo-image="peak">${camera}</span><figcaption>側看成峯</figcaption></figure></div><div class="pvg-camera-control"><span>正面看</span><input type="range" min="0" max="100" value="${angle}" aria-label="移動觀察角度，左邊從正面看，右邊從側面看" data-vg-angle><span>側面看</span></div><div class="pvg-actions"><button type="button" class="pvg-audio" data-vg-listen>${speaker}<span>聽詩句</span></button><button type="button" class="pvg-main" data-vg-capture>${camera}<span>拍下來</span></button></div><p class="pvg-status" data-vg-status role="status"></p><button type="button" class="pvg-retry" data-vg-retry hidden>重新載入山景</button></section>`);
 const snapshot=()=>({angle,photos:[...photos],photoAngles:{...photoAngles},completed:done});
 function photo(target){if(!modelReady)return;const img=document.createElement('img');img.alt=target==='ridge'?'剛拍下的正面山嶺':'剛拍下的側面山峰';img.src=model.capture(photoAngles[target]);f.q(`[data-photo-image="${target}"]`).replaceChildren(img);}
 const update=()=>{
  model?.setAngle(angle);
  f.q('[data-vg-angle]').value=angle;
  f.q('[data-vg-location]').textContent=angle<25?'正面看 · 連綿的山嶺':angle>75?'側看 · 高高的山峰':'移動中 · 同一座山';
  f.q('[data-vg-title]').textContent=done||solved?'同一座山，兩種模樣':!photos.includes('ridge')?'移一移，拍下長長的山嶺':'換個方向，拍下高高的山峰';
  f.root.querySelectorAll('[data-vg-photo]').forEach(el=>el.classList.toggle('is-collected',photos.includes(el.dataset.vgPhoto)||solved));
  f.q('[data-vg-capture]').disabled=readonly||done||solved||!modelReady;
  f.q('[data-vg-angle]').disabled=readonly||!modelReady;
  if(modelReady&&!readonly&&!done&&!solved)research.present(currentStep(),{position:photos.length,total:2});
 };
 async function load(){
  if(loadGeneration)research.retry('model');
  pending?.abort();model?.destroy();model=null;modelReady=false;const version=++loadGeneration,request=new AbortController();pending=request;
  f.root.dataset.model='loading';f.q('[data-mountain-loading]').hidden=false;f.q('[data-mountain-loading]').textContent='正在走進山中…';f.q('[data-vg-stage]').setAttribute('aria-busy','true');f.q('[data-vg-retry]').hidden=true;update();
  const timeout=setTimeout(()=>request.abort(),30000);let stopWaiting;
  const aborted=new Promise((_,reject)=>{stopWaiting=()=>reject(new DOMException('Aborted','AbortError'));request.signal.addEventListener('abort',stopWaiting,{once:true});});
  try{
   const loading=(async()=>{
    const {createMountainViewer}=await import('./mountain-viewer.mjs?v=20260922-school22');
    if(dead||version!==loadGeneration||request.signal.aborted)throw new DOMException('Aborted','AbortError');
    const viewer=await createMountainViewer(f.q('[data-mountain-model]'),{signal:request.signal,angle,onContextLost:()=>{if(dead)return;research.error('model','unsupported');model?.destroy();model=null;modelReady=false;f.root.dataset.model='error';f.q('[data-mountain-loading]').hidden=false;f.q('[data-mountain-loading]').textContent='山景暫時停住了，重新打開就能繼續。';f.q('[data-vg-retry]').hidden=false;update();}});
    if(dead||version!==loadGeneration||request.signal.aborted){viewer.destroy();throw new DOMException('Aborted','AbortError');}
    return viewer;
   })();
   const viewer=await Promise.race([loading,aborted]);
   if(dead||version!==loadGeneration||request.signal.aborted){viewer.destroy();return;}
   model=viewer;modelReady=true;f.root.dataset.model='ready';f.q('[data-mountain-loading]').hidden=true;f.q('[data-vg-stage]').setAttribute('aria-busy','false');photos.forEach(photo);if(solved)['ridge','peak'].forEach(photo);update();
  }catch(error){
   request.abort();
   if(dead||version!==loadGeneration)return;
   research.error('model',error?.name==='AbortError'?'timeout':'network');
   f.root.dataset.model='error';f.q('[data-mountain-loading]').textContent='山景暫時未能打開，請再試一次。';f.q('[data-vg-stage]').setAttribute('aria-busy','false');f.q('[data-vg-retry]').hidden=false;update();
  }finally{clearTimeout(timeout);request.signal.removeEventListener('abort',stopWaiting);if(pending===request)pending=null;}
 }
 const capture=()=>{
  if(readonly||done||solved||!modelReady)return;
  const target=!photos.includes('ridge')?'ridge':'peak',valid=target==='ridge'?angle<=18:angle>=82;
  research.answer(target,angleLabel(),valid);
  if(!valid){research.hint(target);f.say(target==='ridge'?'把小圓點往左移，看看山嶺連起來的樣子。':'把小圓點往右移，從另一邊看一看。');return;}
  photoAngles[target]=angle;photo(target);photos.push(target);done=photos.length===2;
  f.root.classList.remove('is-snapping');void f.root.offsetWidth;f.root.classList.add('is-snapping');
  update();options.onState?.(snapshot());
  f.say(done?'山沒有變，站的位置不同，看見的樣子就不同。':'第一張收好了！向右移，找找側面的山峰。');
  if(done&&!notified){notified=true;research.complete();options.onComplete?.({correct:true,response:snapshot(),knowledge:'橫看成嶺側成峯：觀察位置不同，看到的山形也不同。'});}
 };
 f.q('[data-vg-angle]').addEventListener('input',e=>{angle=clamp(e.target.value);update();options.onState?.(snapshot());},{signal:f.signal});
 f.q('[data-vg-angle]').addEventListener('change',()=>{if(!readonly&&modelReady)research.action(currentStep(),angleLabel(),'camera_rotate');},{signal:f.signal});
 let drag=null;
 const stage=f.q('[data-vg-stage]');
 stage.addEventListener('pointerdown',e=>{if(readonly||!modelReady||e.button>0)return;drag={id:e.pointerId,x:e.clientX,angle};stage.setPointerCapture(e.pointerId);},{signal:f.signal});
 stage.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;angle=clamp(drag.angle+(e.clientX-drag.x)/Math.max(1,stage.clientWidth)*125);update();},{signal:f.signal});
 const finishDrag=event=>{if(!drag)return;const changed=angle!==drag.angle;drag=null;if(changed&&event.type==='pointerup')research.action(currentStep(),angleLabel(),'camera_rotate');options.onState?.(snapshot());};
 stage.addEventListener('pointerup',finishDrag,{signal:f.signal});stage.addEventListener('pointercancel',finishDrag,{signal:f.signal});
 f.q('[data-vg-retry]').addEventListener('click',load,{signal:f.signal});
 f.q('[data-vg-capture]').addEventListener('click',capture,{signal:f.signal});
 f.q('[data-vg-listen]').addEventListener('click',e=>{research.hint(currentStep(),'audio');return f.listen('橫看成嶺側成峯',e.currentTarget);},{signal:f.signal});
 f.onReady(update);update();f.say(done?'兩張山景都收好了。':readonly?'這次先看看，下一次可以再拍。':'左右拖動山景或小圓點，換個角度拍一拍。');load();
 return {destroy(){dead=true;loadGeneration++;pending?.abort();model?.destroy();model=null;f.destroy();},showSolution(){if(dead||solved)return;research.hint('game','reveal');solved=true;angle=0;update();if(modelReady)['ridge','peak'].forEach(photo);f.say('「橫看」就是從正面看：山脈連成嶺。從側面看是高高的峰。山沒有變，變的是看山的位置。');}};
}

export function mountRain(holder,options={}){
 const initial=options.initialState||{};
 let watered=Array.isArray(initial.watered)?[...new Set(initial.watered.filter(n=>Number.isInteger(n)&&n>=0&&n<3))]:[],near=clamp(initial.near??0),seenNear=!!initial.seenNear,seenFar=!!initial.seenFar;
 let done=initial.completed===true&&watered.length===3,readonly=!!options.readOnly,notified=done,solved=false,drag=false;
 const f=foundation(holder,options,`<section class="poem-view-game rain-game"><header class="pvg-heading"><span class="pvg-kicker">把春天找出來</span><h3 data-vg-title></h3></header><div class="pvg-stage rain-stage" data-vg-stage><img src="${art('spring-far.webp')}" class="pvg-layer spring-far" alt="雨後，稀疏的小草芽像淡淡的綠色" draggable="false"><img src="${art('spring-near.webp')}" class="pvg-layer spring-near" alt="雨後，嫩芽和泥土清楚可見" draggable="false"><div class="rain-dry-veil" aria-hidden="true"></div><div class="rain-spots">${[0,1,2].map((n)=>`<button type="button" class="rain-spot" data-rain-spot="${n}" aria-label="讓第${n+1}片泥土喝一點雨水" style="--spot-x:${20+n*30}%"><span>潤一潤</span><i aria-hidden="true"></i></button>`).join('')}</div><button type="button" class="rain-cloud" data-rain-cloud aria-label="小雨雲，拖向三片泥土，也可以直接點泥土"><svg viewBox="0 0 130 90" aria-hidden="true"><path d="M25 55C2 54 3 24 25 22C29 1 58-3 69 14C86 5 111 20 110 37C130 49 116 65 101 64H25Z" fill="#f8fbf5" stroke="#98aca8" stroke-width="2"/><path d="m36 71-4 10m31-10-4 10m31-10-4 10" fill="none" stroke="#77a9b4" stroke-width="3" stroke-linecap="round"/></svg></button><span class="pvg-location" data-vg-location>小雨輕輕，草芽嫩嫩</span><span class="rain-progress" data-rain-count></span></div><div class="pvg-actions"><button type="button" class="pvg-audio" data-vg-listen>${speaker}<span>聽詩句</span></button><button type="button" class="pvg-main" data-rain-capture hidden>${camera}<span>收好小發現</span></button></div><p class="pvg-status" data-vg-status role="status"></p><button type="button" class="pvg-retry" data-vg-retry hidden>重新載入畫面</button></section>`);
 const snapshot=()=>({watered:[...watered],near,seenNear,seenFar,completed:done});
 const ready=()=>watered.length===3||solved;
 const update=()=>{
  f.root.style.setProperty('--rain-progress',solved?1:watered.length/3);
  const distance=ready()?1:0;
  f.q('.spring-near').style.opacity=String(distance);
  f.q('.spring-far').style.transform=`translateY(${-distance*1.5}%) scale(${1+distance*.085})`;
  f.q('.spring-near').style.transform=`translateY(${(1-distance)*1.4}%) scale(${1.065-distance*.065})`;
  f.q('[data-rain-count]').textContent=ready()?'細雨潤過了':`${watered.length} / 3`;
  f.q('[data-rain-cloud]').hidden=ready();f.q('[data-rain-cloud]').disabled=readonly||!f.ready;
  f.q('[data-rain-capture]').hidden=!ready();f.q('[data-rain-capture]').disabled=readonly||done||solved||!f.ready;
  f.q('[data-vg-title]').textContent=done||solved?'雨後的小草還在呢':!ready()?'帶着小雨雲，潤一潤泥土':'雨後草芽，泥土也喝飽了';
  f.q('[data-vg-location]').textContent=!ready()?'小雨輕輕，草芽嫩嫩':'細雨潤過，嫩芽和泥土都清楚了';
  f.root.querySelectorAll('[data-rain-spot]').forEach(el=>{el.classList.toggle('is-watered',watered.includes(+el.dataset.rainSpot));el.hidden=ready();el.disabled=readonly||!f.ready||watered.includes(+el.dataset.rainSpot);});
 };
 const water=n=>{if(readonly||done||solved||watered.includes(n)||!f.ready)return;watered.push(n);if(ready()){near=100;seenNear=true;seenFar=true;}update();options.onState?.(snapshot());f.say(ready()?'雨停了，看看雨後留下的小草和泥土。':'細細的雨落下了，再潤一片泥土。');};
 const cloud=f.q('[data-rain-cloud]'),stage=f.q('[data-vg-stage]');
 let pointer=null;
 cloud.addEventListener('pointerdown',e=>{if(readonly||ready()||e.button>0)return;drag=true;pointer=e.pointerId;cloud.setPointerCapture(e.pointerId);},{signal:f.signal});
 cloud.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==pointer)return;const b=stage.getBoundingClientRect(),x=clamp((e.clientX-b.left)/b.width*100,8,92),y=clamp((e.clientY-b.top)/b.height*100,10,85);cloud.style.left=x+'%';cloud.style.top=y+'%';if(y>45){const n=Math.round((x-20)/30);if(n>=0&&n<=2&&Math.abs(x-(20+n*30))<17)water(n);}},{signal:f.signal});
 const stopDrag=()=>{drag=false;pointer=null;cloud.style.left='50%';cloud.style.top='18%';};
 cloud.addEventListener('pointerup',stopDrag,{signal:f.signal});cloud.addEventListener('pointercancel',stopDrag,{signal:f.signal});
 f.root.querySelectorAll('[data-rain-spot]').forEach(el=>el.addEventListener('click',()=>water(+el.dataset.rainSpot),{signal:f.signal}));
 f.q('[data-rain-capture]').addEventListener('click',()=>{if(readonly||done||solved||!ready())return;done=true;seenNear=true;seenFar=true;update();options.onState?.(snapshot());f.say('雨後的草芽仍然稀疏，泥土間還看得見細細的綠意。');if(!notified){notified=true;options.onComplete?.({correct:true,response:snapshot(),knowledge:'遠看綠意相連，雨後近看草芽仍然稀疏；小草沒有消失。'});}},{signal:f.signal});
 f.q('[data-vg-listen]').addEventListener('click',e=>f.listen(ready()?'草色遙看近卻無':'天街小雨潤如酥',e.currentTarget),{signal:f.signal});
 f.onReady(update);update();f.say(done?'雨後的草芽和泥土都看清楚了。':readonly?'這次的小發現已保留。':'把雨雲拖向泥土，也可以直接點三片泥土。');
 return {destroy:f.destroy,showSolution(){solved=true;near=100;seenNear=true;seenFar=true;update();f.say('雨後能看見泥土和稀疏草芽，細小的綠意仍然在。');}};
}
