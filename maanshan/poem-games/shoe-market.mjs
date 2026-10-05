import {createGameImageLoader} from './image-ready.mjs?v=20260922-school11';
import {imageAsset} from '../media-images.mjs?v=20261005-school40';
import {createProcessResearch} from './research.mjs?v=20260920a';
const file = path => new URL(imageAsset(`media/${path}`), import.meta.url).href;
const art=name=>file(`zheng-ren-mai-lu/game/${name}.webp`),scene=n=>file(`zheng-ren-mai-lu/scene-${n}.webp`);
const LINES=['鄭人有且置履者，先自度其足而置之其坐','至之市，而忘操之，已得履，乃曰：「吾忘持度。」','反歸取之，及反，市罷，遂不得履','人曰：「何不試之以足？」曰：「寧信度，無自信也。」'];
const KNOW='鄭國人寧可相信量好的尺碼，也不相信自己的腳；做事要從實際出發，懂得變通。';
const DONE='完成了！兩個「度」、兩個「置」都貼對了。';
const MORAL='做事要靈活變通，不要死守教條，要相信實際情況。';
const cl=t=>t.replace(/(?:「[^」]*」|[^，。：；？！「])+[，。：；？！]*/g,m=>`<span>${m}</span>`);
const ALTS=['鄭人家中：坐榻的席子上放著一把尺，地上有腳印，他正走出門去市集。','熱鬧的市集鞋攤：鄭人拿著鞋子，才想起尺碼留在家裏。','黃昏，市集散了，鞋店關上木板，鄭人舉著尺子趕回來。','路人指著自己的腳，鄭人仍然舉著尺子。'];
// scene, official line, progress step, instruction (<=28 字), line card, gloss [char, pinyin, meaning]
const VIEW={
  measure:{scene:1,line:0,step:1,say:'先自度其足：拖紅繩結到腳尖，量一量。',text:'鄭人有且置履者，先自<b>度</b>其足',gloss:['度','duó','量一量']},
  place:{scene:1,line:0,step:1,say:'而置之其坐：把量好的尺放到坐榻上。',text:'先自度其足，而<b>置</b>之其<b>坐</b>',gloss:['坐','zuò','通「座」，座位']},
  placed:{scene:1,line:0,step:1,say:'尺碼放在座位上了，出發去市集買鞋！',text:'先自度其足，而<b>置</b>之其<b>坐</b>',gloss:['置','zhì','放']},
  market:{scene:2,line:1,step:2,say:'到了市集，才發現忘了帶尺碼！怎麼辦？',text:'至之市，而忘操之，已得履，乃曰：「吾忘持<b>度</b>。」',gloss:['度','dù','量好的尺碼']},
  closed:{scene:3,line:2,step:2,say:'他回家拿尺碼，趕回來時……敲敲店門。',text:'反歸取之，及反，市<b>罷</b>，遂不得履。',gloss:['罷','bà','結束，散了']},
  advice:{scene:4,line:3,step:2,say:'路人問了他一句話。你覺得誰說得對？',text:'人曰：「何不<b>試之以足</b>？」曰：「寧信度，無自信也。」',gloss:['寧','nìng','寧可']},
  try:{scene:2,line:3,step:3,say:'何不試之以足？用自己的腳試一試鞋。',text:'人曰：「何不<b>試之以足</b>？」',gloss:['足','zú','腳']},
  tag:{scene:0,line:0,step:4,say:'兩個「度」、兩個「置」：把標籤貼到畫中對的地方。'},
  done:{scene:0,line:3,step:4,say:'四個字義都貼好了！想一想故事的道理。'}
};
const STAGES=Object.keys(VIEW),STEP={measure:'measure',place:'measure',placed:'measure',market:'decide',closed:'decide',advice:'decide',try:'try',tag:'tag',done:'tag'};
const INTRO={measure:'紅繩結對準腳尖，就量好腳的長度。可以拖動，也可以點尺子，或用方向鍵。',place:'把量好的尺拖到畫中的坐榻上；也可以點尺，再點坐榻。',placed:'尺碼放在座位上了。按「去市集」出發吧。',market:'他挑好了鞋子，想對一對尺碼，才發現尺碼留在家裏！',closed:'他跑回家拿尺碼，再趕回市集……',advice:'有人問他：「為甚麼不用自己的腳試試呢？」',try:'回到鞋攤，用自己的腳試一試。點一下鞋子，或把鞋子拖到腳上。',tag:'把標籤拖到畫中對的東西上；也可以先點標籤，再點畫中的虛線框。'};
const ASK={market:['他忘了帶尺碼，怎麼辦？',['home','回家取度'],['foot','用自己的腳試']],advice:['路人和鄭人，誰說得對？',['passer','路人：用腳試試'],['zheng','鄭人：只信尺碼']]};
const SHOES=[{id:'big',label:'甲'},{id:'small',label:'乙'},{id:'right',label:'丙'}];
const FEEL={small:'太小了：腳跟露在外面，穿不進去。再試另一雙。',big:'太大了：鞋子鬆鬆的，一走就會掉。再試另一雙。',right:'剛剛好！用腳一試，就知道合不合腳。'};
// Word tags in tray order (度 column first); each belongs on one spot in the pictures.
const TAGS=[
  {id:'du-verb',char:'度',py:'duó',mean:'量一量',spot:'foot',phrase:'先自<b>度</b>其足',line:0,hint:'「先自度其足」的度是一個動作。哪裏正在量腳？'},
  {id:'zhi-buy',char:'置',py:'zhì',mean:'買',spot:'stall',phrase:'且<b>置</b>履者',line:0,hint:'「且置履者」的置是買。他要到哪裏買鞋？'},
  {id:'du-noun',char:'度',py:'dù',mean:'量好的尺碼',spot:'ruler',phrase:'吾忘持<b>度</b>',line:1,hint:'「吾忘持度」的度是一樣東西：量好的尺碼。它留在哪裏？'},
  {id:'zhi-put',char:'置',py:'zhì',mean:'放',spot:'seat',phrase:'而<b>置</b>之其坐',line:0,hint:'「而置之其坐」的置是放。他把尺碼放在甚麼上面？'}];
