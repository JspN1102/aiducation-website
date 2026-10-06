import {createGameImageLoader} from './image-ready.mjs?v=20260922-school11';
import {imageAsset} from '../media-images.mjs?v=20261006-school43';
import {createProcessResearch} from './research.mjs?v=20260920a';
const file = path => new URL(imageAsset(`media/${path}`), import.meta.url).href;
const LINES = ['頭上紅冠不用裁','滿身雪白走將來','平生不敢輕言語','一叫千門萬戶開'];
const SPOTS = {
  comb:{name:'紅冠',note:'天生紅紅的，不用裁',line:0,label:'公雞的頭頂',x:36.7,y:17.8,w:10,h:12,top:true,cx:42.2,cy:4.2,unfound:'頭上',ask:'紅紅的是甚麼？',
    tell:'頭上紅冠不用裁：雞冠天生就是紅的，不用剪裁。',thumb:'34.9% 4%/800% auto'},
  feather:{name:'雪白',note:'羽毛像雪一樣白',line:1,label:'公雞的羽毛',x:31.5,y:48,w:17,h:30,cx:44.6,cy:42,unfound:'身上',ask:'羽毛甚麼顏色？',
    tell:'滿身雪白走將來：羽毛像雪一樣白，大公雞昂首闊步走過來了。',thumb:'26% 44%/400% auto'}
};
// Lane art (% of lane.webp): doorways, tap areas for each house, where each little rooster perches (x, feet y, bubble x, bubble y, bubble on the left).
const DOORS = [[6,43.8,7.6,42],[33.5,49.1,6.9,37.9],[61.1,46.8,7.1,39.8],[86.9,47.3,7.5,40.2]];
const HOUSES = [[0,24.5],[24.5,25.5],[50,25.5],[75.5,24.5]];
const PERCH = [[11,14.5,15.5,-9,0],[30,21.5,34.5,-2,0],[63,8.5,58.5,-13,1],[93,17.5,88.5,-7,1]];
const WINDOWS = [[45.2,58.5,1],[56,57.5,2]];
const FOLK = ['老伯伯伸懶腰','小妹妹揮揮手','農夫扛着鋤頭','婆婆提着燈籠'];
const COUNT = ['一門','百門','千門','萬戶'];
const WAKE = ['篤篤！一門開了。屋頂的小公雞也跟着「喔喔」叫！','百門開了！小公雞一隻接一隻地叫。','千門開了！傳說天雞一叫，天下的公雞都跟着叫。','萬戶都開了！雄雞一叫，天下都亮了！'];
const LIGHTS = [[57.5,61,10],[69.4,63.5,8],[80.6,64.4,7],[72.5,81.5,7]]; // % of stage (scene-4 village)
// The walking rooster is cut from scene-2; the plate is the same hillside without him (px of the 1600×900 scene).
const WALK = {plate:[0,56,720,851],cock:[7,88,688,819]};
const box = ([x0,y0,x1,y1]) => `--l:${x0/16}%;--t:${y0/9}%;--bw:${(x1-x0)/16}%;--bh:${(y1-y0)/9}%`;
const BRIGHT = 80, BANDS = ['夜深了，村子還在睡覺。','東方慢慢發白了，再亮一點。','天亮了！公雞準備好了。'];
const KNOW = '公雞頭戴紅冠、全身雪白；牠平時不隨便叫，一叫天就亮了，千家萬戶都打開門。';
const MISS = {head:'這是公雞的嘴巴和下巴。紅冠長在頭頂上，往上看看。',legs:'這是公雞的腳。看看牠頭上和身上吧。',scene:'點一點畫中的大公雞。'};
const RING = 'M80 17C97 33 95 70 66 86C40 99 8 84 6 56C4 28 30 6 58 8C70 9 82 14 89 23';
const inEllipse = (x,y,cx,cy,rx,ry) => ((x-cx)/rx)**2+((y-cy)/ry)**2<=1;
function region(x,y){
  if(inEllipse(x,y,36.7,13.4,4.6,4.6))return 'comb';
  if(x>=36.5&&x<=42&&y>=17.6&&y<=29.5)return 'head';
  if((x>=31.5&&x<=42.6&&y>=16&&y<=42)||inEllipse(x,y,32.5,49,10.5,19.5)||inEllipse(x,y,14,42,12.8,23))return 'feather';
  if(x>=23&&x<=42.5&&y>=66&&y<=92)return 'legs';
  return 'scene';
}
/** Accepts the current v2 state and v1 states (v1 opened its doors by itself, so `opened` becomes the first n doors). */
function restore(raw){
  const init=raw&&typeof raw==='object'&&!Array.isArray(raw)&&(raw.version===1||raw.version===2)?raw:{};
  const found=new Set(Array.isArray(init.found)?init.found.filter(id=>typeof id==='string'&&Object.hasOwn(SPOTS,id)):[]);
  let dawn=Number.isFinite(init.dawn)?Math.max(0,Math.min(100,Math.round(init.dawn/5)*5)):0;
  const crowed=init.crowed===true&&found.size===2;if(crowed)dawn=Math.max(dawn,BRIGHT);
  const list=init.version===2?(Array.isArray(init.doors)?init.doors:[]):Number.isInteger(init.opened)?[0,1,2,3].slice(0,Math.max(0,Math.min(4,init.opened))):[];
  const doors=new Set(crowed?list.filter(i=>Number.isInteger(i)&&i>=0&&i<4):[]);
  return {found,dawn,crowed,doors};
}

