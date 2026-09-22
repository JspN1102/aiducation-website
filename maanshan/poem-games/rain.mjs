import {createGameImageLoader} from './image-ready.mjs?v=20260922-school11';
import {imageAsset} from '../media-images.mjs?v=20260922-school16';
import {RAIN_GLYPHS} from './rain-glyphs.mjs?v=20260919a';
import {createProcessResearch} from './research.mjs?v=20260920a';

const media = name => new URL(imageAsset(`media/poem-games/rain-catcher/${name}`), import.meta.url).href;
const ROUNDS = [
  {char:'小',pinyin:'xiǎo',initial:'x',phrase:'天街小雨潤如酥',options:[['小','xiǎo'],['少','shǎo'],['掃','sǎo']]},
  {char:'酥',pinyin:'sū',initial:'s',phrase:'天街小雨潤如酥',options:[['酥','sū'],['書','shū'],['需','xū']]},
  {char:'色',pinyin:'sè',initial:'s',phrase:'草色遙看近卻無',options:[['色','sè'],['社','shè'],['謝','xiè']]},
  {char:'是',pinyin:'shì',initial:'sh',phrase:'最是一年春好處',options:[['是','shì'],['四','sì'],['細','xì']]},
  {char:'勝',pinyin:'shèng',initial:'sh',phrase:'絕勝煙柳滿皇都',options:[['勝','shèng'],['送','sòng'],['杏','xìng']]}
];
const POSITIONS = [18,50,82], WAVE_MS = 6200, ADVANCE_MS = 1700, TOTAL = ROUNDS.length;
const voice = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m10 5-5 4H2v6h3l5 4ZM14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
const leaf = '<svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M5 22C0 6 15 2 25 3c-1 15-8 22-20 19Zm0 0L20 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
const KNOWLEDGE='「小」xiǎo 的聲母是 x；「酥」sū、「色」sè 是 s；「是」shì、「勝」shèng 是 sh。把五個字放回詩句，再讀一讀。';
function glyph(char) {
  const strokes=RAIN_GLYPHS[char];
  return strokes ? `<svg class="rc-character" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false"><g transform="translate(0 900) scale(1 -1)">${strokes.map(d=>`<path d="${d}"/>`).join('')}</g></svg>` : char;
}