// Drop spots in scene pixels (1600×900): [x, y, w, h] plus an outline in the same box.
const SPOTS={
  foot:{name:'量腳的畫面'},
  ruler:{name:'坐榻上的尺',box:[370,445,305,85],shape:'<rect x="4" y="24.5" width="295" height="36" rx="18" transform="rotate(-6 151.5 42.5)"/>'},
  seat:{name:'坐榻（座位）',box:[130,400,810,230],shape:'<path d="M5 55 300 15 750 62 805 52 808 145 125 215 20 160Z"/>'},
  stall:{name:'市集的鞋攤',box:[930,370,670,230],shape:'<path d="M12 12 175 8 265 42 670 28 670 222 150 152 25 95Z"/>'}};
// Version 1 sorted sentence cards into these meanings; a correctly sorted card becomes a pinned tag.
const OLD={chi:'du-noun',zuo:'zhi-put',zu:'du-verb',lu:'zhi-buy'};
const FLIPS=[{id:'zuo',from:'坐',to:'座',mean:'座位',phrase:'而置之其<b>坐</b>',say:'「坐」通「座」，是座位。「而置之其坐」：把尺碼放在座位上。'},
  {id:'fan',from:'反',to:'返',mean:'回來',phrase:'<b>反</b>歸取之',say:'「反」通「返」，是回來。「反歸取之」：回家去拿尺碼。'}];
const TOE=74.94,TOL=3.2,START=40,MIN=8,MAX=96;
const voice='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m10 5-5 4H2v6h3l5 4ZM14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';

const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const pinHtml=t=>`<span class="sm-pin is-${t.id.split('-')[0]}" aria-hidden="true"><span class="sm-chip"><b>${t.char}</b><i>${t.py}</i>${t.mean}</span><small>${t.phrase}</small></span>`;
function spotHtml(id){
  const t=TAGS.find(x=>x.spot===id);
  if(id==='foot')return `<button type="button" class="sm-spot sm-vig" data-sm-spot="foot"><span class="sm-vig-art" aria-hidden="true"><img class="sm-vig-foot" src="${art('foot')}" alt="" draggable="false"><img class="sm-vig-ruler" src="${art('ruler')}" alt="" draggable="false"><i></i></span>${pinHtml(t)}</button>`;
  const [x,y,w,h]=SPOTS[id].box;
  return `<button type="button" class="sm-spot" data-sm-spot="${id}" style="left:${(x+w/2)/16}%;top:${(y+h/2)/9}%;width:${w/16}%;height:${h/9}%"><svg viewBox="0 0 ${w} ${h}" aria-hidden="true">${SPOTS[id].shape}</svg>${pinHtml(t)}</button>`;
}

