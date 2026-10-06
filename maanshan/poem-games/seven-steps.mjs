import {createGameImageLoader} from './image-ready.mjs?v=20260922-school11';
import {imageAsset} from '../media-images.mjs?v=20261006-school42';
import {createProcessResearch} from './research.mjs?v=20260920a';
const file = path => new URL(imageAsset(`media/${path}`), import.meta.url).href;
const art = name => file(`qi-bu-shi/game/${name}.webp`), scene = n => file(`qi-bu-shi/scene-${n}.webp`);
// Seven untimed actions; each lights one of 曹植's seven footprints. Coordinates are % of the 1600×900 scenes.
// Step s6 zooms into scene-3, where the user's painting grows one bean plant out of the steam: tap its root and light
// runs up to the 萁 (stalk) and the 豆 (pods). ZOOM maps a scene % to the zoomed stage: ((x-l)*s, y*s).
const steps = [
  {id:'s1',verse:'煮豆持作羹',task:'把一籃黃豆放進釜裏，煮豆子。',method:'可以拖過去，也可以先點黃豆，再點釜。'},
  {id:'s2',verse:'漉豉以為汁',task:'把豆湯倒進竹篩，濾出豆汁。',method:'可以拖過去，也可以先點豆湯，再點竹篩。'},
  {id:'s3',verse:'萁在釜下燃',task:'「萁」是甚麼？選一捆來燒火。',method:'點一捆柴。',options:['stalks','firewood']},
  {id:'s4',verse:'萁在釜下燃',task:'萁在釜下燃：豆萁要放在哪裏？',method:'把豆萁拖過去，或點「釜中」「釜下」。'},
  {id:'s5',verse:'豆在釜中泣',task:'點一點釜中的豆子，聽聽它們。',method:'點三下釜中的豆子。'},
  {id:'s6',verse:'本是同根生',task:'豆和萁從哪裏長出來？點一點豆苗的根。',method:'點一下畫裏發亮的「根」。'},
  {id:'s7',verse:'相煎何太急',task:'豆和萁同一條根，比喻誰呢？',method:'點一個答案。',options:['brothers','friends','neighbours']}
];
const items = {basket:{name:'一籃黃豆',img:'bean-basket'},ladle:{name:'一瓢豆湯',img:'gourd-ladle'},stalks:{name:'豆子的莖',img:'bean-stalks'},firewood:{name:'木柴',img:'firewood'}};
const ZOOM = {l:11.25,s:1.6}, zoomed = (x,y) => [+((x-ZOOM.l)*ZOOM.s).toFixed(2),+(y*ZOOM.s).toFixed(2)];
const targets = {pot:{x:34,y:51.6,w:31,h:15},strainer:{x:71.4,y:64.4,w:25,h:17},stove:{x:29.2,y:90.5,w:21,h:16},root:{x:43.8,y:72.5,w:19,h:21}};
const tags = {qi:{x:29.6,y:23.5,name:'萁',say:'這是「萁」，就是豆子的莖。往下看，它連着甚麼？'},dou:{x:52.4,y:22,name:'豆',say:'這是「豆」，長在豆莢裏。它從哪裏長出來？往下找。'}};
// Light paths traced over scene-3's plant (1600×900 px): roots, stem, the pod branches (豆) and the dry stalk branches (萁).
const veins = [['M619 362C604 378 584 392 556 404S526 418 512 430',0],['M619 362C612 388 606 412 600 446',0],['M619 362C634 380 656 394 690 404S716 420 726 432',0],['M619 362C626 392 638 418 652 446',.05],['M619 362C598 372 576 380 548 384',.05],
  ['M619 362C615 335 612 305 613 275C614 240 618 205 630 168C626 140 619 116 612 92',.35],['M630 168C648 160 668 148 688 136S720 117 734 106 752 88 756 76',.85],['M688 136C694 142 699 148 702 158',1.05],['M734 106C750 104 762 108 772 120',1.1],
  ['M616 112C606 116 598 121 592 130',.8],['M610 284C594 262 572 245 550 233S526 210 516 204 500 202 494 206',.75],['M607 330C590 318 570 308 548 302',.6],['M627 293C640 275 650 262 662 255S680 232 686 214',.7]];
