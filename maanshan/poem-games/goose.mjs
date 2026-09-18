const asset = name => new URL(`../media/poem-games/yong-e/${name}.webp`, import.meta.url).href;
const parts = [
  {id:'feather',color:'white',name:'羽毛',label:'鵝的羽毛',x:48,y:48,feedback:'白毛，像一朵浮在水上的雲。',hint:'詩裏說「白毛」，再選一種顏色吧。'},
  {id:'palm',color:'red',name:'腳掌',label:'鵝的腳掌',x:48,y:78,feedback:'紅掌，輕輕撥開清波。',hint:'詩裏說「紅掌」，再選一種顏色吧。'},
  {id:'water',color:'green',name:'水面',label:'池塘的水面',x:20,y:67,feedback:'綠水，托着小白鵝慢慢游。',hint:'詩裏說「綠水」，再選一種顏色吧。'},
];
const colors = [{id:'white',name:'白色'},{id:'red',name:'紅色'},{id:'green',name:'綠色'}];

/** Reuses the user-owned Culture Village painting and its aligned alpha masks.
 * No rendering engine, model, animation loop, microphone, or camera is loaded.
 * The caller owns navigation and scoring; only three correct fills can finish.
 */
export function mountGoose(holder, {initialState, readOnly=false, onState, onComplete, onProgress, playAudio, reducedMotion=false} = {}) {
  const savedFilled=Array.isArray(initialState?.filled)?initialState.filled:Array.isArray(initialState?.completed)?initialState.completed:[];
  const restored=savedFilled.filter(id=>parts.some(part=>part.id===id));
  const abort = new AbortController(), found = new Set(restored), masks = new Map(), timers = new Set();
  let dead=false, ready=false, complete=found.size===3, solution=false, selected=null, loadGeneration=0, drag=null, suppressClick=false;
  const root=document.createElement('section');
  root.className=`poem-goose-game${reducedMotion?' is-reduced-motion':''}`;
  root.setAttribute('aria-label','白鵝的春水圖填色遊戲');
  root.innerHTML=`<div class="goose-instruction"><p>選顏色，再點畫裏的位置。</p><span class="goose-progress" aria-label="已完成 0 處，共 3 處">0 / 3</span></div>
    <div class="goose-picture" aria-label="替羽毛、腳掌和水面填色" aria-busy="true">
      <img class="goose-base" alt="一隻白鵝浮在池塘上，羽毛、腳掌和水面正等着你上色。" width="1536" height="1024" draggable="false">
      ${parts.map(part=>`<img class="goose-layer" data-goose-layer="${part.id}" alt="" aria-hidden="true" width="1536" height="1024" draggable="false">`).join('')}
      ${parts.map(part=>`<button type="button" class="goose-part" data-goose-part="${part.id}" style="--x:${part.x}%;--y:${part.y}%" aria-label="${part.label}，未上色" aria-pressed="false" disabled><span aria-hidden="true">+</span></button>`).join('')}
      <div class="goose-loading" role="status"><span>畫卷正在展開…</span><button type="button" data-goose-retry hidden>再試一次</button></div>
      <div class="goose-caption" hidden aria-hidden="true"><span>白毛浮綠水</span><span>紅掌撥清波</span></div>
    </div>
    <div class="goose-palette" role="group" aria-label="選一種顏色">${colors.map(color=>`<button type="button" class="goose-paint goose-paint-${color.id}" data-goose-color="${color.id}" aria-pressed="false" disabled><i aria-hidden="true"></i><span>${color.name}</span><b aria-hidden="true"></b></button>`).join('')}</div>
    <p class="goose-feedback" role="status" aria-live="polite">讓詩裏的三種顏色回到畫中。</p>`;
  holder.append(root);
  const q=selector=>root.querySelector(selector);
  const picture=q('.goose-picture'), feedback=q('.goose-feedback');
  const later=(fn,delay)=>{const id=setTimeout(()=>{timers.delete(id);if(!dead)fn();},delay);timers.add(id);return id;};
  const cancelTimers=()=>{timers.forEach(clearTimeout);timers.clear();};
  const tell=message=>{feedback.textContent=message;};
  const state=()=>({filled:[...found],completed:found.size===3});

  function update() {
    root.classList.toggle('is-complete', complete||solution);
    root.dataset.solution=String(solution);
    root.dataset.completed=String(found.size);
    q('.goose-progress').textContent=`${found.size} / 3`;
    q('.goose-progress').setAttribute('aria-label',`已完成 ${found.size} 處，共 3 處`);
    for(const part of parts) {
      const done=found.has(part.id), button=q(`[data-goose-part="${part.id}"]`);
      q(`[data-goose-layer="${part.id}"]`).classList.toggle('is-filled',done||solution);
      button.classList.toggle('is-filled',done);button.disabled=!ready||complete||readOnly||solution;
      button.setAttribute('aria-pressed',String(done));
      button.setAttribute('aria-label',`${part.label}，${done?'已上色':'未上色'}`);
      button.firstElementChild.textContent=done?'✓':'+';
    }
    for(const color of colors) {
      const button=q(`[data-goose-color="${color.id}"]`),used=parts.some(p=>p.color===color.id&&found.has(p.id));
      button.setAttribute('aria-pressed',String(selected===color.id));
      button.classList.toggle('is-used',used);button.disabled=!ready||complete||readOnly||solution;
      button.querySelector('b').textContent=used?'✓':'';
    }
    q('.goose-caption').hidden=!(complete||solution);
    q('.goose-caption').setAttribute('aria-hidden',String(!(complete||solution)));
    picture.setAttribute('aria-busy',String(!ready));
  }
  function choose(color) {
    if(!ready||complete||dead||readOnly||solution)return;
    selected=color;update();tell(`拿起${colors.find(c=>c.id===color).name}，點一點畫裏的${color==='white'?'羽毛':color==='red'?'腳掌':'水面'}。`);
  }
  function paint(part, point) {
    if(!part||!ready||complete||dead||readOnly||solution)return;
    if(found.has(part.id)){tell('這裏塗好啦，再看看其他地方。');return;}
    if(!selected){tell('先在下面選一種顏色吧。');return;}
    if(selected!==part.color){tell(part.hint);return;}
    found.add(part.id);selected=null;
    if(!reducedMotion){
      const effect=document.createElement('i');effect.className='goose-ripple';effect.setAttribute('aria-hidden','true');
      effect.style.left=`${point?.x??part.x}%`;effect.style.top=`${point?.y??part.y}%`;picture.append(effect);later(()=>effect.remove(),800);
    }
    complete=found.size===3;update();tell(complete?'三種顏色都回來了！白毛浮綠水，紅掌撥清波。':part.feedback);
    onState?.(state());
    onProgress?.({completed:found.size,total:3});
    if(complete)onComplete?.({correct:true,response:state(),knowledge:'白毛浮綠水，紅掌撥清波。'});
  }
  function partAt(clientX,clientY) {
    const rect=picture.getBoundingClientRect(),x=(clientX-rect.left)/rect.width,y=(clientY-rect.top)/rect.height;
    if(x<0||x>=1||y<0||y>=1)return null;
    const index=(Math.min(255,Math.floor(y*256))*384+Math.min(383,Math.floor(x*384)))*4+3;
    const part=parts.find(part=>(masks.get(part.id)?.[index]||0)>96);
    return part?{part,point:{x:x*100,y:y*100}}:null;
  }
  function click(event) {
    if(dead||suppressClick)return;
    const target=event.target;
    if(target.closest('[data-goose-retry]')){load();return;}
    const color=target.closest('[data-goose-color]')?.dataset.gooseColor;
    if(color){choose(color);return;}
    const id=target.closest('[data-goose-part]')?.dataset.goosePart;
    if(id){paint(parts.find(part=>part.id===id));return;}
    if(target.closest('.goose-picture')){const hit=partAt(event.clientX,event.clientY);if(hit)paint(hit.part,hit.point);else if(ready&&!complete)tell('試試點羽毛、水面，或水下的小腳掌。');}
  }
  function down(event) {
    const button=event.target.closest('[data-goose-color]');
    if(!button||button.disabled||event.button!==0)return;
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,button,moving:false,color:button.dataset.gooseColor};
    button.setPointerCapture?.(event.pointerId);
  }
  function move(event) {
    if(!drag||drag.id!==event.pointerId)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(Math.hypot(dx,dy)>9){drag.moving=true;drag.button.classList.add('is-dragging');drag.button.style.transform=`translate(${dx}px,${dy}px)`;}
  }
  function up(event) {
    if(!drag||drag.id!==event.pointerId)return;
    const current=drag;drag=null;current.button.style.transform='';current.button.classList.remove('is-dragging');
    if(current.moving){suppressClick=true;later(()=>{suppressClick=false;},80);if(event.type==='pointerup'){choose(current.color);const hit=partAt(event.clientX,event.clientY);if(hit)paint(hit.part,hit.point);}}
    if(current.button.hasPointerCapture?.(event.pointerId))current.button.releasePointerCapture(event.pointerId);
  }
  async function load() {
    const generation=++loadGeneration;ready=false;masks.clear();update();
    const notice=q('.goose-loading');notice.hidden=false;notice.querySelector('span').textContent='畫卷正在展開…';notice.querySelector('button').hidden=true;
    try {
      const names=['unpainted',...parts.map(p=>p.id)];
      const loaded=await Promise.all(names.map(name=>new Promise((resolve,reject)=>{
        const img=new Image();let timeout;
        const finish=(error)=>{clearTimeout(timeout);timers.delete(timeout);img.onload=null;img.onerror=null;error?reject(error):resolve([name,img]);};
        img.onload=()=>finish();img.onerror=()=>finish(new Error('goose-image-unavailable'));
        timeout=setTimeout(()=>finish(new Error('goose-image-timeout')),15000);timers.add(timeout);img.src=asset(name);
      })));
      if(dead||generation!==loadGeneration)return;
      const canvas=document.createElement('canvas');canvas.width=384;canvas.height=256;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx)throw new Error('goose-mask-unavailable');
      for(const [name,img] of loaded){
        if(name==='unpainted'){q('.goose-base').src=img.src;continue;}
        q(`[data-goose-layer="${name}"]`).src=img.src;ctx.clearRect(0,0,384,256);ctx.drawImage(img,0,0,384,256);masks.set(name,ctx.getImageData(0,0,384,256).data);
      }
      ready=true;notice.hidden=true;update();if(complete)tell('三種顏色都回來了！白毛浮綠水，紅掌撥清波。');onProgress?.({completed:found.size,total:3});
    } catch {
      if(dead||generation!==loadGeneration)return;
      notice.querySelector('span').textContent='畫卷還沒打開，再試一次吧。';notice.querySelector('button').hidden=false;
      tell('畫卷打開後，就可以替小白鵝上色了。');
    }
  }
  root.addEventListener('click',click,{signal:abort.signal});
  root.addEventListener('pointerdown',down,{signal:abort.signal});
  root.addEventListener('pointermove',move,{signal:abort.signal});
  root.addEventListener('pointerup',up,{signal:abort.signal});
  root.addEventListener('pointercancel',up,{signal:abort.signal});
  load();
  return {
    reset(){if(dead||readOnly)return;found.clear();complete=false;solution=false;selected=null;suppressClick=false;if(drag){drag.button.style.transform='';drag.button.classList.remove('is-dragging');drag=null;}cancelTimers();root.querySelectorAll('.goose-ripple').forEach(el=>el.remove());update();tell('讓詩裏的三種顏色回到畫中。');onState?.(state());onProgress?.({completed:0,total:3});if(!ready)load();},
    showSolution(){if(dead)return;solution=true;selected=null;update();tell('看看詩裏的配色：白毛、紅掌、綠水。');},
    destroy(){if(dead)return;dead=true;loadGeneration++;abort.abort();cancelTimers();masks.clear();root.remove();},
  };
}
