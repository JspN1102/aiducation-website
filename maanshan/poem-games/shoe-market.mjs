import {createGameImageLoader} from './image-ready.mjs?v=20260922-school11';
import {imageAsset} from '../media-images.mjs?v=20261005-school41';
import {createProcessResearch} from './research.mjs?v=20260920a';
const file = path => new URL(imageAsset(`media/${path}`), import.meta.url).href;
const art=name=>file(`zheng-ren-mai-lu/game/${name}.webp`),scene=n=>file(`zheng-ren-mai-lu/scene-${n}.webp`);
const LINES=['鄭人有且置履者，先自度其足而置之其坐','至之市，而忘操之，已得履，乃曰：「吾忘持度。」','反歸取之，及反，市罷，遂不得履','人曰：「何不試之以足？」曰：「寧信度，無自信也。」'];
const KNOW='鄭國人寧可相信量好的尺碼，也不相信自己的腳；做事要從實際出發，懂得變通。';
const DONE='完成了！兩個「度」、兩個「置」都分清楚了。';
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
  sort:{scene:1,line:0,step:4,say:'兩個「度」、兩個「置」：把句子放進對的意思。'},
  done:{scene:1,line:3,step:4,say:'四個字義都分清了！想一想故事的道理。'}
};
const STAGES=Object.keys(VIEW),STEP={measure:'measure',place:'measure',placed:'measure',market:'decide',closed:'decide',advice:'decide',try:'try',sort:'sort',done:'sort'};
const INTRO={measure:'紅繩結對準腳尖，就量好腳的長度。可以拖動，也可以點尺子，或用方向鍵。',place:'把量好的尺拖到畫中的坐榻上；也可以點尺，再點坐榻。',placed:'尺碼放在座位上了。按「去市集」出發吧。',market:'他挑好了鞋子，想對一對尺碼，才發現尺碼留在家裏！',closed:'他跑回家拿尺碼，再趕回市集……',advice:'有人問他：「為甚麼不用自己的腳試試呢？」',try:'回到鞋攤，用自己的腳試一試。點一下鞋子，或把鞋子拖到腳上。',sort:'先點一張句子卡，再點它的意思；也可以把卡拖過去。'};
const ASK={market:['他忘了帶尺碼，怎麼辦？',['home','回家取度'],['foot','用自己的腳試']],advice:['路人和鄭人，誰說得對？',['passer','路人：用腳試試'],['zheng','鄭人：只信尺碼']]};
const SHOES=[{id:'big',label:'甲'},{id:'small',label:'乙'},{id:'right',label:'丙'}];
const FEEL={small:'太小了：腳跟露在外面，穿不進去。再試另一雙。',big:'太大了：鞋子鬆鬆的，一走就會掉。再試另一雙。',right:'剛剛好！用腳一試，就知道合不合腳。'};
const CARDS=[
  {id:'chi',html:'吾忘持<b>度</b>',bin:'du-noun',line:1,hint:'「吾忘持度」：他忘了帶的是一樣東西，是甚麼呢？'},
  {id:'zuo',html:'<b>置</b>之其坐',bin:'zhi-put',line:0,hint:'「置之其坐」：他把尺碼怎樣處理在座位上？'},
  {id:'zu',html:'先自<b>度</b>其足',bin:'du-verb',line:0,hint:'「先自度其足」：先對自己的腳做甚麼動作？'},
  {id:'lu',html:'且<b>置</b>履者',bin:'zhi-buy',line:0,hint:'「且置履者」：他將要對鞋子做甚麼？'}];
const BINS=[{id:'du-verb',char:'度',py:'duó',mean:'量一量',tag:[42,88]},{id:'du-noun',char:'度',py:'dù',mean:'量好的尺碼',tag:[31,40]},{id:'zhi-buy',char:'置',py:'zhì',mean:'買',tag:[87,50]},{id:'zhi-put',char:'置',py:'zhì',mean:'放',tag:[33,67]}];
const TOE=74.94,TOL=3.2,START=40,MIN=8,MAX=96;
const voice='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m10 5-5 4H2v6h3l5 4ZM14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';

