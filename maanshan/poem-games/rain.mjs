const fieldURL=new URL('../media/poem-games/spring-near.webp',import.meta.url).href;
const leaf='<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 28V16C5 17 3 10 4 5c9 0 12 5 12 11C16 6 22 3 29 3c0 9-5 15-13 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const voice='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m10 5-5 4H2v6h3l5 4ZM14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
// Each target is a visible grass shoot in the supplied illustration. Any three
// distinct shoots count; there are no invisible answers or exact-pixel targets.
const shoots=[[4,5],[16,9],[51,5],[79,5],[94,10],[28,20],[13,25],[72,25],[50,31],[66,39],[95,32],[4,48],[31,44],[85,49],[16,61],[59,60],[80,80],[40,85]];
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const knowledge='遠看是一片淡淡的綠意，近看是稀疏的草芽和泥土。「近卻無」不是小草真的消失了。';

export function mountRain(holder,{initialState,readOnly=false,playAudio,onState,onComplete,reducedMotion=false}={}){
 const doc=holder.ownerDocument,view=doc.defaultView,events=new view.AbortController();
 const modern=initialState?.version===3;
 const legacyDone=!modern&&(initialState?.completed===true||initialState?.gameCompleted===true);
 let found=modern&&Array.isArray(initialState.found)?[...new Set(initialState.found.filter(n=>Number.isInteger(n)&&n>=0&&n<shoots.length))].slice(0,3):legacyDone?[12,15,13]:[];
 let done=found.length===3,reported=done,solved=false,dead=false,ready=false,loading=0;
 let x=50,y=55,drag=null,dwell=0,hint=null,loadTimer=0,audioTimer=0,speaking=false,audioGeneration=0;
 const root=doc.createElement('section');root.className='spring-search-game';root.setAttribute('aria-label','雨後尋春');
 if(reducedMotion)root.classList.add('is-reduced-motion');
 root.innerHTML=`<header class="ssg-heading"><h3>找出三株小草</h3><span class="ssg-count" aria-label="找到的小草數量">${[0,1,2].map(()=>`<i>${leaf}</i>`).join('')}</span></header>
 <p class="ssg-task">拖動放大鏡，對準小草停一停。點畫面也可以。</p>
 <div class="ssg-field" tabindex="0" role="group" aria-label="雨後的草地。用手指移動放大鏡；也可按方向鍵移動、空格觀察。" aria-busy="true">
  <img class="ssg-picture" src="${fieldURL}" width="1200" height="800" alt="雨後的泥土間，散落着一株株嫩綠的小草。" draggable="false">
  <div class="ssg-marks" aria-hidden="true"></div><span class="ssg-hint" hidden aria-hidden="true"></span>
  <div class="ssg-lens" aria-hidden="true"><div class="ssg-lens-image"></div><span class="ssg-crosshair"></span><i></i></div>
  <div class="ssg-loading" role="status"><span>春日畫面正在打開…</span><button type="button" data-ssg-retry hidden>再試一次</button></div>
 </div>
 <p class="ssg-status" role="status" aria-live="polite"></p>
 <div class="ssg-actions"><button type="button" data-ssg-listen>${voice}<span>聽詩句</span></button><button type="button" data-ssg-hint>${leaf}<span>給我一點提示</span></button></div>`;
 holder.append(root);const q=s=>root.querySelector(s),field=q('.ssg-field'),lens=q('.ssg-lens');
 const say=t=>{if(!dead)q('.ssg-status').textContent=t;};
 const snapshot=()=>({version:3,found:[...found],completed:done});
 const active=()=>!dead&&ready&&!done&&!solved&&!readOnly;
 function position(){
  const width=field.clientWidth,height=field.clientHeight,size=lens.offsetWidth,zoom=1.8;
  lens.style.left=`${clamp(x/100*width,size/2+3,width-size/2-3)}px`;
  lens.style.top=`${clamp(y/100*height,size/2+3,height-size/2-3)}px`;
  const glass=q('.ssg-lens-image');
  glass.style.backgroundSize=`${width*zoom}px ${height*zoom}px`;
  // Align the magnified point, including its scale, with the lens centre.
  glass.style.backgroundPosition=`${size/2-x/100*width*zoom}px ${size/2-y/100*height*zoom}px`;
 }
 function render(){
  root.classList.toggle('is-done',done||solved);root.classList.toggle('is-readonly',readOnly);
  root.dataset.found=String(found.length);root.dataset.ready=String(ready);
  q('h3').textContent=done||solved?'原來，小草一直都在':`找出三株小草`;
  q('.ssg-task').textContent=done||solved?'近看，小草一株株，泥土也看得見。':'拖動放大鏡，對準小草停一停。點畫面也可以。';
  const visible=solved?[12,15,13]:found;
  q('.ssg-count').setAttribute('aria-label',`找到 ${visible.length} 株，共三株`);
  q('.ssg-count').querySelectorAll('i').forEach((e,i)=>e.classList.toggle('is-found',i<visible.length));
  q('.ssg-marks').innerHTML=visible.map((id,i)=>`<span style="left:${shoots[id][0]}%;top:${shoots[id][1]}%">${i+1}</span>`).join('');
  q('[data-ssg-hint]').hidden=done||solved||readOnly;q('[data-ssg-hint]').disabled=!ready;
  q('[data-ssg-listen]').disabled=!ready||speaking;q('[data-ssg-listen]').setAttribute('aria-busy',String(speaking));
  q('[data-ssg-listen] span').textContent=speaking?'正在朗讀…':'聽詩句';
  lens.hidden=done||solved||readOnly||!ready;
  field.tabIndex=active()?0:-1;position();
 }
 function inspect(){
  view.clearTimeout(dwell);dwell=0;if(!active())return;
  const radius=Math.max(19,Math.min(field.clientWidth,field.clientHeight)*.115);
  const nearest=shoots.map(([sx,sy],id)=>({id,d:Math.hypot((sx-x)/100*field.clientWidth,(sy-y)/100*field.clientHeight)}))
   .filter(p=>!found.includes(p.id)).sort((a,b)=>a.d-b.d)[0];
  if(!nearest||nearest.d>radius){say('再移一移，找嫩綠的葉子。');return;}
  found.push(nearest.id);hint=null;q('.ssg-hint').hidden=true;done=found.length===3;render();
  say(done?'三株都找到了！草芽很稀疏，近處還能看見泥土。':`找到第 ${found.length} 株了！再找一株不一樣的。`);
  onState?.(snapshot());
  if(done&&!reported){reported=true;onComplete?.({correct:true,response:snapshot(),knowledge});}
 }
 function schedule(){view.clearTimeout(dwell);if(active())dwell=view.setTimeout(inspect,380);}
 function point(e){const b=field.getBoundingClientRect();x=clamp((e.clientX-b.left)/b.width*100,2,98);y=clamp((e.clientY-b.top)/b.height*100,2,98);position();schedule();}
 field.addEventListener('pointerdown',e=>{if(!active()||e.button>0||e.isPrimary===false||e.target.closest('button'))return;e.preventDefault();drag=e.pointerId;try{field.setPointerCapture(e.pointerId);}catch{};point(e);},{signal:events.signal});
 field.addEventListener('pointermove',e=>{if(e.pointerId!==drag||!active())return;if(e.cancelable)e.preventDefault();point(e);},{signal:events.signal,passive:false});
 field.addEventListener('pointerup',e=>{if(e.pointerId!==drag)return;drag=null;try{field.releasePointerCapture(e.pointerId);}catch{};schedule();},{signal:events.signal});
 field.addEventListener('pointercancel',()=>{drag=null;view.clearTimeout(dwell);},{signal:events.signal});
 field.addEventListener('contextmenu',e=>e.preventDefault(),{signal:events.signal});
 field.addEventListener('dragstart',e=>e.preventDefault(),{signal:events.signal});
 field.addEventListener('keydown',e=>{
  if(!active())return;const moves={ArrowLeft:[-7,0],ArrowRight:[7,0],ArrowUp:[0,-7],ArrowDown:[0,7]};
  if(moves[e.key]){e.preventDefault();x=clamp(x+moves[e.key][0],2,98);y=clamp(y+moves[e.key][1],2,98);position();schedule();}
  else if(e.key===' '||e.key==='Enter'){e.preventDefault();inspect();}
 },{signal:events.signal});
 q('[data-ssg-hint]').addEventListener('click',()=>{
  if(!active())return;hint=[12,15,13,8,16].find(id=>!found.includes(id));const [hx,hy]=shoots[hint];
  const mark=q('.ssg-hint');mark.style.left=hx+'%';mark.style.top=hy+'%';mark.hidden=false;say('看看發亮的地方，把放大鏡移過去。');
 },{signal:events.signal});
 q('[data-ssg-listen]').addEventListener('click',async()=>{
  if(dead||!ready||speaking)return;const token=++audioGeneration;speaking=true;render();let result;
  try{result=await Promise.race([Promise.resolve(playAudio?.({text:'草色遙看近卻無'})),new Promise(resolve=>{audioTimer=view.setTimeout(()=>resolve(false),35000);})]);}catch{result=false;}finally{view.clearTimeout(audioTimer);}
  if(dead||token!==audioGeneration)return;speaking=false;render();if(result===false)say('聲音暫時未能播放，可以繼續找小草。');
 },{signal:events.signal});
 async function load(){
  const token=++loading;ready=false;q('.ssg-loading').hidden=false;q('[data-ssg-retry]').hidden=true;field.setAttribute('aria-busy','true');render();
  try{
   if(token>1)q('.ssg-picture').src=fieldURL+'?retry='+token;
   await Promise.race([q('.ssg-picture').decode(),new Promise((_,reject)=>{loadTimer=view.setTimeout(()=>reject(new Error('Image timeout')),12000);})]);
   if(dead||token!==loading)return;q('.ssg-lens-image').style.backgroundImage=`url("${q('.ssg-picture').src}")`;ready=true;q('.ssg-loading').hidden=true;field.setAttribute('aria-busy','false');render();
  }catch{if(dead||token!==loading)return;q('.ssg-loading span').textContent='畫面暫時未載入。';q('[data-ssg-retry]').hidden=false;field.setAttribute('aria-busy','false');}
  finally{view.clearTimeout(loadTimer);}
 }
 q('[data-ssg-retry]').addEventListener('click',()=>void load(),{signal:events.signal});
 const resize=new view.ResizeObserver(position);resize.observe(field);
 say(done?'你的小發現已經收好了。':'找嫩綠的小草，不用趕時間。');render();void load();
 return {showSolution(){if(dead)return;solved=true;view.clearTimeout(dwell);q('.ssg-hint').hidden=true;render();say(knowledge);},destroy(){dead=true;loading++;audioGeneration++;view.clearTimeout(loadTimer);view.clearTimeout(audioTimer);view.clearTimeout(dwell);events.abort();resize.disconnect();root.remove();}};
}
