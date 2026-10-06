import {createGameImageLoader} from './image-ready.mjs?v=20260922-school11';
import {imageAsset} from '../media-images.mjs?v=20261006-school45';
import {createProcessResearch} from './research.mjs?v=20260920a';
const file = path => new URL(imageAsset(`media/${path}`), import.meta.url).href;
const art=name=>file(`zheng-ren-mai-lu/game/${name}.webp`),scene=n=>file(`zheng-ren-mai-lu/scene-${n}.webp`);
const LINES=['鄭人有且置履者，先自度其足而置之其坐','至之市，而忘操之，已得履，乃曰：「吾忘持度。」','反歸取之，及反，市罷，遂不得履','人曰：「何不試之以足？」曰：「寧信度，無自信也。」'];
const KNOW='鄭國人寧可相信量好的尺碼，也不相信自己的腳；做事要從實際出發，懂得變通。';
const cl=t=>t.replace(/(?:「[^」]*」|[^，。：；？！「])+[，。：；？！]*/g,m=>`<span>${m}</span>`);
const ALTS=['鄭人家中：坐榻的席子上放着一把尺，地上有腳印，他正走出門去市集。','熱鬧的市集鞋攤：鄭人拿着鞋子，才想起尺碼留在家裏。','黃昏，市集散了，鞋店關上木板，鄭人舉着尺子趕回來。','路人指着自己的腳，鄭人仍然舉着尺子。'];
// scene, official line, progress step, header, line card, gloss [char, pinyin, meaning]
const VIEW={
  measure:{scene:1,line:0,step:1,text:'鄭人有且置履者，先自<b>度</b>其足',gloss:['度','duó','量一量']},
  placed:{scene:1,line:0,step:1,say:'而置之其坐：量好的尺碼放在座位上。',text:'先自度其足，而<b>置</b>之其坐',gloss:['置','zhì','放']},
  market:{scene:2,line:1,step:2,say:'到了市集，他挑好了鞋子……',text:'至之市，而忘操之，已得履，乃曰：「吾忘持<b>度</b>。」',gloss:['度','dù','量好的尺碼']},
  closed:{scene:3,line:2,step:2,say:'他跑回家拿尺碼，再趕回市集……',text:'反歸取之，及反，市<b>罷</b>，遂不得履。',gloss:['罷','bà','結束，散了']},
  try:{scene:4,line:3,step:3,say:'何不試之以足？用自己的腳試試鞋。',text:'人曰：「何不<b>試之以足</b>？」',gloss:['足','zú','腳']},
  done:{scene:4,line:3,step:3,say:'剛剛好！用腳一試就知道。'}
};
const STAGES=Object.keys(VIEW),STEP={measure:'measure',placed:'measure',market:'story',closed:'story',try:'try',done:'try'};
const INTRO={market:'「吾忘持度」：他想對一對尺碼，才發現尺碼留在家裏的座位上！',closed:'「市罷，遂不得履」：他拿着尺碼趕回來，市集已經散了，買不到鞋子。',try:'路人說：「何不試之以足？」幫他用腳一雙一雙試：先點第 1 雙鞋，或把它拖到腳上。'};
const HEEL=14.09,TOE=85.82,ZONE={heel:9,toe:14},PEN=50;
const AIM=['先自度其足：先量腳跟。','先自度其足：再量腳尖。'];
const HOW=['把尺上的紅點挪到發亮的腳跟，點一下。也可以直接點腳跟。','記下腳跟了！再把紅點挪到腳尖（腳趾最前面），點一下。'];
// The shoes are tried strictly in this order: 1 is too big, 2 too small, and only 3 fits, so a child sees why the first two fail.
const SHOES=[{id:'big',tag:'太大'},{id:'small',tag:'太小'},{id:'right',tag:'剛好'}];
const CAP={small:'太小了，腳跟露出來',big:'太大了，會掉',right:'剛剛好！'};
const FEEL={big:'第 1 雙太大了：腳跟後面空出一大截，一走就會掉。再試第 2 雙。',small:'第 2 雙太小了：腳趾擠住，腳跟露在鞋子外面。再試第 3 雙。',right:'第 3 雙剛剛好！腳跟和腳趾都包住了。用腳一試，就知道合不合腳。'};
// The shoe last tried tells how far along the row the child is (size null: none yet).
const tried=size=>SHOES.findIndex(s=>s.id===size)+1;
const NEXT={placed:'去市集',market:'回家取尺碼',closed:'後來呢？'};
const voice='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m10 5-5 4H2v6h3l5 4ZM14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
// Version 3 keeps {stage, marks, size}; size is the shoe last tried, so it also marks the place in the 1-2-3 row. Older saves (v1 sorted sentence cards, v2 tagged pictures) resume at the
// matching story point; a finished one stays finished, and an unfinished tagging step resumes at the try-on.
function restore(s){
  const out={stage:'measure',marks:0,size:null};
  if(!plain(s)||![1,2,3].includes(s.version))return out;
  const old={measure:'measure',place:'placed',placed:'placed',market:'market',closed:'closed',advice:'closed',try:'try',sort:'try',tag:'try',done:'done'};
  const stage=s.version===3?(STAGES.includes(s.stage)?s.stage:'measure'):(typeof s.stage==='string'&&Object.hasOwn(old,s.stage)?old[s.stage]:'measure');
  out.stage=stage;out.marks=stage==='measure'?(s.version===3&&s.marks===1?1:0):2;
  if(stage==='try'&&['small','big'].includes(s.size))out.size=s.size;
  if(stage==='done')out.size='right';
  return out;
}

