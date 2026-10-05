import {createGameImageLoader} from './image-ready.mjs?v=20260922-school11';
import {imageAsset} from '../media-images.mjs?v=20261005-school41';
import {createProcessResearch} from './research.mjs?v=20260920a';
const file = path => new URL(imageAsset(`media/${path}`), import.meta.url).href;
const art = name => file(`jue-ju/game/${name}.webp`);
const KNOWLEDGE='杜甫在草堂窗前用四句詩畫了一幅春景：黃鸝鳴柳、門前泊船是近景，白鷺上青天是中景，西嶺千秋雪是遠景；有聲有色，有動有靜。';
const STEPS=['willow','orioles','egrets','window','peak','boat','moor'];
const LINES=['兩個黃鸝鳴翠柳','一行白鷺上青天','窗含西嶺千秋雪','門泊東吳萬里船'];
// Matching words in each couplet share a tint in the finale (兩個/一行, 黃鸝/白鷺 … 窗/門, 含/泊 …).
const PAIRS=[[0,0,1,1,2,3,3],[0,1,2,2,3,3,3]];
// Willow canopy cells on a 24×14 grid over the 1600×900 painting; brushing 84 of them turns the tree green.
const WILLOW=[7,8,9,10,28,29,30,31,32,33,34,36,52,53,54,55,56,57,58,59,76,77,78,79,80,81,82,83,84,100,101,102,103,104,105,106,107,108,124,125,126,127,128,129,130,131,133,148,149,150,151,152,153,154,155,157,172,173,174,175,176,177,178,179,180,181,196,197,198,199,200,201,202,203,204,205,220,221,222,223,224,225,226,227,228,229,230,244,245,246,247,248,249,250,251,252,253,254,268,269,270,271,272,273,274,275,276,294,295,296,297,298,299,300,301,302,324,325,326];
const WSET=new Set(WILLOW),NEED=84;
// Painting coordinates in % of the 1600×900 picture: perched orioles, standing egrets (feet x/y, size in cqw), sky slots.
const PERCH=[[26.4375,18.111,7.75,17],[35.6875,24.667,6.5,15.667]];
const BANK=[[56.25,83.1,8.875,7],[66.25,84.4,7.125,9.1875],[77.2,83.6,11.4375,7.1875],[88.1,85.6,4.125,6.875]],BIRDS=[2,2,2,1];
const SLOTS=[[56.25,22.333,12.25,11.667],[69,14.889,10.5,9.444],[81,8.889,8.875,8.222],[91.375,6.667,2.0625,3.333]];
const START=[45,47],TARGET=[73.75,46.7];
// Boat route in painting px: [centre x, waterline y, scale]; the last point is the boat painted at the pier in scene 4.
const PATH=[[1420,676,.09],[1100,708,.3],[1120,780,.62],[1232,822,1]],TIE=[1505,775],KNOB=[1378,793];
const fits=(k,s)=>k<3?s<3:s===3;
const NOTES={sound:'聽！黃鸝在柳樹上鳴叫，這是春天的聲音。',color:'黃鸝的黃、翠柳的綠、白鷺的白、青天的藍——好多春天的顏色！',motion:'白鷺排成一行飛上青天，是動的景物。',still:'西嶺的雪千年不化，門前的船靜靜停泊，是靜的景物。'};
const NOTE_KEYS=[['sound','聲','聽聽畫裏的聲音'],['color','色','看看畫裏的顏色'],['motion','動','找找會動的景物'],['still','靜','找找靜止的景物']];
const voice='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m10 5-5 4H2v6h3l5 4ZM14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';

