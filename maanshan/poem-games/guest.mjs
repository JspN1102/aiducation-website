import {createGameImageLoader} from './image-ready.mjs?v=20260922-school11';
import {imageAsset} from '../media-images.mjs?v=20261006-school43';
import {createProcessResearch} from './research.mjs?v=20260920a';
const file = path => new URL(imageAsset(`media/${path}`), import.meta.url).href;
const art = name => file(`ke-zhi/game/${name}.webp`);
const KNOWLEDGE='杜甫家貧，只有家常菜和舊酒，卻真誠熱情地招待客人，還隔着籬笆請鄰居一起喝酒。';
const STEPS=['sweep','door','dish','wine','invite'];
const LINES=[['花徑不曾緣客掃','蓬門今始為君開'],['盤飧市遠無兼味','樽酒家貧只舊醅'],['肯與鄰翁相對飲','隔籬呼取盡餘杯']];
const PILES=[[43,74.5],[50.5,82],[59.5,83.5],[53.5,90],[66,90.5],[58.5,96.5]];
const CHOICES={dish:[{id:'home',label:'一盤家常菜',ok:true},{id:'feast',label:'山珍海味'}],wine:[{id:'new',label:'新釀美酒'},{id:'old',label:'家裏的舊醅',ok:true}]};
const HINTS={feast:'山珍海味要到市集買。市集太遠了，買不到呢，再想想。',new:'新釀的好酒要花錢買。杜甫家貧，買不起呢，再想想。'};
const TASKS=['客人快到了！把花徑上的落花掃乾淨。','點一點蓬門，為客人打開。','市集太遠了，杜甫會端出哪一盤菜？','杜甫家貧，會給客人倒哪一種酒？'];
const INVITE=['問問客人：肯和鄰家老伯一起喝嗎？','隔着籬笆，叫鄰家老伯過來！','大家舉杯，把剩下的酒喝光！'];
const ACTS=['掃一掃','打開蓬門','','',''],INVITE_ACTS=['問客人','隔籬呼喚','一起乾杯'];
const voice='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m10 5-5 4H2v6h3l5 4ZM14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
const PETAL='M0 5C-3 4-5 0-4-3-3-5-1-5 0-4 1-5 3-5 4-3 5 0 3 4 0 5Z',PINKS=['#f5cfd2','#eeb4bc','#fae4e3','#e7a3ae','#fdf3ef','#f2c3c6'];
function pileSvg(i){let seed=i*977+31;const r=()=>((seed=seed*16807%2147483647)-1)/2147483646,ps=[];
  for(let k=0;k<28;k++){const a=r()*Math.PI*2,d=Math.pow(r(),.75);ps.push([Math.cos(a)*d*34,Math.sin(a)*d*11+2,Math.round(r()*360),.6+r()*.5,PINKS[Math.floor(r()*PINKS.length)],(.78+r()*.22).toFixed(2)]);}
  ps.sort((a,b)=>a[1]-b[1]);
  return `<svg viewBox="-50 -28 100 56" aria-hidden="true"><ellipse cx="0" cy="6" rx="40" ry="11" fill="#6b5a3e" opacity=".13"/><g stroke="#c4808b" stroke-width=".5" stroke-opacity=".5">${ps.map(([x,y,t,s,c,o])=>`<path d="${PETAL}" fill="${c}" fill-opacity="${o}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${t}) scale(${s.toFixed(2)})"/>`).join('')}</g></svg>`;}

