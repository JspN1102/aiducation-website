import {createGameImageLoader} from './image-ready.mjs?v=20260922-school11';
import {imageAsset} from '../media-images.mjs?v=20260922-school16';
import {createProcessResearch} from './research.mjs?v=20260920a';
const file = path => new URL(imageAsset(`media/${path}`), import.meta.url).href;
const plants = [
  {id:'bean-a',kind:'bean',x:22,y:72,size:25,turn:-8},
  {id:'bean-b',kind:'bean',x:52,y:88,size:29,turn:5},
  {id:'bean-c',kind:'bean',x:81,y:70,size:23,turn:11},
  {id:'weed-a',kind:'weed',x:12,y:83,size:25,turn:-12},
  {id:'weed-b',kind:'weed',x:29,y:69,size:24,turn:8},
  {id:'weed-c',kind:'weed',x:42,y:65,size:23,turn:-6},
  {id:'weed-d',kind:'weed',x:63,y:66,size:25,turn:12},
  {id:'weed-e',kind:'weed',x:89,y:83,size:26,turn:-8},
  {id:'weed-f',kind:'weed',x:31,y:94,size:29,turn:7},
  {id:'weed-g',kind:'weed',x:57,y:96,size:30,turn:-11},
  {id:'weed-h',kind:'weed',x:75,y:95,size:28,turn:8}
];
const weedIds = plants.filter(p=>p.kind==='weed').map(p=>p.id);
const facts = '詩裏是「草盛豆苗稀」：野草多，豆苗少。我們剛才幫忙照料這小片田。';