export function mountRain(holder,{initialState,readOnly=false,playAudio,onState,onComplete,onResearch,reducedMotion=false}={}) {
  const doc=holder.ownerDocument,view=doc.defaultView,events=new view.AbortController(),old=initialState||{};
  const loadImages=createGameImageLoader({signal:events.signal,timeout:15000});
  let caught=ROUNDS.map(()=>0);
  if(old.version===6&&Array.isArray(old.caught))caught=ROUNDS.map((_,i)=>old.caught[i]===1?1:0);
  // v5 stored two catches per word in the order 小 / 酥 / 勝. Map by word.
  if(old.version===5&&Array.isArray(old.caught)){
    [0,1,4].forEach((index,i)=>{caught[index]=old.caught[i]===1||old.caught[i]===2?1:0;});
  }
  const priorAnswer=readOnly&&(old.completed===true||old.gameCompleted===true);
  let done=caught.every(n=>n===1)||priorAnswer,solved=false,reported=readOnly,dead=false,ready=false,replaying=false;
  let phase=done?'done':readOnly?'readonly':'intro',round=Math.max(0,caught.findIndex(n=>n===0));
  let lane=1,boatPercent=50,wave=[],progress=0,raf=0,motionFrame=0,previousTime=0,drag=null,lastCorrect=false;
  let fieldWidth=1,fieldHeight=1,paintedBoatX=null,paintedRainY=null;
  let loading=0,loadTimer=0,audioGeneration=0,audioTimer=0,speaking=false,advanceTimer=0,advanceBlocked=false;
  const research=createProcessResearch(onResearch,{prefix:'game.rain',context:()=>replaying?{mode:'free'}:{},alive:()=>!dead});
  const step=index=>`word.${index}`;
  const choiceId=(index,char)=>`option.${ROUNDS[index].options.findIndex(option=>option[0]===char)}`;
  const root=doc.createElement('section');root.className='rain-catcher';root.setAttribute('aria-label','春雨接字');
  root.classList.toggle('is-reduced',reducedMotion);
  root.innerHTML=`<header class="rc-heading"><h3>春雨接字</h3><span class="rc-round-count" data-rc-count aria-label="已收集的漢字"></span></header>
  <div class="rc-collection" aria-label="收集五個詩中字">${ROUNDS.map((_,i)=>`<span data-rc-bud="${i}"><b>${i+1}</b><i aria-hidden="true"></i></span>`).join('')}</div>
  <div class="rc-mission"><span data-rc-prompt>接住讀音是 <strong data-rc-pinyin></strong> 的字</span><button type="button" data-rc-listen aria-label="聽這個字音">${voice}</button></div>
  <div class="rc-field" tabindex="0" role="group" aria-label="左右移動小葉舟，接住符合拼音的漢字雨滴。也可使用下方左右按鈕。" aria-busy="true">
    <img class="rc-scene" src="${media('spring-scene.webp')}" alt="早春的細雨、淡綠草芽和清淺水面" draggable="false" width="1200" height="800">
    <div class="rc-spring-light" aria-hidden="true"></div><div class="rc-drizzle" aria-hidden="true"></div>
    <div class="rc-lanes" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="rc-drops" aria-label="這一排漢字">${[0,1,2].map(i=>`<div class="rc-drop" role="img" data-rc-drop="${i}" style="left:${POSITIONS[i]}%"><span class="rc-drop-shine" aria-hidden="true"></span><span class="rc-glyph"></span><small></small></div>`).join('')}</div>
    <div class="rc-catch-line" aria-hidden="true"></div>
    <div class="rc-boat" data-rc-boat aria-label="小葉舟在中間"><span class="rc-boat-ripple"></span><img src="${media('leaf-boat.webp')}" alt="" draggable="false" width="640" height="268"><span class="rc-splash" aria-hidden="true"><i></i><i></i><i></i></span></div>
    <div class="rc-feedback" data-rc-feedback hidden><strong></strong><span></span></div>
    <div class="rc-intro" data-rc-intro><div><span class="rc-intro-icon">${leaf}</span><strong>一葉小舟，收集五個字</strong><p>左右滑動接字，接對就換下一個。</p><button type="button" class="rc-primary" data-rc-start>開始接雨</button></div></div>
    <div class="rc-ending" data-rc-ending hidden><strong></strong><div class="rc-wordbook">${ROUNDS.map((r,i)=>`<button type="button" data-rc-word="${i}" aria-label="聽「${r.char}」${r.pinyin}"><span class="rc-word-glyph">${glyph(r.char)}</span><small>${r.pinyin}</small></button>`).join('')}</div><p>點一點字卡，再聽一次。</p></div>
    <div class="rc-loading" role="status"><span>春日畫面正在打開…</span><button type="button" data-rc-retry hidden>再試一次</button></div>
  </div>
  <div class="rc-controls"><button type="button" data-rc-left aria-label="小葉舟向左移">←</button><button type="button" class="rc-primary" data-rc-main>準備好了</button><button type="button" data-rc-right aria-label="小葉舟向右移">→</button></div>
  <button type="button" class="rc-slow-catch" data-rc-catch hidden>對準了，接這一排</button>
  <button type="button" class="rc-replay" data-rc-replay hidden>再玩五個字</button>
  <p class="rc-status" role="status" aria-live="polite"></p>`;
  holder.append(root);
  const q=s=>root.querySelector(s),field=q('.rc-field'),drops=[...root.querySelectorAll('[data-rc-drop]')];
  const boat=q('.rc-boat'),dropLayer=q('.rc-drops'),leftButton=q('[data-rc-left]'),rightButton=q('[data-rc-right]');
  const total=()=>caught.reduce((a,b)=>a+b,0);
  const snapshot=()=>({version:6,caught:[...caught],completed:done});
  const terminal=()=>done||solved||(readOnly&&!replaying);
  const canMove=()=>!dead&&ready&&!terminal()&&['falling','paused','steady'].includes(phase);
  const tell=text=>{if(!dead)q('.rc-status').textContent=text;};
  const save=()=>{if(!replaying&&!reported&&!readOnly)onState?.(snapshot());};
  function stopFrame(){view.cancelAnimationFrame(raf);raf=0;previousTime=0;}
  function clearAdvance(){view.clearTimeout(advanceTimer);advanceTimer=0;root.dataset.auto='false';}
  function finish(){
    if(replaying||readOnly||reported||solved||dead||!done)return;
    reported=true;onComplete?.({correct:true,response:snapshot(),knowledge:KNOWLEDGE});
  }
  function paintPosition(){
    const x=Math.round(fieldWidth*boatPercent)/100,y=Math.round(fieldHeight*(.26+progress*.47)*100)/100;
    if(x!==paintedBoatX){boat.style.transform=`translate3d(${x}px,0,0) translate(-50%,-30%)`;paintedBoatX=x;}
    if(y!==paintedRainY){dropLayer.style.transform=`translate3d(0,${y}px,0)`;paintedRainY=y;}
  }
  function requestPosition(){
    if(dead||motionFrame||raf)return;
    motionFrame=view.requestAnimationFrame(()=>{motionFrame=0;if(!dead)paintPosition();});
  }
  function measure(){
    if(dead)return;
    fieldWidth=field.clientWidth||1;fieldHeight=field.clientHeight||1;
    if(drag){const rect=field.getBoundingClientRect();drag.left=rect.left+field.clientLeft;drag.width=fieldWidth;}
    requestPosition();
  }
  function syncLane(){
    if(root.dataset.lane!==String(lane)){
      root.dataset.lane=String(lane);
      boat.setAttribute('aria-label',`小葉舟在${['左邊','中間','右邊'][lane]}`);
    }
    leftButton.disabled=!canMove()||lane===0;rightButton.disabled=!canMove()||lane===2;
  }
  function stopDrag(){
    const previous=drag;drag=null;root.classList.remove('is-dragging');
    if(previous){try{field.releasePointerCapture(previous.pointerId);}catch{}boatPercent=POSITIONS[lane];requestPosition();}
  }
  function refresh(){
    root.dataset.phase=phase;root.dataset.round=String(round);root.dataset.caught=String(total());root.dataset.ready=String(ready);
    root.classList.toggle('is-done',terminal());root.classList.toggle('is-celebrating',phase==='feedback'&&lastCorrect);
    root.style.setProperty('--spring-earned',String(total()/TOTAL));
    q('[data-rc-count]').textContent=done&&total()<TOTAL?'已完成':`${total()} / ${TOTAL} 字`;
    q('[data-rc-pinyin]').textContent=ROUNDS[round].pinyin;q('.rc-mission').hidden=terminal();
    q('[data-rc-intro]').hidden=phase!=='intro';q('[data-rc-ending]').hidden=!terminal();
    q('[data-rc-ending]>strong').textContent=done?(total()===TOTAL?'五個詩中字，收集完成！':'這一題已完成'):'這五個字，這樣讀';
    q('.rc-controls').hidden=terminal()||phase==='intro';q('.rc-drops').hidden=!wave.length||terminal()||phase==='intro';
    q('.rc-catch-line').hidden=terminal()||phase==='intro';q('.rc-boat').hidden=terminal();
    q('[data-rc-feedback]').hidden=phase!=='feedback';q('[data-rc-replay]').hidden=!done||solved;
    q('[data-rc-start]').disabled=!ready;q('[data-rc-main]').disabled=!ready;q('[data-rc-replay]').disabled=!ready;
    q('[data-rc-main]').textContent=phase==='falling'?'暫停一下':phase==='paused'?'繼續接雨':phase==='steady'?'接住這一排':phase==='feedback'?(lastCorrect?'下一個字':'再接一次'):'開始接雨';
    q('[data-rc-catch]').hidden=phase!=='paused';q('[data-rc-listen]').disabled=!ready||speaking;
    q('[data-rc-listen]').setAttribute('aria-busy',String(speaking));
    root.querySelectorAll('[data-rc-word]').forEach(button=>{button.disabled=!ready||speaking;});
    syncLane();
    root.querySelectorAll('[data-rc-bud]').forEach((el,i)=>{
      el.classList.toggle('is-earned',caught[i]===1);el.classList.toggle('is-current',!terminal()&&i===round&&!caught[i]);
      el.querySelector('b').textContent=caught[i]?ROUNDS[i].char:String(i+1);
      el.setAttribute('aria-label',caught[i]?`已收集「${ROUNDS[i].char}」`:`第 ${i+1} 個字，未收集`);
    });
    field.tabIndex=terminal()?-1:0;paintPosition();
  }
  function move(next,position=POSITIONS[clamp(next,0,2)]){if(!canMove())return;const changed=lane!==clamp(next,0,2);lane=clamp(next,0,2);boatPercent=position;if(changed)syncLane();requestPosition();}
  function makeWave(){
    round=Math.max(0,caught.findIndex(n=>n===0));wave=[...ROUNDS[round].options];
    for(let i=wave.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[wave[i],wave[j]]=[wave[j],wave[i]];}
    research.present(step(round),{position:round,total:TOTAL,optionOrder:wave.map(option=>choiceId(round,option[0])),...(replaying?{mode:'free'}:{})},{repeat:true});
    drops.forEach((el,i)=>{
      el.dataset.char=wave[i][0];el.setAttribute('aria-label',wave[i][0]);
      el.querySelector('.rc-glyph').innerHTML=glyph(wave[i][0]);el.querySelector('small').textContent='';el.classList.remove('is-caught','is-wrong');
    });
  }
  function startWave({automatic=false}={}){
    if(dead||!ready||terminal()||!['intro','feedback'].includes(phase)||doc.hidden)return;
    clearAdvance();stopFrame();makeWave();progress=0;lastCorrect=false;advanceBlocked=false;phase=reducedMotion?'steady':'falling';
    tell(reducedMotion?'用左右按鈕對準漢字，再接住這一排。':'左右滑動小葉舟；點水面也能移動。');refresh();
    if(phase==='falling')raf=view.requestAnimationFrame(frame);
    if(!automatic)field.focus({preventScroll:true});
  }
  function scheduleAdvance(){
    clearAdvance();
    if(dead||terminal()||phase!=='feedback'||!lastCorrect||doc.hidden||speaking||reducedMotion||advanceBlocked)return;
    root.dataset.auto='true';advanceTimer=view.setTimeout(()=>{advanceTimer=0;root.dataset.auto='false';startWave({automatic:true});},ADVANCE_MS);
  }
  function catchRow(){
    if(!canMove())return;stopDrag();stopFrame();clearAdvance();advanceBlocked=false;progress=1;phase='feedback';
    const selected=wave[lane],target=ROUNDS[round];lastCorrect=selected[0]===target.char;
    research.answer(step(round),choiceId(round,selected[0]),lastCorrect);
    if(!lastCorrect)research.hint(step(round));
    drops.forEach((el,i)=>{el.querySelector('small').textContent=wave[i][1];el.setAttribute('aria-label',`${wave[i][0]}，${wave[i][1]}`);});
    drops[lane].classList.add(lastCorrect?'is-caught':'is-wrong');
    q('[data-rc-feedback]').dataset.result=lastCorrect?'correct':'incorrect';
    q('[data-rc-feedback] strong').textContent=lastCorrect?`接到了！${target.char} · ${target.pinyin}`:`這是「${selected[0]}」${selected[1]}`;
    q('[data-rc-feedback] span').textContent=lastCorrect?target.phrase:`找讀 ${target.pinyin} 的字，再試一次。`;
    if(lastCorrect){
      caught[round]=1;done=total()===TOTAL;save();
      tell(`接到了！「${target.char}」讀 ${target.pinyin}。已收集 ${total()} 個字，共五個。`);
      if(done){research.complete();phase='done';refresh();finish();return;}
    }else tell(`這是「${selected[0]}」${selected[1]}；要找讀 ${target.pinyin} 的字。再來一次，不扣分。`);
    refresh();scheduleAdvance();
  }
  function frame(now){
    raf=0;if(dead||phase!=='falling'||terminal())return;
    if(doc.hidden){pause();return;}
    if(previousTime)progress=Math.min(1,progress+Math.min(90,now-previousTime)/WAVE_MS);
    previousTime=now;paintPosition();
    if(progress>=1){catchRow();return;}
    raf=view.requestAnimationFrame(frame);
  }
  function pause(){
    clearAdvance();advanceBlocked=true;
    if(phase!=='falling')return;
    stopDrag();stopFrame();phase='paused';refresh();tell('雨滴等着你。移好小舟，再繼續；也可直接接這一排。');
  }
  function resume(){if(phase!=='paused'||dead||terminal()||doc.hidden)return;phase='falling';refresh();tell('看好字音，讓小葉舟接住它。');raf=view.requestAnimationFrame(frame);}
  function point(event){
    if(!drag)return;
    const percent=clamp((event.clientX-drag.left)/drag.width*100,POSITIONS[0],POSITIONS[2]);
    move(Math.round((percent-POSITIONS[0])/(POSITIONS[1]-POSITIONS[0])),percent);
  }
  function replay(){
    if(dead||!ready||!done||solved)return;
    replaying=true;research.reset();
    stopDrag();clearAdvance();stopFrame();audioGeneration++;speaking=false;view.clearTimeout(audioTimer);
    replaying=true;done=false;caught=ROUNDS.map(()=>0);round=0;lane=1;boatPercent=50;wave=[];progress=0;lastCorrect=false;phase='intro';
    refresh();tell('再收集五個字，原來的成果已保留。');
  }
  async function listen(index){
    if(dead||!ready||speaking)return;const token=++audioGeneration,target=ROUNDS[index];speaking=true;pause();refresh();let result,timeout;
    research.hint(step(index),'audio');
    try{result=await Promise.race([Promise.resolve(playAudio?.({char:target.char,pinyin:target.pinyin})),new Promise(resolve=>{timeout=view.setTimeout(()=>resolve(false),20000);audioTimer=timeout;})]);}catch{result=false;}finally{view.clearTimeout(timeout);if(audioTimer===timeout)audioTimer=0;}
    if(dead||token!==audioGeneration)return;speaking=false;refresh();
    if(result===false){research.error(step(index),'audio_unavailable');tell('聲音暫時未能播放，看拼音也可以練習。');}
    scheduleAdvance();
  }
  field.addEventListener('pointerdown',event=>{
    if(drag||!canMove()||event.button>0||event.isPrimary===false||event.target.closest('button'))return;
    event.preventDefault();const rect=field.getBoundingClientRect();
    drag={pointerId:event.pointerId,left:rect.left+field.clientLeft,width:field.clientWidth||1};
    root.classList.add('is-dragging');try{field.setPointerCapture(event.pointerId);}catch{}point(event);
  },{signal:events.signal,passive:false});
  field.addEventListener('pointermove',event=>{if(drag?.pointerId!==event.pointerId||!canMove())return;if(event.cancelable)event.preventDefault();point(event);},{signal:events.signal,passive:false});
  const release=event=>{if(drag?.pointerId!==event.pointerId)return;if(event.type==='pointerup')point(event);stopDrag();};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])field.addEventListener(type,release,{signal:events.signal});
  for(const type of ['touchstart','touchmove','contextmenu','selectstart','dragstart'])field.addEventListener(type,event=>{if(canMove()&&!event.target.closest('button')&&event.cancelable)event.preventDefault();},{signal:events.signal,passive:false});
  field.addEventListener('keydown',event=>{
    if(event.target.closest('button'))return;
    if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();move(lane+(event.key==='ArrowLeft'?-1:1));}
    if(event.code==='Space'){event.preventDefault();if(phase==='falling')pause();else if(phase==='paused'||phase==='steady')catchRow();else startWave();}
  },{signal:events.signal});
  q('[data-rc-start]').addEventListener('click',()=>startWave(),{signal:events.signal});
  q('[data-rc-left]').addEventListener('click',()=>move(lane-1),{signal:events.signal});
  q('[data-rc-right]').addEventListener('click',()=>move(lane+1),{signal:events.signal});
  q('[data-rc-main]').addEventListener('click',()=>{if(phase==='falling')pause();else if(phase==='paused')resume();else if(phase==='steady')catchRow();else startWave();},{signal:events.signal});
  q('[data-rc-catch]').addEventListener('click',catchRow,{signal:events.signal});
  q('[data-rc-replay]').addEventListener('click',replay,{signal:events.signal});
  const leave=()=>{stopDrag();pause();};
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)leave();},{signal:events.signal});view.addEventListener('blur',leave,{signal:events.signal});
  q('[data-rc-listen]').addEventListener('click',()=>void listen(round),{signal:events.signal});
  root.querySelectorAll('[data-rc-word]').forEach(button=>button.addEventListener('click',()=>void listen(Number(button.dataset.rcWord)),{signal:events.signal}));
  async function load(){
    if(loading)research.retry('assets');
    const generation=++loading;ready=false;refresh();q('.rc-loading').hidden=false;q('.rc-loading span').textContent='春日畫面正在展開…';q('[data-rc-retry]').hidden=true;field.setAttribute('aria-busy','true');
    const unavailable=()=>{if(dead||generation!==loading)return;research.error('assets');q('.rc-loading span').textContent='春日畫面還在載入，可以再試一次。';q('[data-rc-retry]').hidden=false;field.setAttribute('aria-busy','false');};
    const images=[q('.rc-scene'),q('.rc-boat img')];
    if(generation>1)images.forEach(img=>{const url=new URL(img.src);url.searchParams.set('retry',String(generation));img.src=url.href;});
    try{
      await loadImages(images,{onTimeout:unavailable});
      if(dead||generation!==loading)return;
      ready=true;q('.rc-loading').hidden=true;field.setAttribute('aria-busy','false');refresh();
      // Recover a fully caught but not yet submitted v6 draft after a refresh.
      if(done)finish();
    }catch{unavailable();}
    finally{view.clearTimeout(loadTimer);}
  }
  q('[data-rc-retry]').addEventListener('click',()=>void load(),{signal:events.signal});
  const resizeObserver=new view.ResizeObserver(measure);resizeObserver.observe(field);measure();
  tell(done?'點字卡聽讀音，也可以再玩五個字。':readOnly?'看看這五個字的讀音。':'一局收集五個不同的字。接錯也能再來。');refresh();void load();
  return {
    showSolution(){if(dead||solved)return;stopDrag();research.hint('game','reveal');clearAdvance();stopFrame();solved=true;phase='solution';audioGeneration++;speaking=false;view.clearTimeout(audioTimer);refresh();tell(KNOWLEDGE);},
    destroy(){if(dead)return;dead=true;loading++;audioGeneration++;stopDrag();clearAdvance();stopFrame();view.cancelAnimationFrame(motionFrame);motionFrame=0;resizeObserver.disconnect();view.clearTimeout(loadTimer);view.clearTimeout(audioTimer);events.abort();root.remove();}
  };
}