/** 鄭人買履 as a market story: measure, decide, try on, then sort 度/置 meanings. */
export function mountShoeMarket(holder,{initialState,readOnly=false,playAudio,onState,onComplete,onResearch,reducedMotion=false,onProgress}={}){
  const doc=holder.ownerDocument,view=doc.defaultView,abort=new view.AbortController(),timers=new Set(),heard=new Set();
  const loadImages=createGameImageLoader({signal:abort.signal});
  const init=initialState&&typeof initialState==='object'&&initialState.version===1?initialState:{};
  let stage=STAGES.includes(init.stage)?init.stage:'measure';
  let choice=['home','foot'].includes(init.choice)?init.choice:null,size=['small','right','big'].includes(init.size)?init.size:null;
  const sorted={},raw=init.sorted&&typeof init.sorted==='object'&&!Array.isArray(init.sorted)?init.sorted:{};
  const late=['sort','done'].includes(stage);
  if(late)for(const c of CARDS)if(raw[c.id]===c.bin)sorted[c.id]=c.bin;
  if(stage==='done'&&Object.keys(sorted).length<CARDS.length)stage='sort';
  if(['closed','advice'].includes(stage))choice='home';
  if(['measure','place','placed','market'].includes(stage))choice=null;
  if(stage!=='try')size=late?'right':null;
  if(late)choice??='foot';
  if(readOnly){stage='done';size='right';choice??='foot';CARDS.forEach(c=>{sorted[c.id]=c.bin;});}
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
    ${BINS.map(b=>`<span class="sm-tag" data-tag="${b.id}" style="--x:${b.tag[0]}%;--y:${b.tag[1]}%" aria-hidden="true"><b>${b.char}</b><i>${b.py}</i>${b.mean}</span>`).join('')}
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
    <div class="sm-sort" hidden><div class="sm-cards">${CARDS.map(c=>`<button type="button" data-sm-sent="${c.id}" data-sm-drag="sent">${c.html}</button>`).join('')}</div>
      <div class="sm-bins">${BINS.map(b=>`<button type="button" class="is-${b.id.slice(0,2)}" data-sm-bin="${b.id}"><span><b>${b.char}</b> ${b.py}</span><small>${b.mean}</small><em></em></button>`).join('')}</div></div>
    <div class="sm-moral" hidden><img src="${art('ruler')}" alt="" draggable="false"><b>寓意</b><p>${cl(MORAL)}</p><small>${cl(KNOW)}</small></div>
  </div>
  <div class="sm-actions"><button type="button" class="sm-listen" data-sm-listen>${voice}<span>聽這句</span></button><button type="button" class="sm-next" data-sm-next hidden></button></div>
  <p class="sm-feedback" role="status" aria-live="polite"></p></div></div>`;
  holder.append(root);
  const q=s=>root.querySelector(s),qa=s=>root.querySelectorAll(s),tell=t=>{if(!dead)q('.sm-feedback').innerHTML=cl(t);};
  const later=(fn,ms)=>{const id=view.setTimeout(()=>{timers.delete(id);if(!dead)fn();},ms);timers.add(id);};
  const state=()=>({version:1,stage,choice,size,sorted:{...sorted}});
  const available=()=>!dead&&ready&&!readOnly&&!solved,can=s=>available()&&stage===s;
  const completed=()=>stage==='done'?4:stage==='sort'?3:stage==='try'?2:['measure','place'].includes(stage)?0:1;
  function progress(){const n=completed();if(n!==lastProgress){lastProgress=n;onProgress?.({completed:n,total:4});}}
  function save(){if(readOnly||solved||dead)return;onState?.(state());progress();}
  function wiggle(el){if(!el||reducedMotion)return;el.classList.remove('is-wiggle');void el.offsetWidth;el.classList.add('is-wiggle');later(()=>el.classList.remove('is-wiggle'),520);}
  function tone(kind){
    try{audio??=new(view.AudioContext||view.webkitAudioContext)();if(audio.state==='suspended')void audio.resume().catch(()=>{});
      const now=audio.currentTime,notes={ding:[[660,0],[990,.1]],soft:[[330,0]],knock:[[170,0],[160,.17]],tock:[[520,0]]}[kind]||[[440,0]];
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
    else if(stage==='sort')research.present('sort',{optionOrder:CARDS.map(c=>c.id)});
  }
  function passed(){return stage==='placed'||stage==='closed'&&knocked||stage==='advice'&&agreed||stage==='try'&&size==='right';}
  function render(){
    const v=VIEW[stage],on=available(),filled=new Set(Object.values(sorted));
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
    qa('.sm-tag').forEach(t=>t.classList.toggle('is-on',filled.has(t.dataset.tag)));
    q('.sm-text').hidden=!v.text;
    if(v.text){q('.sm-line').innerHTML=v.text.replace(/「[^」]*」[，。？！]?|[^，。、：；？！「」]+[，。、：；？！]*/g,m=>`<span>${m}</span>`);const [c,py,mean]=v.gloss,g=q('[data-sm-gloss]');g.innerHTML=`<b>${c}</b><i>${py}</i><span>${mean}</span>${voice}`;g.setAttribute('aria-label',`聽「${c}」字的讀音：${py}，意思是${mean}`);g.disabled=!ready;}
    q('.sm-measure').hidden=stage!=='measure';setKnot(knot);q('[data-sm-knot]').disabled=!on||stage!=='measure';
    const card=q('[data-sm-card]');card.hidden=stage!=='place';card.disabled=!on;card.setAttribute('aria-pressed',String(selected==='ruler'));
    const ask=ASK[stage];q('.sm-ask').hidden=!ask;
    if(ask){q('.sm-ask p').textContent=ask[0];qa('[data-sm-choice]').forEach((b,i)=>{b.textContent=ask[i+1][1];b.dataset.id=ask[i+1][0];b.disabled=!on||stage==='advice'&&agreed;b.classList.toggle('is-picked',stage==='advice'&&agreed&&i===0);});}
    q('.sm-fitting').hidden=stage!=='try';q('.sm-fit').dataset.size=size||'none';
    qa('[data-sm-shoe]').forEach(b=>{b.disabled=!on;b.classList.toggle('is-on',b.dataset.smShoe===size);b.setAttribute('aria-pressed',String(b.dataset.smShoe===size));});
    q('.sm-sort').hidden=stage!=='sort';
    qa('[data-sm-sent]').forEach(b=>{const id=b.dataset.smSent;b.classList.toggle('is-used',!!sorted[id]);b.disabled=!on||!!sorted[id];b.setAttribute('aria-pressed',String(selected===id));});
    qa('[data-sm-bin]').forEach(b=>{const id=b.dataset.smBin,got=CARDS.filter(c=>sorted[c.id]===id);b.disabled=!on;b.classList.toggle('is-filled',got.length>0);b.classList.toggle('is-ready',!!selected&&selected!=='ruler');
      b.querySelector('em').innerHTML=got.map(c=>c.html).join('');const bin=BINS.find(x=>x.id===id);b.setAttribute('aria-label',`${bin.char}（${bin.py}）：${bin.mean}${got.length?`，已放入「${got.map(c=>c.html.replace(/<\/?b>/g,'')).join('')}」`:''}`);});
    q('.sm-moral').hidden=stage!=='done';
    const next=q('[data-sm-next]');next.hidden=readOnly||solved||!passed();next.disabled=!on;
    next.innerHTML=`${{placed:'去市集',closed:'後來呢？',advice:'回市集試鞋',try:'買這雙'}[stage]||'下一步'} <span aria-hidden="true">→</span>`;
    q('[data-sm-listen]').disabled=!ready;
  }
  // Move focus only for keyboard users, so pointer users never see a ring that looks like a hint.
  function focusOn(sel){if(kbUser)q(sel)?.focus({preventScroll:true});}
  function focusFirst(){
    const el={measure:'[data-sm-knot]',place:'[data-sm-card]',market:'[data-sm-choice]',closed:'[data-sm-knock]',advice:'[data-sm-choice]',try:'[data-sm-shoe]',sort:'[data-sm-sent]:not(:disabled)',done:'[data-sm-listen]'}[stage];
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
  function pickSentence(id,kb){if(!can('sort')||sorted[id])return;selected=selected===id?null:id;render();tell(selected?'這句的字是甚麼意思？點下面一個意思框。':'放下了。再選一張句子卡。');if(selected&&kb)q('[data-sm-bin]').focus({preventScroll:true});}
  function judge(id,bin){
    if(!can('sort'))return;const card=CARDS.find(c=>c.id===id);
    if(!card||sorted[id]){tell('先點一張句子卡，再點它的意思。');return;}
    const ok=card.bin===bin;research.answer('sort',`${id}:${bin}`,ok);
    if(!ok){research.hint('sort');tone('soft');wiggle(q(`[data-sm-bin="${bin}"]`));tell(card.hint);return;}
    sorted[id]=bin;selected=null;tone('ding');
    if(Object.keys(sorted).length<CARDS.length){save();render();tell(`對了！還有 ${CARDS.length-Object.keys(sorted).length} 張。`);focusOn('[data-sm-sent]:not(:disabled)');return;}
    stage='done';save();render();tell(DONE);focusFirst();
    if(!reported){reported=true;research.complete();onComplete?.({correct:true,response:state(),knowledge:KNOW});}
  }
  function next(){
    if(!available()||!passed())return;
    if(stage==='placed'){go('market');autoLine(1);}
    else if(stage==='closed'){go('advice');autoLine(3);}
    else if(stage==='advice')go('try');
    else if(stage==='try'){research.action('try','buy');go('sort');}
  }
  // Replays during review (readOnly / solved / after completion) are not hints, so they are not reported.
  const helped=kind=>{if(available()&&stage!=='done')research.hint(STEP[stage],kind);};
  function listen(){
    if(dead||!ready)return;helped('audio');
    const card=CARDS.find(c=>c.id===selected);speak({text:LINES[stage==='sort'&&card?card.line:VIEW[stage].line]},true);
  }
  // Drag: the knot slides along the ruler; the ruler card, shoes and sentence cards can be dropped on their targets.
  const targetAt=(x,y)=>[...qa('[data-sm-seat],[data-sm-fit],[data-sm-bin]')].find(t=>{if(t.closest('[hidden]')||t.disabled)return false;const r=t.getBoundingClientRect();return r.width>0&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;});
  const knotFrom=x=>{const r=q('.sm-measure').getBoundingClientRect();return (x-r.left)/r.width*100;};
  // Swallow only the synthetic click that a drag or knot tap leaves at the release point (layout may have changed under it).
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
    drag.moved=true;if(e.cancelable)e.preventDefault();
    drag.el.classList.add('is-dragging');drag.el.style.translate=`${dx}px ${dy}px`;
    const t=targetAt(e.clientX,e.clientY);qa('.is-over').forEach(n=>{if(n!==t)n.classList.remove('is-over');});t?.classList.add('is-over');
  }
  function up(e){
    if(!drag||e.pointerId!==drag.id)return;
    const d=endDrag();
    if(d.kind==='knot'){hush(e);if(e.type==='pointerup')measure();return;}
    if(!d.moved||e.type!=='pointerup')return;
    const t=targetAt(e.clientX,e.clientY);hush(e);
    if(d.kind==='card'){if(t?.matches('[data-sm-seat]'))place();else{research.action('measure','miss');tell('放到畫中坐榻的亮框裏。也可以點尺，再點坐榻。');}}
    else if(d.kind==='shoe'){if(t?.matches('[data-sm-fit]'))tryOn(d.el.dataset.smShoe);else tell('把鞋子拖到腳上，或者點一下鞋子。');}
    else if(d.kind==='sent'){if(t?.matches('[data-sm-bin]'))judge(d.el.dataset.smSent,t.dataset.smBin);else tell('放進下面其中一個意思框。');}
  }
  root.addEventListener('pointerdown',e=>{kbUser=false;down(e);},{signal:abort.signal});
  root.addEventListener('pointermove',move,{signal:abort.signal,passive:false});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(type,up,{signal:abort.signal});
  for(const type of ['contextmenu','selectstart','dragstart'])root.addEventListener(type,e=>{if(e.target.closest?.('[data-sm-drag]')&&e.cancelable)e.preventDefault();},{signal:abort.signal});
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)endDrag();},{signal:abort.signal});
  root.addEventListener('keydown',e=>{
    if(!e.altKey&&!e.ctrlKey&&!e.metaKey)kbUser=true;
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
    const sent=t.closest('[data-sm-sent]');if(sent)return pickSentence(sent.dataset.smSent,kb);
    const bin=t.closest('[data-sm-bin]');if(bin){if(!can('sort'))return;if(!selected){tell('先點一張句子卡，再點它的意思。');return;}judge(selected,bin.dataset.smBin);}
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
      CARDS.forEach(c=>{sorted[c.id]=c.bin;});render();tell(`${KNOW} 兩個「度」：度 duó 是量一量，度 dù 是量好的尺碼；兩個「置」：買和放。`);
    },
    reset(){
      if(dead||readOnly)return;endDrag();research.reset();timers.forEach(id=>view.clearTimeout(id));timers.clear();
      stage='measure';choice=null;size=null;selected=null;knot=START;knocked=false;agreed=false;solved=false;heard.clear();
      for(const k of Object.keys(sorted))delete sorted[k];render();tell(INTRO.measure);onState?.(state());progress();if(ready)present();else void load();
    },
    destroy(){
      if(dead)return;dead=true;loadId++;endDrag();abort.abort();timers.forEach(id=>view.clearTimeout(id));timers.clear();
      try{void audio?.close().catch(()=>{});}catch{}root.remove();
    }
  };
}