const pods = [[737,222,30,68,-28,1.25],[790,158,36,50,-25,1.35],[575,180,26,44,12,1.1]];
const kin = [{id:'brothers',name:'兄弟'},{id:'friends',name:'朋友'},{id:'neighbours',name:'鄰居'}];
const tears = [[26.5,53],[34.5,54.5],[42.5,52.5]];
const knowledge = '豆和豆萁從同一條根長出來，比喻曹植和曹丕是親兄弟；詩人用「泣」和「相煎何太急」勸哥哥不要互相傷害。';
const foot = '<svg viewBox="0 0 24 36" aria-hidden="true"><path d="M12.4 11.6c4.5.2 6.7 4.5 6.2 10.4-.5 6.4-3.1 11.6-7.4 11.3-4.1-.3-6.2-5.3-5.7-11.2.5-6.3 2.6-10.7 6.9-10.5Z"/><circle cx="6.3" cy="10" r="2"/><circle cx="9.3" cy="6.6" r="2.2"/><circle cx="13.2" cy="5.1" r="2.5"/><circle cx="17.1" cy="6.3" r="2.1"/><circle cx="19.6" cy="9.6" r="1.8"/></svg>';
const drop = '<svg viewBox="0 0 20 28" aria-hidden="true"><path d="M10 1.5C7 7 2.5 12.4 2.5 18.2a7.5 7.5 0 0 0 15 0C17.5 12.4 13 7 10 1.5Z"/><path class="ss-shine" d="M6.6 17.5c0-2 .9-3.8 2-5.2"/></svg>';
const ear = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 5-5 4H2v6h3l5 4ZM14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';