/** 雄雞報曉: find the red comb and white feathers, raise the sun, crow, then knock on every door to wake the village. */
export function mountRooster(holder,{initialState,readOnly=false,playAudio,onState,onComplete,onResearch,reducedMotion=false,onProgress}={}){
  const doc=holder.ownerDocument,view=doc.defaultView,abort=new view.AbortController(),signal=abort.signal;
  const loadImages=createGameImageLoader({signal,timeout:15000});
  const init=restore(initialState),found=init.found,doors=init.doors;
  let dawn=init.dawn,crowed=init.crowed;
  let advanced=found.size===2,ready=false,solution=false,dead=false,loadId=0,misses=0,refusals=0,drag=null,saveTimer=0,audio=null,reported=crowed&&doors.size===4,pulled=dawn>0,lastProgress=-1;
  let newest=-1,strut='',strutTimer=0,introWanted=!readOnly&&!found.size&&!crowed;
  const played=new Set(),timers=new Set(),ooTimers=[];
  const research=createProcessResearch(onResearch,{prefix:'game.rooster',alive:()=>!dead});
  const lookFirst=!readOnly&&!advanced&&!crowed,walkSrc=lookFirst?'src':'data-src';
  const root=doc.createElement('section');
  root.className=`poem-rooster-game${reducedMotion?' is-reduced':''}`;root.setAttribute('aria-label','雄雞報曉：畫雞小遊戲');
  root.innerHTML=`<div class="rr-head"><p class="rr-instruction"></p><span class="rr-progress"></span></div>
    <div class="rr-stage" role="group" aria-label="畫中的大公雞" aria-busy="true">
      <img class="rr-scene rr-night" data-src="${file('hua-ji/scene-3.webp')}" alt="天還沒亮，公雞靜靜地站在山坡上。" width="1600" height="900" draggable="false">
      <i class="rr-nhole" aria-hidden="true"></i><i class="rr-nhead" aria-hidden="true"></i>
      <img class="rr-scene rr-sky" data-src="${file('hua-ji/scene-4.webp')}" alt="" aria-hidden="true" width="1600" height="900" draggable="false">
      <i class="rr-layer rr-warm"></i><i class="rr-layer rr-dark"></i><i class="rr-layer rr-stars"></i><i class="rr-moon"></i>
      <span class="rr-sunclip" aria-hidden="true"><i class="rr-sun"></i></span><i class="rr-glow"></i>
      <img class="rr-scene rr-day" src="${file('hua-ji/scene-2.webp')}" fetchpriority="high" alt="一隻雪白的大公雞，頭上有紅紅的雞冠。" width="1600" height="900" draggable="false">
      <img class="rr-walk rr-plate rr-extra" ${walkSrc}="${file('hua-ji/game/rooster-plate.webp')}" style="${box(WALK.plate)}" alt="" aria-hidden="true" width="540" height="596" draggable="false">
      <img class="rr-walk rr-cock rr-extra" ${walkSrc}="${file('hua-ji/game/rooster-walk.webp')}" style="${box(WALK.cock)}" alt="" aria-hidden="true" width="511" height="548" draggable="false">
      <img class="rr-scene rr-dawn" data-src="${file('hua-ji/scene-4.webp')}" alt="太陽升起，公雞高聲啼叫，村子亮起來了。" width="1600" height="900" draggable="false">
      <i class="rr-layer rr-veil"></i>
      ${LIGHTS.map(([x,y,s],i)=>`<i class="rr-light" data-light="${i}" style="--x:${x}%;--y:${y}%;--s:${s}%"></i>`).join('')}
      <svg class="rr-rings" viewBox="0 0 60 60" aria-hidden="true"><path d="M8 24Q16 30 8 38"/><path d="M20 16Q32 30 20 46"/><path d="M33 8Q49 30 33 54"/></svg>
      <svg class="rr-shakes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M14 30Q6 44 12 58"/><path d="M6 24Q-4 44 4 64"/><path d="M78 34Q85 46 81 60"/><path d="M86 28Q95 46 89 66"/></svg>
      <span class="rr-hush" aria-hidden="true"><b>天還沒亮，</b><b>我不隨便叫！</b></span>
      <i class="rr-tap" aria-hidden="true"></i>
      <span class="rr-sunzone" aria-hidden="true"><span class="rr-pull"><i></i>往上拉太陽</span></span>
      ${Object.entries(SPOTS).map(([id,s])=>`<button type="button" class="rr-spot${s.top?' is-top':''}" data-rr-spot="${id}" style="--x:${s.x}%;--y:${s.y}%;--w:${s.w}%;--h:${s.h}%" aria-label="${s.label}"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${RING}" pathLength="1"/></svg></button>`).join('')}
      ${Object.entries(SPOTS).map(([id,s])=>`<span class="rr-chip" data-rr-chip="${id}" style="--x:${s.cx}%;--y:${s.cy}%" aria-hidden="true"><b>${s.name}</b><small>${s.note}</small></span>`).join('')}
      <span class="rr-caption" aria-hidden="true"><b>雄雞一叫，天下都亮了！</b><small>一叫千門萬戶開</small></span>
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
      <div class="rr-lane" role="group"><div class="rr-lane-art"><img class="rr-lane-img" data-src="${file('hua-ji/game/lane.webp')}" alt="" width="900" height="280" draggable="false">
        ${WINDOWS.map(([x,y,h])=>`<i class="rr-win" data-house="${h}" style="--x:${x}%;--y:${y}%"></i>`).join('')}
        ${DOORS.map(([x,y,w,h],i)=>`<span class="rr-door" data-rr-door="${i}" style="--x:${x}%;--y:${y}%;--w:${w}%;--h:${h}%;--i:${i}"><b class="rr-spill"></b><i class="rr-folk" style="--f:${i}"></i><i class="rr-leaf is-l"></i><i class="rr-leaf is-r"></i></span>`).join('')}
        ${PERCH.map(([x,y,,,left],i)=>`<span class="rr-perch" style="--x:${x}%;--y:${y}%;--k:${left?1:-1}"><span class="rr-hop"><i class="rr-chick" style="--f:${i}"></i></span></span>`).join('')}
        ${PERCH.map(([,,x,y,left],i)=>`<b class="rr-oo${left?' is-left':''}" data-oo="${i}" style="--x:${x}%;--y:${y}%" aria-hidden="true">喔喔！</b>`).join('')}
        ${HOUSES.map(([x,w],i)=>`<button type="button" class="rr-house" data-rr-house="${i}" style="--x:${x}%;--w:${w}%"></button>`).join('')}</div>
        <img class="rr-src" data-var="--rr-door" data-src="${file('hua-ji/game/door.webp')}" alt="" width="360" height="595" hidden>
        <img class="rr-src rr-extra" data-var="--rr-folk" data-src="${file('hua-ji/game/villagers.webp')}" alt="" width="496" height="220" hidden>
        <img class="rr-src rr-extra" data-var="--rr-chick" data-src="${file('hua-ji/game/roosters.webp')}" alt="" width="532" height="150" hidden>
        <img class="rr-src rr-extra" data-var="--rr-nhead" data-src="${file('hua-ji/game/night-head.webp')}" alt="" width="322" height="161" hidden></div>
      <ol class="rr-count" aria-hidden="true">${COUNT.map(t=>`<li>${t}</li>`).join('')}</ol>
    </div>
    <div class="rr-actionline"><span class="rr-method"></span><button type="button" class="rr-audio" data-rr-audio>聽這句詩</button></div>`;
  holder.append(root);
  const q=s=>root.querySelector(s),qa=s=>[...root.querySelectorAll(s)],stage=q('.rr-stage'),range=q('.rr-range'),cock=q('.rr-cock'),houses=qa('[data-rr-house]');
  const tell=text=>{q('.rr-feedback').textContent=text;};
  const later=(fn,ms)=>{const id=view.setTimeout(()=>{timers.delete(id);if(!dead)fn();},ms);timers.add(id);return id;};
  const clearTimers=()=>{timers.forEach(id=>view.clearTimeout(id));timers.clear();saveTimer=0;strutTimer=0;};
  const state=()=>({version:2,found:[...found],dawn,crowed,doors:[...doors].sort((a,b)=>a-b)});
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
  const PITCH=[1,1.12,.94,1.22],chickSound=(k,at=0)=>tone([[760*k,980*k,at,.11,.05,'sawtooth',2000],[900*k,700*k,at+.14,.36,.05,'sawtooth',2000]]);
  const hushSound=()=>tone([[392,370,0,.16,.07,'triangle'],[330,300,.2,.24,.06,'triangle']]);
  function say(text,asked){Promise.resolve().then(()=>playAudio?.({text})).then(ok=>{if(ok===false)research.error('audio','audio_unavailable');}).catch(()=>{research.error('audio','audio_unavailable');if(!dead&&asked)tell('聲音暫時未能播放，稍後再試。');});}
  const sayOnce=i=>{if(played.has(i)||full())return;played.add(i);say(LINES[i]);};
  const currentLine=()=>({look:found.has('comb')?1:0,dawn:2,open:3})[phase()];
  const progress=()=>full()?4:found.size+(dawn>=BRIGHT||crowed?1:0)+(crowed&&doors.size===4?1:0);
  const restart=(el,cls)=>{el.classList.remove(cls);void el.offsetWidth;el.classList.add(cls);};

  function render(){
    const p=phase(),shownDawn=full()?100:dawn,open=full()?new Set([0,1,2,3]):doors,bright=shownDawn>=BRIGHT,done=full()||crowed&&doors.size===4,n=progress();
    root.classList.toggle('is-look',p==='look');root.classList.toggle('is-dawn',p==='dawn');root.classList.toggle('is-open',p==='open');
    root.classList.toggle('is-bright',bright);root.classList.toggle('is-done',done);root.classList.toggle('is-readonly',readOnly);root.classList.toggle('is-solution',solution);
    root.style.setProperty('--d',String(shownDawn/100));root.style.setProperty('--o',String(open.size/4));
    const ask=p==='look'?['找找公雞的紅冠','和雪白羽毛。']:p==='open'?(done?['雄雞一叫，','天下都亮了！']:['點一點每道門，','叫醒全村！']):bright?['天亮了！','按「喔喔喔」叫一聲。']:['拉動太陽，','讓天亮起來。'],ins=q('.rr-instruction');
    if(ins.textContent!==ask.join(''))ins.replaceChildren(...ask.map(t=>Object.assign(doc.createElement('span'),{textContent:t})));
    q('.rr-progress').textContent=`${n} / 4`;q('.rr-progress').setAttribute('aria-label',`完成 ${n} 步，共 4 步`);
    q('.rr-method').textContent=p==='look'?'點一點畫中的公雞。':p==='open'?(done?'聽聽最後一句詩。':`還有 ${4-open.size} 戶未開門。`):bright?'天亮了，公雞可以叫了。':'拉動太陽，也可按左右鍵。';
    for(const [id,s] of Object.entries(SPOTS)){
      const has=full()||found.has(id),spot=q(`[data-rr-spot="${id}"]`),clue=q(`[data-rr-clue="${id}"]`);
      spot.hidden=p!=='look';spot.disabled=!ready||full();spot.classList.toggle('is-found',has);spot.setAttribute('aria-label',has?`${s.label}：${s.name}，已找到`:s.label);
      q(`[data-rr-chip="${id}"]`).classList.toggle('is-on',p==='look'&&has);
      clue.classList.toggle('is-found',has);clue.querySelector('b').textContent=has?s.name:s.unfound;clue.querySelector('small').textContent=has?LINES[s.line]:s.ask;
    }
    q('.rr-clues').hidden=p!=='look';const next=q('[data-rr-next]');next.hidden=p!=='look';next.disabled=!ready;next.classList.toggle('is-wait',found.size<2);if(found.size<2)next.setAttribute('aria-disabled','true');else next.removeAttribute('aria-disabled');
    q('.rr-skybar').hidden=q('[data-rr-crow]').hidden=p!=='dawn';q('.rr-lane').hidden=p==='look';q('.rr-count').hidden=p!=='open';
    range.value=String(shownDawn);range.disabled=!ready||p!=='dawn';range.setAttribute('aria-valuetext',`${shownDawn}%，${['深夜','天快亮了','天亮了'][band(shownDawn)]}`);
    qa('.rr-step').forEach(b=>{b.disabled=!ready||p!=='dawn'||(b.dataset.rrStep<0?dawn<=0:dawn>=100);});q('[data-rr-crow]').disabled=!ready||p!=='dawn';
    q('.rr-pull').hidden=pulled||p!=='dawn';
    qa('[data-rr-door]').forEach((d,i)=>{d.classList.toggle('is-open',open.has(i));d.classList.toggle('is-new',open.has(i)&&i===newest);});
    qa('.rr-perch').forEach((perch,i)=>perch.classList.toggle('is-on',open.has(i)));
    qa('.rr-win').forEach(w=>w.classList.toggle('is-on',open.has(Number(w.dataset.house))));
    qa('[data-light]').forEach((l,i)=>l.classList.toggle('is-on',open.has(i)));
    houses.forEach((b,i)=>{b.disabled=!ready||readOnly||p!=='open';b.setAttribute('aria-label',open.has(i)?`第${i+1}戶：門開了，${FOLK[i]}。再聽小公雞叫`:`第${i+1}戶：敲門`);});
    qa('.rr-count li').forEach((li,i)=>{li.classList.toggle('is-on',i<open.size);li.classList.toggle('is-new',newest>=0&&!full()&&i===doors.size-1);});
    q('.rr-lane').setAttribute('aria-label',`村子的四戶人家，已打開 ${open.size} 道門`);
    if(n!==lastProgress){lastProgress=n;if(!readOnly)onProgress?.({completed:n,total:4});}
  }
  const walkReady=()=>[q('.rr-plate'),cock].every(i=>i.complete&&i.naturalWidth>0);
  function endStrut(){
    if(strutTimer){view.clearTimeout(strutTimer);timers.delete(strutTimer);strutTimer=0;}
    if(!strut)return;strut='';root.classList.remove('is-strut','is-strut-in','is-strut-show');
  }
  /** 走將來: 'in' walks the rooster onto the hillside; 'show' is a short proud strut where he stands. */
  function startStrut(kind){
    if(reducedMotion||dead||phase()!=='look'||!walkReady())return;
    endStrut();strut=kind;void cock.offsetWidth;root.classList.add('is-strut',`is-strut-${kind}`);
    strutTimer=later(endStrut,kind==='in'?3400:1800);
  }
  function find(id){
    if(!can('look'))return;
    if(Object.hasOwn(SPOTS,id)){
      if(found.has(id)){
        if(found.size===2){research.action('find','strut');startStrut('show');tell('大公雞昂首闊步，好神氣！按「下一步：等天亮」。');}
        else tell(`${SPOTS[id].name}找到了，再找找另一樣。`);
        return;
      }
      found.add(id);misses=0;research.answer('find',id,true);ding();qa('.rr-spot').forEach(b=>b.classList.remove('is-hint'));
      tell(SPOTS[id].tell+(found.size===2?'兩樣都找到了！':''));render();save();sayOnce(SPOTS[id].line);
      if(id==='feather')startStrut('show');
      return;
    }
    if(found.size===2){if(id==='scene'){tell('兩樣都找到了！按「下一步：等天亮」。');return;}research.action('find','strut');startStrut('show');tell('大公雞昂首闊步，好神氣！按「下一步：等天亮」。');return;}
    research.answer('find',id,false);soft();misses++;
    const next=found.has('comb')?'feather':'comb';
    tell(id==='head'&&found.has('comb')?'這是嘴巴和下巴。再看看牠身上的羽毛。':MISS[id]||MISS.scene);
    if(misses>=2){q(`[data-rr-spot="${next}"]`).classList.add('is-hint');research.hint('find');}
  }
  function advance(){if(!can('look')||found.size<2)return;endStrut();advanced=true;research.action('find','next');tell('天黑了，公雞靜靜地等着。'+BANDS[0]);render();void load(false);later(()=>range.focus({preventScroll:true}),50);}
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
      research.answer('crow','dark',false);research.hint('crow');hushSound();
      tell(refusals++?'天還沒亮，公雞不隨便叫。先把太陽拉上來吧。':'天還沒亮，公雞不隨便叫。想一想：假如公雞無時無刻都在叫，大家還知道甚麼時候天亮嗎？');
      restart(q('.rr-hush'),'is-on');later(()=>q('.rr-hush').classList.remove('is-on'),2600);
      if(!reducedMotion){restart(root,'is-shake');later(()=>root.classList.remove('is-shake'),1300);}
      sayOnce(2);return;
    }
    research.answer('crow','dawn',true);crowed=true;crowSound();save();q('.rr-hush').classList.remove('is-on');root.classList.remove('is-shake');
    root.classList.add('is-crowing');later(()=>root.classList.remove('is-crowing'),reducedMotion?900:2600);
    tell('喔喔喔！公雞一叫，太陽出來了。快去敲門，叫醒村子！');render();research.present('wake');
    houses[0].focus({preventScroll:true});
  }
  function echo(i,quiet,ms=1400){
    const perch=qa('.rr-perch')[i],bubble=q(`[data-oo="${i}"]`);
    qa('.rr-oo').forEach(b=>{if(b!==bubble)b.classList.remove('is-on');}); // one 喔喔 at a time: neighbours overlap on phones
    restart(bubble,'is-on');if(!reducedMotion)restart(perch,'is-crow');
    if(ooTimers[i]){view.clearTimeout(ooTimers[i]);timers.delete(ooTimers[i]);}
    ooTimers[i]=later(()=>{bubble.classList.remove('is-on');perch.classList.remove('is-crow');},ms);
    if(!quiet)chickSound(PITCH[i]);
  }
  function knockDoor(i){
    if(dead||!ready||readOnly||phase()!=='open'||!(i>=0&&i<4))return;
    if(full()||doors.has(i)){echo(i);return;}
    doors.add(i);newest=i;research.action('wake',`door-${i}`);knock();render();save();tell(WAKE[doors.size-1]);
    later(()=>echo(i),reducedMotion?0:500);
    const next=[1,2,3].map(k=>(i+k)%4).find(k=>!doors.has(k));
    if(doc.activeElement===houses[i])(next===undefined?q('.rr-audio'):houses[next]).focus({preventScroll:true});
    if(doors.size===4)finish();
  }
  function finish(){
    save();if(reported||solution||readOnly)return;reported=true;research.complete();
    later(()=>PITCH.forEach((k,i)=>{later(()=>echo(i,true,i<3?450:1400),i*450);chickSound(k,i*.45);}),reducedMotion?0:1300);
    later(()=>sayOnce(3),(reducedMotion?0:1300)+1900);
    onComplete?.({correct:true,response:state(),knowledge:KNOW});
  }
  const need=()=>phase()==='look'?[q('.rr-day')]:qa('img').filter(i=>!i.classList.contains('rr-day')&&!i.classList.contains('rr-extra'));
  const vars=()=>qa('.rr-src[src]').forEach(i=>root.style.setProperty(i.dataset.var,`url("${i.src}")`));
  const arm=()=>{qa('img[data-src]').forEach(i=>{i.src=i.dataset.src;i.removeAttribute('data-src');});vars();};
  const walkDecoded=ms=>new Promise(done=>{const t=view.setTimeout(()=>done(false),ms);Promise.all([q('.rr-plate'),cock].map(i=>i.decode())).then(()=>{view.clearTimeout(t);done(true);},()=>{view.clearTimeout(t);done(false);});});
  async function load(retry){
    if(retry)research.retry('assets');
    const request=++loadId;if(phase()!=='look')arm();
    const list=need(),loading=q('.rr-loading');ready=false;
    loading.hidden=list.every(i=>i.complete&&i.naturalWidth>0)&&(!introWanted||reducedMotion||phase()!=='look'||walkReady());q('.rr-loading span').textContent='畫卷正在展開…';q('[data-rr-retry]').hidden=true;stage.setAttribute('aria-busy','true');render();
    const unavailable=()=>{if(dead||request!==loadId)return;research.error('assets');loading.hidden=false;q('.rr-loading span').textContent='圖片還在載入，可以再試一次。';q('[data-rr-retry]').hidden=false;stage.setAttribute('aria-busy','false');};
    try{
      if(retry){for(const image of qa('img[src]')){const url=new URL(image.src);url.searchParams.set('retry',String(request));image.src=url.href;}vars();}
      await loadImages(list,{onTimeout:unavailable});
      if(dead||request!==loadId)return;
      let intro=false;
      if(introWanted&&phase()==='look'&&!found.size&&!reducedMotion){introWanted=false;intro=await walkDecoded(1500);if(dead||request!==loadId)return;}
      ready=true;loading.hidden=true;stage.setAttribute('aria-busy','false');
      root.style.setProperty('--rr-scene2',`url("${q('.rr-day').src}")`);
      render();
      const p=phase();
      if(p==='look'){arm();if(!full())research.present('find');if(intro&&!found.size)startStrut('in');}
      else if(p==='dawn'){research.present('dawn');research.present('crow');}
      else if(crowed&&!full()&&!reported)research.present('wake');
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
  cock.addEventListener('animationend',()=>{if(strut)endStrut();},{signal});
  // Chrome's touch adjustment moves a fat-finger tap onto the nearest button (the comb) unless the spot under
  // the finger also listens for taps; this listener keeps beak and body taps where the child put them.
  q('.rr-tap').addEventListener('click',()=>{},{signal});
  // Focus or scrollIntoView can scroll a clipped box (older Safari has no overflow:clip); keep the pictures pinned.
  for(const box of [stage,q('.rr-lane')])box.addEventListener('scroll',()=>{box.scrollLeft=0;box.scrollTop=0;},{signal});
  root.addEventListener('focusin',event=>{if(strut==='in'&&event.target.closest?.('.rr-stage'))endStrut();},{signal});
  range.addEventListener('input',()=>setDawn(Number(range.value)),{signal});
  range.addEventListener('change',()=>{if(can('dawn'))save();},{signal});
  root.addEventListener('click',event=>{
    const t=event.target;
    if(t.closest?.('[data-rr-retry]')){void load(true);return;}
    if(t.closest?.('[data-rr-audio]')){research.hint({look:'find',dawn:'crow',open:'wake'}[phase()],'audio');say(LINES[currentLine()],true);return;}
    if(strut==='in'&&t.closest?.('.rr-stage')){endStrut();return;}
    if(t.closest?.('[data-rr-next]')){if(found.size<2&&can('look'))tell('先找出紅冠和雪白羽毛，再等天亮。');else advance();return;}
    if(t.closest?.('[data-rr-crow]')){crow();return;}
    const house=t.closest?.('[data-rr-house]');if(house){knockDoor(Number(house.dataset.rrHouse));return;}
    const step=t.closest?.('[data-rr-step]');if(step){setDawn(dawn+Number(step.dataset.rrStep));save();if(step.disabled&&can('dawn'))(dawn>=BRIGHT?q('[data-rr-crow]'):range).focus({preventScroll:true});return;}
    const spot=t.closest?.('[data-rr-spot]');if(spot){find(spot.dataset.rrSpot);return;}
    if(t.closest?.('.rr-stage')&&!t.closest('.rr-loading,.rr-sunzone')&&can('look')){
      const box=stage.getBoundingClientRect();if(!box.width)return;
      find(region((event.clientX-box.left)/box.width*100,(event.clientY-box.top)/box.height*100));
    }
  },{signal});
  tell(full()||crowed&&doors.size===4?KNOW:phase()==='dawn'?(dawn>=BRIGHT?'天亮了！按「喔喔喔」叫一聲。':BANDS[band(dawn)]):phase()==='open'?'公雞叫了！點一點每道門，叫醒全村。':found.size?SPOTS[[...found][0]].tell:'大公雞走過來了！看看牠長得怎樣？');
  render();void load(false);
  const quiet=()=>{endStrut();root.classList.remove('is-crowing','is-shake');qa('.rr-hush,.rr-oo').forEach(e=>e.classList.remove('is-on'));qa('.rr-perch').forEach(e=>e.classList.remove('is-crow'));};
  return {
    showSolution(){if(dead||solution)return;if(saveTimer)save();research.hint('game','reveal');solution=true;clearTimers();drag=null;quiet();render();tell(KNOW);void load(false);},
    reset(){
      if(dead||readOnly)return;research.reset();clearTimers();drag=null;quiet();
      found.clear();doors.clear();dawn=0;crowed=false;advanced=false;solution=false;reported=false;misses=0;refusals=0;pulled=false;newest=-1;introWanted=true;played.clear();
      qa('.is-hint').forEach(b=>b.classList.remove('is-hint'));tell('大公雞走過來了！看看牠長得怎樣？');render();onState?.(state());void load(false);
    },
    destroy(){if(dead)return;if(saveTimer)save();dead=true;loadId++;abort.abort();clearTimers();drag=null;try{void audio?.close();}catch{}audio=null;root.remove();}
  };
}