/** 草堂待客: sweep the flower path, open the 蓬門, set the humble table, then call the neighbour over the fence. */
export function mountGuest(holder,{initialState,readOnly=false,playAudio,onState,onComplete,onResearch,reducedMotion=false,onProgress}={}){
 const doc=holder.ownerDocument,view=doc.defaultView,abort=new view.AbortController(),opt={signal:abort.signal},timers=new Set();
 const loadImages=createGameImageLoader({signal:abort.signal});
 const swept=new Set(),flying=new Set(),wrongs=new Set();
 let door=false,dish=null,wine=null,neighbour=0;
 const init=initialState&&typeof initialState==='object'?initialState:{};
 if(readOnly||init.gameCompleted===true){PILES.forEach((_,i)=>swept.add(i));door=true;dish='home';wine='old';neighbour=3;}
 else if(init.version===1){
  if(Array.isArray(init.swept))init.swept.slice(0,20).forEach(i=>{if(Number.isInteger(i)&&i>=0&&i<PILES.length)swept.add(i);});
  door=swept.size===PILES.length&&init.door===true;dish=door&&init.dish==='home'?'home':null;wine=dish&&init.wine==='old'?'old':null;
  neighbour=wine&&Number.isInteger(init.neighbour)?Math.max(0,Math.min(2,init.neighbour)):0;
 }
 const count=()=>(swept.size===PILES.length)+door+!!dish+!!wine+(neighbour===3);
 let done=neighbour===3,reported=done,at=Math.min(4,count()),dead=false,ready=false,solved=false,calling=false,speaking=false,queued=null,speakGen=0;
 let loadGen=0,audioContext=null,noise=null,drag=null,raf=0,suppressUntil=0,broomGen=0;
 const research=createProcessResearch(onResearch,{prefix:'game.guest',alive:()=>!dead});
 const root=doc.createElement('section');root.className='poem-guest-game';root.setAttribute('aria-label','草堂待客');
 const spot=(id,x,y,w,label,aria)=>`<button type="button" class="gk-spot" data-gk-spot="${id}" style="--x:${x}%;--y:${y}%;--w:${w}%" aria-label="${aria}" hidden><span>${label}</span></button>`;
 const bubble=(id,x,y,text)=>`<span class="gk-bubble" data-gk-bubble="${id}" style="--x:${x}%;--y:${y}%" aria-hidden="true">${text}</span>`;
 const glow=(x,y,w,d)=>`<i class="gk-glow" style="--x:${x}%;--y:${y}%;--w:${w}%;--d:${d}s" aria-hidden="true"></i>`;
 const choices=kind=>`<div class="gk-choices" data-gk-choices="${kind}" role="group" aria-label="${kind==='dish'?'選一盤菜':'選一種酒'}" hidden>${CHOICES[kind].map(c=>`<button type="button" class="gk-choice" data-gk-choice="${kind}:${c.id}"><img data-gk-need="3" src="${art(c.id==='home'?'dish-home':c.id==='feast'?'dish-feast':c.id==='old'?'wine-old':'wine-new')}" alt="" draggable="false"><span>${c.label}</span></button>`).join('')}</div>`;
 root.innerHTML=`<div class="gk-layout"><header class="gk-head"><p class="gk-instruction"></p><span class="gk-progress"></span></header>
 <div class="gk-stage" aria-busy="true">
  <img class="gk-scene" data-gk-scene="2" data-gk-need="2" src="${file('ke-zhi/scene-2.webp')}" width="1600" height="900" alt="茅屋前開滿了花，落花鋪滿小路，客人正走到門前。" draggable="false">
  <img class="gk-scene" data-gk-scene="3" data-gk-need="3" src="${file('ke-zhi/scene-3.webp')}" width="1600" height="900" alt="杜甫和客人坐在草堂前，桌上有一盤菜，杜甫正在倒酒。" draggable="false">
  <img class="gk-scene" data-gk-scene="4" data-gk-need="4" src="${file('ke-zhi/scene-4.webp')}" width="1600" height="900" alt="鄰家老伯來到籬笆旁，杜甫舉杯請他一起喝酒。" draggable="false">
  <div class="gk-layer" data-gk-layer="2">
   ${PILES.map(([x,y],i)=>`<button type="button" class="gk-pile" data-gk-pile="${i}" style="--x:${x}%;--y:${y}%" aria-label="一堆落花，點一下掃走">${pileSvg(i)}</button>`).join('')}
   <button type="button" class="gk-door" data-gk-door aria-label="蓬門關着，點一下為客人打開"><span class="gk-leaf"><img data-gk-need="2" src="${art('door')}" alt="" draggable="false"></span><span class="gk-leaf"><img data-gk-need="2" src="${art('door')}" alt="" draggable="false"></span></button>
   <img class="gk-gap" data-gk-need="2" src="${art('broom-gap')}" alt="" draggable="false">
   <span class="gk-broom" data-gk-broom aria-hidden="true"><img data-gk-need="2" src="${art('broom')}" alt="" draggable="false"></span>
   ${bubble('host2',38.5,33,'請進！')}
  </div>
  <div class="gk-layer" data-gk-layer="3">
   <span class="gk-mark" data-gk-mark="dish" style="--x:26%;--y:64.5%;--w:10%;--a:2"><b>家常菜</b></span>
   <span class="gk-mark" data-gk-mark="wine" style="--x:32.5%;--y:53%;--w:7%;--a:.9"><b>舊醅</b></span>
   ${spot('guest',49,45,14,'問客人','問問客人肯不肯請鄰居來')}${spot('fence',68,80,10,'籬笆','隔着籬笆呼喚鄰家老伯')}
   ${bubble('guest3',51,33,'好呀，請他來！')}${bubble('host3',27,30,'老伯，過來喝一杯！')}
  </div>
  <div class="gk-layer" data-gk-layer="4">
   ${spot('toast',32,56,8,'酒壺','舉杯，把剩下的酒喝光')}
   ${glow(30,45.5,7,0)}${glow(47.5,37.5,7,.25)}${glow(32,56,9,.5)}${glow(37,60,6,.5)}
   ${bubble('guest4',74,35,'來啦！')}
   <div class="gk-end" aria-hidden="true"><b>草堂待客</b><small>菜不多，酒也舊，情意很真。</small></div>
  </div>
  <div class="gk-loading" role="status"><span>草堂正在佈置…</span><button type="button" data-gk-retry hidden>再試一次</button></div>
 </div>
 <div class="gk-side"><p class="gk-verse"><span data-gk-half="0"></span><span data-gk-half="1"></span></p>${choices('dish')}${choices('wine')}
  <div class="gk-summary" hidden><b>草堂待客</b><p>${KNOWLEDGE}</p></div>
  <div class="gk-actionline"><button type="button" class="gk-primary" data-gk-primary></button><button type="button" class="gk-listen" data-gk-listen>${voice}<span>聽這句詩</span></button></div>
  <p class="gk-feedback" role="status" aria-live="polite"></p></div></div>`;
 holder.append(root);
 const q=s=>root.querySelector(s),all=s=>[...root.querySelectorAll(s)],stage=q('.gk-stage'),broom=q('[data-gk-broom]'),pileEls=all('[data-gk-pile]');
 const tell=t=>{if(!dead)q('.gk-feedback').textContent=t;};
 const later=(fn,ms)=>{const id=view.setTimeout(()=>{timers.delete(id);if(!dead)fn();},ms);timers.add(id);return id;};
 const state=()=>({version:1,swept:[...swept].sort((a,b)=>a-b),door,dish,wine,neighbour});
 const save=()=>{if(!readOnly&&!solved&&!dead)onState?.(state());};
 const progress=()=>onProgress?.({completed:count(),total:5});
 const finished=()=>done||solved||readOnly;
 const live=()=>!dead&&ready&&!finished();
 const stepDone=i=>[swept.size===PILES.length,door,!!dish,!!wine,neighbour===3][i];
 const scene=()=>finished()?4:at<2?2:at<4?3:neighbour>=2&&!calling?4:3;
 const lineNo=()=>finished()?2:at<2?0:at<4?1:2;
 const half=()=>at===4?(neighbour>=1?1:0):at%2;
 const verse=()=>finished()?LINES[2].join('，'):LINES[lineNo()][half()];
 if(reducedMotion)root.classList.add('is-reduced');

 function render(){
  const had=root.contains(doc.activeElement)?doc.activeElement:null,sc=scene(),fin=finished(),n=fin?5:at+1,li=lineNo();
  root.dataset.scene=String(sc);root.dataset.step=fin?'done':STEPS[at];root.classList.toggle('is-done',fin);root.classList.toggle('is-toast',neighbour===3||fin);
  q('.gk-instruction').textContent=fin?'草堂待客完成了！':calling?'杜甫隔着籬笆呼喚鄰家老伯……':at===4?INVITE[Math.min(neighbour,2)]:TASKS[at];
  const chip=q('.gk-progress');chip.textContent=`${n} / 5`;chip.setAttribute('aria-label',`第 ${n} 步，共 5 步`);
  all('[data-gk-scene]').forEach(el=>el.classList.toggle('is-on',+el.dataset.gkScene===sc));
  all('[data-gk-layer]').forEach(el=>el.classList.toggle('is-on',+el.dataset.gkLayer===sc));
  pileEls.forEach((el,i)=>{el.hidden=swept.has(i)&&!flying.has(i);el.disabled=!live()||at!==0||swept.has(i);});
  const d=q('[data-gk-door]');d.classList.toggle('is-open',door||fin);d.disabled=!live()||at!==1||door;d.classList.toggle('is-cue',live()&&at===1&&!door);
  broom.classList.toggle('is-active',live()&&at===0&&!stepDone(0));
  q('[data-gk-mark="dish"]').classList.toggle('is-on',!!dish&&sc===3);q('[data-gk-mark="wine"]').classList.toggle('is-on',!!wine&&sc===3);
  const showSpot={guest:live()&&at===4&&neighbour===0,fence:live()&&at===4&&neighbour===1&&!calling,toast:live()&&at===4&&neighbour===2&&!calling&&sc===4};
  all('[data-gk-spot]').forEach(el=>{el.hidden=!showSpot[el.dataset.gkSpot];el.disabled=!showSpot[el.dataset.gkSpot];});
  const bubbles={host2:sc===2&&door&&!fin,guest3:sc===3&&neighbour===1&&!calling,host3:calling,guest4:sc===4&&neighbour===2&&!fin};
  all('[data-gk-bubble]').forEach(el=>el.classList.toggle('is-on',!!bubbles[el.dataset.gkBubble]));
  q('.gk-end').classList.toggle('is-on',fin);
  const halves=all('[data-gk-half]'),hDone=[[stepDone(0),stepDone(1)],[stepDone(2),stepDone(3)],[neighbour>=1,neighbour===3]][li];
  halves.forEach((el,h)=>{el.textContent=LINES[li][h]+(h?'':'，');el.className=fin||hDone[h]?'is-done':'';if(!fin&&lineNo()===li&&h===half())el.classList.add('is-now');});
  for(const kind of ['dish','wine']){const box=q(`[data-gk-choices="${kind}"]`),step=kind==='dish'?2:3,picked=kind==='dish'?dish:wine;
   box.hidden=fin||at!==step;
   box.querySelectorAll('[data-gk-choice]').forEach(b=>{const id=b.dataset.gkChoice.split(':')[1];b.classList.toggle('is-right',picked===id);b.classList.toggle('is-wrong',!picked&&wrongs.has(id)||!!picked&&picked!==id);b.disabled=!live()||at!==step||!!picked;b.setAttribute('aria-pressed',String(picked===id));});}
  q('.gk-summary').hidden=!fin;
  const p=q('[data-gk-primary]'),next=stepDone(at)&&at<4&&!fin,label=next?'下一步':at===4?INVITE_ACTS[calling?1:Math.min(neighbour,2)]:ACTS[at];
  const busy=!live()||calling;p.hidden=fin||!label;p.setAttribute('aria-disabled',String(busy));p.classList.toggle('is-busy',busy);p.classList.toggle('is-next',next);
  p.innerHTML=next?'下一步 <span aria-hidden="true">→</span>':label;p.setAttribute('aria-label',next?'下一步':at===0?'掃一掃，掃走一堆落花':label);
  const l=q('[data-gk-listen]');l.classList.toggle('is-busy',speaking);l.setAttribute('aria-disabled',String(speaking));l.querySelector('span').textContent=speaking?'仔細聽…':'聽這句詩';
  if(had&&(had.disabled||had.closest('[hidden]'))){const to=[p,...all('[data-gk-choice],[data-gk-pile],[data-gk-door]'),l].find(el=>!el.disabled&&!el.closest('[hidden]'));to?.focus({preventScroll:true});}
 }
 function presentStep(){if(!ready||finished())return;research.present(STEPS[at],{position:at,total:5,...(at===2?{optionOrder:['home','feast']}:at===3?{optionOrder:['new','old']}:{})});}
 function ctx(){try{audioContext??=new(view.AudioContext||view.webkitAudioContext)();if(audioContext.state==='suspended')void audioContext.resume().catch(()=>{});return audioContext;}catch{return null;}}
 function tone(freq,delay=0,dur=.4,type='sine',vol=.14,to){const c=ctx();if(!c)return;try{const o=c.createOscillator(),g=c.createGain(),t=c.currentTime+delay;o.type=type;o.frequency.setValueAtTime(freq,t);if(to)o.frequency.exponentialRampToValueAtTime(to,t+dur);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+.015);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g);g.connect(c.destination);o.start(t);o.stop(t+dur+.03);}catch{}}
 function swish(){const c=ctx();if(!c)return;try{if(!noise){noise=c.createBuffer(1,Math.floor(c.sampleRate*.3),c.sampleRate);const data=noise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length);}
  const s=c.createBufferSource(),f=c.createBiquadFilter(),g=c.createGain(),t=c.currentTime;s.buffer=noise;f.type='bandpass';f.frequency.setValueAtTime(1600,t);f.frequency.exponentialRampToValueAtTime(4200,t+.22);f.Q.value=.8;
  g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.2,t+.03);g.gain.exponentialRampToValueAtTime(.0001,t+.27);s.connect(f);f.connect(g);g.connect(c.destination);s.start(t);s.stop(t+.3);}catch{}}
 const chime=()=>{tone(659,0,.6);tone(880,.12,.7);tone(1319,.26,.9,'sine',.09);},ding=()=>{tone(784,0,.5);tone(1175,.09,.6,'sine',.09);},soft=()=>tone(233,0,.28,'triangle',.08);
 async function speak(text,auto=false){
  if(!text||dead)return;if(speaking){if(auto)queued=text;return;}
  const token=++speakGen;speaking=true;render();let ok=false,timer;
  try{ok=await Promise.race([Promise.resolve(playAudio?.({text})),new Promise(resolve=>{timer=later(()=>resolve(false),15000);})]);}catch{ok=false;}
  view.clearTimeout(timer);timers.delete(timer);if(dead||token!==speakGen)return;speaking=false;
  if(ok===false){research.error('audio','audio_unavailable');if(!auto)tell('朗讀暫時未能播放，可以先看詩句，稍後再試。');}
  render();if(queued){const next=queued;queued=null;void speak(next,true);}
 }
 function won(text,clip){render();save();progress();tell(text);chime();void speak(clip,true);}
 // Broom: rests on the painted broom; follows the finger while sweeping.
 const setBroom=(x,y,r)=>{broom.style.setProperty('--bx',`${x}%`);broom.style.setProperty('--by',`${y}%`);broom.style.setProperty('--br',`${r}deg`);};
 const restBroom=()=>{['--bx','--by','--br'].forEach(p=>broom.style.removeProperty(p));};
 function swishTo(i){if(reducedMotion)return;const [x,y]=PILES[i],g=++broomGen;setBroom(x-2,y+5,-28);later(()=>{if(g===broomGen&&!drag)setBroom(x+3,y+5,16);},200);later(()=>{if(g===broomGen&&!drag)restBroom();},560);}
 function sweep(i,dx,dy){
  if(!live()||at!==0||swept.has(i))return;
  swept.add(i);research.action('sweep',`pile.${i}`);swish();
  const el=pileEls[i],len=Math.hypot(dx,dy)||1;el.style.setProperty('--fx',`${Math.round(dx/len*90)}px`);el.style.setProperty('--fy',`${Math.round(dy/len*40-24)}px`);
  if(!reducedMotion){flying.add(i);el.classList.add('is-swept');later(()=>{flying.delete(i);el.classList.remove('is-swept');render();},650);}
  const left=PILES.length-swept.size;
  if(left){render();save();tell(swept.size===1?'沙沙！掃走了一堆落花。':`還有 ${left} 堆落花。`);return;}
  research.answer('sweep','path',true);
  won('花徑掃乾淨了！「緣」是因為：花徑從不曾因客人來而掃，今天特地為客人掃。',LINES[0][0]);
 }
 const nearest=(x,y,i)=>{let best=i,bd=Infinity;pileEls.forEach((el,k)=>{if(swept.has(k))return;const r=el.getBoundingClientRect(),d=Math.hypot(x-r.left-r.width/2,y-r.top-r.height/2);if(d<bd&&d<Math.max(r.width,r.height)*.8){bd=d;best=k;}});return best;};
 const sweepTap=i=>{if(!live()||at!==0||swept.has(i))return;swishTo(i);sweep(i,PILES[i][0]<56?-1:1,.25);};
 function openDoor(){if(!live()||at!==1||door)return;door=true;research.answer('door','open',true);tone(190,0,.5,'triangle',.1,95);won('蓬門打開了！蓬門是用蓬草編的門，很簡陋；「君」就是客人崔明府。',LINES[0][1]);}
 function choose(kind,id){
  const step=kind==='dish'?2:3,c=CHOICES[kind]?.find(o=>o.id===id);if(!c||!live()||at!==step||stepDone(step))return;
  research.answer(kind,id,!!c.ok);
  if(!c.ok){research.hint(kind);wrongs.add(id);soft();const b=q(`[data-gk-choice="${kind}:${id}"]`);b.classList.remove('is-shake');void b.offsetWidth;if(!reducedMotion){b.classList.add('is-shake');later(()=>b.classList.remove('is-shake'),500);}render();tell(HINTS[id]);return;}
  if(kind==='dish'){dish='home';won('對！「盤飧」是盤裏的菜。市集遠，只有一樣家常菜，這就是「無兼味」。',LINES[1][0]);}
  else{wine='old';won('對！家貧，只有家裏的舊酒「舊醅」，是沒有過濾的濁酒。',LINES[1][1]);}
 }
 function ask(){if(!live()||at!==4||neighbour!==0)return;neighbour=1;research.action('invite','ask');ding();render();save();tell('客人說好！「肯」就是願意。杜甫先問客人，再請鄰居。');void speak(LINES[2][0],true);}
 function call(){
  if(!live()||at!==4||neighbour!==1||calling)return;neighbour=2;calling=true;research.action('invite','fence');tone(523,0,.32,'triangle',.1);tone(440,.28,.45,'triangle',.1);render();save();tell('「隔籬」是隔着籬笆，「呼取」是叫來。');
  later(()=>{calling=false;render();void load();tell('鄰家老伯聽到了，笑着走過來！');void speak(LINES[2][1],true);},reducedMotion?0:1300);
 }
 function toast(){
  if(!live()||at!==4||neighbour!==2||calling)return;neighbour=3;done=true;research.answer('invite','toast',true);
  [0,.25,.5].forEach(t=>tone(1047,t,.5,'sine',.1));tone(1568,.75,.9,'sine',.08);render();save();progress();tell('乾杯！「盡餘杯」就是把剩下的酒喝光。');
  if(!reported){reported=true;research.complete();onComplete?.({correct:true,response:state(),knowledge:KNOWLEDGE});}
 }
 function primary(){if(!live())return;if(stepDone(at)&&at<4){next();return;}
  if(at===0){const i=PILES.findIndex((_,k)=>!swept.has(k));if(i>=0)sweepTap(i);}else if(at===1)openDoor();else if(at===4)[ask,call,toast][Math.min(neighbour,2)]();}
 function next(){
  if(!live()||!stepDone(at)||at>=4)return;at++;wrongs.clear();tell('');render();void load();
  const target=at===2||at===3?q(`[data-gk-choices="${at===2?'dish':'wine'}"] button`):q('[data-gk-primary]');target?.focus({preventScroll:true});
 }
 // Pointer sweeping: start on a petal pile (or the broom) and brush across the path.
 function stagePoint(x,y){const r=stage.getBoundingClientRect();return [(x-r.left)/r.width*100,(y-r.top)/r.height*100];}
 function paint(){raf=0;if(!drag||dead)return;const [x,y]=stagePoint(drag.px,drag.py);setBroom(Math.max(2,Math.min(98,x)),Math.max(30,Math.min(103,y+4)),Math.max(-40,Math.min(28,-10+drag.vx*1.4)));}
 function down(e){
  const el=e.target.closest?.('[data-gk-pile],[data-gk-broom]');
  if(!el||drag||!live()||at!==0||stepDone(0)||e.button>0||e.isPrimary===false||el.disabled)return;
  if(e.cancelable)e.preventDefault();broomGen++;
  drag={id:e.pointerId,el,x:e.clientX,y:e.clientY,px:e.clientX,py:e.clientY,lx:e.clientX,vx:0,moved:0,pile:el.dataset.gkPile};
  try{el.setPointerCapture(e.pointerId);}catch{}
  broom.classList.add('is-held');paint();
 }
 function move(e){
  if(!drag||e.pointerId!==drag.id)return;if(e.cancelable)e.preventDefault();
  drag.moved=Math.max(drag.moved,Math.hypot(e.clientX-drag.x,e.clientY-drag.y));const dx=e.clientX-drag.lx,dy=e.clientY-drag.py;
  drag.vx=drag.vx*.6+dx*.4;drag.lx=drag.px=e.clientX;drag.py=e.clientY;if(!raf)raf=view.requestAnimationFrame(paint);
  if(drag.moved>10)pileEls.forEach((el,i)=>{if(swept.has(i))return;const r=el.getBoundingClientRect();if(e.clientX>r.left-6&&e.clientX<r.right+6&&e.clientY>r.top-6&&e.clientY<r.bottom+6)sweep(i,dx||(PILES[i][0]<56?-1:1),dy);});
 }
 function cancelDrag(){const d=drag;drag=null;view.cancelAnimationFrame(raf);raf=0;if(!d)return null;try{d.el.releasePointerCapture(d.id);}catch{}suppressUntil=Date.now()+600;broom.classList.remove('is-held');restBroom();return d;}
 function release(e){if(!drag||e.pointerId!==drag.id)return;const d=cancelDrag(),k=e.type==='pointerup'&&d.moved<=10?nearest(e.clientX,e.clientY,d.pile==null?-1:+d.pile):-1;if(k>=0)sweepTap(k);}
 async function load(retry=false){
  const need=all(`[data-gk-need="${scene()}"]`),ok=img=>img.complete&&img.naturalWidth>0,box=q('.gk-loading');
  if(!retry&&need.every(ok)){loadGen++;ready=true;box.hidden=true;stage.setAttribute('aria-busy','false');render();presentStep();return;}
  if(retry)research.retry('assets');
  const token=++loadGen;ready=false;box.hidden=false;box.querySelector('span').textContent='草堂正在佈置…';q('[data-gk-retry]').hidden=true;stage.setAttribute('aria-busy','true');render();
  const unavailable=()=>{if(dead||token!==loadGen)return;research.error('assets');box.querySelector('span').textContent='圖片還在載入，可以再試一次。';q('[data-gk-retry]').hidden=false;stage.setAttribute('aria-busy','false');};
  try{
   if(retry)need.filter(img=>!ok(img)).forEach(img=>{const u=new URL(img.src);u.searchParams.set('retry',String(token));img.src=u.href;});
   await loadImages(need,{onTimeout:unavailable});
   if(dead||token!==loadGen)return;ready=true;box.hidden=true;stage.setAttribute('aria-busy','false');render();presentStep();
  }catch{unavailable();}
 }
 root.addEventListener('pointerdown',down,opt);
 root.addEventListener('pointermove',move,{signal:abort.signal,passive:false});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(type,release,opt);
 for(const type of ['contextmenu','selectstart','dragstart'])root.addEventListener(type,e=>{if(e.target.closest?.('.gk-stage')&&e.cancelable)e.preventDefault();},opt);
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden)cancelDrag();},opt);
 view.addEventListener('blur',()=>cancelDrag(),opt);
 root.addEventListener('click',e=>{
  const t=e.target,pile=t.closest?.('[data-gk-pile]'),choice=t.closest?.('[data-gk-choice]'),s=t.closest?.('[data-gk-spot]');
  if(pile&&(e.detail===0||Date.now()>suppressUntil))sweepTap(e.detail===0?+pile.dataset.gkPile:nearest(e.clientX,e.clientY,+pile.dataset.gkPile));
  if(t.closest?.('[data-gk-door]'))openDoor();
  if(choice){const [kind,id]=choice.dataset.gkChoice.split(':');choose(kind,id);}
  if(s)({guest:ask,fence:call,toast})[s.dataset.gkSpot]?.();
  if(t.closest?.('[data-gk-primary]'))primary();
  if(t.closest?.('[data-gk-retry]'))void load(true);
  if(t.closest?.('[data-gk-listen]')&&!speaking){research.hint(finished()?'game':STEPS[at],'audio');void speak(verse());}
 },opt);
 render();tell(finished()?'「盡餘杯」就是把剩下的酒喝光。':at===0?'用手指在落花上掃一掃，也可以按「掃一掃」。':'');void load();
 return {
  showSolution(){if(dead||solved)return;research.hint('game','reveal');cancelDrag();solved=true;calling=false;render();void load();tell('看看結局：杜甫、客人和鄰家老伯一起舉杯，把酒喝光。');},
  reset(){
   if(dead||readOnly)return;research.reset();cancelDrag();timers.forEach(id=>view.clearTimeout(id));timers.clear();
   swept.clear();flying.clear();wrongs.clear();door=false;dish=null;wine=null;neighbour=0;done=false;solved=false;calling=false;speaking=false;queued=null;speakGen++;broomGen++;at=0;
   pileEls.forEach(el=>el.classList.remove('is-swept'));restBroom();render();tell('客人又要來了，再招待一次吧！');onState?.(state());onProgress?.({completed:0,total:5});void load();
  },
  destroy(){if(dead)return;dead=true;loadGen++;speakGen++;cancelDrag();abort.abort();timers.forEach(id=>view.clearTimeout(id));timers.clear();try{void audioContext?.close().catch(()=>{});}catch{}root.remove();}
 };
}