let uid = 0;
/** 「七步成詩」: cook, strain, choose the fuel, light it, hear the beans, find their one root, answer. */
export function mountSevenSteps(holder,{initialState,readOnly=false,playAudio,onState,onComplete,onResearch,reducedMotion=false,onProgress}={}){
  const doc=holder.ownerDocument,view=doc.defaultView,abort=new view.AbortController(),timers=new Set();
  const loadImages=createGameImageLoader({signal:abort.signal});
  const raw=initialState&&typeof initialState==='object'?initialState:{},init=raw.version===1||raw.gameCompleted===true?raw:{},picks0=init.picks&&typeof init.picks==='object'?init.picks:{};
  let step=Number.isInteger(init.step)?Math.max(0,Math.min(7,init.step)):0;
  if(init.gameCompleted===true)step=7;else if(step===7)step=6; // an unconfirmed finish asks the last question again so onComplete can fire
  let sobs=step===4&&Number.isInteger(picks0.sobs)?Math.max(0,Math.min(2,picks0.sobs)):0;
  // v1 drafts of the old s6 saved the word cards already put on the root; a partial pick simply replays the new s6.
  if(step===5&&Array.isArray(picks0.root)&&['dou','qi'].every(k=>picks0.root.includes(k)))step=6;
  let reported=step===7,dead=false,ready=false,solved=false,selected=null,drag=null,loadId=0,suppressUntil=0,lockUntil=0,audioUntil=0,tapUntil=0,keyboard=false,ctx=null,rooted=false,idleId=0;
  const uidv=`ss${++uid}`;
  const spoken=new Set(),research=createProcessResearch(onResearch,{prefix:'game.steps',alive:()=>!dead});
  const root=doc.createElement('section');root.className=`poem-seven-steps${reducedMotion?' is-reduced':''}`;root.setAttribute('aria-label','七步成詩');
  const pos=(t,k)=>`--x:${t.x}%;--y:${t.y}%;--w:${t.w}%;--h:${t.h}%`,tagPos=t=>{const [zx,zy]=zoomed(t.x,t.y);return `--x:${t.x}%;--y:${t.y}%;--zx:${zx}%;--zy:${zy}%`;};
  root.innerHTML=`<div class="ss-layout">
    <div class="ss-head"><p class="ss-instruction"></p><span class="ss-progress"></span></div>
    <div class="ss-stage" aria-busy="true">
      <div class="ss-cam">
      ${[1,2,3].map(n=>`<img class="ss-scene ss-scene-${n}" src="${scene(n)}" alt="" width="1600" height="900" draggable="false">`).join('')}
      <img class="ss-patch" data-ss-patch="pot" src="${art('pot-water')}" alt="" style="--l:18.5%;--t:45.333%;--w:32.25%" draggable="false">
      <img class="ss-patch" data-ss-patch="strainer" src="${art('strainer-empty')}" alt="" style="--l:59.375%;--t:57.778%;--w:24.375%" draggable="false">
      <img class="ss-patch" data-ss-patch="basin" src="${art('basin-empty')}" alt="" style="--l:56.562%;--t:73.333%;--w:27.188%" draggable="false">
      <i class="ss-glow" aria-hidden="true"></i>
      ${tears.map(([x,y],i)=>`<i class="ss-tear" data-ss-tear="${i}" style="--x:${x}%;--y:${y}%" aria-hidden="true">${drop}</i>`).join('')}
      <svg class="ss-veins" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true"><defs><filter id="${uidv}-blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7"/></filter>
        <radialGradient id="${uidv}-halo"><stop offset="0" stop-color="#fff2b8" stop-opacity=".95"/><stop offset=".55" stop-color="#ffd877" stop-opacity=".45"/><stop offset="1" stop-color="#ffd877" stop-opacity="0"/></radialGradient></defs>
        <ellipse class="ss-halo" cx="620" cy="398" rx="110" ry="58" fill="url(#${uidv}-halo)" style="--d:0s"/>
        ${pods.map(([x,y,rx,ry,r,d])=>`<ellipse class="ss-halo" cx="${x}" cy="${y}" rx="${rx*1.5}" ry="${ry*1.3}" transform="rotate(${r} ${x} ${y})" fill="url(#${uidv}-halo)" style="--d:${d}s"/>`).join('')}
        <g class="ss-vein-glow" filter="url(#${uidv}-blur)">${veins.map(([d,t])=>`<path d="${d}" pathLength="1" style="--d:${t}s"/>`).join('')}</g>
        <g class="ss-vein-line">${veins.map(([d,t])=>`<path d="${d}" pathLength="1" style="--d:${t}s"/>`).join('')}</g></svg>
      </div>
      ${Object.entries(tags).map(([k,t])=>`<span class="ss-token" data-ss-token="${k}" style="${tagPos(t)}" aria-hidden="true">${t.name}</span>`).join('')}
      <div class="ss-fx" aria-hidden="true"></div>
      ${Object.entries(targets).map(([k,t])=>`<button type="button" class="ss-target ss-target-${k}" data-ss-target="${k}" style="${pos(t)}" hidden><span></span></button>`).join('')}
      <div class="ss-caption" hidden></div>
      <div class="ss-loading" role="status"><span>灶房正在展開…</span><button type="button" data-ss-retry hidden>再試一次</button></div>
    </div>
    <div class="ss-side">
      <div class="ss-walk" aria-hidden="true">${steps.map((_,i)=>`<i class="ss-foot${i%2?' is-right':''}">${foot}</i>`).join('')}<b class="ss-seal">詩</b><span class="ss-walker"><img src="${file('qi-bu-shi/avatar.webp')}" alt="" draggable="false"></span></div>
      <div class="ss-tray" role="group" aria-label="材料和答案">
        ${['basket','ladle','stalks','firewood'].map(k=>`<button type="button" class="ss-item" data-ss-item="${k}" hidden><img src="${art(items[k].img)}" alt="" draggable="false"><span>${items[k].name}</span></button>`).join('')}
        <div class="ss-sobs" hidden><span class="ss-sob-icons">${tears.map(()=>`<i>${drop}</i>`).join('')}</span><span class="ss-sob-text"></span></div>
        <div class="ss-family" hidden aria-hidden="true"><span class="ss-fam"><img src="${art('bean-basket')}" alt="" draggable="false"><b>豆</b></span><i class="ss-fam-line"></i><span class="ss-fam-root"><b>根</b><em>？</em></span><i class="ss-fam-line is-right"></i><span class="ss-fam"><b>萁</b><img src="${art('bean-stalks')}" alt="" draggable="false"></span></div>
        <div class="ss-kin" role="group" aria-label="豆和萁比喻誰" hidden><div>${kin.map(c=>`<button type="button" data-ss-kin="${c.id}">${c.name}</button>`).join('')}</div></div>
        <div class="ss-summary" hidden><b>本是同根生，相煎何太急</b><p>${knowledge}</p></div>
      </div>
      <div class="ss-actionline"><span class="ss-method"></span><button type="button" class="ss-audio" data-ss-audio>${ear}<span>聽這句詩</span></button></div>
      <p class="ss-feedback" role="status" aria-live="polite"></p>
    </div></div>`;
  holder.append(root);
  const q=s=>root.querySelector(s),qa=s=>[...root.querySelectorAll(s)],stage=q('.ss-stage');
  const tell=t=>{if(!dead)q('.ss-feedback').textContent=t;};
  const later=(fn,ms)=>{const id=view.setTimeout(()=>{timers.delete(id);if(!dead)fn();},ms);timers.add(id);return id;};
  const shown=()=>solved||readOnly?7:step,live=()=>!dead&&ready&&!readOnly&&!solved&&step<7;
  const state=()=>({version:1,step,picks:{...(step>=3?{fuel:'stalks'}:{}),...(step===4&&sobs?{sobs}:{}),...(step===7?{kin:'brothers'}:{})}});
  const save=()=>{if(!dead&&!readOnly&&!solved)onState?.(state());};
  const verseNow=()=>shown()===7?'本是同根生，相煎何太急':steps[shown()].verse;
  const draggable=k=>({basket:0,ladle:1,stalks:3})[k]===step;
  const trayFor=n=>({0:['basket'],1:['ladle'],2:['stalks','firewood'],3:['stalks']})[n]||[];
  const targetsFor=n=>({0:['pot'],1:['strainer'],3:['pot','stove'],4:['pot'],5:['root']})[n]||[];
  const label=(k,n)=>k==='pot'?(n===3?'釜中':n===4?'點豆子':'釜'):k==='strainer'?'竹篩':k==='stove'?'釜下':'根';

  function render(){
    const n=shown(),on=live();
    root.dataset.step=String(n);root.classList.toggle('is-done',n===7);root.classList.toggle('is-readonly',readOnly);root.classList.toggle('is-selecting',!!selected);root.classList.toggle('is-rooted',rooted&&n===5);
    q('.ss-instruction').innerHTML=(n===7?'七步走完，詩也作好了！':steps[n].task).replace(/[，：？。！]/g,'$&|').split('|').filter(Boolean).map(t=>`<span>${t}</span>`).join('');
    q('.ss-progress').textContent=`${n} / 7`;q('.ss-progress').setAttribute('aria-label',`已走 ${n} 步，共 7 步`);
    q('.ss-walk').style.setProperty('--at',String(n));qa('.ss-foot').forEach((el,i)=>el.classList.toggle('is-lit',i<n));q('.ss-seal').classList.toggle('is-lit',n===7);
    q('.ss-scene-2').classList.toggle('is-on',n>=4);q('.ss-scene-3').classList.toggle('is-on',n>=5);
    q('[data-ss-patch="pot"]').classList.toggle('is-on',n<1);qa('[data-ss-patch="strainer"],[data-ss-patch="basin"]').forEach(el=>el.classList.toggle('is-on',n<2));
    q('.ss-glow').classList.toggle('is-on',n>=4);
    qa('.ss-tear').forEach((el,i)=>el.classList.toggle('is-on',n===4&&i<sobs));
    const want=targetsFor(n);
    for(const el of qa('[data-ss-target]')){const k=el.dataset.ssTarget,show=want.includes(k)&&!readOnly&&!solved;el.hidden=!show;el.disabled=!on||!show||rooted;el.querySelector('span').textContent=label(k,n);
      el.classList.toggle('is-calling',show&&(!!selected||n===4||n===5));el.setAttribute('aria-label',k==='pot'&&n===4?'釜中的豆子，點一下聽聽':k==='root'?'豆苗的根，點一下':`放到${label(k,n)}`);}
    const tray=trayFor(n);
    for(const el of qa('[data-ss-item]')){const k=el.dataset.ssItem,show=tray.includes(k)&&!readOnly&&!solved;
      el.hidden=!show;el.disabled=!on;el.classList.toggle('is-draggable',draggable(k));
      el.setAttribute('aria-pressed',String(selected===k));if(k==='stalks')el.querySelector('span').textContent=n>=3?'豆萁':'豆子的莖';
      el.setAttribute('aria-label',n===2?`${el.textContent.trim()}，選這一捆`:`${el.textContent.trim()}，可以拖動，也可以點一下再點目的地`);}
    q('.ss-family').hidden=n!==5||readOnly||solved;
    q('.ss-sobs').hidden=n!==4||readOnly||solved;qa('.ss-sob-icons i').forEach((el,i)=>el.classList.toggle('is-on',i<sobs));q('.ss-sob-text').textContent=`豆子哭了 ${sobs} / 3 次`;
    q('.ss-kin').hidden=n!==6;qa('[data-ss-kin]').forEach(el=>{el.disabled=!on;});q('.ss-summary').hidden=n!==7;
    q('.ss-method').textContent=n===7?'再聽一次最後兩句。':steps[n].method;
    const cap=n===7?['本是同根生，','相煎何太急。']:rooted&&n===5?['本是同根生']:[];q('.ss-caption').hidden=!cap.length;
    if(q('.ss-caption').dataset.text!==cap.join('')){q('.ss-caption').dataset.text=cap.join('');q('.ss-caption').innerHTML=cap.map(t=>`<span>${t}</span>`).join('');}
    stage.setAttribute('aria-label',['灶上有一個大釜，旁邊有竹篩和瓦盆。','釜裏煮着豆子，竹篩下有一盆豆汁。','釜裏煮着豆子，灶口還沒有生火。','釜裏煮着豆子，灶口還沒有生火。','豆萁在釜下燒起來，豆子在釜中翻滾。','蒸氣裏長出一棵豆苗：上面掛着豆莢，有乾了的豆萁，下面是一條根。','蒸氣裏長出一棵豆苗：豆和萁同一條根。','蒸氣裏長出一棵豆苗：豆和萁同一條根。'][n]);
  }
  function present(){if(ready&&live()){research.present(steps[step].id,{position:step,total:7,...(steps[step].options?{optionOrder:steps[step].options}:{})});if(step===5)waitRoot();}}
  // s6 idle help: after a few quiet seconds the root ripples; a little later the feedback line says where to look.
  function stopIdle(){if(idleId){view.clearTimeout(idleId);timers.delete(idleId);idleId=0;}}
  function waitRoot(ms=4000){
    stopIdle();if(!live()||step!==5||rooted)return;
    idleId=later(()=>{idleId=0;if(!live()||step!==5||rooted)return;q('.ss-target-root').classList.add('is-hint');research.hint('s6','idle');
      idleId=later(()=>{idleId=0;if(live()&&step===5&&!rooted)tell('看看豆苗最下面：一絲絲白色的，就是根。點一下。');},4000);},ms);
  }
  function findRoot(){
    if(!live()||step!==5||rooted||Date.now()<lockUntil)return;
    research.action('s6','root');rooted=true;stopIdle();q('.ss-target-root').classList.remove('is-hint');render();tone('ok');
    tell('看！光從根走上來，走到萁，也走到豆。');
    later(()=>{if(live()&&step===5)speak('本是同根生',true);},reducedMotion?0:1500);
    later(()=>{if(!live()||step!==5)return;rooted=false;advance('豆和萁本來長在同一棵豆苗上，從同一條根長出來。現在，萁卻在釜下燒着豆。','本是同根生');},reducedMotion?1800:4000);
  }
  function missRoot(tag){
    if(!live()||step!==5||rooted||Date.now()<lockUntil)return;research.hint('s6',tag?`tag.${tag}`:'miss');tone('soft');
    tell(tag?tags[tag].say:'根在豆苗最下面，就在釜上面那一團白色的鬚。點一下。');q('.ss-target-root').classList.add('is-hint');waitRoot(6000);
  }
  function tone(kind){
    if(dead)return;try{ctx??=new(view.AudioContext||view.webkitAudioContext)();if(ctx.state==='suspended')void ctx.resume().catch(()=>{});
      const now=ctx.currentTime,notes=kind==='ok'?[[523,0],[784,.1]]:kind==='bubble'?[[190,0],[260,.08],[210,.17]]:kind==='soft'?[[262,0]]:[[392,0]];
      for(const [f,t] of notes){const o=ctx.createOscillator(),g=ctx.createGain();o.type=kind==='bubble'?'sine':'triangle';o.frequency.setValueAtTime(f,now+t);if(kind==='bubble')o.frequency.exponentialRampToValueAtTime(f*1.7,now+t+.07);
        g.gain.setValueAtTime(.0001,now+t);g.gain.exponentialRampToValueAtTime(kind==='soft'?.07:.13,now+t+.012);g.gain.exponentialRampToValueAtTime(.0001,now+t+(kind==='ok'?.35:.18));o.connect(g);g.connect(ctx.destination);o.start(now+t);o.stop(now+t+.4);}
    }catch{}
  }
  function speak(text,auto){
    // One clip at a time: auto clips wait for the previous clip (12 s safety cap); a quick double tap is ignored.
    if(dead||!playAudio)return;const now=Date.now();
    if(auto){if(spoken.has(text)||now<audioUntil)return;spoken.add(text);}else if(now<tapUntil)return;
    tapUntil=now+700;const token=audioUntil=now+12000,done=()=>{if(audioUntil===token)audioUntil=0;};
    Promise.resolve().then(()=>playAudio({text})).then(ok=>{done();if(ok===false){research.error('audio','audio_unavailable');if(!auto)tell('朗讀暫時未能播放，可以先看詩句，稍後再試。');}}).catch(()=>{done();research.error('audio','audio_unavailable');});
  }
  function spawn(cls,style,html='',ms=1600){if(reducedMotion)return null;const el=doc.createElement(html.startsWith('<img')?'span':'i');el.className=cls;el.setAttribute('style',style);el.innerHTML=html;q('.ss-fx').append(el);later(()=>el.remove(),ms);return el;}
  // Keyboard users keep their place: when the focused control disappears, focus the next useful one.
  const visible=el=>!el.disabled&&!el.closest('[hidden]');
  function refocus(force){if(!keyboard)return;const a=doc.activeElement;if(!force&&root.contains(a)&&visible(a))return;if(!force&&a!==doc.body&&!root.contains(a))return;
    (force?['[data-ss-target]']:['[data-ss-item]','[data-ss-kin]','[data-ss-target]','[data-ss-audio]']).flatMap(qa).find(visible)?.focus();}
  function advance(message,verse){
    step++;selected=null;lockUntil=Date.now()+(reducedMotion?150:650);save();onProgress?.({completed:step,total:7});render();refocus();tell(message);tone('ok');
    if(verse)speak(verse,true);
    if(step===7){if(!reported){reported=true;research.complete();onComplete?.({correct:true,response:state(),knowledge});}}else present();
  }
  function hint(id,message){research.hint(id);tone('soft');tell(message);}
  function act(key,where){
    if(!live()||Date.now()<lockUntil)return;
    if(step===0&&key==='basket'&&where==='pot'){research.action('s1','pot');for(let i=0;i<9;i++)spawn('ss-bean',`--x:${23+i*2.3+(i%3)*.9}%;--d:${i*55}ms`,'',1500);advance('豆子下釜了！釜是古時煮食物的鍋。「煮豆持作羹」：煮豆子來做湯。','煮豆持作羹');}
    else if(step===1&&key==='ladle'&&where==='strainer'){research.action('s2','strainer');spawn('ss-pour','',`<img src="${art('gourd-ladle')}" alt="">`,1500);[67.6,69.4,71.2,73].forEach((x,i)=>spawn('ss-drip',`--x:${x}%;--d:${500+i*170}ms`,'',3600));advance('豆汁流下來了！「漉」就是過濾：豆渣留在竹篩上，豆汁流進盆裏。','漉豉以為汁');}
    else if(step===3&&key==='stalks'&&where==='stove'){research.action('s4','stove');spawn('ss-push','',`<img src="${art('bean-stalks')}" alt="">`,1300);advance('火點着了！豆萁在釜下面燒，這就是「萁在釜下燃」。','萁在釜下燃');}
    else if(step===3&&where==='pot'){research.action('s4','pot');hint('s4','釜中是煮豆子的地方。萁在釜「下」燃，放到下面的灶口吧。');}
  }
  function chooseFuel(key){
    if(!live()||step!==2||Date.now()<lockUntil)return;research.answer('s3',key,key==='stalks');
    if(key==='stalks')advance('對！「萁」就是豆子的莖，曬乾了可以燒火。');else hint('s3','詩裏燒的是豆子的莖，叫「萁」。再看看哪一捆掛着豆莢。');
  }
  function sob(){
    if(!live()||step!==4)return;sobs=Math.min(3,sobs+1);research.action('s5',`tap.${sobs}`);tone('bubble');
    const [x,y]=tears[sobs-1];spawn('ss-gudu',`--x:${x}%;--y:${y-15}%`,'咕嘟',1300);
    if(sobs===3){sobs=0;advance('豆子在釜中「咕嘟咕嘟」，好像在哭。把豆子寫得像人一樣會哭，這叫「擬人」。','豆在釜中泣');}
    else{save();render();tell(sobs===1?'咕嘟……豆子好像在小聲哭。再點一下。':'咕嘟咕嘟……還有一下。');}
  }
  function answerKin(id){
    if(!live()||step!==6||Date.now()<lockUntil)return;const ok=id==='brothers';research.answer('s7',id,ok);
    if(ok)advance('對！豆和萁就像兄弟。哥哥曹丕逼弟弟曹植，曹植問：同是兄弟，何必苦苦相逼？這就是「相煎何太急」。','相煎何太急');
    else hint('s7',`${id==='friends'?'朋友':'鄰居'}不是同一條根長出來的。豆和萁像一家人，曹丕和曹植是甚麼關係？`);
  }
  function pickItem(key){
    if(!live())return;
    if(step===2){chooseFuel(key);return;}
    if(!draggable(key))return;
    selected=selected===key?null:key;render();if(selected)refocus(true);
    if(selected)tell(`拿起了${items[key].name}，再點${step===0?'釜':step===1?'竹篩':'「釜中」或「釜下」'}。`);
  }
  function hitTarget(where){
    if(!live())return;
    if(step===4&&where==='pot'){sob();return;}
    if(step===5&&where==='root'){findRoot();return;}
    const only=trayFor(step).filter(draggable);const key=selected||(only.length===1?only[0]:null);
    if(key)act(key,where);
  }
  // Pointer drag with a floating copy; taps fall through to click (select, then target).
  function targetAt(x,y){return qa('[data-ss-target]').find(el=>{if(el.hidden||el.disabled)return false;const r=el.getBoundingClientRect(),pad=14;return x>=r.left-pad&&x<=r.right+pad&&y>=r.top-pad&&y<=r.bottom+pad;})||null;}
  function endDrag(){const d=drag;drag=null;if(!d)return null;d.ghost?.remove();d.over?.classList.remove('is-over');d.item.classList.remove('is-source');try{d.item.releasePointerCapture(d.id);}catch{}return d;}
  function down(e){
    const item=e.target.closest?.('[data-ss-item]');
    if(!item||drag||item.disabled||e.button>0||e.isPrimary===false||!live()||!draggable(item.dataset.ssItem))return;
    drag={id:e.pointerId,item,key:item.dataset.ssItem,x:e.clientX,y:e.clientY,moved:false,ghost:null,over:null};
    try{item.setPointerCapture(e.pointerId);}catch{}
  }
  function move(e){
    if(!drag||e.pointerId!==drag.id)return;
    if(!drag.moved&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<8)return;
    if(e.cancelable)e.preventDefault();
    if(!drag.moved){drag.moved=true;selected=drag.key;render();drag.item.classList.add('is-source');const g=doc.createElement('div');g.className='ss-ghost';g.setAttribute('aria-hidden','true');
      g.innerHTML=`<img src="${art(items[drag.key].img)}" alt="">`;root.append(g);drag.ghost=g;}
    drag.ghost.style.left=`${e.clientX}px`;drag.ghost.style.top=`${e.clientY}px`;
    const over=targetAt(e.clientX,e.clientY);if(over!==drag.over){drag.over?.classList.remove('is-over');over?.classList.add('is-over');drag.over=over;}
  }
  function up(e){
    if(!drag||e.pointerId!==drag.id)return;
    const d=endDrag();if(!d.moved)return;suppressUntil=Date.now()+450;
    const t=e.type==='pointerup'?targetAt(e.clientX,e.clientY):null;
    if(t)act(d.key,t.dataset.ssTarget);else if(e.type==='pointerup'){research.hint(steps[step].id,'missed_drop');tell('放到發亮的圈圈上就可以了。');}
    if(live()&&step<7&&selected===d.key&&!t){selected=null;render();}
  }
  async function load(){
    if(loadId)research.retry('assets');
    const id=++loadId;ready=false;const box=q('.ss-loading');box.hidden=false;box.querySelector('span').textContent='灶房正在展開…';q('[data-ss-retry]').hidden=true;stage.setAttribute('aria-busy','true');render();
    const unavailable=()=>{if(dead||id!==loadId)return;research.error('assets');box.querySelector('span').textContent='圖片還在載入，可以再試一次。';q('[data-ss-retry]').hidden=false;stage.setAttribute('aria-busy','false');};
    try{
      if(id>1)for(const img of root.querySelectorAll('img')){const u=new URL(img.src);u.searchParams.set('retry',String(id));img.src=u.href;}
      await loadImages(root.querySelectorAll('img'),{onTimeout:unavailable});
      if(dead||id!==loadId)return;ready=true;box.hidden=true;stage.setAttribute('aria-busy','false');render();present();onProgress?.({completed:shown(),total:7});
    }catch{unavailable();}
  }
  const opt={signal:abort.signal};
  root.addEventListener('pointerdown',down,opt);root.addEventListener('pointermove',move,{...opt,passive:false});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(type,up,opt);
  for(const type of ['contextmenu','selectstart','dragstart'])root.addEventListener(type,e=>{if(e.target.closest?.('[data-ss-item],.ss-stage')&&e.cancelable)e.preventDefault();},opt);
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)endDrag();},opt);view.addEventListener('blur',()=>endDrag(),opt);
  root.addEventListener('click',e=>{
    const t=e.target;
    if(t.closest('[data-ss-retry]')){void load();return;}
    if(t.closest('[data-ss-audio]')){if(!dead){research.hint(shown()===7?'game':steps[shown()].id,'audio');speak(verseNow(),false);}return;}
    if(e.detail!==0&&Date.now()<suppressUntil)return;
    const item=t.closest('[data-ss-item]');if(item){pickItem(item.dataset.ssItem);return;}
    const target=t.closest('[data-ss-target]');if(target){hitTarget(target.dataset.ssTarget);return;}
    const choice=t.closest('[data-ss-kin]');if(choice){answerKin(choice.dataset.ssKin);return;}
    if(step===5&&t.closest('.ss-stage,.ss-family'))missRoot(t.closest('[data-ss-token]')?.dataset.ssToken);
  },opt);
  root.addEventListener('keydown',e=>{keyboard=true;
    if(e.key==='Escape'&&selected&&live()){selected=null;render();tell('放下了。想再拿，就點一下。');return;}
    const group=e.target.closest?.('[data-ss-kin],[data-ss-item],[data-ss-target]'),dir={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1}[e.key];
    if(!group||!dir)return;const list=qa(group.matches('[data-ss-kin]')?'[data-ss-kin]':group.matches('[data-ss-item]')?'[data-ss-item]':'[data-ss-target]').filter(visible),i=list.indexOf(group);
    if(i>=0&&list.length>1){e.preventDefault();list[(i+dir+list.length)%list.length].focus();}},opt);
  root.addEventListener('pointerdown',()=>{keyboard=false;},{...opt,capture:true});
  render();tell(shown()===7?'曹丕聽了這首詩，覺得很慚愧。':step?'接着走下一步。每做好一件事，曹植就走一步。':'曹植要在七步之內作一首詩。每做好一件事，就走一步。');void load();
  return {
    showSolution(){if(dead||solved)return;endDrag();stopIdle();research.hint('game','reveal');solved=true;selected=null;rooted=false;render();tell('看看七步：煮豆、濾汁、用萁燒火，豆子在釜中哭泣；豆和萁本是同根生，比喻兄弟。');},
    reset(){if(dead||readOnly)return;endDrag();research.reset();timers.forEach(id=>view.clearTimeout(id));timers.clear();idleId=0;q('.ss-fx').replaceChildren();q('.ss-target-root').classList.remove('is-hint');
      step=0;sobs=0;rooted=false;solved=false;reported=false;selected=null;lockUntil=0;spoken.clear();render();tell('曹植要在七步之內作一首詩。每做好一件事，就走一步。');save();onProgress?.({completed:0,total:7});if(ready)present();else void load();},
    destroy(){if(dead)return;endDrag();dead=true;loadId++;abort.abort();timers.forEach(id=>view.clearTimeout(id));timers.clear();try{void ctx?.close().catch(()=>{});}catch{}root.remove();}
  };
}
