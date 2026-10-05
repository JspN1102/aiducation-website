import {createGameImageLoader} from './image-ready.mjs?v=20260922-school11';
import {imageAsset} from '../media-images.mjs?v=20261005-school41';
import {createProcessResearch} from './research.mjs?v=20260920a';
const file = path => new URL(imageAsset(`media/${path}`), import.meta.url).href;
const LINES = ['頭上紅冠不用裁','滿身雪白走將來','平生不敢輕言語','一叫千門萬戶開'];
const SPOTS = {
  comb:{name:'紅冠',note:'天生紅紅的，不用裁',line:0,label:'公雞的頭頂',x:36.7,y:13.6,w:10,h:12,cx:42.2,cy:4.2,unfound:'頭上',ask:'紅紅的是甚麼？',
    tell:'頭上紅冠不用裁：雞冠天生就是紅的，不用剪裁。',thumb:'34.9% 4%/800% auto'},
  feather:{name:'雪白',note:'羽毛像雪一樣白',line:1,label:'公雞的羽毛',x:31.5,y:48,w:17,h:30,cx:44.6,cy:42,unfound:'身上',ask:'羽毛甚麼顏色？',
    tell:'滿身雪白走將來：羽毛像雪一樣白，大公雞走過來了。',thumb:'26% 44%/400% auto'}
};
const DOORS = [[6,43.8,7.6,42],[33.5,49.1,6.9,37.9],[61.1,46.8,7.1,39.8],[86.9,47.3,7.5,40.2]];
const LIGHTS = [[57.5,61,10],[69.4,63.5,8],[80.6,64.4,7],[72.5,81.5,7]];
const BRIGHT = 80, BANDS = ['夜深了，村子還在睡覺。','東方慢慢發白了，再亮一點。','天亮了！公雞準備好了。'];
const KNOW = '公雞頭戴紅冠、全身雪白；牠平時不隨便叫，一叫天就亮了，千家萬戶都打開門。';
const MISS = {head:'這是公雞的嘴巴和下巴。紅冠長在頭頂上，往上看看。',legs:'這是公雞的腳。看看牠頭上和身上吧。',scene:'點一點畫中的大公雞。'};
const RING = 'M80 17C97 33 95 70 66 86C40 99 8 84 6 56C4 28 30 6 58 8C70 9 82 14 89 23';
const inEllipse = (x,y,cx,cy,rx,ry) => ((x-cx)/rx)**2+((y-cy)/ry)**2<=1;
function region(x,y){
  if(inEllipse(x,y,36.7,13.4,4.6,5))return 'comb';
  if(x>=36.5&&x<=42&&y>=17.6&&y<=29.5)return 'head';
  if((x>=31.5&&x<=42.6&&y>=16&&y<=42)||inEllipse(x,y,32.5,49,10.5,19.5)||inEllipse(x,y,14,42,12.8,23))return 'feather';
  if(x>=23&&x<=42.5&&y>=66&&y<=92)return 'legs';
  return 'scene';
}