/** 鄭人買履 as a market story: measure, decide, try on, then tag 度/置 meanings onto the pictures. */
export function mountShoeMarket(holder,{initialState,readOnly=false,playAudio,onState,onComplete,onResearch,reducedMotion=false,onProgress}={}){
  const doc=holder.ownerDocument,view=doc.defaultView,abort=new view.AbortController(),timers=new Set(),heard=new Set();
  const loadImages=createGameImageLoader({signal:abort.signal});
  // Version 2 pins tags on pictures; a version 1 state (sentence sorting) resumes in the tagging step.
  const init=plain(initialState)&&[1,2].includes(initialState.version)?initialState:{},v1=init.version===1;
  let stage=v1&&init.stage==='sort'?'tag':init.stage;stage=STAGES.includes(stage)?stage:'measure';
  let choice=['home','foot'].includes(init.choice)?init.choice:null,size=['small','right','big'].includes(init.size)?init.size:null;
  const pinned=new Set(),late=['tag','done'].includes(stage);
  if(late&&v1&&plain(init.sorted))for(const [card,id] of Object.entries(OLD))if(init.sorted[card]===id)pinned.add(id);
  if(late&&!v1&&Array.isArray(init.pinned))for(const id of init.pinned)if(TAGS.some(t=>t.id===id))pinned.add(id);
  if(stage==='done'&&pinned.size<TAGS.length)stage='tag';
  if(stage==='tag'&&pinned.size===TAGS.length)stage='done';
  if(['closed','advice'].includes(stage))choice='home';
  if(['measure','place','placed','market'].includes(stage))choice=null;
  if(stage!=='try')size=late?'right':null;
  if(late)choice??='foot';
  if(readOnly){stage='done';size='right';choice??='foot';TAGS.forEach(t=>pinned.add(t.id));}
  const misses={},demoed=new Set(),flipped=new Set();
  let kbUser=false,dead=false,ready=false,solved=false,reported=stage==='done',knot=START,knocked=false,agreed=false,selected=null,drag=null,suppress={until:0,x:0,y:0},loadId=0,audio=null,lastProgress=-1;
  const research=createProcessResearch(onResearch,{prefix:'game.shoe',alive:()=>!dead});
  const root=doc.createElement('section');root.className='poem-shoe-game';root.setAttribute('aria-label','市集買鞋記');
  if(reducedMotion)root.classList.add('is-reduced');
  root.innerHTML=`<div class="sm-frame"><header class="sm-head"><p class="sm-say"></p><span class="sm-progress"></span></header>
  <div class="sm-stage" aria-busy="true">
    ${ALTS.map((alt,i)=>`<img class="sm-scene" data-scene="${i+1}" src="${scene(i+1)}" alt="${alt}" width="1600" height="900" draggable="false">`).join('')}
    <img class="sm-patch" src="${art('mat-patch')}" alt="" draggable="false"><span class="sm-prints" aria-hidden="true"></span><span class="sm-mark" aria-hidden="true"></span>
    <button type="button" class="sm-seat" data-sm-seat aria-label="畫中的坐榻（座位）：把量好的尺放在這裏" hidden><span>坐榻</span></button>
    <button type="button" class="sm-knock" data-sm-knock aria-label="敲敲關了門的鞋店" hidden><span>敲敲店門</span></button>
    <span class="sm-sign" aria-hidden="true">市罷</span>
    <p class="sm-bubble is-forgot">吾忘持度！</p><p class="sm-bubble is-ask">何不試之以足？</p><p class="sm-bubble is-stubborn">寧信度，<br>無自信也。</p><p class="sm-bubble is-seller">試試看，<br>哪雙合腳？</p>
    <div class="sm-board" role="group" aria-label="故事圖：家中和市集">
      <div class="sm-pane is-home">${spotHtml('foot')}<div class="sm-canvas"><img class="sm-pic" src="${scene(1)}" alt="${ALTS[0]}" width="1600" height="900" draggable="false">${spotHtml('ruler')}${spotHtml('seat')}</div><span class="sm-place" aria-hidden="true">家中</span></div>
      <div class="sm-pane is-market"><div class="sm-canvas"><img class="sm-pic" src="${scene(2)}" alt="${ALTS[1]}" width="1600" height="900" draggable="false">${spotHtml('stall')}</div><span class="sm-place" aria-hidden="true">市集</span></div>
    </div>
    <div class="sm-loading" role="status"><span>市集正在展開…</span><button type="button" data-sm-retry hidden>再試一次</button></div>
  </div>
  <div class="sm-side"><div class="sm-panel">
    <div class="sm-text"><p class="sm-line"></p><button type="button" class="sm-gloss" data-sm-gloss></button></div>
    <div class="sm-measure" hidden><img class="sm-foot" src="${art('foot')}" alt="鄭人的腳，從側面看" draggable="false"><span class="sm-guide" aria-hidden="true"></span>
      <div class="sm-track" data-sm-drag="knot"><img class="sm-ruler" src="${art('ruler')}" alt="" draggable="false"><span class="sm-heel" aria-hidden="true"></span>
      <button type="button" class="sm-knot" data-sm-knot role="slider" aria-label="尺上的紅繩結，移到腳尖" aria-valuemin="${MIN}" aria-valuemax="${MAX}"><i></i></button></div></div>
    <button type="button" class="sm-card" data-sm-card data-sm-drag="card" aria-label="量好的尺碼：點一下拿起，再點畫中的坐榻；也可以拖過去" hidden><span class="sm-rule"><img src="${art('ruler')}" alt="" draggable="false"><i aria-hidden="true"></i></span><span>量好的尺碼</span></button>
    <div class="sm-ask" hidden><p></p><div>${[0,1].map(i=>`<button type="button" data-sm-choice="${i}"></button>`).join('')}</div></div>
    <div class="sm-fitting" hidden><div class="sm-fit" data-sm-fit><span class="sm-ground" aria-hidden="true"></span><img class="sm-foot" src="${art('foot')}" alt="鄭人自己的腳" draggable="false"><img class="sm-worn" src="${art('shoe-worn')}" alt="" draggable="false"></div>
      <div class="sm-tray">${SHOES.map(s=>`<button type="button" class="is-${s.id}" data-sm-shoe="${s.id}" data-sm-drag="shoe" aria-label="${s.label}：試穿這雙鞋"><img src="${art('shoe')}" alt="" draggable="false"><span>${s.label}</span></button>`).join('')}</div></div>
    <div class="sm-tags" hidden>${TAGS.map(t=>`<button type="button" class="is-${t.id.split('-')[0]}" data-sm-tag="${t.id}" data-sm-drag="tag"><span class="sm-face"><b>${t.char}</b><i>${t.py}</i><span>${t.mean}</span></span><span class="sm-used">✓ ${t.phrase}</span></button>`).join('')}</div>
    <div class="sm-moral" hidden><img src="${art('ruler')}" alt="" draggable="false"><b>寓意</b><p>${cl(MORAL)}</p><small>${cl(KNOW)}</small>
      <div class="sm-bonus"><p>小挑戰：點卡片，看看古人借用了哪個字。</p><div class="sm-flips">${FLIPS.map(f=>`<button type="button" class="sm-flip" data-sm-flip="${f.id}"><span class="sm-flip-in"><span class="sm-front"><b>${f.from}</b><small>通哪個字？</small></span><span class="sm-back"><span><b>${f.from}</b>通<b>${f.to}</b></span><small>${f.mean}・${f.phrase}</small></span></span></button>`).join('')}</div></div></div>
  </div>
  <div class="sm-actions"><button type="button" class="sm-listen" data-sm-listen>${voice}<span>聽這句</span></button><button type="button" class="sm-next" data-sm-next hidden></button></div>
  <p class="sm-feedback" role="status" aria-live="polite"></p></div></div>`;
  holder.append(root);
  const q=s=>root.querySelector(s),qa=s=>root.querySelectorAll(s),tell=t=>{if(!dead)q('.sm-feedback').innerHTML=cl(t);};
  const later=(fn,ms)=>{const id=view.setTimeout(()=>{timers.delete(id);if(!dead)fn();},ms);timers.add(id);};
  const state=()=>({version:2,stage,choice,size,pinned:TAGS.filter(t=>pinned.has(t.id)).map(t=>t.id)});
  const available=()=>!dead&&ready&&!readOnly&&!solved,can=s=>available()&&stage===s;
  const completed=()=>stage==='done'?4:stage==='tag'?3:stage==='try'?2:['measure','place'].includes(stage)?0:1;
  const tagOf=id=>TAGS.find(t=>t.id===id),filled=spot=>TAGS.some(t=>t.spot===spot&&pinned.has(t.id));
  function progress(){const n=completed();if(n!==lastProgress){lastProgress=n;onProgress?.({completed:n,total:4});}}
  function save(){if(readOnly||solved||dead)return;onState?.(state());progress();}
  function wiggle(el){if(!el||reducedMotion)return;el.classList.remove('is-wiggle');void el.offsetWidth;el.classList.add('is-wiggle');later(()=>el.classList.remove('is-wiggle'),520);}
  function tone(kind){
    try{audio??=new(view.AudioContext||view.webkitAudioContext)();if(audio.state==='suspended')void audio.resume().catch(()=>{});
      const now=audio.currentTime,notes={ding:[[660,0],[990,.1]],soft:[[330,0]],knock:[[170,0],[160,.17]],tock:[[520,0]],pin:[[784,0],[1175,.09]],win:[[523,0],[659,.1],[784,.2],[1047,.32]]}[kind]||[[440,0]];
      for(const [f,t] of notes){const o=audio.createOscillator(),g=audio.createGain(),end=now+t+(kind==='knock'?.13:.3);
        o.type=kind==='knock'?'triangle':'sine';o.frequency.setValueAtTime(f,now+t);if(kind==='knock')o.frequency.exponentialRampToValueAtTime(70,now+t+.1);
        g.gain.setValueAtTime(.001,now+t);g.gain.exponentialRampToValueAtTime(kind==='soft'?.07:.15,now+t+.01);g.gain.exponentialRampToValueAtTime(.001,end);
        o.connect(g);g.connect(audio.destination);o.start(now+t);o.stop(end+.02);}
    }catch{}
  }
  function speak(payload,loud){
    const step=STEP[stage];
    Promise.resolve().then(()=>playAudio?.(payload)).then(ok=>{if(ok===false){research.error(step,'audio_unavailable');if(loud)tell('聲音暫時未能播放，可以先看文字，稍後再試。');}})
      .catch(()=>{research.error(step,'audio_unavailable');if(loud)tell('聲音暫時未能播放，可以先看文字，稍後再試。');});
  }
  function autoLine(n){if(heard.has(n)||!available())return;heard.add(n);speak({text:LINES[n]},false);}
  function setKnot(v){
    knot=Math.max(MIN,Math.min(MAX,v));q('.sm-measure').style.setProperty('--knot',`${knot}%`);
    const k=q('[data-sm-knot]'),off=knot-TOE;k.setAttribute('aria-valuenow',String(Math.round(knot)));
    k.setAttribute('aria-valuetext',Math.abs(off)<=TOL?'對準腳尖':off<0?'在腳尖後面':'超過了腳尖');
  }
  function present(){
    if(!available())return;
    if(STEP[stage]==='measure')research.present('measure');
    else if(stage==='market')research.present('decide',{optionOrder:['home','foot']});
    else if(stage==='try')research.present('try',{optionOrder:SHOES.map(s=>s.id)});
    else if(stage==='tag')research.present('tag',{optionOrder:TAGS.map(t=>t.id)});
  }
  function passed(){return stage==='placed'||stage==='closed'&&knocked||stage==='advice'&&agreed||stage==='try'&&size==='right';}
  function render(){
    const v=VIEW[stage],on=available();
    root.dataset.stage=stage;root.classList.toggle('is-readonly',readOnly);
    q('.sm-say').innerHTML=cl(v.say);q('.sm-progress').textContent=`${v.step} / 4`;q('.sm-progress').setAttribute('aria-label',`第 ${v.step} 步，共 4 步`);
    qa('.sm-scene').forEach(img=>{const show=+img.dataset.scene===v.scene;img.classList.toggle('is-on',show);img.setAttribute('aria-hidden',String(!show));});
    q('.sm-patch').classList.toggle('is-on',stage==='measure'||stage==='place');
    q('.sm-prints').classList.toggle('is-on',stage==='measure');
    q('.sm-mark').classList.toggle('is-on',v.scene===1&&!['measure','place'].includes(stage));
    const seat=q('[data-sm-seat]');seat.hidden=stage!=='place';seat.disabled=!on;seat.classList.toggle('is-ready',selected==='ruler');
    const knock=q('[data-sm-knock]');knock.hidden=stage!=='closed'||knocked;knock.disabled=!on;
    q('.sm-sign').classList.toggle('is-on',stage==='closed'&&knocked);
    q('.is-forgot').classList.toggle('is-on',stage==='market');q('.is-seller').classList.toggle('is-on',stage==='try');
    q('.is-ask').classList.toggle('is-on',stage==='advice');q('.is-stubborn').classList.toggle('is-on',stage==='advice');
    const tagging=stage==='tag'&&on,sel=tagOf(selected),glow=sel&&(misses[sel.id]||0)>=2?sel.spot:null;
    q('.sm-board').classList.toggle('is-on',stage==='tag'||stage==='done');root.classList.toggle('is-picking',tagging&&!!sel);
    qa('[data-sm-spot]').forEach(b=>{const id=b.dataset.smSpot,t=TAGS.find(x=>x.spot===id),got=pinned.has(t.id);
      b.classList.toggle('is-filled',got);b.classList.toggle('is-hint',tagging&&glow===id);b.disabled=!tagging||got;
      b.setAttribute('aria-label',got?`${SPOTS[id].name}：貼著「${t.char} ${t.py}，${t.mean}」`:`${SPOTS[id].name}：把標籤貼在這裏`);});
    q('.sm-tags').hidden=stage!=='tag';
    qa('[data-sm-tag]').forEach(b=>{const t=tagOf(b.dataset.smTag),used=pinned.has(t.id);b.classList.toggle('is-used',used);b.disabled=!tagging||used;b.setAttribute('aria-pressed',String(selected===t.id));
      b.setAttribute('aria-label',used?`已貼好：${t.phrase.replace(/<\/?b>/g,'')}，${t.char} ${t.py}，${t.mean}`:`標籤：${t.char} ${t.py}，${t.mean}`);});
    qa('[data-sm-flip]').forEach(b=>{const turned=flipped.has(b.dataset.smFlip);b.disabled=!ready;b.classList.toggle('is-flipped',turned);b.setAttribute('aria-pressed',String(turned));
      b.querySelector('.sm-front').setAttribute('aria-hidden',String(turned));b.querySelector('.sm-back').setAttribute('aria-hidden',String(!turned));});
    q('.sm-text').hidden=!v.text;
    if(v.text){q('.sm-line').innerHTML=v.text.replace(/「[^」]*」[，。？！]?|[^，。、：；？！「」]+[，。、：；？！]*/g,m=>`<span>${m}</span>`);const [c,py,mean]=v.gloss,g=q('[data-sm-gloss]');g.innerHTML=`<b>${c}</b><i>${py}</i><span>${mean}</span>${voice}`;g.setAttribute('aria-label',`聽「${c}」字的讀音：${py}，意思是${mean}`);g.disabled=!ready;}
    q('.sm-measure').hidden=stage!=='measure';setKnot(knot);q('[data-sm-knot]').disabled=!on||stage!=='measure';
    const card=q('[data-sm-card]');card.hidden=stage!=='place';card.disabled=!on;card.setAttribute('aria-pressed',String(selected==='ruler'));
    const ask=ASK[stage];q('.sm-ask').hidden=!ask;
    if(ask){q('.sm-ask p').textContent=ask[0];qa('[data-sm-choice]').forEach((b,i)=>{b.textContent=ask[i+1][1];b.dataset.id=ask[i+1][0];b.disabled=!on||stage==='advice'&&agreed;b.classList.toggle('is-picked',stage==='advice'&&agreed&&i===0);});}
    q('.sm-fitting').hidden=stage!=='try';q('.sm-fit').dataset.size=size||'none';
    qa('[data-sm-shoe]').forEach(b=>{b.disabled=!on;b.classList.toggle('is-on',b.dataset.smShoe===size);b.setAttribute('aria-pressed',String(b.dataset.smShoe===size));});
    q('.sm-moral').hidden=stage!=='done';
    const next=q('[data-sm-next]');next.hidden=readOnly||solved||!passed();next.disabled=!on;
    next.innerHTML=`${{placed:'去市集',closed:'後來呢？',advice:'回市集試鞋',try:'買這雙'}[stage]||'下一步'} <span aria-hidden="true">→</span>`;
    q('[data-sm-listen]').disabled=!ready;
  }
  // Move focus only for keyboard users, so pointer users never see a ring that looks like a hint.
  function focusOn(sel){if(kbUser)q(sel)?.focus({preventScroll:true});}
  function focusFirst(){
    const el={measure:'[data-sm-knot]',place:'[data-sm-card]',market:'[data-sm-choice]',closed:'[data-sm-knock]',advice:'[data-sm-choice]',try:'[data-sm-shoe]',tag:'[data-sm-tag]:not(:disabled)',done:'[data-sm-listen]'}[stage];
    focusOn(el);
  }
  function go(next,message){stage=next;selected=null;knocked=false;agreed=false;save();render();present();focusFirst();tell(message??INTRO[next]??'');}
  function measure(){
    if(!can('measure'))return;const off=knot-TOE,ok=Math.abs(off)<=TOL;
    research.answer('measure',ok?'toe':off<0?'short':'long',ok);
    if(!ok){tone('soft');wiggle(q('[data-sm-knot]'));tell(off<0?'還沒到腳尖，往右再移一點。':'超過腳尖了，往左回一點。');return;}
    tone('ding');knot=TOE;go('place','量好了！紅繩結記下腳的長度，這就是他的「度」（尺碼）。現在把尺放到畫中的坐榻上。');
  }
  function pickRuler(kb){if(!can('place'))return;selected=selected==='ruler'?null:'ruler';render();tell(selected?'再點畫中坐榻的亮框，把尺放上去。':'放下了。想放到坐榻上，再點一下尺。');if(selected&&kb)q('[data-sm-seat]').focus({preventScroll:true});}
  function place(){
    if(!can('place'))return;research.action('measure','seat');tone('tock');
    go('placed','「置之其坐」：尺碼放在座位上了。他高高興興出門買鞋。');autoLine(0);focusOn('[data-sm-next]');
  }
  function choose(id){
    if(stage==='market'&&available()){
      research.answer('decide',id,id==='foot');choice=id;tone(id==='foot'?'ding':'tock');
      if(id==='home'){go('closed');autoLine(2);}else go('try','好主意！腳就長在自己身上。用腳試一試鞋吧。');
    }else if(stage==='advice'&&available()&&!agreed){
      research.answer('decide',id==='passer'?'agree-passerby':'agree-zheng',id==='passer');
      if(id!=='passer'){research.hint('decide');tone('soft');tell('尺碼是照著腳量出來的。腳就在身上，用腳試不是更準嗎？再想想。');return;}
      agreed=true;tone('ding');render();tell('說得對！「寧信度，無自信也」——他寧可信尺碼，也不信自己的腳。');focusOn('[data-sm-next]');
    }
  }
  function knock(){if(!can('closed')||knocked)return;research.action('decide','knock');tone('knock');knocked=true;render();tell('「市罷，遂不得履」：市集已經散了，於是買不到鞋子。');focusOn('[data-sm-next]');}
  function tryOn(id){
    if(!can('try'))return;
    if(size===id){tell(FEEL[id]);return;}
    research.answer('try',id,id==='right');size=id;tone(id==='right'?'ding':'soft');save();render();tell(FEEL[id]);
    if(id!=='right')wiggle(q('.sm-fit'));
  }
  function pickTag(id,kb){
    if(!can('tag')||pinned.has(id))return;selected=selected===id?null:id;render();
    const t=tagOf(selected);tell(t?`「${t.char} ${t.py}：${t.mean}」該貼在畫中哪裏？點那個虛線框。`:'放下了。再選一張標籤。');
    if(t&&kb)q('[data-sm-spot]:not(:disabled)')?.focus({preventScroll:true});
  }
  function flash(el){if(!el)return;el.classList.remove('is-no');void el.offsetWidth;el.classList.add('is-no');later(()=>el.classList.remove('is-no'),700);}
  // Drop tag `id` on spot `spot`; returns true when it sticks. A wrong spot never blocks: the tag stays picked.
  function judge(id,spot){
    const t=tagOf(id);if(!can('tag')||!t||pinned.has(id)||!SPOTS[spot]||filled(spot))return false;
    const ok=t.spot===spot;research.answer('tag',`${id}:${spot}`,ok);
    if(!ok){
      misses[id]=(misses[id]||0)+1;research.hint('tag');tone('soft');selected=id;flash(q(`[data-sm-spot="${spot}"]`));
      const glow=misses[id]>=2;if(glow&&!demoed.has(id)){demoed.add(id);research.hint('tag','demo');}
      render();tell(`這裏是${SPOTS[spot].name}。${t.hint}${glow?'看看發亮的地方。':''}`);return false;
    }
    pinned.add(id);selected=null;const left=TAGS.length-pinned.size,said=`貼對了！「${t.phrase}」的${t.char} ${t.py}，是${t.mean}。`;
    if(left){tone('pin');save();render();tell(`${said}還有 ${left} 張。`);focusOn('[data-sm-tag]:not(:disabled)');return true;}
    tone('win');stage='done';save();render();tell(`${said}${DONE}`);focusFirst();
    if(!reported){reported=true;research.complete();onComplete?.({correct:true,response:state(),knowledge:KNOW});}
    return true;
  }
  function flip(id){
    const f=FLIPS.find(x=>x.id===id);if(!f||!ready||dead)return;
    if(flipped.has(id))flipped.delete(id);else{flipped.add(id);if(available())research.action('bonus',id);}
    tone('tock');render();tell(flipped.has(id)?f.say:MORAL);
  }
  function next(){
    if(!available()||!passed())return;
    if(stage==='placed'){go('market');autoLine(1);}
    else if(stage==='closed'){go('advice');autoLine(3);}
    else if(stage==='advice')go('try');
    else if(stage==='try'){research.action('try','buy');go('tag');}
  }
  // Replays during review (readOnly / solved / after completion) are not hints, so they are not reported.
  const helped=kind=>{if(available()&&stage!=='done')research.hint(STEP[stage],kind);};
  function listen(){
    if(dead||!ready)return;helped('audio');
    const t=stage==='tag'&&tagOf(selected);speak({text:LINES[t?t.line:VIEW[stage].line]},true);
  }
  // Drag: the knot slides along the ruler; the ruler card, shoes and word tags can be dropped on their targets.
  const inside=(el,x,y)=>{const r=el.getBoundingClientRect();return r.width>0&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;};
  const targetAt=(x,y)=>[...qa('[data-sm-seat],[data-sm-fit]')].find(t=>!t.closest('[hidden]')&&!t.disabled&&inside(t,x,y));
  // Spots are in tab order foot, ruler, seat, stall, so the ruler wins where it lies on the seat; a pane clips its spots.
  const spotAt=(x,y)=>[...qa('[data-sm-spot]')].find(t=>!t.disabled&&inside(t,x,y)&&inside(t.closest('.sm-pane'),x,y));
  function back(el,dx,dy){if(reducedMotion)return;el.style.setProperty('--dx',`${dx}px`);el.style.setProperty('--dy',`${dy}px`);el.classList.remove('is-return');void el.offsetWidth;el.classList.add('is-return');later(()=>el.classList.remove('is-return'),380);}
  const knotFrom=x=>{const r=q('.sm-measure').getBoundingClientRect();return (x-r.left)/r.width*100;};
  // Swallow only the synthetic click that a drag or knot tap leaves at the release point (layout may have changed under it);
  // that click comes before any new press, so the next pointerdown lifts the hush.
  const hush=e=>{suppress={until:Date.now()+500,x:e.clientX,y:e.clientY};};
  function endDrag(){
    const d=drag;drag=null;if(!d)return null;
    d.el.classList.remove('is-dragging');d.el.style.removeProperty('translate');qa('.is-over').forEach(n=>n.classList.remove('is-over'));
    try{d.el.releasePointerCapture(d.id);}catch{}return d;
  }
  function down(e){
    const el=e.target.closest?.('[data-sm-drag]');
    if(drag||!el||!available()||e.button>0||e.isPrimary===false)return;
    const kind=el.dataset.smDrag;
    if(kind==='knot'?stage!=='measure':el.disabled)return;
    drag={el,kind,id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};
    try{el.setPointerCapture(e.pointerId);}catch{}
    if(kind==='knot'){if(e.cancelable)e.preventDefault();setKnot(knotFrom(e.clientX));}
  }
  function move(e){
    if(!drag||e.pointerId!==drag.id)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(drag.kind==='knot'){if(e.cancelable)e.preventDefault();setKnot(knotFrom(e.clientX));return;}
    if(!drag.moved&&Math.hypot(dx,dy)<8)return;
    if(!drag.moved&&drag.kind==='tag'){drag.el.classList.remove('is-return');selected=drag.el.dataset.smTag;render();}
    drag.moved=true;if(e.cancelable)e.preventDefault();
    drag.el.classList.add('is-dragging');drag.el.style.translate=`${dx}px ${dy}px`;
    const t=drag.kind==='tag'?spotAt(e.clientX,e.clientY):targetAt(e.clientX,e.clientY);qa('.is-over').forEach(n=>{if(n!==t)n.classList.remove('is-over');});t?.classList.add('is-over');
  }
  function up(e){
    if(!drag||e.pointerId!==drag.id)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y,d=endDrag();
    if(d.kind==='knot'){hush(e);if(e.type==='pointerup')measure();return;}
    if(!d.moved||e.type!=='pointerup')return;
    hush(e);
    if(d.kind==='tag'){
      const id=d.el.dataset.smTag,s=spotAt(e.clientX,e.clientY);
      if(s?judge(id,s.dataset.smSpot):false)return;
      back(d.el,dx,dy);if(!s&&can('tag')){research.action('tag','miss');tell('貼到畫中發亮的虛線框上。也可以先點標籤，再點虛線框。');}
      return;
    }
    const t=targetAt(e.clientX,e.clientY);
    if(d.kind==='card'){if(t?.matches('[data-sm-seat]'))place();else{research.action('measure','miss');tell('放到畫中坐榻的亮框裏。也可以點尺，再點坐榻。');}}
    else if(d.kind==='shoe'){if(t?.matches('[data-sm-fit]'))tryOn(d.el.dataset.smShoe);else tell('把鞋子拖到腳上，或者點一下鞋子。');}
  }
  root.addEventListener('pointerdown',e=>{kbUser=false;suppress.until=0;down(e);},{signal:abort.signal});
  root.addEventListener('pointermove',move,{signal:abort.signal,passive:false});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(type,up,{signal:abort.signal});
  for(const type of ['contextmenu','selectstart','dragstart'])root.addEventListener(type,e=>{if(e.target.closest?.('[data-sm-drag]')&&e.cancelable)e.preventDefault();},{signal:abort.signal});
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)endDrag();},{signal:abort.signal});
  root.addEventListener('keydown',e=>{
    if(!e.altKey&&!e.ctrlKey&&!e.metaKey)kbUser=true;
    if(e.key==='Escape'&&selected&&can('tag')){e.preventDefault();const id=selected;selected=null;render();tell('放下了。再選一張標籤。');q(`[data-sm-tag="${id}"]`)?.focus({preventScroll:true});return;}
    if(!e.target.closest?.('[data-sm-knot]')||!can('measure'))return;
    const step={ArrowRight:1,ArrowUp:1,ArrowLeft:-1,ArrowDown:-1,PageUp:5,PageDown:-5}[e.key];
    if(step){e.preventDefault();setKnot(knot+step);}else if(e.key==='Home'){e.preventDefault();setKnot(MIN);}else if(e.key==='End'){e.preventDefault();setKnot(MAX);}
  },{signal:abort.signal});
  root.addEventListener('click',e=>{
    const t=e.target,kb=e.detail===0;
    if(!kb&&Date.now()<suppress.until&&Math.hypot(e.clientX-suppress.x,e.clientY-suppress.y)<32)return;
    if(t.closest('[data-sm-retry]'))return void load();
    if(t.closest('[data-sm-listen]'))return listen();
    if(t.closest('[data-sm-gloss]')){const g=VIEW[stage].gloss;if(g&&ready){helped('pinyin');speak({char:g[0],pinyin:g[1]},true);}return;}
    if(t.closest('[data-sm-next]'))return next();
    if(t.closest('[data-sm-knot]'))return measure();
    if(t.closest('[data-sm-card]'))return pickRuler(kb);
    if(t.closest('[data-sm-seat]'))return place();
    if(t.closest('[data-sm-knock]'))return knock();
    const c=t.closest('[data-sm-choice]');if(c)return choose(c.dataset.id);
    const s=t.closest('[data-sm-shoe]');if(s)return tryOn(s.dataset.smShoe);
    const tag=t.closest('[data-sm-tag]');if(tag)return pickTag(tag.dataset.smTag,kb);
    const spot=t.closest('[data-sm-spot]');if(spot){if(!can('tag'))return;if(!selected)return tell(`這裏是${SPOTS[spot.dataset.smSpot].name}。先點一張標籤，再點這裏。`);return void judge(selected,spot.dataset.smSpot);}
    const f=t.closest('[data-sm-flip]');if(f)return flip(f.dataset.smFlip);
  },{signal:abort.signal});
  async function load(){
    if(loadId)research.retry('assets');
    const id=++loadId,box=q('.sm-loading'),stageEl=q('.sm-stage');ready=false;box.hidden=false;box.querySelector('span').textContent='市集正在展開…';q('[data-sm-retry]').hidden=true;stageEl.setAttribute('aria-busy','true');render();
    const unavailable=()=>{if(dead||id!==loadId)return;research.error('assets');box.querySelector('span').textContent='圖片還在載入，可以再試一次。';q('[data-sm-retry]').hidden=false;stageEl.setAttribute('aria-busy','false');};
    try{
      if(id>1)qa('img').forEach(img=>{const u=new URL(img.src);u.searchParams.set('retry',String(id));img.src=u.href;});
      await loadImages(qa('img'),{onTimeout:unavailable});
      if(dead||id!==loadId)return;ready=true;box.hidden=true;stageEl.setAttribute('aria-busy','false');render();present();progress();
    }catch{unavailable();}
  }
  render();tell(readOnly||stage==='done'?DONE:INTRO[stage]);void load();
  return {
    showSolution(){
      if(dead||solved)return;endDrag();research.hint('game','reveal');solved=true;reported=true;stage='done';size='right';choice??='foot';selected=null;
      TAGS.forEach(t=>pinned.add(t.id));render();tell(`${KNOW} 兩個「度」：度 duó 是量一量，度 dù 是量好的尺碼；兩個「置」：買和放。`);
    },
    reset(){
      if(dead||readOnly)return;endDrag();research.reset();timers.forEach(id=>view.clearTimeout(id));timers.clear();
      stage='measure';choice=null;size=null;selected=null;knot=START;knocked=false;agreed=false;solved=false;heard.clear();
      pinned.clear();demoed.clear();flipped.clear();for(const k of Object.keys(misses))delete misses[k];render();tell(INTRO.measure);onState?.(state());progress();if(ready)present();else void load();
    },
    destroy(){
      if(dead)return;dead=true;loadId++;endDrag();abort.abort();timers.forEach(id=>view.clearTimeout(id));timers.clear();
      try{void audio?.close().catch(()=>{});}catch{}root.remove();
    }
  };
}