/** A close-up tending activity; clearing this game bed does not rewrite the poem. */
export function mountGarden(holder, {initialState, readOnly=false, playAudio, onState, onComplete, onResearch}={}) {
  const doc=holder.ownerDocument,view=doc.defaultView,abort=new view.AbortController();
  const loadImages=createGameImageLoader({signal:abort.signal});
  const removed=new Set(Array.isArray(initialState?.removed)?initialState.removed.filter(id=>weedIds.includes(id)):[]);
  let dead=false,ready=false,done=removed.size===weedIds.length,reported=done,drag=null,dragFrame=0,loadId=0,suppressClickUntil=0;
  const research=createProcessResearch(onResearch,{prefix:'game.garden',alive:()=>!dead});
  const timers=new Set(),root=doc.createElement('section');root.className='poem-garden';root.setAttribute('aria-label','豆苗小幫手');
  root.innerHTML=`<div class="gr-instruction"><p>拔掉細長野草，留下寬葉豆苗。</p><span class="gr-count" aria-live="off"></span></div>
    <div class="garden-picture gr-picture" aria-label="三株豆苗和八叢野草的田地" aria-busy="true">
      <img class="gr-background" src="${file('poem-games/garden/garden-bed-20260919a.webp')}" alt="月亮升起，遠山前有一小片田地。" width="1152" height="768" draggable="false">
      <div class="garden-moonlight" aria-hidden="true"></div>
      ${plants.map(p=>`<button type="button" class="garden-plant is-${p.kind}" data-plant="${p.id}" style="--x:${p.x}%;--y:${p.y}%;--size:${p.size}%;--turn:${p.turn}deg;--depth:${Math.round(p.y)}" aria-label="${p.kind==='bean'?'寬葉豆苗，請保留':'細長野草，向上拔起，也可以點一下'}" disabled><img src="${file(`living-scenes/${p.kind==='bean'?'bean':'grass'}-v1.webp`)}" alt="" draggable="false"><span class="garden-root" aria-hidden="true"></span></button>`).join('')}
      <div class="garden-end" hidden><span>帶月荷鋤歸</span><small>伴着月光，扛起鋤頭。</small></div>
      <div class="gr-loading" role="status"><span>田園正在展開…</span><button type="button" data-garden-retry hidden>再試一次</button></div>
    </div>
    <div class="gr-actionline"><span class="gr-method">點一下，也可以向上拔。</span><button type="button" class="gr-audio" data-garden-audio>聽這句詩</button></div>
    <p class="gr-feedback" role="status" aria-live="polite"></p>`;
  holder.append(root);
  const q=s=>root.querySelector(s),tell=text=>{q('.gr-feedback').textContent=text;};
  const later=(fn,time)=>{const id=view.setTimeout(()=>{timers.delete(id);if(!dead)fn();},time);timers.add(id);};
  const state=()=>({version:1,removed:[...removed],done});

  function render() {
    root.classList.toggle('is-done',done);root.classList.toggle('is-readonly',readOnly);
    q('.gr-count').textContent=`${removed.size} / ${weedIds.length}`;
    q('.gr-count').setAttribute('aria-label',`已照料 ${removed.size} 叢野草，共 ${weedIds.length} 叢`);
    for(const p of plants){const b=q(`[data-plant="${p.id}"]`),gone=removed.has(p.id);b.classList.toggle('is-pulled',gone);b.disabled=!ready||readOnly||done||gone;b.setAttribute('aria-hidden',String(gone));}
    q('.garden-end').hidden=!done;
    q('.gr-method').textContent=done?'看看三株寬葉豆苗。':'點一下，也可以向上拔。';
    if(done)tell(facts);else if(readOnly)tell('細長的是野草，寬葉的是豆苗。');
  }

  function pull(id) {
    if(dead||!ready||readOnly||done||removed.has(id))return;
    const p=plants.find(item=>item.id===id);if(!p)return;
    research.answer(id,'pull',p.kind==='weed');
    const button=q(`[data-plant="${id}"]`);
    if(p.kind==='bean'){
      research.hint(id);
      button.classList.remove('is-shaking');void button.offsetWidth;button.classList.add('is-shaking');
      later(()=>button.classList.remove('is-shaking'),550);
      tell('這是豆苗，寬寬的葉子要留下。找找旁邊細長的草。');return;
    }
    removed.add(id);done=removed.size===weedIds.length;render();
    if(!done)tell(removed.size===1?'拔起來了！寬葉豆苗要留下。':`又照料好一處，還有 ${weedIds.length-removed.size} 叢野草。`);
    onState?.(state());
    if(done&&!reported){reported=true;research.complete();onComplete?.({correct:true,response:{removed:[...removed],kept:plants.filter(p=>p.kind==='bean').map(p=>p.id)},knowledge:facts});}
  }

  function down(event){
    const button=event.target.closest?.('[data-plant]');
    if(dead||drag||!button||button.disabled||event.button>0||event.isPrimary===false)return;
    if(event.cancelable)event.preventDefault();
    drag={pointerId:event.pointerId,id:button.dataset.plant,x:event.clientX,y:event.clientY,dx:0,dy:0,distance:0,threshold:Math.max(24,Math.min(42,button.clientHeight*.3)),button};
    button.classList.add('is-pulling');
    if(event.pointerType!=='touch')button.focus({preventScroll:true});
    try{button.setPointerCapture(event.pointerId);}catch{}
  }
  function paintDrag(){
    dragFrame=0;if(!drag||dead)return;
    drag.button.style.setProperty('--lift',`${Math.min(0,drag.dy)}px`);
    drag.button.style.setProperty('--sway',`${Math.max(-22,Math.min(22,drag.dx*.3))}px`);
  }
  function cancelDrag(){
    const previous=drag;drag=null;view.cancelAnimationFrame(dragFrame);dragFrame=0;
    if(!previous)return null;
    previous.button.classList.remove('is-pulling');previous.button.style.removeProperty('--lift');previous.button.style.removeProperty('--sway');
    try{previous.button.releasePointerCapture(previous.pointerId);}catch{}
    suppressClickUntil=Date.now()+600;
    return previous;
  }
  function move(event){
    if(!drag||event.pointerId!==drag.pointerId)return;
    if(event.cancelable)event.preventDefault();
    drag.dx=event.clientX-drag.x;drag.dy=event.clientY-drag.y;
    drag.distance=Math.max(drag.distance,Math.hypot(drag.dx,drag.dy));
    if(drag.id.startsWith('weed')){
      if(-drag.dy>=drag.threshold&&-drag.dy>=Math.abs(drag.dx)*.7){
        drag.button.style.setProperty('--pull-distance',`${-drag.dy+65}px`);
        const previous=cancelDrag();pull(previous.id);
      }else if(!dragFrame)dragFrame=view.requestAnimationFrame(paintDrag);
    }
  }
  function release(event){
    if(!drag||event.pointerId!==drag.pointerId)return;
    const previous=cancelDrag();
    if(event.type==='pointerup'&&Math.max(previous.distance,Math.hypot(event.clientX-previous.x,event.clientY-previous.y))<=10)pull(previous.id);
  }
  async function load(){
    if(loadId)research.retry('assets');
    const request=++loadId;ready=false;q('.gr-loading').hidden=false;q('.gr-loading span').textContent='田園正在展開…';q('[data-garden-retry]').hidden=true;q('.gr-picture').setAttribute('aria-busy','true');render();
    const unavailable=()=>{if(dead||request!==loadId)return;research.error('assets');q('.gr-loading span').textContent='圖片還在載入，可以再試一次。';q('[data-garden-retry]').hidden=false;q('.gr-picture').setAttribute('aria-busy','false');};
    try{
      if(request>1)for(const image of root.querySelectorAll('img')){const url=new URL(image.src);url.searchParams.set('retry',String(request));image.src=url.href;}
      await loadImages(root.querySelectorAll('img'),{onTimeout:unavailable});
      if(dead||request!==loadId)return;ready=true;q('.gr-loading').hidden=true;q('.gr-picture').setAttribute('aria-busy','false');render();
      if(!readOnly&&!done)plants.forEach((p,position)=>{if(!removed.has(p.id))research.present(p.id,{position,total:plants.length});});
    }catch{unavailable();}
  }
  root.addEventListener('pointerdown',down,{signal:abort.signal});
  root.addEventListener('pointermove',move,{signal:abort.signal,passive:false});
  root.addEventListener('pointerup',release,{signal:abort.signal});
  root.addEventListener('pointercancel',release,{signal:abort.signal});
  root.addEventListener('lostpointercapture',release,{signal:abort.signal});
  for(const type of ['contextmenu','selectstart','dragstart'])root.addEventListener(type,event=>{if(event.target.closest?.('[data-plant]')&&event.cancelable)event.preventDefault();},{signal:abort.signal});
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)cancelDrag();},{signal:abort.signal});
  view.addEventListener('blur',()=>cancelDrag(),{signal:abort.signal});
  root.addEventListener('click',event=>{
    const plant=event.target.closest?.('[data-plant]');if(plant&&(event.detail===0||Date.now()>suppressClickUntil))pull(plant.dataset.plant);
    if(event.target.closest?.('[data-garden-retry]'))void load();
    if(event.target.closest?.('[data-garden-audio]')){
      research.hint('game','audio');
      Promise.resolve().then(()=>playAudio?.({text:done?'帶月荷鋤歸':'草盛豆苗稀'})).then(ok=>{if(ok===false)research.error('audio','audio_unavailable');}).catch(()=>{research.error('audio','audio_unavailable');if(!dead)tell('聲音暫時未能播放，稍後再試。');});
    }
  },{signal:abort.signal});
  tell(done?facts:'先看看葉子：豆苗寬，野草細長。');render();void load();
  return {
    showSolution(){if(dead||done)return;cancelDrag();research.hint('game','reveal');weedIds.forEach(id=>removed.add(id));done=true;reported=true;render();},
    destroy(){if(dead)return;dead=true;loadId++;cancelDrag();abort.abort();timers.forEach(id=>view.clearTimeout(id));root.remove();}
  };
}
