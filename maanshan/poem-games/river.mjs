const media=path=>new URL(`../media/${path}`,import.meta.url).href;
const zones=[{id:'willow',label:'柳枝',x:22,y:22},{id:'near',label:'近岸',x:16,y:76},{id:'far',label:'對岸',x:82,y:48}];
const WIDTH=768,HEIGHT=512,RADIUS=55;
const knowledge='「綠」寫春風讓江岸草木重新變綠。「明月何時照我還」是盼望歸鄉，詩人仍在瓜洲。';
const validDab=p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=1024);

/** Erases three pigment-only alpha overlays; water, sky and boat never recolor. */
export function mountRiver(holder,{initialState,readOnly=false,playAudio,onState,onComplete}={}){
  const doc=holder.ownerDocument,view=doc.defaultView,abort=new view.AbortController();
  const colored=new Set(Array.isArray(initialState?.colored)?initialState.colored.filter(id=>zones.some(z=>z.id===id)):[]);
  // Each saved dab clears at least one of fewer than 800 sampled pigment
  // points; keep restored drafts comfortably inside the shared storage limit.
  const dabs=Array.isArray(initialState?.dabs)?initialState.dabs.filter(validDab).slice(0,1000).map(p=>[...p]):[];
  let moon=colored.size===3&&initialState?.moon===true,reported=moon,dead=false,ready=false,loadId=0,drag=null;
  const surfaces=new Map(),timers=new Set(),root=doc.createElement('section');root.className='poem-river';root.setAttribute('aria-label','春風小畫筆');
  root.innerHTML=`<div class="gr-instruction"><p>掃過草木，把春天的綠帶回來。</p><span class="gr-count"></span></div>
    <div class="river-picture gr-picture" aria-label="把春風吹向柳枝、近岸和對岸" aria-busy="true">
      <img class="gr-background" src="${media('exploration/bo-chuan-gua-zhou/scene.webp')}" alt="江岸草木、停泊的小舟和天上的月亮。" width="1536" height="1024" draggable="false">
      ${zones.map(z=>`<canvas class="river-waiting" data-river-layer="${z.id}" width="${WIDTH}" height="${HEIGHT}" aria-hidden="true"></canvas>`).join('')}
      <div class="river-moonlight" aria-hidden="true"></div>
      ${zones.map(z=>`<button type="button" class="river-wind" data-river-zone="${z.id}" style="--x:${z.x}%;--y:${z.y}%" aria-label="向${z.label}吹春風，點按也可塗綠" disabled><svg viewBox="0 0 26 18" aria-hidden="true"><path d="M2 5h15c6 0 6-6 1-4M4 10h17c5 0 5 6 0 6M1 15h11"/></svg><span>${z.label}</span></button>`).join('')}
      <button type="button" class="river-moon" data-river-moon aria-label="看月亮，讀思鄉的詩句" hidden><span>看月亮</span></button>
      <div class="river-verse" hidden>明月何時照我還</div><i class="river-brush" hidden aria-hidden="true"></i>
      <div class="gr-loading" role="status"><span>江岸正在展開…</span><button type="button" data-river-retry hidden>再試一次</button></div>
    </div>
    <div class="gr-actionline"><span class="gr-method">用手指掃，也可點三處春風。</span><button type="button" class="gr-audio" data-river-audio>聽這句詩</button></div>
    <p class="gr-feedback" role="status" aria-live="polite"></p>`;
  holder.append(root);const q=s=>root.querySelector(s),stage=q('.river-picture'),tell=t=>{q('.gr-feedback').textContent=t;};
  const snapshot=()=>({version:1,colored:[...colored],dabs:dabs.map(p=>[...p]),moon});
  const save=()=>{if(!dead&&!readOnly)onState?.(snapshot());};
  function render(){
    root.classList.toggle('is-done',moon);root.classList.toggle('is-readonly',readOnly);
    stage.classList.toggle('is-painting',ready&&!readOnly&&colored.size<3);
    q('.gr-count').textContent=`${colored.size} / 3`;q('.gr-count').setAttribute('aria-label',`已有 ${colored.size} 處恢復新綠，共 3 處`);
    for(const z of zones){const b=q(`[data-river-zone="${z.id}"]`);b.classList.toggle('is-green',colored.has(z.id));b.disabled=!ready||readOnly||colored.has(z.id)||moon;b.setAttribute('aria-hidden',String(colored.has(z.id)));}
    q('[data-river-moon]').hidden=!ready||colored.size<3||moon||readOnly;
    q('.river-verse').hidden=!moon;
    q('.gr-method').textContent=moon?'小舟仍在瓜洲，心裏想着家。':colored.size===3?'春意回來了，再抬頭看看月亮。':'用手指掃，也可點三處春風。';
  }
  function describe(){
    tell(moon?'江岸綠了。詩人望着明月，盼着回家。':colored.size===3?'春風又綠江南岸。點一下月亮，看看詩人在想甚麼。':colored.size?'看，新綠沿着春風回來了。再看看其他草木。':'只替草木添新綠，江水和小舟留在原處。');
  }
  function erase(surface,x,y){
    const ctx=surface.context;
    ctx.save();ctx.globalCompositeOperation='destination-out';
    const fade=ctx.createRadialGradient(x,y,RADIUS*.7,x,y,RADIUS);fade.addColorStop(0,'rgba(0,0,0,1)');fade.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=fade;ctx.beginPath();ctx.arc(x,y,RADIUS,0,Math.PI*2);ctx.fill();ctx.restore();
    let changes=0;
    for(const sample of surface.samples){if(!sample.erased&&(sample.x-x)**2+(sample.y-y)**2<(RADIUS*.8)**2){sample.erased=true;changes++;}}
    return changes;
  }
  function applyDab(x,y,persist=true){
    if(dead||!ready||(persist&&(readOnly||moon||colored.size===3)))return false;
    let changed=0;
    for(const z of zones){
      if(colored.has(z.id))continue;
      const surface=surfaces.get(z.id);changed+=erase(surface,x,y);
      const cleared=surface.samples.filter(s=>s.erased).length;
      if(cleared>=surface.samples.length*.73&&surface.samples.length){colored.add(z.id);surface.context.clearRect(0,0,WIDTH,HEIGHT);}
    }
    if(persist&&changed){dabs.push([Math.round(x/WIDTH*1024),Math.round(y/HEIGHT*1024)]);render();describe();save();}
    return Boolean(changed);
  }
  function breeze(id){
    if(dead||!ready||readOnly||moon||colored.has(id))return;
    const surface=surfaces.get(id);if(!surface)return;
    const before=surface.samples.filter(s=>s.erased).length,target=before+surface.samples.length*.29;
    let steps=0;
    while(!colored.has(id)&&surface.samples.filter(s=>s.erased).length<target&&steps++<64){
      const next=surface.samples.find(s=>!s.erased);if(!next)break;
      applyDab(next.x,next.y,false);
      dabs.push([Math.round(next.x/WIDTH*1024),Math.round(next.y/HEIGHT*1024)]);
    }
    render();describe();save();
  }
  function finish(){
    if(dead||!ready||readOnly||moon||colored.size!==3)return;
    moon=true;render();describe();save();
    if(!reported){reported=true;onComplete?.({correct:true,response:{colored:[...colored],moon:true},knowledge});}
  }
  function point(event){const r=stage.getBoundingClientRect();return{x:Math.max(0,Math.min(WIDTH,(event.clientX-r.left)/r.width*WIDTH)),y:Math.max(0,Math.min(HEIGHT,(event.clientY-r.top)/r.height*HEIGHT))};}
  function brushCursor(p){const marker=q('.river-brush');marker.hidden=false;marker.style.left=`${p.x/WIDTH*100}%`;marker.style.top=`${p.y/HEIGHT*100}%`;}
  function down(event){
    if(!ready||readOnly||moon||colored.size===3||event.button>0||event.target.closest('button'))return;
    if(event.cancelable)event.preventDefault();const p=point(event);drag={id:event.pointerId,...p};
    try{stage.setPointerCapture(event.pointerId);}catch{}
    brushCursor(p);applyDab(p.x,p.y);
  }
  function move(event){
    if(!drag||event.pointerId!==drag.id)return;if(event.cancelable)event.preventDefault();
    const p=point(event),distance=Math.hypot(p.x-drag.x,p.y-drag.y),steps=Math.ceil(distance/(RADIUS*.45));
    for(let i=1;i<=steps;i++)applyDab(drag.x+(p.x-drag.x)*i/steps,drag.y+(p.y-drag.y)*i/steps);
    drag.x=p.x;drag.y=p.y;brushCursor(p);
  }
  function release(event){if(!drag||event.pointerId!==drag.id)return;drag=null;q('.river-brush').hidden=true;try{stage.releasePointerCapture(event.pointerId);}catch{};}
  async function loadImage(url){const image=new view.Image();image.src=url;await image.decode();return image;}
  async function load(){
    const request=++loadId;ready=false;q('.gr-loading').hidden=false;q('[data-river-retry]').hidden=true;render();
    let timeout;
    try{
      if(request>1){const url=new URL(q('.gr-background').src);url.searchParams.set('retry',String(request));q('.gr-background').src=url.href;}
      const loaded=await Promise.race([Promise.all([q('.gr-background').decode(),...zones.map(z=>loadImage(media(`poem-games/river/${z.id}-waiting.webp`)+(request>1?`?retry=${request}`:'')))]),new Promise((_,reject)=>{timeout=view.setTimeout(()=>reject(new Error('Image timeout')),12000);timers.add(timeout);})]);
      if(dead||request!==loadId)return;
      zones.forEach((z,index)=>{
        const canvas=q(`[data-river-layer="${z.id}"]`),context=canvas.getContext('2d');context.clearRect(0,0,WIDTH,HEIGHT);context.drawImage(loaded[index+1],0,0,WIDTH,HEIGHT);
        const pixels=context.getImageData(0,0,WIDTH,HEIGHT).data,samples=[];
        for(let y=6;y<HEIGHT;y+=12)for(let x=6;x<WIDTH;x+=12)if(pixels[(y*WIDTH+x)*4+3]>90)samples.push({x,y,erased:false});
        surfaces.set(z.id,{canvas,context,samples});
        if(colored.has(z.id))context.clearRect(0,0,WIDTH,HEIGHT);
      });
      ready=true;for(const p of dabs)applyDab(p[0]/1024*WIDTH,p[1]/1024*HEIGHT,false);
      q('.gr-loading').hidden=true;stage.setAttribute('aria-busy','false');render();describe();
    }catch{
      if(dead||request!==loadId)return;q('.gr-loading span').textContent='圖片暫時未載入。';q('[data-river-retry]').hidden=false;stage.setAttribute('aria-busy','false');
    }finally{view.clearTimeout(timeout);timers.delete(timeout);}
  }
  stage.addEventListener('pointerdown',down,{signal:abort.signal,passive:false});stage.addEventListener('pointermove',move,{signal:abort.signal,passive:false});stage.addEventListener('pointerup',release,{signal:abort.signal});stage.addEventListener('pointercancel',release,{signal:abort.signal});
  root.addEventListener('click',event=>{
    const zone=event.target.closest?.('[data-river-zone]')?.dataset.riverZone;if(zone)breeze(zone);
    if(event.target.closest?.('[data-river-moon]'))finish();
    if(event.target.closest?.('[data-river-retry]'))void load();
    if(event.target.closest?.('[data-river-audio]'))Promise.resolve().then(()=>playAudio?.({text:moon?'明月何時照我還':'春風又綠江南岸'})).catch(()=>{if(!dead)tell('聲音暫時未能播放，稍後再試。');});
  },{signal:abort.signal});
  render();describe();void load();
  return{
    showSolution(){if(dead)return;zones.forEach(z=>{colored.add(z.id);surfaces.get(z.id)?.context.clearRect(0,0,WIDTH,HEIGHT);});moon=true;reported=true;render();describe();},
    destroy(){if(dead)return;dead=true;loadId++;abort.abort();timers.forEach(id=>view.clearTimeout(id));drag=null;surfaces.clear();root.remove();}
  };
}