/** 鄭人買履: measure the foot heel to toe, follow the story to the closed market, then try shoes on with the foot. */
export function mountShoeMarket(holder,{initialState,readOnly=false,playAudio,onState,onComplete,onResearch,reducedMotion=false,onProgress}={}){
  const doc=holder.ownerDocument,view=doc.defaultView,abort=new view.AbortController(),timers=new Set(),heard=new Set();
  const loadImages=createGameImageLoader({signal:abort.signal});
  let {stage,marks,size}=restore(initialState);
  // Finished only counts once the platform has the answer (readOnly); a finished draft without one resumes at the try-on.
  if(readOnly){stage='done';marks=2;size='right';}else if(stage==='done'){stage='try';size=null;}
  let kbUser=false,dead=false,ready=false,solved=false,reported=stage==='done',pen=marks===1?HEEL:PEN,miss=0,hold=false,flying=false,flyEl=null;
  let drag=null,suppress={until:0,x:0,y:0},loadId=0,audio=null,lastProgress=-1,fold=null;
  const demoed=new Set(),research=createProcessResearch(onResearch,{prefix:'game.shoe',alive:()=>!dead});
  const uid=`sm-keys-${Math.random().toString(36).slice(2,8)}`,root=doc.createElement('section');root.className='poem-shoe-game';root.setAttribute('aria-label','鄭人買鞋記');
  if(reducedMotion)root.classList.add('is-reduced');
  root.innerHTML=`<div class="sm-frame"><header class="sm-head"><p class="sm-say"></p><span class="sm-progress"></span></header>
  <div class="sm-stage" aria-busy="true">
    ${ALTS.map((alt,i)=>`<img class="sm-scene" data-scene="${i+1}" src="${scene(i+1)}" alt="${alt}" width="1600" height="900" draggable="false">`).join('')}
    <img class="sm-patch" src="${art('mat-patch')}" alt="" draggable="false"><span class="sm-mark" aria-hidden="true"><b>量好的尺碼</b></span>
    <span class="sm-sign" aria-hidden="true">市罷</span>
    <p class="sm-bubble is-forgot">吾忘持度！</p><p class="sm-bubble is-ask">何不試之以足？</p><p class="sm-bubble is-stubborn">寧信度，<br>無自信也。</p>
    <div class="sm-loading" role="status"><span>市集正在展開…</span><button type="button" data-sm-retry hidden>再試一次</button></div>
  </div>
  <div class="sm-side"><div class="sm-panel">
    <div class="sm-text"><p class="sm-line"></p><button type="button" class="sm-gloss" data-sm-gloss></button></div>
    <div class="sm-measure" data-sm-drag="pen" hidden><img class="sm-foot" src="${art('foot')}" alt="鄭人的腳，從側面看：左邊是腳跟，右邊是腳尖" draggable="false">
      <span class="sm-aim is-heel" aria-hidden="true"><i></i><b>腳跟</b></span><span class="sm-aim is-toe" aria-hidden="true"><i></i><b>腳尖</b></span>
      <span class="sm-guide" aria-hidden="true"></span><img class="sm-ruler" src="${art('ruler')}" alt="" draggable="false"><span class="sm-cord" aria-hidden="true"></span>
      <span class="sm-dot is-heel" aria-hidden="true"><b>腳跟</b></span><span class="sm-dot is-toe" aria-hidden="true"><b>腳尖</b></span><span class="sm-got" aria-hidden="true">量好了！</span>
      <button type="button" class="sm-pen" data-sm-pen role="slider" aria-valuemin="2" aria-valuemax="98" aria-describedby="${uid}"><i></i></button><span class="sm-sr" id="${uid}">用左右方向鍵移動紅點，按 Enter 記下。</span></div>
    <div class="sm-fitting" hidden><div class="sm-fit" data-sm-fit data-size="none"><span class="sm-ground" aria-hidden="true"></span>
      <img class="sm-in" src="${art('bu-lu')}" alt="" draggable="false"><img class="sm-foot" src="${art('foot')}" alt="鄭人自己的腳" draggable="false"><img class="sm-out" src="${art('bu-lu-front')}" alt="" draggable="false">
      <span class="sm-ring" aria-hidden="true"></span><p class="sm-cap" aria-hidden="true"></p></div>
      <div class="sm-tray">${SHOES.map((s,i)=>`<button type="button" class="is-${s.id}" data-sm-shoe="${s.id}" data-sm-drag="shoe"><img src="${art('bu-lu')}" alt="" draggable="false"><span class="sm-no" aria-hidden="true">${i+1}</span><em class="sm-tag" aria-hidden="true">${s.tag}</em></button>`).join('')}</div></div>
    <div class="sm-moral" hidden><b>寓意</b><p>${cl('可是鄭人說「寧信度」：寧可信量好的尺碼，也不信自己的腳，結果沒買到鞋。')}</p><strong>${cl('做事要從實際出發，懂得變通。')}</strong>
      <small>「<b>度</b>」duó 量一量<i aria-hidden="true">｜</i>dù 尺碼</small></div>
  </div>
  <div class="sm-actions"><button type="button" class="sm-listen" data-sm-listen>${voice}<span>聽這句詩</span></button><button type="button" class="sm-next" data-sm-next hidden></button></div>
  <p class="sm-feedback" role="status" aria-live="polite"></p></div></div>`;
  holder.append(root);
  const q=s=>root.querySelector(s),qa=s=>root.querySelectorAll(s),tell=t=>{if(!dead)q('.sm-feedback').innerHTML=cl(t);};
  const later=(fn,ms)=>{const id=view.setTimeout(()=>{timers.delete(id);if(!dead)fn();},ms);timers.add(id);};
  const state=()=>({version:3,stage,marks,size});
  const available=()=>!dead&&ready&&!readOnly&&!solved,can=s=>available()&&stage===s;
  const completed=()=>({measure:0,placed:1,market:1,closed:1,try:2,done:3})[stage];
  function progress(){const n=completed();if(n!==lastProgress){lastProgress=n;onProgress?.({completed:n,total:3});}}
  function save(){if(readOnly||solved||dead)return;onState?.(state());progress();}
  function replay(el,cls,ms){if(!el||reducedMotion)return;el.classList.remove(cls);void el.offsetWidth;el.classList.add(cls);later(()=>el.classList.remove(cls),ms);}
  function tone(kind){
    try{audio??=new(view.AudioContext||view.webkitAudioContext)();if(audio.state==='suspended')void audio.resume().catch(()=>{});
      const now=audio.currentTime,notes={ding:[[660,0],[990,.1]],soft:[[330,0]],tock:[[520,0]],pin:[[784,0],[1175,.09]],win:[[523,0],[659,.1],[784,.2],[1047,.32]]}[kind]||[[440,0]];
      for(const [f,t] of notes){const o=audio.createOscillator(),g=audio.createGain(),end=now+t+.3;
        o.type='sine';o.frequency.setValueAtTime(f,now+t);
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
  // The red marker slides along the ruler; it counts as on the heel (or toe) inside a generous zone that grows after each miss.
  // The toe zone starts further back because the toes are long: any tap on the toes counts.
  const zone=k=>Math.min(22,ZONE[k]+miss*4),atHeel=()=>pen<=HEEL+zone('heel'),atToe=()=>pen>=TOE-zone('toe'),near=()=>marks?atToe():atHeel();
  function where(){return atHeel()?'在腳跟':atToe()?'在腳尖':'在腳的中間';}
  function setPen(v){
    pen=Math.max(2,Math.min(98,v));const m=q('.sm-measure'),end=marks===2?TOE:pen,p=q('[data-sm-pen]');
    m.style.setProperty('--pen',`${pen}%`);m.style.setProperty('--a',`${Math.min(HEEL,end)}%`);m.style.setProperty('--b',`${Math.max(HEEL,end)}%`);
    m.classList.toggle('is-near',stage==='measure'&&marks<2&&near());
    p.setAttribute('aria-valuenow',String(Math.round(pen)));p.setAttribute('aria-valuetext',where());
    p.setAttribute('aria-label',marks?'尺上的紅點：移到腳尖，再按一下記下來':'尺上的紅點：移到腳跟，再按一下記下來');
  }
  function present(){
    if(!available())return;
    if(stage==='measure')research.present('measure');
    else if(stage==='try')research.present('try',{optionOrder:SHOES.map(s=>s.id)});
  }
  function render(){
    const v=VIEW[stage],on=available(),show=stage==='measure'||hold||flying;
    root.dataset.stage=stage;root.classList.toggle('is-readonly',readOnly);root.classList.toggle('is-help',stage==='measure'&&miss>=2);
    q('.sm-say').innerHTML=cl(stage==='measure'?AIM[marks?1:0]:v.say);
    q('.sm-progress').textContent=`${v.step} / 3`;q('.sm-progress').setAttribute('aria-label',`第 ${v.step} 步，共 3 步`);
    qa('.sm-scene').forEach(img=>{const on1=+img.dataset.scene===v.scene;img.classList.toggle('is-on',on1);img.setAttribute('aria-hidden',String(!on1));});
    q('.sm-patch').classList.toggle('is-on',show);
    q('.sm-mark').classList.toggle('is-on',stage==='placed'&&!show&&!flying);
    q('.sm-sign').classList.toggle('is-on',stage==='closed');
    q('.is-forgot').classList.toggle('is-on',stage==='market');
    q('.is-ask').classList.toggle('is-on',stage==='try'||stage==='done');q('.is-stubborn').classList.toggle('is-on',stage==='done');
    q('.sm-text').hidden=!v.text;
    if(v.text){q('.sm-line').innerHTML=v.text.replace(/「[^」]*」[，。？！]?|[^，。、：；？！「」]+[，。、：；？！]*/g,m=>`<span>${m}</span>`);const [c,py,mean]=v.gloss,g=q('[data-sm-gloss]');g.innerHTML=`<b>${c}</b><i>${py}</i><span>${mean}</span>${voice}`;g.setAttribute('aria-label',`聽「${c}」字的讀音：${py}，意思是${mean}`);g.disabled=!ready;}
    const m=q('.sm-measure');m.hidden=!show;m.dataset.marks=String(marks);m.classList.toggle('is-flying',flying);q('[data-sm-pen]').disabled=!on||stage!=='measure'||marks>=2;setPen(pen);
    const fit=q('.sm-fit');q('.sm-fitting').hidden=!['try','done'].includes(stage);fit.dataset.size=size||'none';q('.sm-cap').textContent=CAP[size]||'';
    q('.sm-tray').hidden=stage==='done';
    // Shoes already tried stay greyed with their verdict; later ones wait (dimmed, still tappable for a reminder); only the next one is live.
    const done=tried(size);
    qa('[data-sm-shoe]').forEach((b,i)=>{const n=i+1,turn=n<=done?'tried':n===done+1?'next':'wait';
      b.disabled=!on||stage!=='try'||turn==='tried';b.dataset.turn=turn;b.classList.toggle('is-on',b.dataset.smShoe===size);
      b.setAttribute('aria-disabled',String(turn==='wait'));b.setAttribute('aria-pressed',String(b.dataset.smShoe===size));
      b.setAttribute('aria-label',`第 ${n} 雙鞋：${turn==='tried'?`試過了，${SHOES[i].tag}`:turn==='next'?'用腳試穿這雙鞋':`等一等，先試第 ${done+1} 雙`}`);});
    q('.sm-moral').hidden=stage!=='done';
    const next=q('[data-sm-next]');next.hidden=readOnly||solved||!NEXT[stage]||hold||flying;next.disabled=!on;
    next.innerHTML=`${NEXT[stage]||'下一步'} <span aria-hidden="true">→</span>`;
    q('[data-sm-listen]').disabled=!ready;
  }
  // Move focus only for keyboard users, so pointer users never see a ring that looks like a hint.
  function focusOn(sel){if(kbUser)q(sel)?.focus({preventScroll:true});}
  function focusFirst(){focusOn({measure:'[data-sm-pen]',placed:'[data-sm-next]',market:'[data-sm-next]',closed:'[data-sm-next]',try:'[data-sm-shoe][data-turn=next]',done:'[data-sm-listen]'}[stage]);}
  function go(next,message){stage=next;save();render();present();focusFirst();tell(message??INTRO[next]??'');}
  function mark(){
    if(!can('measure')||marks>=2)return;
    const heel=!marks;
    if(near()){
      research.answer('measure',heel?'heel':'toe',true);miss=0;
      if(heel){marks=1;pen=HEEL;tone('pin');save();render();replay(q('.sm-dot.is-heel'),'is-pop',600);tell(HOW[1]);return;}
      marks=2;pen=TOE;stage='placed';hold=true;tone('win');save();render();replay(q('.sm-got'),'is-pop',600);
      tell('量好了：從腳跟到腳尖，就是這麼長！這就是他的「度」（尺碼）。');prepFly();later(flyRuler,reducedMotion?900:1500);return;
    }
    // Tapping the heel again (a double tap) is not a mistake: just point on to the toe.
    if(!heel&&atHeel()){tone('soft');setPen(HEEL);replay(q('.sm-aim.is-toe'),'is-nudge',700);tell('腳跟已經記下了。現在去腳尖：右邊腳趾最前面。');return;}
    const toeFirst=heel&&atToe();miss++;
    research.answer('measure',heel?(toeFirst?'toe-first':'heel-far'):'toe-short',false);tone('soft');
    const k=heel?'heel':'toe';if(miss>=2&&!demoed.has(k)){demoed.add(k);research.hint('measure','demo');}
    render();replay(q(`.sm-aim.is-${k}`),'is-nudge',700);
    tell((heel?(toeFirst?'這裏是腳尖。要先量腳跟：腳跟在腳的最後面（左邊）。':'這裏還不是腳跟。腳跟在腳的最後面，左邊圓圓的地方。')
      :'還沒到腳尖。腳尖在腳趾最前面，再往右挪一點。')+(miss>=2?'點發亮的圓圈就可以。':''));
  }
  // Touching the red dot where it rests is the natural first move, so it only wakes the dot and points at the target.
  function lift(){
    if(!can('measure')||marks>=2)return;
    research.action('measure','pick');tone('tock');replay(q('[data-sm-pen]'),'is-lift',600);
    tell(marks?'紅點準備好了！把它拖到發亮的腳尖，或直接點一下腳尖。':'紅點準備好了！把它拖到發亮的腳跟，或直接點一下腳跟。');
  }
  // 而置之其坐: the marked ruler flies from the work panel onto the seat in the home picture, then the painted ruler shows.
  function flyRuler(){
    const from=q('.sm-ruler').getBoundingClientRect(),sr=q('.sm-stage').getBoundingClientRect(),rr=root.getBoundingClientRect();
    hold=false;flying=true;render();
    const land=()=>{if(flyEl&&!reducedMotion){const el=flyEl;el.animate?.([{opacity:1},{opacity:0}],{duration:800,fill:'forwards'});later(()=>el.remove(),820);}else flyEl?.remove();
      flyEl=null;research.action('measure','seat');tone('tock');tell('「而置之其坐」：量好的尺碼放在座位上了。他高高興興出門買鞋。');
      // The empty measuring picture folds away smoothly instead of making the page jump.
      const m=q('.sm-measure'),h=m.offsetHeight,settle=()=>{fold?.cancel();fold=null;flying=false;render();autoLine(0);focusOn('[data-sm-next]');};
      if(reducedMotion||!h||typeof m.animate!=='function')return settle();
      const gap=parseFloat(view.getComputedStyle(m.parentElement).rowGap)||0;
      fold=m.animate([{height:`${h}px`,opacity:1,marginBottom:'0px'},{height:'0px',opacity:0,marginBottom:`${-gap}px`}],{duration:450,easing:'ease-in-out',fill:'forwards'});
      later(settle,470);};
    if(reducedMotion||!from.width||!sr.width||typeof root.animate!=='function')return land();
    const img=flyEl||prepFly();
    Object.assign(img.style,{left:`${from.left-rr.left}px`,top:`${from.top-rr.top}px`,width:`${from.width}px`,height:`${from.height}px`,visibility:''});
    const s=sr.width*.177/from.width,dx=sr.left+sr.width*.3272-(from.left+from.width/2),dy=sr.top+sr.height*.5461-(from.top+from.height/2);
    img.animate([{transform:'none'},{transform:`translate(${dx*.55}px,${dy*.55-30}px) scale(${(1+s)/2}) rotate(-3deg)`,offset:.55},{transform:`translate(${dx}px,${dy}px) scale(${s}) rotate(-7.3deg)`}],{duration:950,easing:'ease-in-out',fill:'forwards'});
    later(land,960);
  }
  // The flying copy is created while the finished measurement is on show, so its picture is decoded before it moves.
  function prepFly(){
    if(reducedMotion||flyEl)return flyEl;
    const img=doc.createElement('img');img.className='sm-fly';img.alt='';img.draggable=false;Object.assign(img.style,{visibility:'hidden',left:'0',top:'0',width:'1px',height:'1px'});img.src=art('ruler');
    root.append(img);flyEl=img;img.decode?.().catch(()=>{});return img;
  }
  function clearFly(){root.querySelectorAll('.sm-fly').forEach(el=>el.remove());fold?.cancel();fold=null;flyEl=null;hold=false;flying=false;}
  function tryOn(id){
    if(!can('try'))return;
    const n=tried(size)+1,want=SHOES[n-1]?.id;
    if(!want||tried(id)<n){if(size)tell(FEEL[size]);return;}
    // Shoes go strictly 1, 2, 3: a later shoe only points back at the one whose turn it is.
    if(id!==want){research.action('try','wait');tone('soft');replay(q(`[data-sm-shoe=${want}]`),'is-nudge',700);tell(`要一雙一雙按次序試：先試第 ${n} 雙。`);return;}
    size=id;
    // The first two are steps of the story, not mistakes: they show what "too big" and "too small" look like.
    if(id!=='right'){research.action('try',id);tone('soft');save();render();replay(q('.sm-fit'),'is-drop',500);tell(FEEL[id]);focusFirst();return;}
    research.answer('try',id,true);
    tone('win');stage='done';save();render();replay(q('.sm-fit'),'is-drop',500);tell(FEEL.right);focusFirst();
    if(!reported){reported=true;research.complete();onComplete?.({correct:true,response:state(),knowledge:KNOW});}
  }
  function next(){
    if(!available()||hold||flying)return;
    if(stage==='placed'){research.action('story','market');go('market');autoLine(1);}
    else if(stage==='market'){research.action('story','home');go('closed');autoLine(2);}
    else if(stage==='closed'){research.action('story','try');go('try');autoLine(3);}
  }
  // Replays during review (readOnly / solved / after completion) are not hints, so they are not reported.
  const helped=kind=>{if(available()&&stage!=='done')research.hint(STEP[stage],kind);};
  function listen(){if(dead||!ready)return;helped('audio');speak({text:LINES[VIEW[stage].line]},true);}
  // Drag: the red marker follows the finger anywhere on the measuring picture; a shoe can be dropped on the foot.
  const inside=(el,x,y)=>{const r=el.getBoundingClientRect();return r.width>0&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;};
  const penFrom=x=>{const r=q('.sm-measure').getBoundingClientRect();return (x-r.left)/r.width*100;};
  // Swallow only the synthetic click that a drag or tap leaves at the release point; the next pointerdown lifts the hush.
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
    if(kind==='pen'?stage!=='measure'||marks>=2:el.disabled||el.dataset.turn!=='next')return;
    const onPen=kind==='pen'&&!!e.target.closest('[data-sm-pen]');
    drag={el,kind,id:e.pointerId,x:e.clientX,y:e.clientY,moved:false,start:pen,onPen,off:onPen?penFrom(e.clientX)-pen:0,far:0};
    try{el.setPointerCapture(e.pointerId);}catch{}
    if(kind==='pen'){if(e.pointerType==='mouse'&&e.cancelable)e.preventDefault();if(!onPen)setPen(penFrom(e.clientX));}
  }
  function move(e){
    if(!drag||e.pointerId!==drag.id)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(drag.kind==='pen'){if(e.cancelable)e.preventDefault();drag.far=Math.max(drag.far,Math.hypot(dx,dy));setPen(penFrom(e.clientX)-drag.off);return;}
    if(!drag.moved&&Math.hypot(dx,dy)<8)return;
    drag.moved=true;if(e.cancelable)e.preventDefault();
    drag.el.classList.add('is-dragging');drag.el.style.translate=`${dx}px ${dy}px`;
    const fit=q('[data-sm-fit]');fit.classList.toggle('is-over',inside(fit,e.clientX,e.clientY));
  }
  function up(e){
    if(!drag||e.pointerId!==drag.id)return;
    const d=endDrag();
    if(d.kind==='pen'){if(e.type!=='pointerup')setPen(d.start);else{hush(e);if(d.onPen&&d.far<8&&!near())lift();else mark();}return;}
    if(!d.moved||e.type!=='pointerup')return;
    hush(e);
    if(inside(q('[data-sm-fit]'),e.clientX,e.clientY))tryOn(d.el.dataset.smShoe);else if(can('try'))tell('把鞋子拖到腳上，或者點一下鞋子。');
  }
  root.addEventListener('pointerdown',e=>{kbUser=false;suppress.until=0;down(e);},{signal:abort.signal});
  root.addEventListener('pointermove',move,{signal:abort.signal,passive:false});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(type,up,{signal:abort.signal});
  for(const type of ['contextmenu','selectstart','dragstart'])root.addEventListener(type,e=>{if(e.target.closest?.('[data-sm-drag]')&&e.cancelable)e.preventDefault();},{signal:abort.signal});
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden&&drag){const d=endDrag();if(d.kind==='pen')setPen(d.start);}},{signal:abort.signal});
  root.addEventListener('keydown',e=>{
    if(!e.altKey&&!e.ctrlKey&&!e.metaKey)kbUser=true;
    if(!e.target.closest?.('[data-sm-pen]')||!can('measure')||marks>=2)return;
    const n=e.shiftKey?1:5,step={ArrowRight:n,ArrowUp:n,ArrowLeft:-n,ArrowDown:-n,PageUp:10,PageDown:-10}[e.key];
    if(step){e.preventDefault();setPen(pen+step);}else if(e.key==='Home'){e.preventDefault();setPen(2);}else if(e.key==='End'){e.preventDefault();setPen(98);}
  },{signal:abort.signal});
  root.addEventListener('click',e=>{
    const t=e.target,kb=e.detail===0;
    if(!kb&&Date.now()<suppress.until&&Math.hypot(e.clientX-suppress.x,e.clientY-suppress.y)<32)return;
    if(t.closest('[data-sm-retry]'))return void load();
    if(t.closest('[data-sm-listen]'))return listen();
    if(t.closest('[data-sm-gloss]')){const g=VIEW[stage].gloss;if(g&&ready){helped('pinyin');speak({char:g[0],pinyin:g[1]},true);}return;}
    if(t.closest('[data-sm-next]'))return next();
    if(t.closest('[data-sm-pen]'))return mark();
    const s=t.closest('[data-sm-shoe]');if(s)return tryOn(s.dataset.smShoe);
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
  const opening=()=>stage==='done'?FEEL.right:stage==='measure'?HOW[marks?1:0]:stage==='placed'?'尺碼放在座位上了。按「去市集」出發吧。':INTRO[stage];
  render();tell(opening());void load();
  return {
    showSolution(){
      if(dead||solved)return;endDrag();timers.forEach(id=>view.clearTimeout(id));timers.clear();clearFly();
      research.hint('game','reveal');solved=true;reported=true;stage='done';marks=2;size='right';render();
      tell('從腳跟量到腳尖，就是腳的尺碼（度）。路人說「何不試之以足」：一雙一雙用腳試，第 3 雙剛剛好。做事要從實際出發，懂得變通。');
    },
    reset(){
      if(dead||readOnly)return;endDrag();research.reset();timers.forEach(id=>view.clearTimeout(id));timers.clear();clearFly();
      stage='measure';marks=0;size=null;pen=PEN;miss=0;solved=false;heard.clear();demoed.clear();
      render();tell(HOW[0]);onState?.(state());progress();if(ready)present();else void load();
    },
    destroy(){
      if(dead)return;dead=true;loadId++;endDrag();abort.abort();timers.forEach(id=>view.clearTimeout(id));timers.clear();
      try{void audio?.close().catch(()=>{});}catch{}root.remove();
    }
  };
}
