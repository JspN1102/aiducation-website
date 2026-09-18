const media=path=>new URL(`../media/${path}`,import.meta.url).href;
const zones=[{id:'willow'},{id:'near'},{id:'far'}];
const WIDTH=768,HEIGHT=512,RADIUS=55;
const knowledge='「綠」寫春風讓江岸草木重新變綠。「明月何時照我還」是盼望歸鄉，詩人仍在瓜洲。';
const validDab=p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=1024);

/** Erases three pigment-only alpha overlays; water, sky and boat never recolor. */
export function mountRiver(holder,{initialState,readOnly=false,playAudio,onState,onComplete,reducedMotion=false}={}){
  const doc=holder.ownerDocument,view=doc.defaultView,abort=new view.AbortController();
  const modern=initialState?.version===2,legacyDone=initialState?.gameCompleted===true||(!modern&&initialState?.moon===true);
  const colored=new Set(legacyDone?zones.map(z=>z.id):modern&&Array.isArray(initialState?.colored)?initialState.colored.filter(id=>zones.some(z=>z.id===id)):[]);
  // Each saved dab clears at least one of fewer than 800 sampled pigment
  // points; keep restored drafts comfortably inside the shared storage limit.
  const dabs=modern&&Array.isArray(initialState?.dabs)?initialState.dabs.filter(validDab).slice(0,1000).map(p=>[...p]):[];
  let chapter=legacyDone?2:modern&&Number.isInteger(initialState.chapter)?Math.max(0,Math.min(2,initialState.chapter)):0;
  let berthed=legacyDone||modern&&initialState.berthed===true,heard=modern&&Array.isArray(initialState.heard)?initialState.heard.slice(0,3).map(v=>v===true):[false,false,false];
  let moon=legacyDone||modern&&colored.size===3&&initialState?.moon===true,reported=moon,dead=false,ready=false,loadId=0,drag=null,moonDrag=null,lightSelected=false,solved=false,speaking=false,voiceGeneration=0;
  const chapters=[{title:'找到停泊的小舟',verse:'京口瓜洲一水間',task:'聽一句，再點小舟，讓它停穩。'},{title:'讓江岸重新變綠',verse:'春風又綠江南岸',task:'聽一句，掃過三處草木，喚醒春色。'},{title:'把月光送到小舟',verse:'明月何時照我還',task:'聽一句，把月光拖向小舟。'}];
  const surfaces=new Map(),timers=new Set(),root=doc.createElement('section');root.className='poem-river journey-river';root.setAttribute('aria-label','春風與月光');
  root.innerHTML=`<header class="rj-header"><div><span>春風與月光</span><h3></h3></div><b class="rj-progress"></b></header>
    <div class="river-picture gr-picture" aria-label="用手指掃過江岸草木，讓春色回來" aria-busy="true">
      <img class="gr-background" src="${media('exploration/bo-chuan-gua-zhou/scene.webp')}" alt="江岸草木、停泊的小舟和天上的月亮。" width="1536" height="1024" draggable="false">
      ${zones.map(z=>`<canvas class="river-waiting" data-river-layer="${z.id}" width="${WIDTH}" height="${HEIGHT}" aria-hidden="true"></canvas>`).join('')}
      <div class="river-moonlight" aria-hidden="true"></div>
      <svg class="rj-light-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M75 17 Q77 42 44 77"/></svg>
      <button type="button" class="rj-boat-target" data-rj-boat aria-label="小舟停在瓜洲，點一下停穩，或接住月光"><span>停一停</span></button>
      <button type="button" class="river-moon" data-river-moon aria-label="月光，拖到小舟，也可點一下月光再點小舟" hidden><span>送月光</span></button>
      <div class="river-verse" hidden>心裏想着家<br><small>小舟仍在瓜洲</small></div><i class="river-brush" hidden aria-hidden="true"></i><i class="rj-moving-light" hidden aria-hidden="true"></i>
      <div class="gr-loading" role="status"><span>江岸正在展開…</span><button type="button" data-river-retry hidden>再試一次</button></div>
    </div>
    <p class="rj-verse"></p><p class="rj-task"></p>
    <div class="rj-actions"><button type="button" class="gr-audio" data-river-audio>聽這句詩</button><button type="button" class="rj-next" data-rj-next hidden>下一步 <span aria-hidden="true">→</span></button></div>
    <p class="gr-feedback" role="status" aria-live="polite"></p>`;
  holder.append(root);const q=s=>root.querySelector(s),stage=q('.river-picture'),tell=t=>{q('.gr-feedback').textContent=t;};
  const snapshot=()=>({version:2,chapter,berthed,heard:[...heard],colored:[...colored],dabs:dabs.map(p=>[...p]),moon});
  const save=()=>{if(!dead&&!readOnly&&!solved)onState?.(snapshot());};
  const active=()=>!dead&&ready&&!readOnly&&!solved&&!moon&&!speaking;
  function render(){
    root.classList.toggle('is-done',moon||solved);root.classList.toggle('is-readonly',readOnly);root.dataset.chapter=String(chapter);root.dataset.berthed=String(berthed);
    q('h3').textContent=moon||solved?'春風回來了，我何時回家？':chapters[chapter].title;q('.rj-progress').textContent=`${chapter+1} / 3`;q('.rj-verse').textContent=chapters[chapter].verse;q('.rj-task').textContent=moon||solved?'詩人望月思鄉，盼着回到鍾山的家。':chapters[chapter].task;
    stage.classList.toggle('is-painting',active()&&chapter===1&&heard[1]&&colored.size<3);
    q('[data-river-moon]').hidden=!ready||chapter!==2||moon||solved||readOnly;q('[data-river-moon]').disabled=!active()||!heard[2];
    q('[data-rj-boat]').hidden=chapter===1||moon||solved||readOnly;q('[data-rj-boat]').disabled=!active()||!heard[chapter]||chapter===0&&berthed;q('[data-rj-boat] span').textContent=chapter===0?(berthed?'停穩了':'停一停'):'送到小舟';
    q('.river-verse').hidden=!(moon||solved);
    q('[data-rj-next]').hidden=!((chapter===0&&berthed||chapter===1&&colored.size===3)&&!readOnly&&!solved);q('[data-rj-next]').disabled=speaking;
    q('[data-river-audio]').disabled=!ready||speaking||solved;q('[data-river-audio]').textContent=speaking?'仔細聽…':heard[chapter]?'再聽一次':'聽這句詩';q('[data-river-audio]').setAttribute('aria-busy',String(speaking));
  }
  function describe(){
    tell(moon?'月光照着小舟，詩人盼望回家；他現在仍在瓜洲。':chapter===0?(berthed?'「泊」是停船。京口和瓜洲隔着一條長江。':'聽完後點小舟，開始這一夜的旅程。'):chapter===1?(colored.size===3?'「綠」讓我們看見春風吹來，草木重新變綠。':colored.size?`春風喚醒了 ${colored.size} 處，繼續把新綠帶回江岸。`:'用手指掃過江岸草木，一點點染回新綠。'):'月光拖到小舟，或點一下月光、再點小舟。');
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
    if(dead||!ready||(persist&&(!active()||chapter!==1||!heard[1]||colored.size===3)))return false;
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
  function finish(){
    if(!active()||chapter!==2||!heard[2]||!berthed||colored.size!==3)return;
    moon=true;render();describe();save();
    if(!reported){reported=true;onComplete?.({correct:true,response:snapshot(),knowledge});}
  }
  function point(event){const r=stage.getBoundingClientRect();return{x:Math.max(0,Math.min(WIDTH,(event.clientX-r.left)/r.width*WIDTH)),y:Math.max(0,Math.min(HEIGHT,(event.clientY-r.top)/r.height*HEIGHT))};}
  function brushCursor(p){const marker=q('.river-brush');marker.hidden=false;marker.style.left=`${p.x/WIDTH*100}%`;marker.style.top=`${p.y/HEIGHT*100}%`;}
  function down(event){
    if(!active()||chapter!==1||!heard[1]||colored.size===3||event.button>0||event.target.closest('button'))return;
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
  async function listen(){
    if(dead||!ready||speaking||solved)return;const token=++voiceGeneration;speaking=true;render();tell('聽清楚這句，也可以跟着讀一讀。');let ok=false,timeout;
    try{ok=await Promise.race([Promise.resolve(playAudio?.({text:chapters[chapter].verse})),new Promise(resolve=>{timeout=view.setTimeout(()=>resolve(false),15000);timers.add(timeout);})]);}catch{}finally{view.clearTimeout(timeout);timers.delete(timeout);}
    if(dead||token!==voiceGeneration)return;speaking=false;if(!readOnly&&!moon){heard[chapter]=true;save();}render();describe();if(ok===false||ok===undefined)tell('聲音暫時未能播放，可以看詩句繼續；稍後再聽一次。');
  }
  const moonButton=q('[data-river-moon]'),light=q('.rj-moving-light');
  moonButton.addEventListener('pointerdown',event=>{if(!active()||chapter!==2||!heard[2])return;moonDrag=event.pointerId;lightSelected=true;moonButton.setPointerCapture(event.pointerId);},{signal:abort.signal});
  moonButton.addEventListener('pointermove',event=>{if(moonDrag!==event.pointerId)return;const p=point(event);light.hidden=false;light.style.left=`${p.x/WIDTH*100}%`;light.style.top=`${p.y/HEIGHT*100}%`;},{signal:abort.signal});
  moonButton.addEventListener('pointerup',event=>{if(moonDrag!==event.pointerId)return;const p=point(event);moonDrag=null;light.hidden=true;if(p.x/WIDTH>.23&&p.x/WIDTH<.67&&p.y/HEIGHT>.59&&p.y/HEIGHT<.91)finish();else tell('讓月光落在小舟上；也可以再點一下小舟。');},{signal:abort.signal});
  moonButton.addEventListener('pointercancel',()=>{moonDrag=null;light.hidden=true;},{signal:abort.signal});
  root.addEventListener('click',event=>{
    if(event.target.closest?.('[data-river-moon]')&&active()){lightSelected=true;root.classList.add('is-light-selected');tell('月光準備好了，再點一下小舟。');}
    if(event.target.closest?.('[data-rj-boat]')&&active()&&heard[chapter]){if(chapter===0){berthed=true;render();save();describe();}else if(lightSelected)finish();else tell('先點一下月光，再把它送到小舟。');}
    if(event.target.closest?.('[data-rj-next]')&&active()&&(chapter===0&&berthed||chapter===1&&colored.size===3)){chapter++;render();save();describe();q('[data-river-audio]').focus({preventScroll:true});}
    if(event.target.closest?.('[data-river-retry]'))void load();
    if(event.target.closest?.('[data-river-audio]'))void listen();
  },{signal:abort.signal});
  if(reducedMotion)root.classList.add('is-reduced-motion');render();describe();void load();
  return{
    showSolution(){if(dead)return;voiceGeneration++;speaking=false;solved=true;chapter=2;berthed=true;zones.forEach(z=>{colored.add(z.id);surfaces.get(z.id)?.context.clearRect(0,0,WIDTH,HEIGHT);});moon=true;reported=true;render();describe();},
    destroy(){if(dead)return;dead=true;loadId++;voiceGeneration++;abort.abort();timers.forEach(id=>view.clearTimeout(id));drag=null;moonDrag=null;surfaces.clear();root.remove();}
  };
}