/** 草堂窗前畫春景: brush the willow green, send the egrets up in one line, frame the snowy 西嶺 in the window, then moor the boat from 東吳. */
export function mountCouplet(holder,{initialState,readOnly=false,playAudio,onState,onComplete,onResearch,reducedMotion=false,onProgress}={}){
 const doc=holder.ownerDocument,view=doc.defaultView,abort=new view.AbortController(),opt={signal:abort.signal},timers=new Set();
 const loadImages=createGameImageLoader({signal:abort.signal});
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const paint=new Set(),sung=new Set();
 let round=0,egrets=[-1,-1,-1,-1],win=0,wx=START[0],wy=START[1],boat=0,tied=false;
 const full=()=>{WILLOW.forEach(c=>paint.add(c));sung.add(0);sung.add(1);egrets=[0,1,2,3];win=2;[wx,wy]=TARGET;boat=1;tied=true;round=4;};
 const init=initialState&&typeof initialState==='object'?initialState:{};
 if(readOnly||init.gameCompleted===true)full();
 else if(init.version===2){
  const r=Number.isInteger(init.round)?clamp(init.round,0,4):0;
  if(r===4){full();round=3;}// The host never confirmed completion: wait at the moored boat.
  else{
   round=r;
   if(r>0){WILLOW.forEach(c=>paint.add(c));sung.add(0);sung.add(1);}
   else if(Array.isArray(init.paint)){init.paint.slice(0,400).forEach(c=>{if(WSET.has(c))paint.add(c);});if(paint.size>=NEED&&Array.isArray(init.sung))init.sung.slice(0,4).forEach(i=>{if(i===0||i===1)sung.add(i);});}
   if(r>1)egrets=[0,1,2,3];
   else if(r===1&&Array.isArray(init.egrets)){const used=new Set();egrets=[0,1,2,3].map(k=>{const s=init.egrets[k];if(Number.isInteger(s)&&s>=0&&s<4&&fits(k,s)&&!used.has(s)){used.add(s);return s;}return -1;});}
   if(r>2){win=2;[wx,wy]=TARGET;}
   else if(r===2){win=[0,1,2].includes(init.window)?init.window:0;if(win===2)[wx,wy]=TARGET;else if(win===1&&Array.isArray(init.lens)&&init.lens.length===2&&init.lens.every(Number.isFinite)){wx=clamp(init.lens[0],36,89);wy=clamp(init.lens[1],20.7,79.3);}}
   if(r===3){const b=Number.isFinite(init.boat)?clamp(init.boat,0,1):0;boat=b>=.97?1:Math.round(b*100)/100;tied=boat===1&&init.tied===true;}
  }
 }
 let reported=round===4,dead=false,ready=false,solved=false,speaking=false,queued=null,speakGen=0,readGen=0,reading=-1;
 let loadGen=0,audioContext=null,noise=null,drag=null,raf=0,suppressUntil=0,animRaf=0,animGen=0,moving=false;
 let arriving=false,rising=false,revealing=false,mooring=false,misses=0,halfSaid=false,note=null,kx=KNOB[0],ky=KNOB[1];
 const research=createProcessResearch(onResearch,{prefix:'game.couplet',alive:()=>!dead});
 const root=doc.createElement('section');root.className='poem-couplet-game';root.setAttribute('aria-label','草堂窗前畫春景');
 const need=(...r)=>`data-pc-need="${r.map(n=>`r${n}`).join(' ')}"`;
 const img=(name,rounds,extra='')=>`<img ${extra}${need(...rounds)} src="${art(name)}" alt="" draggable="false">`;
 const tag=(key,x,y,text,d=0,cls='')=>`<span class="pc-tag${cls}" data-pc-show="${key}" style="--x:${x}%;--y:${y}%;--d:${d}s" aria-hidden="true">${text.replace(/・(.+)/,'<span class="pc-more">・$1</span>')}</span>`;
 const ring=(key,x,y,w,a=1,r=0)=>`<i class="pc-ring" data-pc-show="${key}" style="--x:${x}%;--y:${y}%;--w:${w}%;--a:${a};--r:${r}deg" aria-hidden="true"></i>`;
 const badge=(x,y,ch,bg,fg,d)=>`<b class="pc-badge" data-pc-show="color" style="--x:${x}%;--y:${y}%;--bg:${bg};--fg:${fg};--d:${d}s" aria-hidden="true">${ch}</b>`;
 const hidden=i=>`第${'一二三四'[i]}句：完成這一關就會出現`;
 root.innerHTML=`<div class="pc-layout"><header class="pc-head"><p class="pc-instruction"></p><span class="pc-progress"></span></header>
 <div class="pc-stage" aria-busy="true"><div class="pc-world">
  <img class="pc-scene" data-pc-scene="1" ${need(0,1)} src="${file('jue-ju/scene-1.webp')}" width="1600" height="900" alt="從草堂的窗口望出去，柳樹垂着長長的枝條，遠處有一條江。" draggable="false">
  ${img('oriole-gap',[0,1],'class="pc-gap" ')}
  <img class="pc-scene" data-pc-scene="2" ${need(1,2)} src="${file('jue-ju/scene-2.webp')}" width="1600" height="900" alt="翠綠的柳樹上有兩隻黃鸝，一行白鷺飛上藍天。" draggable="false">
  <img class="pc-scene" data-pc-scene="3" ${need(2,3)} src="${file('jue-ju/scene-3.webp')}" width="1600" height="900" alt="窗外遠方出現了積雪的西嶺。" draggable="false">
  <img class="pc-scene" data-pc-scene="4" ${need(3,4)} src="${file('jue-ju/scene-4.webp')}" width="1600" height="900" alt="門前的江邊停泊着一艘從東吳來的大船，遠方是積雪的西嶺。" draggable="false">
  ${img('pale-rest',[0,1],'class="pc-pale" ')}
  ${img('pale-willow',[0],'data-pc-src hidden ')}
  <canvas class="pc-canvas" width="1200" height="675" aria-hidden="true"></canvas>
  <i class="pc-haze" aria-hidden="true"></i>
  <img class="pc-lens" ${need(2)} src="${file('jue-ju/scene-3.webp')}" alt="" draggable="false">
  <div class="pc-flock is-low" aria-hidden="true"><svg viewBox="0 0 1600 900" preserveAspectRatio="none"><polyline points="${SLOTS.map(([l,t,w,h])=>`${(l+w/2)*16},${(t+h/2)*9}`).join(' ')}"/></svg>
   ${SLOTS.map(([l,t,w,h],s)=>`<i class="pc-slot" data-pc-slot="${s}" style="--x:${l+w/2}%;--y:${t+h/2}%;--w:${w}%;--h:${h}%"></i>${img(`egret-fly-${s}`,[1],`class="pc-slotimg" data-pc-slotimg="${s}" style="left:${l}%;top:${t}%;width:${w}%;height:${h}%" `)}`).join('')}</div>
  <svg class="pc-route" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true"><path d="M1420 672C1300 676 1150 684 1104 708S1080 770 1124 784 1196 812 1226 818"/></svg>
  ${img('oriole-fly-a',[0],'class="pc-fly" style="--x:30.31%;--y:26.61%;--fx:-30cqw;--fy:-12cqw;--d:0s" ')}
  ${img('oriole-fly-b',[0],'class="pc-fly" style="--x:38.94%;--y:32.5%;--fx:-36cqw;--fy:-7cqw;--d:.3s" ')}
  ${PERCH.map(([l,t,w,h],i)=>`<button type="button" class="pc-bird" data-pc-bird="${i}" style="left:${l}%;top:${t}%;width:${w}%;height:${h}%" aria-label="第${i?'二':'一'}隻黃鸝，點一下請牠唱歌">${img(i?'oriole-b':'oriole-a',[0,1,2,3,4])}<span class="pc-chirp" aria-hidden="true">啾啾♪</span></button>`).join('')}
  ${BANK.map(([x,y,w,h],k)=>`<button type="button" class="pc-egret" data-pc-egret="${k}" style="left:${x}%;top:${y}%;width:${w}cqw;height:${h}cqw" aria-label="岸邊的${BIRDS[k]>1?'兩隻白鷺，點一下請牠們':'一隻白鷺，點一下請牠'}飛上青天">${img(`egret-${k}`,[1])}</button>`).join('')}
  <button type="button" class="pc-window" data-pc-window><span class="pc-shutter" data-side="l">${img('shutter-l',[2])}</span><span class="pc-shutter" data-side="r">${img('shutter-r',[2])}</span>${img('window-frame',[2],'class="pc-frame" ')}</button>
  <button type="button" class="pc-post" data-pc-post aria-label="木樁，點一下把船繫好">${img('post',[3])}</button>
  <button type="button" class="pc-boat" data-pc-boat aria-label="從東吳來的船，點一下划船；方向鍵也可以移動">${img('boat',[3])}</button>
  <svg class="pc-rope" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true"><path/></svg>
  <button type="button" class="pc-knob" data-pc-knob aria-label="船上的繩子：拉到木樁上，或點一下把船繫好"></button>
  <span class="pc-brush" aria-hidden="true">${img('brush',[0])}</span>
  ${ring('willow-hint',37,40,30,1.1)}${ring('peak-hint',TARGET[0],TARGET[1],19,.95)}${ring('moor-hint',94.06,86,7,.6)}
  <i class="pc-glow" data-pc-show="peak" aria-hidden="true"></i>
  ${ring('sound',34,26,19,1.25)}${ring('motion',77,18,38,2.8,-19)}${ring('still',74,45,25,2.3)}${ring('still',76.5,76,26,1.9)}
  ${badge(24.5,21,'黃','#f3c43a','#4a3200',0)}${badge(48,51,'翠','#3f9a66','#fff',.12)}${badge(72,31,'白','#ffffff','#3d5566',.24)}${badge(70,6.5,'青','#5d9fd8','#fff',.36)}
  ${tag('r0',33,12,'兩個黃鸝')}${tag('r0',49,52,'翠柳',.15)}
  ${tag('r1',79,26,'一行')}${tag('r1',72,6,'青天',.15)}
  ${tag('peak',57,40,'西嶺',.3)}${tag('peak',73.75,22,'千秋雪',.45)}
  ${tag('from',77,57,'從東吳來・走了萬里路')}${tag('bo',58,76,'泊')}
  ${tag('final',31,10,'近景・黃鸝鳴柳',.2)}${tag('final',66,13,'中景・白鷺上青天',.5)}${tag('final',72,37,'遠景・西嶺千秋雪',.8)}${tag('final',56,76,'近景・門前泊船',1.1)}
  ${tag('sound',34,10,'鳴　♪')}${tag('motion',70,33,'飛上青天')}${tag('still',61,32,'千秋雪')}${tag('still',58,77,'泊')}
 </div>
 <div class="pc-loading" role="status"><span>畫紙正在鋪開…</span><button type="button" data-pc-retry hidden>再試一次</button></div></div>
 <div class="pc-side"><div class="pc-verse">${LINES.map((t,i)=>`<p class="pc-line" data-pc-line="${i}"><span class="pc-sr">${hidden(i)}</span>${[...t].map((c,j)=>`<span class="pc-ch" data-p="${PAIRS[i>>1][j]}" aria-hidden="true">${c}</span>`).join('')}</p>`).join('')}</div>
  <p class="pc-pair" hidden>同色的詞語上下相對，這叫「對仗」。</p>
  <div class="pc-actionline"><button type="button" class="pc-primary" data-pc-primary></button><div class="pc-notes" role="group" aria-label="看看這幅畫" hidden>${NOTE_KEYS.map(([id,ch,label])=>`<button type="button" class="pc-note" data-pc-note="${id}" aria-pressed="false" aria-label="${ch}：${label}">${ch}</button>`).join('')}</div><button type="button" class="pc-listen" data-pc-listen>${voice}<span>聽這句詩</span></button></div>
  <p class="pc-feedback" role="status" aria-live="polite"></p></div></div>`;
 holder.append(root);
 const q=s=>root.querySelector(s),all=s=>[...root.querySelectorAll(s)],stage=q('.pc-stage'),world=q('.pc-world'),canvas=q('.pc-canvas'),brush=q('.pc-brush');
 const birdEls=all('[data-pc-bird]'),bankEls=all('[data-pc-egret]'),slotImgs=all('[data-pc-slotimg]'),boatEl=q('[data-pc-boat]'),knobEl=q('[data-pc-knob]');
 let g2=null;try{g2=canvas.getContext('2d');}catch{}
 const tell=t=>{if(!dead)q('.pc-feedback').textContent=t;};
 const later=(fn,ms)=>{const id=view.setTimeout(()=>{timers.delete(id);if(!dead)fn();},ms);timers.add(id);return id;};
 const state=()=>({version:2,round,paint:[...paint].sort((a,b)=>a-b),sung:[...sung].sort(),egrets:[...egrets],window:win,lens:[Math.round(wx*100)/100,Math.round(wy*100)/100],boat:Math.round(boat*100)/100,tied});
 const save=()=>{if(!readOnly&&!solved&&!dead)onState?.(state());};
 const finished=()=>round===4||solved||readOnly;
 const live=()=>!dead&&ready&&!finished();
 const painted=()=>paint.size>=NEED;
 const stepDone=r=>r===0?painted()&&sung.size===2:r===1?egrets.every(s=>s>=0):r===2?win===2:r===3?tied:true;
 const count=()=>finished()?4:round+(stepDone(round)?1:0);
 const progress=()=>onProgress?.({completed:count(),total:4});
 const step=()=>round===0?(painted()?'orioles':'willow'):round===1?'egrets':round===2?(win?'peak':'window'):(boat>=1?'moor':'boat');
 const scene=()=>finished()?4:round===0?1:round===1?(stepDone(1)&&!rising?2:1):round===2?(win===2?3:2):(tied&&!mooring?4:3);
 const worldPct=(x,y)=>{const r=world.getBoundingClientRect();return [(x-r.left)/r.width*100,(y-r.top)/r.height*100];};
 const lensGap=()=>Math.hypot((wx-TARGET[0])*16,(wy-TARGET[1])*9);
 if(reducedMotion)root.classList.add('is-reduced');

 function instruction(){
  if(finished())return '春景畫好了！有聲有色，有動有靜。';
  if(stepDone(round))return round===3?'船泊好了！看看整幅春景畫。':`第${'一二三'[round]}句畫好了！按「下一句」繼續畫。`;
  if(round===0)return arriving?'柳樹綠了！看，誰飛來了？':painted()?'兩隻黃鸝來了！點一點牠們，請牠們唱歌。':'柳樹還沒上色！在柳樹上刷一刷，刷成翠綠。';
  if(round===1)return '白鷺要上青天！把牠們拖到天上，排成一行。';
  if(round===2)return win?'拖動窗框，把遠方的雪山「含」在窗裏。':'窗關着。推開窗，看看外面。';
  return boat>=1?'船到了！把繩子拉到木樁上，把船泊好。':'一艘船從東吳遠道而來。把船划到門前。';
 }
 function render(){
  const had=root.contains(doc.activeElement)?doc.activeElement:null,sc=scene(),fin=finished(),pt=painted(),n=fin?4:round+1,on=new Set();
  root.dataset.round=String(fin?4:round);root.classList.toggle('is-done',fin);root.classList.toggle('is-live',live());root.classList.toggle('is-arriving',arriving);
  world.style.setProperty('--pan',String(fin?.5:round===0?0:1));world.style.setProperty('--wx',wx.toFixed(2));world.style.setProperty('--wy',wy.toFixed(2));
  q('.pc-instruction').textContent=instruction();
  const chip=q('.pc-progress');chip.textContent=`${n} / 4`;chip.setAttribute('aria-label',`第 ${n} 句，共 4 句`);
  all('[data-pc-scene]').forEach(el=>{const k=+el.dataset.pcScene;el.classList.toggle('is-on',k<=sc);el.setAttribute('aria-hidden',String(k!==sc));});
  q('.pc-pale').classList.toggle('is-on',sc===1);
  canvas.classList.toggle('is-on',!fin&&round===0&&!pt);
  brush.classList.toggle('is-off',fin||round!==0||pt);
  const perched=fin||round>0||pt&&!arriving;
  birdEls.forEach((b,i)=>{b.classList.toggle('is-away',!perched);b.disabled=!perched||!ready;b.classList.toggle('is-cue',live()&&round===0&&pt&&!arriving&&!sung.has(i));});
  const r1=!fin&&round===1,full1=stepDone(1);
  bankEls.forEach((b,k)=>{b.hidden=!r1||egrets[k]>=0;b.disabled=!live()||!r1;});
  const flock=q('.pc-flock');flock.classList.toggle('is-off',!(r1&&sc===1));flock.classList.toggle('is-low',!full1);flock.classList.toggle('is-cue',r1&&!full1&&misses>=2);
  all('[data-pc-slot]').forEach((el,s)=>el.classList.toggle('is-full',egrets.includes(s)));
  slotImgs.forEach((el,s)=>el.classList.toggle('is-on',egrets.includes(s)));
  const r2=!fin&&round===2,wb=q('[data-pc-window]');
  wb.classList.toggle('is-off',!r2);wb.classList.toggle('is-open',win>=1);wb.disabled=!live()||!r2||win===2;
  wb.setAttribute('aria-label',win===0?'關着的窗，點一下推開窗':win===1?'窗框：拖動它，或用方向鍵移動；按一下會向雪山移近':'窗框裏含着西嶺的雪山');
  q('.pc-lens').classList.toggle('is-on',r2&&(win===1||revealing));q('.pc-haze').classList.toggle('is-on',r2&&win<2);
  const r3=!fin&&round===3,near=r3&&sc===3;
  boatEl.classList.toggle('is-off',!near);boatEl.disabled=!live()||!r3||boat>=1;
  q('.pc-route').classList.toggle('is-on',r3&&boat<1);q('[data-pc-post]').classList.toggle('is-off',!near);q('[data-pc-post]').disabled=!live()||!r3||boat<1||tied;
  q('.pc-rope').classList.toggle('is-on',near&&boat>=1);knobEl.classList.toggle('is-off',!(near&&boat>=1&&!tied));knobEl.disabled=!live()||!r3||boat<1||tied;
  if(fin)on.add(note||'final');
  else if(round===0){if(stepDone(0))on.add('r0');else if(!pt&&misses>=2)on.add('willow-hint');}
  else if(round===1){if(full1&&!rising)on.add('r1');}
  else if(round===2){if(win===2)on.add('peak');else if(win===1&&misses>=2)on.add('peak-hint');}
  else{if(tied)on.add('bo');else if(boat<1)on.add('from');else if(misses>=2)on.add('moor-hint');}
  all('[data-pc-show]').forEach(el=>el.classList.toggle('is-on',on.has(el.dataset.pcShow)));
  all('.pc-line').forEach((el,i)=>{const ok=fin||i<round||i===round&&stepDone(round);el.classList.toggle('is-done',ok);el.classList.toggle('is-now',!fin&&i===round);el.classList.toggle('is-reading',reading===i);el.querySelector('.pc-sr').textContent=ok?LINES[i]:hidden(i);});
  q('.pc-pair').hidden=!fin;q('.pc-notes').hidden=!fin;
  all('[data-pc-note]').forEach(b=>b.setAttribute('aria-pressed',String(note===b.dataset.pcNote)));
  const p=q('[data-pc-primary]'),next=stepDone(round)&&!fin,label=next?(round===3?'看整幅畫':'下一句'):[painted()?'請黃鸝唱歌':'刷一刷','白鷺起飛',win?'移動窗框':'推開窗',boat>=1?'繫好船':'划船'][round];
  const busy=!live()||moving||arriving||rising||mooring;p.hidden=fin;p.setAttribute('aria-disabled',String(busy));p.classList.toggle('is-busy',busy);p.classList.toggle('is-next',next);
  p.innerHTML=next?`${label} <span aria-hidden="true">→</span>`:label;p.setAttribute('aria-label',next?label:round===0&&!pt?'刷一刷，替柳樹刷上翠綠':label);
  const l=q('[data-pc-listen]'),talking=speaking||reading>=0;l.classList.toggle('is-busy',talking);l.setAttribute('aria-disabled',String(talking));l.querySelector('span').textContent=talking?'仔細聽…':fin?'聽全詩':'聽這句詩';
  if(had&&(had.disabled||had.closest('[hidden],.is-off,.is-away'))){const to=[p,...all('[data-pc-note]'),l].find(el=>!el.disabled&&!el.closest('[hidden]'));to?.focus({preventScroll:true});}
 }
 function presentStep(){if(!ready||finished())return;const s=step();research.present(s,{position:STEPS.indexOf(s),total:STEPS.length});}
 function ctx(){try{audioContext??=new(view.AudioContext||view.webkitAudioContext)();if(audioContext.state==='suspended')void audioContext.resume().catch(()=>{});return audioContext;}catch{return null;}}
 function tone(freq,delay=0,dur=.4,type='sine',vol=.14,to){const c=ctx();if(!c)return;try{const o=c.createOscillator(),g=c.createGain(),t=c.currentTime+delay;o.type=type;o.frequency.setValueAtTime(freq,t);if(to)o.frequency.exponentialRampToValueAtTime(to,t+dur);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+.015);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g);g.connect(c.destination);o.start(t);o.stop(t+dur+.03);}catch{}}
 function swish(lo=1600,hi=4200,vol=.2){const c=ctx();if(!c)return;try{if(!noise){noise=c.createBuffer(1,Math.floor(c.sampleRate*.3),c.sampleRate);const data=noise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length);}
  const s=c.createBufferSource(),f=c.createBiquadFilter(),g=c.createGain(),t=c.currentTime;s.buffer=noise;f.type='bandpass';f.frequency.setValueAtTime(lo,t);f.frequency.exponentialRampToValueAtTime(hi,t+.22);f.Q.value=.8;
  g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+.03);g.gain.exponentialRampToValueAtTime(.0001,t+.27);s.connect(f);f.connect(g);g.connect(c.destination);s.start(t);s.stop(t+.3);}catch{}}
 const chime=()=>{tone(659,0,.6);tone(880,.12,.7);tone(1319,.26,.9,'sine',.09);},ding=()=>{tone(784,0,.5);tone(1175,.09,.6,'sine',.09);},soft=()=>tone(233,0,.28,'triangle',.08);
 const chirp=i=>{const f=i?2900:2600;[0,.16].forEach(d=>tone(f,d,.12,'sine',.07,f*1.3));tone(f*1.15,.34,.18,'sine',.06,f*.9);};
 const plop=()=>{tone(320,0,.25,'sine',.1,140);swish(500,900,.08);},knot=()=>{tone(220,0,.15,'triangle',.12,110);tone(330,.13,.18,'triangle',.1,160);};
 async function speak(text,auto=false){
  if(!text||dead)return false;if(speaking){if(auto)queued=text;return false;}
  const token=++speakGen;speaking=true;render();let ok=false,timer;
  try{ok=await Promise.race([Promise.resolve(playAudio?.({text})),new Promise(resolve=>{timer=later(()=>resolve(false),15000);})]);}catch{ok=false;}
  view.clearTimeout(timer);timers.delete(timer);if(dead||token!==speakGen)return false;speaking=false;
  if(ok===false){research.error('audio','audio_unavailable');if(!auto)tell('朗讀暫時未能播放，可以先看詩句，稍後再試。');}
  render();if(queued){const next=queued;queued=null;void speak(next,true);}
  return ok!==false;
 }
 async function readAll(){const g=++readGen;for(let k=0;k<LINES.length;k++){if(dead||g!==readGen)return;reading=k;render();if(!await speak(LINES[k])||g!==readGen)break;}if(!dead&&g===readGen){reading=-1;render();}}
 function won(text,clip){render();save();progress();tell(text);chime();void speak(clip,true);}
 // One running animation at a time (auto brush, window glide, rowing); reduced motion jumps straight to the end.
 function animate(ms,frame,end){stopAnim();moving=true;const g=animGen,t0=view.performance.now();
  const tick=now=>{if(dead||g!==animGen)return;const k=reducedMotion?1:Math.min(1,(now-t0)/ms);frame(k<.5?2*k*k:1-Math.pow(2-2*k,2)/2);if(k<1){animRaf=view.requestAnimationFrame(tick);return;}animRaf=0;moving=false;end?.();};
  render();if(reducedMotion)tick(t0);else animRaf=view.requestAnimationFrame(tick);}
 function stopAnim(){animGen++;view.cancelAnimationFrame(animRaf);animRaf=0;moving=false;}

 // Round 1: brush away the pale sketch over the willow, then make the two orioles sing.
 function redraw(){if(!g2)return;try{g2.globalCompositeOperation='source-over';g2.clearRect(0,0,1200,675);const src=q('[data-pc-src]');if(src.complete&&src.naturalWidth)g2.drawImage(src,0,0,1200,675);
  for(const c of paint)erase((c%24+.5)*66.667,(Math.floor(c/24)+.5)*64.286,70);}catch{}}
 function erase(x,y,rad){if(!g2)return;try{const cx=x*.75,cy=y*.75,rr=rad*.75,gr=g2.createRadialGradient(cx,cy,0,cx,cy,rr);gr.addColorStop(0,'#000');gr.addColorStop(.55,'#000');gr.addColorStop(1,'rgba(0,0,0,0)');
  g2.globalCompositeOperation='destination-out';g2.fillStyle=gr;g2.beginPath();g2.arc(cx,cy,rr,0,Math.PI*2);g2.fill();g2.globalCompositeOperation='source-over';}catch{}}
 function stamp(d,x,y){erase(x,y,90);for(const c of WILLOW){if(Math.hypot((c%24+.5)*66.667-x,(Math.floor(c/24)+.5)*64.286-y)>55)continue;d.hit++;if(!paint.has(c)){paint.add(c);d.fresh++;}}d.n++;if(d.fresh&&!d.sound){d.sound=true;swish(1200,2600,.12);}}
 function strokeTo(d,x,y){if(!d.last){stamp(d,x,y);d.last=[x,y];return;}const [lx,ly]=d.last,n=Math.ceil(Math.hypot(x-lx,y-ly)/20);for(let i=1;i<=n;i++)stamp(d,lx+(x-lx)*i/n,ly+(y-ly)*i/n);if(n)d.last=[x,y];}
 const setBrush=(x,y,r)=>{brush.style.setProperty('--bx',`${(x/16).toFixed(2)}%`);brush.style.setProperty('--by',`${(y/9).toFixed(2)}%`);brush.style.setProperty('--br',`${r}deg`);};
 const restBrush=()=>{brush.classList.remove('is-held');['--bx','--by','--br'].forEach(p=>brush.style.removeProperty(p));};
 function afterPaint(d){
  if(painted()){finishWillow();return;}
  save();
  if(d.fresh){misses=0;render();tell(paint.size>=60&&!halfSaid?(halfSaid=true,'綠了一大半，再刷一刷！'):'沙沙！柳葉變綠了。');return;}
  if(d.hit){tell('這裏已經綠了，再刷刷別的柳葉。');return;}
  misses++;soft();if(misses===2)research.hint('willow','target');render();tell('柳樹在左邊，在柳葉上刷一刷。');
 }
 function autoBrush(){
  if(!live()||round!==0||painted()||moving||!g2&&false)return;
  const rows=[];for(const c of WILLOW){const j=Math.floor(c/24);if(!paint.has(c)&&!rows.includes(j))rows.push(j);if(rows.length===3)break;}
  const path=[];rows.forEach((j,i)=>{const xs=WILLOW.filter(c=>Math.floor(c/24)===j&&!paint.has(c)).map(c=>(c%24+.5)*66.667),y=(j+.5)*64.286,a=Math.min(...xs)-30,b=Math.max(...xs)+30;path.push(...(i%2?[[b,y],[a,y]]:[[a,y],[b,y]]));});
  const pts=[path[0]];for(let i=1;i<path.length;i++){const [ax,ay]=path[i-1],[bx,by]=path[i],n=Math.max(1,Math.ceil(Math.hypot(bx-ax,by-ay)/20));for(let k=1;k<=n;k++)pts.push([ax+(bx-ax)*k/n,ay+(by-ay)*k/n]);}
  const d={fresh:0,hit:0,n:0,sound:false};let at=-1;brush.classList.add('is-held');swish(1200,2600,.12);
  animate(Math.min(1100,pts.length*9),k=>{const to=Math.round(k*(pts.length-1));while(at<to){at++;stamp(d,...pts[at]);}const [x,y]=pts[at];setBrush(x,y,-18);},()=>{restBrush();research.action('willow','button');afterPaint(d);});
 }
 function finishWillow(){
  research.answer('willow','green',true);misses=0;arriving=true;render();save();tell('柳樹變成翠綠了！「翠」是鮮亮的青綠色。');
  later(()=>{arriving=false;render();presentStep();tell('兩隻黃鸝飛來了！點一點牠們，聽聽牠們唱歌。');},reducedMotion?0:1800);
 }
 function sing(i){
  if(!ready||dead)return;const fin=finished();if(!fin&&round===0&&(!painted()||arriving))return;
  chirp(i);const b=birdEls[i];b.classList.remove('is-sing');void b.offsetWidth;b.classList.add('is-sing');later(()=>b.classList.remove('is-sing'),950);
  if(!live()||round!==0||sung.has(i))return;
  sung.add(i);research.action('orioles',`bird.${i}`);
  if(sung.size<2){render();save();tell('啾啾！黃鸝唱歌了。還有一隻呢？');return;}
  research.answer('orioles','sing',true);won('「兩個」黃鸝在「翠」綠的柳樹上「鳴」叫，春天又有聲音又有顏色！',LINES[0]);
 }

 // Round 2: the egrets fly from the river bank into one line in the sky (上青天).
 function placeEgret(k,from,slot){
  if(!live()||round!==1||egrets[k]>=0)return;
  const s=slot??[0,1,2,3].find(t=>fits(k,t)&&!egrets.includes(t));if(s==null)return;
  egrets[k]=s;research.action('egrets',`group.${k}`);swish();
  const [l,t,w,h]=SLOTS[s],[x,y,,bh]=BANK[k],[fx,fy]=from||[x,y-bh/.5625/2],el=slotImgs[s];
  el.style.setProperty('--fx',`${(fx-(l+w/2-2)).toFixed(2)}cqw`);el.style.setProperty('--fy',`${((fy-(t+h/2+6))*.5625).toFixed(2)}cqw`);
  el.classList.remove('is-in');void el.offsetWidth;if(!reducedMotion)el.classList.add('is-in');
  if(egrets.every(v=>v>=0)){research.answer('egrets','line',true);misses=0;rising=true;later(()=>{rising=false;render();},reducedMotion?0:1300);won('「一行」是一排；白鷺排成一行，飛上「青天」——藍藍的天空。',LINES[1]);return;}
  const left=egrets.reduce((n,v,j)=>n+(v<0?BIRDS[j]:0),0);render();save();tell(`撲撲！白鷺飛上天了，岸邊還有 ${left} 隻。`);
 }
 function dropEgret(k,px,py){
  let best=-1,bd=Infinity;SLOTS.forEach(([l,t,w,h],s)=>{if(!fits(k,s)||egrets.includes(s))return;const dd=Math.hypot((l+w/2-2-px)*16,(t+h/2+6-py)*9);if(dd<bd){bd=dd;best=s;}});
  if(best>=0&&(bd<=200||py<45)){placeEgret(k,[px,py],best);return;}
  research.answer('egrets','miss',false);misses++;soft();if(misses===2)research.hint('egrets','target');render();tell('白鷺要飛上青天，把牠放到天上的虛線框裏。');
 }

 // Round 3: open the shutters, then move the window until it 「含」 the snowy 西嶺.
 function setLens(x,y){wx=clamp(x,36,89);wy=clamp(y,20.7,79.3);world.style.setProperty('--wx',wx.toFixed(2));world.style.setProperty('--wy',wy.toFixed(2));}
 function openWindow(){if(!live()||round!==2||win!==0)return;win=1;tone(190,0,.5,'triangle',.1,95);research.answer('window','open',true);render();save();presentStep();tell('窗開了！遠方雲霧裏好像藏着甚麼……');}
 function framed(){
  if(!live()||round!==2||win!==1)return;stopAnim();win=2;setLens(...TARGET);research.answer('peak','framed',true);misses=0;ding();revealing=true;
  later(()=>{revealing=false;render();},reducedMotion?0:1500);won('找到了！「含」好像窗把雪山含在口裏；「千秋雪」是千年不化的積雪。',LINES[2]);
 }
 function lensMiss(){
  research.answer('peak','miss',false);misses++;if(misses===1)research.hint('peak','direction');if(misses===2)research.hint('peak','target');soft();render();save();
  const dx=(TARGET[0]-wx)*16,dy=(TARGET[1]-wy)*9;tell(`雪山藏在雲霧後面，把窗框往${Math.abs(dx)>=Math.abs(dy)?(dx>0?'右':'左'):(dy>0?'下':'上')}移一移。`);
 }
 function glideLens(x,y,end){const x0=wx,y0=wy,x1=clamp(x,36,89),y1=clamp(y,20.7,79.3);animate(350,k=>setLens(x0+(x1-x0)*k,y0+(y1-y0)*k),end);}
 function nudgeLens(){if(!live()||round!==2||win!==1||moving)return;research.action('peak','nudge');glideLens(wx+(TARGET[0]-wx)*.55,wy+(TARGET[1]-wy)*.55,()=>{if(lensGap()<=100)framed();else{render();save();tell('窗框移近了，再移一移，雪山就在前面。');}});}

 // Round 4: row the boat from far away (東吳) to the door, then tie its rope to the post (泊).
 function boatAt(t){const n=PATH.length-1,u=clamp(t,0,1)*n,i=Math.min(n-1,Math.floor(u)),f=u-i,a=PATH[i],b=PATH[i+1];return a.map((v,j)=>v+(b[j]-v)*f);}
 const anchor=t=>{const [x,y,s]=boatAt(t);return [x,y-.48*275.5*s];};
 function setBoat(t){boat=clamp(t,0,1);const [x,y,s]=boatAt(boat);boatEl.style.setProperty('--bx',`${(x/16).toFixed(3)}%`);boatEl.style.setProperty('--by',`${(y/9).toFixed(3)}%`);boatEl.style.setProperty('--bs',s.toFixed(4));}
 function nearestT(px,py){let best=boat,bd=Infinity;for(let i=0;i<=200;i++){const [x,y]=anchor(i/200),d=Math.hypot(x-px,y-py);if(d<bd){bd=d;best=i/200;}}return best;}
 function rope(){const [x0,y0]=KNOB,[x1,y1]=tied?TIE:[kx,ky],mx=(x0+x1)/2,my=Math.max(y0,y1)+(tied?14:32);q('.pc-rope path').setAttribute('d',`M${x0} ${y0}Q${mx.toFixed(1)} ${my.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`);knobEl.style.left=`${(x1/16).toFixed(2)}%`;knobEl.style.top=`${(y1/9).toFixed(2)}%`;}
 function arrive(){stopAnim();setBoat(1);research.answer('boat','arrive',true);plop();kx=KNOB[0];ky=KNOB[1];rope();render();save();presentStep();tell('船到門前了！把繩子拉到木樁上，把船泊好。');}
 function rowBy(dt,why){if(!live()||round!==3||boat>=1||moving)return;if(why)research.action('boat',why);plop();const a=boat,b=clamp(boat+dt,0,1);
  animate(why?600:220,k=>setBoat(a+(b-a)*k),()=>{if(boat>=.97){arrive();return;}render();save();if(why)tell(boat<.5?'划呀划，船慢慢靠近了。':'快到了！再划一划。');});}
 function tie(){if(!live()||round!==3||boat<1||tied)return;cancelDrag();stopAnim();tied=true;mooring=true;knot();research.answer('moor','tie',true);misses=0;rope();
  later(()=>{mooring=false;render();},reducedMotion?0:900);won('「泊」是停船靠岸。這船從遙遠的「東吳」來，走了「萬里」路。',LINES[3]);}
 function ropeBack(){const x0=kx,y0=ky;animate(300,k=>{kx=x0+(KNOB[0]-x0)*k;ky=y0+(KNOB[1]-y0)*k;rope();});}

 function finish(){
  if(!live()||round!==3||!tied||mooring)return;
  round=4;speakGen++;speaking=false;queued=null;readGen++;reading=-1;note=null;render();save();chime();
  if(!reported){reported=true;research.complete();onComplete?.({correct:true,response:state(),knowledge:KNOWLEDGE});}
  tell('點「聲、色、動、靜」看一看這幅畫。');q('[data-pc-note]')?.focus({preventScroll:true});void load();
 }
 function showNote(id){if(!ready||!finished()||!NOTES[id])return;note=note===id?null:id;if(note&&!readOnly)research.action('finale',`note.${id}`);if(note==='sound'){chirp(0);later(()=>chirp(1),450);}render();tell(note?NOTES[note]:'點「聲、色、動、靜」看一看這幅畫。');}
 function primary(){
  if(!live()||moving||arriving)return;
  if(stepDone(round)){if(!rising&&!mooring)next();return;}
  if(round===0){if(!painted())autoBrush();else sing(sung.has(0)?1:0);}
  else if(round===1){const k=egrets.findIndex(s=>s<0);if(k>=0)placeEgret(k);}
  else if(round===2){if(win===0)openWindow();else nudgeLens();}
  else if(boat<1)rowBy(.25,'row');else tie();
 }
 function next(){
  if(!live()||!stepDone(round))return;if(round===3){finish();return;}
  round++;misses=0;tell('');render();save();void load();q('[data-pc-primary]').focus({preventScroll:true});
 }

 // Pointer play: brush strokes, egret drags, window and boat drags, the rope; a short press counts as a tap.
 function paintFrame(){
  raf=0;const d=drag;if(!d||dead)return;const [px,py]=worldPct(d.px,d.py);
  if(d.kind==='stroke'){const x=px*16,y=py*9;strokeTo(d,x,y);d.tilt=d.tilt*.6+clamp((d.px-d.lx)*1.6,-26,26)*.4;d.lx=d.px;setBrush(x,y,Math.round(-6+d.tilt));}
  else if(d.kind==='egret'){d.el.style.setProperty('--dx',`${d.px-d.x}px`);d.el.style.setProperty('--dy',`${d.py-d.y}px`);}
  else if(d.kind==='window'){setLens(px-d.ox,py-d.oy);if(lensGap()<=70){cancelDrag();framed();}}
  else if(d.kind==='boat'){const t=nearestT(px*16-d.ox,py*9-d.oy),step=clamp(t-boat,-.04,.04);setBoat(boat+step);if(boat>=.97){cancelDrag();arrive();return;}if(Math.abs(t-boat)>.002)raf=view.requestAnimationFrame(paintFrame);}
  else if(d.kind==='rope'){kx=clamp(px*16,40,1590);ky=clamp(py*9,40,890);rope();if(Math.hypot(kx-TIE[0],ky-TIE[1])<=60)tie();}
 }
 function down(e){
  if(drag||!live()||moving||e.button>0||e.isPrimary===false)return;
  const t=e.target,btn=t.closest?.('button'),inWorld=!!t.closest?.('.pc-world');let kind=null,el=null;
  if(round===0&&!painted()&&!arriving&&!btn&&inWorld){kind='stroke';el=world;}
  else if(round===1&&(el=t.closest?.('[data-pc-egret]'))&&!el.disabled)kind='egret';
  else if(round===2&&(el=t.closest?.('[data-pc-window]'))&&!el.disabled)kind=win===0?'shutter':'window';
  else if(round===2&&win===1&&!btn&&inWorld){kind='tap';el=world;}
  else if(round===3&&boat<1&&(el=t.closest?.('[data-pc-boat]'))&&!el.disabled)kind='boat';
  else if(round===3&&boat>=1&&!tied&&(el=t.closest?.('[data-pc-knob]'))&&!el.disabled)kind='rope';
  if(!kind)return;
  if(e.cancelable)e.preventDefault();
  const [px,py]=worldPct(e.clientX,e.clientY);
  drag={kind,el,id:e.pointerId,x:e.clientX,y:e.clientY,px:e.clientX,py:e.clientY,lx:e.clientX,moved:0,tilt:0,ox:0,oy:0,fresh:0,hit:0,n:0,sound:false,last:null};
  try{el.setPointerCapture(e.pointerId);}catch{}
  if(kind==='stroke'){brush.classList.add('is-held');paintFrame();}
  else if(kind==='window'){drag.ox=px-wx;drag.oy=py-wy;drag.gap=lensGap();el.classList.add('is-held');}
  else if(kind==='boat'){const [ax,ay]=anchor(boat);drag.ox=px*16-ax;drag.oy=py*9-ay;el.classList.add('is-held');}
  else if(kind!=='tap')el.classList.add('is-held');
 }
 function move(e){
  if(!drag||e.pointerId!==drag.id)return;if(e.cancelable)e.preventDefault();
  drag.moved=Math.max(drag.moved,Math.hypot(e.clientX-drag.x,e.clientY-drag.y));drag.px=e.clientX;drag.py=e.clientY;
  if(drag.kind!=='tap'&&drag.kind!=='shutter'&&!raf)raf=view.requestAnimationFrame(paintFrame);
 }
 function cancelDrag(){
  const d=drag;drag=null;view.cancelAnimationFrame(raf);raf=0;if(!d)return null;try{d.el.releasePointerCapture(d.id);}catch{}suppressUntil=Date.now()+600;
  d.el.classList.remove('is-held');if(d.kind==='stroke')restBrush();if(d.kind==='egret'){d.el.style.removeProperty('--dx');d.el.style.removeProperty('--dy');}
  return d;
 }
 function settle(d,up,e){
  const tap=up&&d.moved<=10;
  if(d.kind==='stroke'){if(d.n){research.action('willow',d.moved>10?'stroke':'tap');afterPaint(d);}return;}
  if(d.kind==='egret'){const k=+d.el.dataset.pcEgret;if(tap)placeEgret(k);else if(up){const [px,py]=worldPct(e.clientX,e.clientY);dropEgret(k,px,py);}return;}
  if(d.kind==='shutter'){if(up)openWindow();return;}
  if(d.kind==='window'){if(tap)nudgeLens();else if(lensGap()<=100)framed();else if(d.moved>10){if(lensGap()<d.gap-40){research.action('peak','drag');render();save();tell('近了！再移一移，雪山就在前面。');}else lensMiss();}return;}
  if(d.kind==='tap'){if(tap){research.action('peak','tap');const [px,py]=worldPct(e.clientX,e.clientY);glideLens(px,py,()=>{if(lensGap()<=100)framed();else lensMiss();});}return;}
  if(d.kind==='boat'){if(tap)rowBy(.25,'row');else if(boat<1){research.action('boat','drag');render();save();}return;}
  if(d.kind==='rope'&&!tied){if(tap||Math.hypot(kx-TIE[0],ky-TIE[1])<=80){tie();return;}ropeBack();if(up){research.answer('moor','miss',false);misses++;soft();if(misses===2)research.hint('moor','target');render();tell('把繩子拉到右下角的木樁上。');}}
 }
 function release(e){
  if(!drag||e.pointerId!==drag.id)return;
  if(raf&&drag.kind!=='boat'){view.cancelAnimationFrame(raf);raf=0;paintFrame();}if(!drag)return;
  const d=cancelDrag();settle(d,e.type==='pointerup',e);
 }
 function dropDrag(){const d=cancelDrag();if(d)settle(d,false,null);}
 async function load(retry=false){
  const need=all(`[data-pc-need~="r${finished()?4:round}"]`),ok=img=>img.complete&&img.naturalWidth>0,box=q('.pc-loading');
  const go=()=>{ready=true;box.hidden=true;stage.setAttribute('aria-busy','false');if(round===0)redraw();render();presentStep();};
  if(!retry&&need.every(ok)){loadGen++;go();return;}
  if(retry)research.retry('assets');
  const token=++loadGen;ready=false;box.hidden=false;box.querySelector('span').textContent='畫紙正在鋪開…';q('[data-pc-retry]').hidden=true;stage.setAttribute('aria-busy','true');render();
  const unavailable=()=>{if(dead||token!==loadGen)return;research.error('assets');box.querySelector('span').textContent='圖片還在載入，可以再試一次。';q('[data-pc-retry]').hidden=false;stage.setAttribute('aria-busy','false');};
  try{
   if(retry)need.filter(img=>!ok(img)).forEach(img=>{const u=new URL(img.src);u.searchParams.set('retry',String(token));img.src=u.href;});
   await loadImages(need,{onTimeout:unavailable});
   if(dead||token!==loadGen)return;go();
  }catch{unavailable();}
 }
 root.addEventListener('pointerdown',down,opt);
 root.addEventListener('pointermove',move,{signal:abort.signal,passive:false});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(type,release,opt);
 for(const type of ['contextmenu','selectstart','dragstart'])root.addEventListener(type,e=>{if(e.target.closest?.('.pc-stage')&&e.cancelable)e.preventDefault();},opt);
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden)dropDrag();},opt);
 view.addEventListener('blur',()=>dropDrag(),opt);
 root.addEventListener('keydown',e=>{
  const move={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key],t=e.target;if(!move||drag)return;
  if(t.closest?.('[data-pc-window]')&&live()&&round===2&&win===1){e.preventDefault();stopAnim();setLens(wx+move[0]*3,wy+move[1]*4);if(lensGap()<=70)framed();else save();}
  else if(t.closest?.('[data-pc-boat]')&&live()&&round===3&&boat<1){e.preventDefault();rowBy(move[0]+move[1]>0?.1:-.1);}
 },opt);
 root.addEventListener('click',e=>{
  const t=e.target,fresh=e.detail===0||Date.now()>suppressUntil,bird=t.closest?.('[data-pc-bird]'),egret=t.closest?.('[data-pc-egret]'),n=t.closest?.('[data-pc-note]');
  if(bird)sing(+bird.dataset.pcBird);
  if(egret&&fresh)placeEgret(+egret.dataset.pcEgret);
  if(t.closest?.('[data-pc-window]')&&fresh){if(win===0)openWindow();else nudgeLens();}
  if(t.closest?.('[data-pc-boat]')&&fresh)rowBy(.25,'row');
  if(t.closest?.('[data-pc-knob],[data-pc-post]')&&fresh)tie();
  if(n)showNote(n.dataset.pcNote);
  if(t.closest?.('[data-pc-primary]'))primary();
  if(t.closest?.('[data-pc-retry]'))void load(true);
  if(t.closest?.('[data-pc-listen]')&&!speaking&&reading<0){research.hint(finished()?'game':step(),'audio');if(finished())void readAll();else void speak(LINES[round]);}
 },opt);
 setBoat(boat);rope();render();
 tell(finished()?'點「聲、色、動、靜」看一看這幅畫。':round===0&&!painted()?'用手指在柳樹上來回刷，也可以按「刷一刷」。':'');void load();
 return {
  showSolution(){if(dead||solved)return;research.hint('game','reveal');cancelDrag();stopAnim();solved=true;arriving=rising=revealing=mooring=false;note=null;full();setLens(...TARGET);setBoat(1);rope();render();void load();tell('看看整幅春景：黃鸝、白鷺、雪山和門前的船都畫好了。');},
  reset(){
   if(dead||readOnly)return;research.reset();cancelDrag();stopAnim();timers.forEach(id=>view.clearTimeout(id));timers.clear();
   paint.clear();sung.clear();round=0;egrets=[-1,-1,-1,-1];win=0;boat=0;tied=false;solved=false;reported=false;
   arriving=rising=revealing=mooring=false;misses=0;halfSaid=false;note=null;speaking=false;queued=null;speakGen++;readGen++;reading=-1;kx=KNOB[0];ky=KNOB[1];
   setLens(...START);setBoat(0);rope();restBrush();slotImgs.forEach(el=>el.classList.remove('is-in'));birdEls.forEach(b=>b.classList.remove('is-sing'));redraw();
   render();tell('畫紙又變白了，再畫一次春景吧！');onState?.(state());onProgress?.({completed:0,total:4});void load();
  },
  destroy(){if(dead)return;dead=true;loadGen++;speakGen++;readGen++;cancelDrag();stopAnim();abort.abort();timers.forEach(id=>view.clearTimeout(id));timers.clear();try{void audioContext?.close().catch(()=>{});}catch{}root.remove();}
 };
}
