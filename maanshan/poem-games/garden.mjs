import {createProcessResearch} from './research.mjs?v=20260920a';
const file = path => new URL(`../media/${path}`, import.meta.url).href;
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
  const removed=new Set(Array.isArray(initialState?.removed)?initialState.removed.filter(id=>weedIds.includes(id)):[]);
  let dead=false,ready=false,done=removed.size===weedIds.length,reported=done,drag=null,loadId=0,suppressClickUntil=0;
  const research=createProcessResearch(onResearch,{prefix:'game.garden',alive:()=>!dead});
  const timers=new Set(),root=doc.createElement('section');root.className='poem-garden';root.setAttribute('aria-label','豆苗小幫手');
  root.innerHTML=`<div class="gr-instruction"><p>拔掉細長野草，留下寬葉豆苗。</p><span class="gr-count" aria-live="off"></span></div>
    <div class="garden-picture gr-picture" aria-label="三株豆苗和八叢野草的田地" aria-busy="true">
      <img class="gr-background" src="${file('poem-games/garden/garden-bed-20260919a.webp')}" alt="月亮升起，遠山前有一小片田地。" width="1152" height="768" draggable="false">
      <div class="garden-moonlight" aria-hidden="true"></div>
      ${plants.map(p=>`<button type="button" class="garden-plant is-${p.kind}" data-plant="${p.id}" style="--x:${p.x}%;--y:${p.y}%;--size:${p.size}%;--turn:${p.turn}deg;--depth:${Math.round(p.y)}" aria-label="${p.kind==='bean'?'寬葉豆苗，請保留':'細長野草，點一下拔起'}" disabled><img src="${file(`living-scenes/${p.kind==='bean'?'bean':'grass'}-v1.webp`)}" alt="" draggable="false"><span class="garden-root" aria-hidden="true"></span></button>`).join('')}
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
    if(!button||button.disabled||event.button>0)return;
    drag={pointerId:event.pointerId,id:button.dataset.plant,x:event.clientX,y:event.clientY,button};
    try{button.setPointerCapture(event.pointerId);}catch{}
  }
  function move(event){
    if(!drag||event.pointerId!==drag.pointerId)return;
    if(event.cancelable)event.preventDefault();
    if(drag.id.startsWith('weed')){
      const lift=Math.max(-32,Math.min(0,event.clientY-drag.y));
      drag.button.style.setProperty('--lift',`${lift}px`);
    }
  }
  function release(event){
    if(!drag||event.pointerId!==drag.pointerId)return;
    const previous=drag;drag=null;previous.button.style.removeProperty('--lift');
    try{previous.button.releasePointerCapture(event.pointerId);}catch{}
    if(event.type==='pointerup'){suppressClickUntil=Date.now()+600;pull(previous.id);}
  }
  async function load(){
    if(loadId)research.retry('assets');
    const request=++loadId;ready=false;q('.gr-loading').hidden=false;q('[data-garden-retry]').hidden=true;render();
    let timeout;
    try{
      if(request>1)for(const image of root.querySelectorAll('img')){const url=new URL(image.src);url.searchParams.set('retry',String(request));image.src=url.href;}
      await Promise.race([Promise.all([...root.querySelectorAll('img')].map(img=>img.decode())),new Promise((_,reject)=>{timeout=view.setTimeout(()=>reject(new Error('Image timeout')),12000);timers.add(timeout);})]);
      if(dead||request!==loadId)return;ready=true;q('.gr-loading').hidden=true;q('.gr-picture').setAttribute('aria-busy','false');render();
      if(!readOnly&&!done)plants.forEach((p,position)=>{if(!removed.has(p.id))research.present(p.id,{position,total:plants.length});});
    }catch{
      if(dead||request!==loadId)return;q('.gr-loading span').textContent='圖片暫時未載入。';q('[data-garden-retry]').hidden=false;q('.gr-picture').setAttribute('aria-busy','false');
      research.error('assets');
    }finally{view.clearTimeout(timeout);timers.delete(timeout);}
  }
  root.addEventListener('pointerdown',down,{signal:abort.signal});
  root.addEventListener('pointermove',move,{signal:abort.signal,passive:false});
  root.addEventListener('pointerup',release,{signal:abort.signal});
  root.addEventListener('pointercancel',release,{signal:abort.signal});
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
    showSolution(){if(dead||done)return;research.hint('game','reveal');weedIds.forEach(id=>removed.add(id));done=true;reported=true;render();},
    destroy(){if(dead)return;dead=true;loadId++;abort.abort();timers.forEach(id=>view.clearTimeout(id));drag=null;root.remove();}
  };
}
