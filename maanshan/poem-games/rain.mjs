const media = name => new URL(`../media/poem-games/rain-catcher/${name}`, import.meta.url).href;
const ROUNDS = [
  {char:'小',pinyin:'xiǎo',initial:'x',phrase:'天街小雨潤如酥',options:[['小','xiǎo'],['少','shǎo'],['掃','sǎo']]},
  {char:'酥',pinyin:'sū',initial:'s',phrase:'天街小雨潤如酥',options:[['酥','sū'],['書','shū'],['需','xū']]},
  {char:'勝',pinyin:'shèng',initial:'sh',phrase:'絕勝煙柳滿皇都',options:[['勝','shèng'],['送','sòng'],['杏','xìng']]}
];
const POSITIONS = [18,50,82], WAVE_MS = 5800, TOTAL = 6;
const voice = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m10 5-5 4H2v6h3l5 4ZM14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
const leaf = '<svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M5 22C0 6 15 2 25 3c-1 15-8 22-20 19Zm0 0L20 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
const KNOWLEDGE='「小」xiǎo 的聲母是 x，「酥」sū 是 s，「勝」shèng 是 sh。把三個字放回詩句，再讀一讀。';

export function mountRain(holder,{initialState,readOnly=false,playAudio,onState,onComplete,reducedMotion=false}={}) {
  const doc=holder.ownerDocument,view=doc.defaultView,events=new view.AbortController();
  const old=initialState||{};
  let caught=old.version===5&&Array.isArray(old.caught)
    ? ROUNDS.map((_,i)=>Number.isInteger(old.caught[i])?clamp(old.caught[i],0,2):0) : [0,0,0];
  // Earlier games keep completed work; incomplete drafts start this new game.
  if(old.completed===true||old.gameCompleted===true)caught=[2,2,2];
  let done=caught.every(n=>n===2),solved=false,reported=done,dead=false,ready=false;
  let phase=done?'done':readOnly?'readonly':'intro',round=Math.max(0,caught.findIndex(n=>n<2));
  let lane=1,wave=[],waveNumber=0,progress=0,raf=0,previousTime=0,drag=null;
  let loading=0,loadTimer=0,audioGeneration=0,audioTimer=0,speaking=false;
  const root=doc.createElement('section');root.className='rain-catcher';root.setAttribute('aria-label','春雨接字');
  root.classList.toggle('is-reduced',reducedMotion);
  root.innerHTML=`<header class="rc-heading"><h3>春雨接字</h3><span class="rc-progress" aria-label="已接到的字音">${ROUNDS.map((r,i)=>`<span data-rc-bud="${i}">${leaf}<b>${r.initial}</b></span>`).join('')}</span></header>
  <div class="rc-mission"><span data-rc-prompt>接住讀音是 <strong data-rc-pinyin></strong> 的字</span><button type="button" data-rc-listen aria-label="聽這個字音">${voice}</button></div>
  <div class="rc-field" tabindex="0" role="group" aria-label="左右移動小葉舟，接住符合拼音的漢字雨滴。也可使用下方左右按鈕。" aria-busy="true">
    <img class="rc-scene" src="${media('spring-scene.webp')}" alt="早春的細雨、淡綠草芽和清淺水面" draggable="false" width="1200" height="800">
    <div class="rc-spring-light" aria-hidden="true"></div><div class="rc-drizzle" aria-hidden="true"></div>
    <div class="rc-lanes" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="rc-drops" aria-label="這一排漢字">${[0,1,2].map(i=>`<div class="rc-drop" data-rc-drop="${i}" style="left:${POSITIONS[i]}%"><span></span><small></small></div>`).join('')}</div>
    <div class="rc-catch-line" aria-hidden="true"></div>
    <div class="rc-boat" data-rc-boat aria-label="小葉舟在中間"><span class="rc-boat-ripple"></span><img src="${media('leaf-boat.webp')}" alt="" draggable="false" width="480" height="300"></div>
    <div class="rc-feedback" data-rc-feedback hidden></div>
    <div class="rc-intro" data-rc-intro><div><span class="rc-intro-icon">${leaf}</span><strong>把字音接進小葉舟</strong><p>左右滑動，對準要接的字。</p><button type="button" class="rc-primary" data-rc-start>開始接雨</button></div></div>
    <div class="rc-ending" data-rc-ending hidden><strong>你接住了春天的聲音</strong><div>${ROUNDS.map(r=>`<span><b>${r.char}</b><small>${r.pinyin}</small></span>`).join('')}</div><p>小雨輕輕，春色慢慢亮起。</p></div>
    <div class="rc-loading" role="status"><span>春日畫面正在打開…</span><button type="button" data-rc-retry hidden>再試一次</button></div>
  </div>
  <div class="rc-controls"><button type="button" data-rc-left aria-label="小葉舟向左移">←</button><button type="button" class="rc-primary" data-rc-main>準備好了</button><button type="button" data-rc-right aria-label="小葉舟向右移">→</button></div>
  <button type="button" class="rc-slow-catch" data-rc-catch hidden>對準了，接這一排</button>
  <p class="rc-status" role="status" aria-live="polite"></p>`;
  holder.append(root);
  const q=s=>root.querySelector(s),field=q('.rc-field'),drops=[...root.querySelectorAll('[data-rc-drop]')];
  const total=()=>caught.reduce((a,b)=>a+b,0);
  const snapshot=()=>({version:5,caught:[...caught],completed:done});
  const terminal=()=>done||solved||readOnly;
  const canMove=()=>!dead&&ready&&!terminal()&&['falling','paused','steady'].includes(phase);
  const tell=text=>{if(!dead)q('.rc-status').textContent=text;};
  function stopFrame(){view.cancelAnimationFrame(raf);raf=0;previousTime=0;}
  function paintPosition(){
    q('.rc-boat').style.left=POSITIONS[lane]+'%';
    q('.rc-boat').setAttribute('aria-label',`小葉舟在${['左邊','中間','右邊'][lane]}`);
    root.dataset.lane=String(lane);
    q('.rc-drops').style.top=(24+progress*50)+'%';
  }
  function refresh(){
    root.dataset.phase=phase;root.dataset.round=String(round);root.dataset.caught=String(total());root.dataset.ready=String(ready);
    root.classList.toggle('is-done',terminal());root.style.setProperty('--spring-earned',String(total()/TOTAL));
    q('[data-rc-pinyin]').textContent=ROUNDS[round].pinyin;q('.rc-mission').hidden=terminal();
    q('[data-rc-intro]').hidden=phase!=='intro';q('[data-rc-ending]').hidden=!terminal();
    q('[data-rc-ending]>strong').textContent=done?'你接住了春天的聲音':'這三個字，這樣讀';
    q('.rc-controls').hidden=terminal()||phase==='intro';q('.rc-drops').hidden=!wave.length||terminal()||phase==='intro';
    q('.rc-catch-line').hidden=terminal()||phase==='intro';q('.rc-boat').hidden=terminal();
    q('[data-rc-feedback]').hidden=phase!=='feedback';
    q('[data-rc-start]').disabled=!ready;q('[data-rc-main]').disabled=!ready;
    q('[data-rc-main]').textContent=phase==='falling'?'暫停一下':phase==='paused'?'繼續落雨':phase==='steady'?'接住這一排':phase==='feedback'?'繼續接雨':'開始接雨';
    q('[data-rc-catch]').hidden=phase!=='paused';q('[data-rc-listen]').disabled=!ready||speaking;
    q('[data-rc-listen]').setAttribute('aria-busy',String(speaking));
    q('[data-rc-left]').disabled=!canMove()||lane===0;q('[data-rc-right]').disabled=!canMove()||lane===2;
    root.querySelectorAll('[data-rc-bud]').forEach((el,i)=>{el.classList.toggle('is-earned',caught[i]===2||solved);el.classList.toggle('is-half',caught[i]===1);el.setAttribute('aria-label',`${ROUNDS[i].initial} 已接 ${solved?2:caught[i]} 個，共兩個`);});
    field.tabIndex=terminal()?-1:0;paintPosition();
  }
  function move(next){if(!canMove())return;lane=clamp(next,0,2);paintPosition();q('[data-rc-left]').disabled=lane===0;q('[data-rc-right]').disabled=lane===2;}
  function makeWave(){
    round=Math.max(0,caught.findIndex(n=>n<2));
    const offset=(waveNumber++ + round)%3;
    wave=ROUNDS[round].options.map((_,i)=>ROUNDS[round].options[(i+offset)%3]);
    drops.forEach((el,i)=>{el.querySelector('span').textContent=wave[i][0];el.querySelector('small').textContent='';el.classList.remove('is-caught','is-wrong');});
  }
  function startWave(){
    if(dead||!ready||terminal()||!['intro','feedback'].includes(phase))return;
    stopFrame();makeWave();progress=0;phase=reducedMotion?'steady':'falling';
    tell(reducedMotion?'用左右按鈕對準漢字，再接住這一排。':'左右滑動小葉舟；點水面也能移動。');refresh();
    if(phase==='falling')raf=view.requestAnimationFrame(frame);
    field.focus({preventScroll:true});
  }
  function catchRow(){
    if(!canMove())return;stopFrame();progress=1;phase='feedback';
    const selected=wave[lane],target=ROUNDS[round],correct=selected[0]===target.char;
    drops.forEach((el,i)=>{el.querySelector('small').textContent=wave[i][1];});
    drops[lane].classList.add(correct?'is-caught':'is-wrong');
    q('[data-rc-feedback]').textContent=correct?`接到了！${target.char} · ${target.pinyin}`:`這是 ${selected[0]} · ${selected[1]}，再來一次`;
    if(correct){
      caught[round]++;onState?.(snapshot());
      tell(`接到了！「${target.char}」讀 ${target.pinyin}。${caught[round]===2?`「${target.phrase}」。`:'再接一滴，這片春色就亮了。'}`);
      if(total()===TOTAL){done=true;phase='done';onState?.(snapshot());refresh();if(!reported){reported=true;onComplete?.({correct:true,response:snapshot(),knowledge:KNOWLEDGE});}return;}
    }else tell(`這是「${selected[0]}」${selected[1]}；我們要接「${target.char}」${target.pinyin}。再來一次，不扣分。`);
    refresh();
  }
  function frame(now){
    raf=0;if(dead||phase!=='falling'||terminal())return;
    if(doc.hidden){pause();return;}
    if(previousTime)progress=Math.min(1,progress+Math.min(90,now-previousTime)/WAVE_MS);
    previousTime=now;paintPosition();
    if(progress>=1){catchRow();return;}
    raf=view.requestAnimationFrame(frame);
  }
  function pause(){if(phase!=='falling')return;stopFrame();phase='paused';drag=null;refresh();tell('雨滴等着你。移好小舟，再繼續；也可直接接這一排。');}
  function resume(){if(phase!=='paused'||dead||terminal())return;phase='falling';refresh();tell('看好字音，讓小葉舟接住它。');raf=view.requestAnimationFrame(frame);}
  function point(event){const r=field.getBoundingClientRect();move(clamp(Math.floor((event.clientX-r.left)/r.width*3),0,2));}
  field.addEventListener('pointerdown',event=>{
    if(!canMove()||event.button>0||event.isPrimary===false||event.target.closest('button'))return;
    event.preventDefault();drag=event.pointerId;try{field.setPointerCapture(drag);}catch{}point(event);
  },{signal:events.signal,passive:false});
  field.addEventListener('pointermove',event=>{if(drag!==event.pointerId||!canMove())return;if(event.cancelable)event.preventDefault();point(event);},{signal:events.signal,passive:false});
  const release=event=>{if(drag!==event.pointerId)return;drag=null;try{field.releasePointerCapture(event.pointerId);}catch{}};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])field.addEventListener(type,release,{signal:events.signal});
  for(const type of ['touchstart','touchmove','contextmenu','selectstart','dragstart'])field.addEventListener(type,event=>{if(canMove()&&!event.target.closest('button')&&event.cancelable)event.preventDefault();},{signal:events.signal,passive:false});
  field.addEventListener('keydown',event=>{
    if(event.target.closest('button'))return;
    if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();move(lane+(event.key==='ArrowLeft'?-1:1));}
    if(event.code==='Space'){event.preventDefault();if(phase==='falling')pause();else if(phase==='paused'||phase==='steady')catchRow();else startWave();}
  },{signal:events.signal});
  q('[data-rc-start]').addEventListener('click',startWave,{signal:events.signal});
  q('[data-rc-left]').addEventListener('click',()=>move(lane-1),{signal:events.signal});
  q('[data-rc-right]').addEventListener('click',()=>move(lane+1),{signal:events.signal});
  q('[data-rc-main]').addEventListener('click',()=>{if(phase==='falling')pause();else if(phase==='paused')resume();else if(phase==='steady')catchRow();else startWave();},{signal:events.signal});
  q('[data-rc-catch]').addEventListener('click',catchRow,{signal:events.signal});
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)pause();},{signal:events.signal});view.addEventListener('blur',pause,{signal:events.signal});
  q('[data-rc-listen]').addEventListener('click',async()=>{
    if(dead||!ready||speaking)return;const token=++audioGeneration,target=ROUNDS[round];speaking=true;refresh();
    pause();let result;
    try{result=await Promise.race([Promise.resolve(playAudio?.({char:target.char,pinyin:target.pinyin})),new Promise(resolve=>{audioTimer=view.setTimeout(()=>resolve(false),20000);})]);}catch{result=false;}finally{view.clearTimeout(audioTimer);}
    if(dead||token!==audioGeneration)return;speaking=false;refresh();if(result===false&&!terminal())tell('聲音暫時未能播放，看拼音也可以接雨滴。');
  },{signal:events.signal});
  async function load(){
    const generation=++loading;ready=false;refresh();q('.rc-loading').hidden=false;q('[data-rc-retry]').hidden=true;
    const images=[q('.rc-scene'),q('.rc-boat img')];
    if(generation>1)images.forEach(img=>{const url=new URL(img.src);url.searchParams.set('retry',String(generation));img.src=url.href;});
    try{
      await Promise.race([Promise.all(images.map(img=>img.decode())),new Promise((_,reject)=>{loadTimer=view.setTimeout(()=>reject(new Error('image-timeout')),15000);})]);
      if(dead||generation!==loading)return;ready=true;q('.rc-loading').hidden=true;field.setAttribute('aria-busy','false');refresh();
    }catch{if(dead||generation!==loading)return;q('.rc-loading span').textContent='春日畫面未能載入。';q('[data-rc-retry]').hidden=false;field.setAttribute('aria-busy','false');}
    finally{view.clearTimeout(loadTimer);}
  }
  q('[data-rc-retry]').addEventListener('click',()=>void load(),{signal:events.signal});
  tell(done?'三個字音都接到了，春色也收好了。':readOnly?'看看這三個字的讀音。':'接對兩滴，點亮一片春色。接錯也能再來。');refresh();void load();
  return {
    showSolution(){if(dead)return;stopFrame();solved=true;phase='solution';audioGeneration++;speaking=false;view.clearTimeout(audioTimer);refresh();tell(KNOWLEDGE);},
    destroy(){if(dead)return;dead=true;loading++;audioGeneration++;stopFrame();view.clearTimeout(loadTimer);view.clearTimeout(audioTimer);events.abort();root.remove();}
  };
}