/** 雄雞報曉: find the red comb and white feathers, raise the sun, then crow to open the village doors. */
export function mountRooster(holder,{initialState,readOnly=false,playAudio,onState,onComplete,onResearch,reducedMotion=false,onProgress}={}){
  const doc=holder.ownerDocument,view=doc.defaultView,abort=new view.AbortController(),signal=abort.signal;
  const loadImages=createGameImageLoader({signal,timeout:15000});
  const init=initialState&&typeof initialState==='object'&&!Array.isArray(initialState)&&initialState.version===1?initialState:{};
  const found=new Set(Array.isArray(init.found)?init.found.filter(id=>typeof id==='string'&&Object.hasOwn(SPOTS,id)):[]);
  let dawn=Number.isFinite(init.dawn)?Math.max(0,Math.min(100,Math.round(init.dawn/5)*5)):0;
  let crowed=init.crowed===true&&found.size===2;if(crowed)dawn=Math.max(dawn,BRIGHT);
  let opened=crowed&&Number.isInteger(init.opened)?Math.max(0,Math.min(4,init.opened)):0;
  let advanced=found.size===2,ready=false,solution=false,dead=false,loadId=0,misses=0,drag=null,saveTimer=0,audio=null,reported=crowed&&opened===4,pulled=dawn>0,lastProgress=-1;
  const played=new Set(),timers=new Set();
  const research=createProcessResearch(onResearch,{prefix:'game.rooster',alive:()=>!dead});
  const root=doc.createElement('section');
  root.className=`poem-rooster-game${reducedMotion?' is-reduced':''}`;root.setAttribute('aria-label','雄雞報曉：畫雞小遊戲');
  root.innerHTML=`<div class="rr-head"><p class="rr-instruction"></p><span class="rr-progress"></span></div>
    <div class="rr-stage" role="group" aria-label="畫中的大公雞" aria-busy="true">
      <img class="rr-scene rr-night" data-src="${file('hua-ji/scene-3.webp')}" alt="天還沒亮，公雞靜靜地站在山坡上。" width="1600" height="900" draggable="false">
      <img class="rr-scene rr-sky" data-src="${file('hua-ji/scene-4.webp')}" alt="" aria-hidden="true" width="1600" height="900" draggable="false">
      <i class="rr-layer rr-warm"></i><i class="rr-layer rr-dark"></i><i class="rr-layer rr-stars"></i><i class="rr-moon"></i>
      <span class="rr-sunclip" aria-hidden="true"><i class="rr-sun"></i></span><i class="rr-glow"></i>
      <img class="rr-scene rr-day" src="${file('hua-ji/scene-2.webp')}" fetchpriority="high" alt="一隻雪白的大公雞，頭上有紅紅的雞冠。" width="1600" height="900" draggable="false">
      <img class="rr-scene rr-dawn" data-src="${file('hua-ji/scene-4.webp')}" alt="太陽升起，公雞高聲啼叫，村子亮起來了。" width="1600" height="900" draggable="false">
      ${LIGHTS.map(([x,y,s],i)=>`<i class="rr-light" data-light="${i}" style="--x:${x}%;--y:${y}%;--s:${s}%"></i>`).join('')}
      <svg class="rr-rings" viewBox="0 0 60 60" aria-hidden="true"><path d="M8 24Q16 30 8 38"/><path d="M20 16Q32 30 20 46"/><path d="M33 8Q49 30 33 54"/></svg>
      <span class="rr-hush" aria-hidden="true"><b>…</b></span>
      <span class="rr-sunzone" aria-hidden="true"><span class="rr-pull"><i></i>往上拉太陽</span></span>
      ${Object.entries(SPOTS).map(([id,s])=>`<button type="button" class="rr-spot" data-rr-spot="${id}" style="--x:${s.x}%;--y:${s.y}%;--w:${s.w}%;--h:${s.h}%" aria-label="${s.label}"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${RING}" pathLength="1"/></svg></button>`).join('')}
      ${Object.entries(SPOTS).map(([id,s])=>`<span class="rr-chip" data-rr-chip="${id}" style="--x:${s.cx}%;--y:${s.cy}%" aria-hidden="true"><b>${s.name}</b><small>${s.note}</small></span>`).join('')}
      <span class="rr-caption" aria-hidden="true">一叫千門萬戶開</span>
      <div class="rr-loading" role="status"><span>畫卷正在展開…</span><button type="button" data-rr-retry hidden>再試一次</button></div>
    </div>
    <p class="rr-feedback" role="status" aria-live="polite"></p>
    <div class="rr-panel">
      <ul class="rr-clues">${Object.entries(SPOTS).map(([id,s])=>`<li class="rr-clue" data-rr-clue="${id}"><i class="rr-thumb" style="--thumb:${s.thumb}" aria-hidden="true"></i><span><b></b><small></small></span></li>`).join('')}</ul>
      <button type="button" class="rr-next" data-rr-next>下一步：等天亮</button>
      <div class="rr-skybar"><button type="button" class="rr-step is-moon" data-rr-step="-25" aria-label="天暗一點"><i></i></button>
        <input class="rr-range" type="range" min="0" max="100" step="5" value="0" aria-label="太陽升起：向右拉，天就亮">
        <button type="button" class="rr-step is-sun" data-rr-step="25" aria-label="天亮一點"><i></i></button></div>
      <button type="button" class="rr-crow" data-rr-crow><span>喔喔喔</span><small>公雞叫一聲</small></button>
      <div class="rr-lane" role="img"><div class="rr-lane-art"><img class="rr-lane-img" data-src="${file('hua-ji/game/lane.webp')}" alt="" width="900" height="280" draggable="false">
        ${DOORS.map(([x,y,w,h],i)=>`<span class="rr-door" data-rr-door="${i}" style="--x:${x}%;--y:${y}%;--w:${w}%;--h:${h}%;--i:${i}"><b class="rr-spill"></b><i class="rr-leaf is-l"></i><i class="rr-leaf is-r"></i></span>`).join('')}</div>
        <img class="rr-door-src" data-src="${file('hua-ji/game/door.webp')}" alt="" width="360" height="595" hidden></div>
    </div>
    <div class="rr-actionline"><span class="rr-method"></span><button type="button" class="rr-audio" data-rr-audio>聽這句詩</button></div>`;
  holder.append(root);
  const q=s=>root.querySelector(s),qa=s=>[...root.querySelectorAll(s)],stage=q('.rr-stage'),range=q('.rr-range');
  const tell=text=>{q('.rr-feedback').textContent=text;};
  const later=(fn,ms)=>{const id=view.setTimeout(()=>{timers.delete(id);if(!dead)fn();},ms);timers.add(id);return id;};
  const clearTimers=()=>{timers.forEach(id=>view.clearTimeout(id));timers.clear();saveTimer=0;};
  const state=()=>({version:1,found:[...found],dawn,crowed,opened});
  const full=()=>solution||readOnly;
  const phase=()=>full()||crowed?'open':found.size===2&&advanced?'dawn':'look';
  const band=v=>v>=BRIGHT?2:v>=35?1:0;
  const can=p=>!dead&&ready&&!full()&&phase()===p;
  function save(){if(saveTimer){view.clearTimeout(saveTimer);timers.delete(saveTimer);saveTimer=0;}if(!readOnly&&!dead)onState?.(state());}
  const queueSave=()=>{if(!saveTimer)saveTimer=later(()=>{saveTimer=0;save();},300);};
  function tone(notes){try{audio??=new(view.AudioContext||view.webkitAudioContext)();if(audio.state==='suspended')void audio.resume().catch(()=>{});const now=audio.currentTime;
    for(const [f0,f1,at,dur,vol,type='sine',band]of notes){const osc=audio.createOscillator(),gain=audio.createGain();osc.type=type;osc.frequency.setValueAtTime(f0,now+at);osc.frequency.exponentialRampToValueAtTime(f1,now+at+dur);
      gain.gain.setValueAtTime(.0001,now+at);gain.gain.exponentialRampToValueAtTime(vol,now+at+.02);gain.gain.exponentialRampToValueAtTime(.0001,now+at+dur);osc.connect(gain);
      if(band){const filter=audio.createBiquadFilter();filter.type='bandpass';filter.frequency.value=band;filter.Q.value=1.3;gain.connect(filter);filter.connect(audio.destination);}else gain.connect(audio.destination);
      osc.start(now+at);osc.stop(now+at+dur+.03);}}catch{}}
  const ding=()=>tone([[880,1320,0,.22,.15],[1320,1760,.1,.3,.09]]),soft=()=>tone([[300,190,0,.2,.1]]);
  const knock=()=>tone([[430,170,0,.09,.14,'triangle'],[390,150,.13,.08,.1,'triangle']]);
  const crowSound=()=>tone([[520,690,0,.16,.08,'sawtooth',1300],[610,760,.19,.14,.08,'sawtooth',1300],[680,820,.36,.14,.08,'sawtooth',1300],[800,560,.55,.7,.09,'sawtooth',1300]]);
  const hushSound=()=>tone([[392,370,0,.16,.07,'triangle'],[330,300,.2,.24,.06,'triangle']]);
  function say(text,asked){Promise.resolve().then(()=>playAudio?.({text})).then(ok=>{if(ok===false)research.error('audio','audio_unavailable');}).catch(()=>{research.error('audio','audio_unavailable');if(!dead&&asked)tell('聲音暫時未能播放，稍後再試。');});}
  const sayOnce=i=>{if(played.has(i)||full())return;played.add(i);say(LINES[i]);};
  const currentLine=()=>({look:found.has('comb')?1:0,dawn:2,open:3})[phase()];
  const progress=()=>full()?4:found.size+(dawn>=BRIGHT||crowed?1:0)+(crowed&&opened===4?1:0);

  function render(){
    const p=phase(),shownDawn=full()?100:dawn,shownOpened=full()?4:opened,bright=shownDawn>=BRIGHT,done=full()||crowed&&opened===4,n=progress();
    root.classList.toggle('is-look',p==='look');root.classList.toggle('is-dawn',p==='dawn');root.classList.toggle('is-open',p==='open');
    root.classList.toggle('is-bright',bright);root.classList.toggle('is-done',done);root.classList.toggle('is-readonly',readOnly);root.classList.toggle('is-solution',solution);
    root.style.setProperty('--d',String(shownDawn/100));
    const ask=p==='look'?['找找公雞的紅冠','和雪白羽毛。']:p==='open'?['一叫千門萬戶開！']:bright?['天亮了！','按「喔喔喔」叫一聲。']:['拉動太陽，','讓天亮起來。'],ins=q('.rr-instruction');
    if(ins.textContent!==ask.join(''))ins.replaceChildren(...ask.map(t=>Object.assign(doc.createElement('span'),{textContent:t})));
    q('.rr-progress').textContent=`${n} / 4`;q('.rr-progress').setAttribute('aria-label',`完成 ${n} 步，共 4 步`);
    q('.rr-method').textContent=p==='look'?'點一點畫中的公雞。':p==='open'?(done?'聽聽最後一句詩。':'看，家家戶戶打開門了。'):bright?'天亮了，公雞可以叫了。':'拉動太陽，也可按左右鍵。';
    for(const [id,s] of Object.entries(SPOTS)){
      const has=full()||found.has(id),spot=q(`[data-rr-spot="${id}"]`),clue=q(`[data-rr-clue="${id}"]`);
      spot.hidden=p!=='look';spot.disabled=!ready||full();spot.classList.toggle('is-found',has);spot.setAttribute('aria-label',has?`${s.label}：${s.name}，已找到`:s.label);
      q(`[data-rr-chip="${id}"]`).classList.toggle('is-on',p==='look'&&has);
      clue.classList.toggle('is-found',has);clue.querySelector('b').textContent=has?s.name:s.unfound;clue.querySelector('small').textContent=has?LINES[s.line]:s.ask;
    }
    q('.rr-clues').hidden=p!=='look';q('[data-rr-next]').hidden=!(p==='look'&&found.size===2);q('[data-rr-next]').disabled=!ready;
    q('.rr-skybar').hidden=q('[data-rr-crow]').hidden=p!=='dawn';q('.rr-lane').hidden=p==='look';
    range.value=String(shownDawn);range.disabled=!ready||p!=='dawn';range.setAttribute('aria-valuetext',`${shownDawn}%，${['深夜','天快亮了','天亮了'][band(shownDawn)]}`);
    qa('.rr-step').forEach(b=>{b.disabled=!ready||p!=='dawn'||(b.dataset.rrStep<0?dawn<=0:dawn>=100);});q('[data-rr-crow]').disabled=!ready||p!=='dawn';
    q('.rr-pull').hidden=pulled||p!=='dawn';
    qa('[data-rr-door]').forEach((d,i)=>d.classList.toggle('is-open',i<shownOpened));qa('[data-light]').forEach((l,i)=>l.classList.toggle('is-on',i<shownOpened));
    q('.rr-lane').setAttribute('aria-label',`村子的四道門，已打開 ${shownOpened} 道`);
    if(n!==lastProgress){lastProgress=n;if(!readOnly)onProgress?.({completed:n,total:4});}
  }
  function find(id){
    if(!can('look'))return;
    if(Object.hasOwn(SPOTS,id)){
      if(found.has(id)){tell(found.size===2?'兩樣都找到了！按「下一步：等天亮」。':`${SPOTS[id].name}找到了，再找找另一樣。`);return;}
      found.add(id);misses=0;research.answer('find',id,true);ding();qa('.rr-spot').forEach(b=>b.classList.remove('is-hint'));
      tell(SPOTS[id].tell+(found.size===2?'兩樣都找到了！':''));render();save();sayOnce(SPOTS[id].line);return;
    }
    research.answer('find',id,false);soft();misses++;
    const next=found.has('comb')?'feather':'comb';
    tell(id==='head'&&found.has('comb')?'這是嘴巴和下巴。再看看牠身上的羽毛。':MISS[id]||MISS.scene);
    if(misses>=2){q(`[data-rr-spot="${next}"]`).classList.add('is-hint');research.hint('find');}
  }
  function advance(){if(!can('look')||found.size<2)return;advanced=true;research.action('find','next');tell('天黑了，公雞靜靜地等着。'+BANDS[0]);render();void load(false);later(()=>range.focus({preventScroll:true}),50);}
  function setDawn(value){
    if(!can('dawn'))return;
    const v=Math.max(0,Math.min(100,Math.round(value/5)*5));if(v===dawn)return;
    const before=band(dawn);dawn=v;pulled=true;
    if(band(v)!==before){research.action('dawn',`band-${band(v)}`);tell(BANDS[band(v)]);if(band(v)===2&&!played.has('bright')){played.add('bright');research.answer('dawn','bright',true);ding();}}
    render();queueSave();
  }
  function crow(){
    if(!can('dawn'))return;
    if(dawn<BRIGHT){
      research.answer('crow','dark',false);research.hint('crow');hushSound();tell('天還沒亮，公雞平生不敢輕易叫。先讓太陽升起來吧。');
      const hush=q('.rr-hush');hush.classList.remove('is-on');void hush.offsetWidth;hush.classList.add('is-on');later(()=>hush.classList.remove('is-on'),1800);sayOnce(2);return;
    }
    research.answer('crow','dawn',true);crowed=true;crowSound();save();
    root.classList.add('is-crowing');later(()=>root.classList.remove('is-crowing'),reducedMotion?900:2600);
    tell('喔喔喔！公雞一叫，天亮了，家家戶戶都打開門。');render();q('.rr-audio').focus({preventScroll:true});
    if(reducedMotion)sayOnce(3);else later(()=>sayOnce(3),1100);
    openDoors();
  }
  function openDoors(){
    const step=()=>{if(solution||opened>=4)return;opened++;knock();render();if(opened<4)later(step,600);else finish();};
    if(opened>=4){finish();return;}
    if(reducedMotion){opened=4;render();finish();}else later(step,opened?300:1300);
  }
  function finish(){
    save();if(reported||solution||readOnly)return;reported=true;research.complete();tell(KNOW);render();
    onComplete?.({correct:true,response:state(),knowledge:KNOW});
  }
  const need=()=>phase()==='look'?[q('.rr-day')]:qa('img').filter(i=>!i.classList.contains('rr-day'));
  const arm=()=>qa('img[data-src]').forEach(i=>{i.src=i.dataset.src;i.removeAttribute('data-src');});
  async function load(retry){
    if(retry)research.retry('assets');
    const request=++loadId;if(phase()!=='look')arm();
    const list=need(),loading=q('.rr-loading');ready=false;
    loading.hidden=list.every(i=>i.complete&&i.naturalWidth>0);q('.rr-loading span').textContent='畫卷正在展開…';q('[data-rr-retry]').hidden=true;stage.setAttribute('aria-busy','true');render();
    const unavailable=()=>{if(dead||request!==loadId)return;research.error('assets');loading.hidden=false;q('.rr-loading span').textContent='圖片還在載入，可以再試一次。';q('[data-rr-retry]').hidden=false;stage.setAttribute('aria-busy','false');};
    try{
      if(retry)for(const image of qa('img[src]')){const url=new URL(image.src);url.searchParams.set('retry',String(request));image.src=url.href;}
      await loadImages(list,{onTimeout:unavailable});
      if(dead||request!==loadId)return;
      ready=true;loading.hidden=true;stage.setAttribute('aria-busy','false');
      root.style.setProperty('--rr-scene2',`url("${q('.rr-day').src}")`);
      const door=q('.rr-door-src');if(door.src)root.style.setProperty('--rr-door',`url("${door.src}")`);
      render();
      const p=phase();
      if(p==='look'){arm();if(!full())research.present('find');}
      else if(p==='dawn'){research.present('dawn');research.present('crow');}
      else if(crowed&&!full()&&!reported)openDoors();
    }catch{unavailable();}
  }
  function down(event){
    const zone=event.target.closest?.('.rr-sunzone');
    if(!zone||drag||!can('dawn')||event.button>0||event.isPrimary===false)return;
    if(event.cancelable)event.preventDefault();
    drag={id:event.pointerId,y:event.clientY,start:dawn,span:Math.max(80,stage.clientHeight*.55),zone};
    try{zone.setPointerCapture(event.pointerId);}catch{}
  }
  function move(event){if(!drag||event.pointerId!==drag.id)return;if(event.cancelable)event.preventDefault();setDawn(drag.start+(drag.y-event.clientY)/drag.span*100);}
  function up(event){if(!drag||event.pointerId!==drag.id)return;const previous=drag;drag=null;try{previous.zone.releasePointerCapture(previous.id);}catch{}if(!readOnly)queueSave();}
  root.addEventListener('pointerdown',down,{signal});
  root.addEventListener('pointermove',move,{signal,passive:false});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(type,up,{signal});
  root.addEventListener('dragstart',event=>{if(event.cancelable)event.preventDefault();},{signal});
  range.addEventListener('input',()=>setDawn(Number(range.value)),{signal});
  range.addEventListener('change',()=>{if(can('dawn'))save();},{signal});
  root.addEventListener('click',event=>{
    const t=event.target;
    if(t.closest?.('[data-rr-retry]')){void load(true);return;}
    if(t.closest?.('[data-rr-audio]')){research.hint({look:'find',dawn:'crow',open:'crow'}[phase()],'audio');say(LINES[currentLine()],true);return;}
    if(t.closest?.('[data-rr-next]')){advance();return;}
    if(t.closest?.('[data-rr-crow]')){crow();return;}
    const step=t.closest?.('[data-rr-step]');if(step){setDawn(dawn+Number(step.dataset.rrStep));save();if(step.disabled&&can('dawn'))(dawn>=BRIGHT?q('[data-rr-crow]'):range).focus({preventScroll:true});return;}
    const spot=t.closest?.('[data-rr-spot]');if(spot){find(spot.dataset.rrSpot);return;}
    if(t.closest?.('.rr-stage')&&!t.closest('.rr-loading,.rr-sunzone')&&can('look')){
      const box=stage.getBoundingClientRect();if(!box.width)return;
      find(region((event.clientX-box.left)/box.width*100,(event.clientY-box.top)/box.height*100));
    }
  },{signal});
  tell(full()||crowed&&opened===4?KNOW:phase()==='dawn'?(dawn>=BRIGHT?'天亮了！按「喔喔喔」叫一聲。':BANDS[band(dawn)]):phase()==='open'?'公雞叫了，家家戶戶正在開門。':found.size?SPOTS[[...found][0]].tell:'大公雞走過來了！看看牠長得怎樣？');
  render();void load(false);
  return {
    showSolution(){if(dead||solution)return;if(saveTimer)save();research.hint('game','reveal');solution=true;clearTimers();drag=null;root.classList.remove('is-crowing');render();tell(KNOW);void load(false);},
    reset(){
      if(dead||readOnly)return;research.reset();clearTimers();drag=null;found.clear();dawn=0;crowed=false;opened=0;advanced=false;solution=false;reported=false;misses=0;pulled=false;played.clear();
      root.classList.remove('is-crowing');qa('.is-hint').forEach(b=>b.classList.remove('is-hint'));tell('大公雞走過來了！看看牠長得怎樣？');render();onState?.(state());void load(false);
    },
    destroy(){if(dead)return;if(saveTimer)save();dead=true;loadId++;abort.abort();clearTimers();drag=null;try{void audio?.close();}catch{}audio=null;root.remove();}
  };
}
