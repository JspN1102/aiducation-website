import {escapeHTML as esc} from './core.mjs?v=20260921-school2';

// Hands-on practice records participation, never a fabricated speech score.
export function mountPoetryPlay(container,{poem,mode,completed,stopAudio=()=>{},onComplete=()=>{},onExplore=()=>{},speak=()=>{}}){
  let disposed=false,placed=[],misses=0,beat=0,demonstrating=false,timer=null,context=null;
  const lines=poem.lines.map(l=>l.text), order=lines.map((_,i)=>i);
  for(let i=order.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
  if(order.every((v,i)=>v===i))order.push(order.shift());
  const phrase=lines.find(l=>l.replace(/[，。！？；、]/g,'').length>=5)?.split(/[，。！？；、]/)[0]||lines[0];
  const chars=[...phrase], groups=chars.length===5?[2,3]:chars.length===7?[2,2,3]:chars.map(()=>1);
  const boundaries=[];groups.reduce((total,n)=>{boundaries.push(total+n);return total+n;},0);
  const $=selector=>container.querySelector(selector);
  function tick(){
    try{
      const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
      context??=new Audio();void context.resume().catch(()=>{});
      const oscillator=context.createOscillator(),gain=context.createGain(),t=context.currentTime;
      oscillator.type='sine';oscillator.frequency.setValueAtTime(640,t);oscillator.frequency.exponentialRampToValueAtTime(280,t+.05);
      gain.gain.setValueAtTime(.075,t);gain.gain.exponentialRampToValueAtTime(.001,t+.085);
      oscillator.connect(gain);gain.connect(context.destination);oscillator.start(t);oscillator.stop(t+.09);
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
    }catch{/* Visual rhythm remains available without sound. */}
  }
  function shell(){
    container.innerHTML=`<div class="poetry-play"><aside class="play-scene"><img src="media/exploration/${poem.slug}/scene.webp" alt="${esc(poem.title)}的詩境" width="900" height="600"><div class="play-scene-caption"><span>畫裡的詩，手中的遊戲</span><button class="text-button" data-play="explore">走進詩境 →</button></div></aside><section class="play-card"><div class="play-guide"><img src="media/shishi-guide.webp" alt="" width="48" height="58"><div><span>詩詩陪你玩</span><h2>${mode==='order'?'把古詩拼回來':'拍一拍，讀一讀'}</h2></div></div><div id="play-body"></div></section></div>`;
    if(completed?.version===1&&completed.kind===mode&&completed.completedAt){
      $('#play-body').innerHTML='<div class="play-finished"><img src="media/paper-crane-flight-v3.webp" width="180" height="136" alt=""><h3>這一關，你已經完成了</h3><p class="play-message">再玩一遍，或者去詩境找新的發現。</p><div class="play-actions"><button class="button" data-play="restart">再玩一次</button><button class="button primary" data-play="explore">走進詩境 →</button></div></div>';
    }else if(mode==='order')renderOrder();else renderRhythm();
  }
  function renderOrder(){
    const complete=placed.length===lines.length;
    $('#play-body').innerHTML=`<p class="play-instruction">${complete?'整首詩連起來了！':`點一下詩句，放進第 ${placed.length+1} 格。`}</p><div class="poem-puzzle" aria-label="已拼好的詩句">${lines.map((line,i)=>`<div class="puzzle-slot ${i<placed.length?'filled':i===placed.length?'active':''}"><span>${i+1}</span><p>${i<placed.length?esc(line):i===placed.length?'這一句是……':'· · ·'}</p></div>`).join('')}</div><div class="puzzle-pieces" aria-label="待選的詩句">${order.filter(i=>!placed.includes(i)).map(i=>`<button data-play="piece" data-index="${i}">${esc(lines[i])}</button>`).join('')}</div><p class="play-message" role="status">${complete?'你把詩句的先後次序記住了。':''}</p><div class="play-actions">${complete?'<button class="button" data-play="restart">再拼一次</button><button class="button primary" data-play="explore">AR體驗 →</button>':'<button class="text-button" data-play="undo" '+(placed.length?'':'disabled')+'>撤回一步</button><button class="text-button" data-play="hint">給我一點提示</button>'}</div>`;
  }
  function renderRhythm(){
    $('#play-body').innerHTML=`<p class="play-instruction">一字一拍，遇到「/」稍停一下。</p><div class="rhythm-verse" aria-label="${esc(phrase)}，分組朗讀">${chars.map((c,i)=>`<span class="rhythm-char" data-beat="${i}">${esc(c)}</span>${boundaries.includes(i+1)&&i<chars.length-1?'<b aria-hidden="true">/</b>':''}`).join('')}</div><div class="rhythm-tools"><button class="button" data-play="demo">聽節拍</button><button class="button" data-play="listen">聽這句</button></div><button class="rhythm-drum" data-play="tap" aria-label="拍一下，也讀出一個字"><span aria-hidden="true">拍</span><small>每拍一下，讀一個字</small></button><p class="play-message" role="status">準備好了，就拍第一下。</p><div class="play-actions"><button class="text-button" data-play="restart">從頭開始</button><span class="beat-counter">0 / ${chars.length} 拍</span></div>`;
  }
  function showBeat(index){
    container.querySelectorAll('[data-beat]').forEach((el,i)=>{el.classList.toggle('tapped',i<=index);el.classList.toggle('current',i===index);});
    tick();
  }
  function tap(){
    if(demonstrating||beat>=chars.length)return;
    stopAudio();
    showBeat(beat++);$('.beat-counter').textContent=`${beat} / ${chars.length} 拍`;
    $('.play-message').textContent=beat===chars.length?'把這一句讀出節奏了！也可以再拍一遍。':boundaries.includes(beat)?'停一小下，再讀下一組。':'跟著拍子，讀下一個字。';
    if(beat===chars.length){$('[data-play="tap"]').disabled=true;onComplete({version:1,kind:'rhythm',participated:true,completedAt:Date.now()});}
  }
  function stopDemo(){clearTimeout(timer);timer=null;demonstrating=false;}
  function demo(){
    stopAudio();stopDemo();beat=0;renderRhythm();demonstrating=true;
    $('[data-play="tap"]').disabled=true;$('[data-play="demo"]').disabled=true;$('[data-play="listen"]').disabled=true;
    $('.play-message').textContent='先聽一遍，留意停頓。';let index=0;
    const next=()=>{
      if(disposed)return;
      if(index===chars.length){demonstrating=false;renderRhythm();$('.play-message').textContent='輪到你啦，一字一拍。';return;}
      showBeat(index++);timer=setTimeout(next,boundaries.includes(index)?1050:550);
    };next();
  }
  const controller=new AbortController();
  container.addEventListener('click',event=>{
    const button=event.target.closest('[data-play]');if(!button||button.disabled)return;
    const action=button.dataset.play;
    if(action==='explore'){stopDemo();onExplore();}
    if(action==='piece'){
      const index=Number(button.dataset.index);
      if(index!==placed.length){misses++;$('.play-message').textContent=`再想想，第 ${placed.length+1} 句是哪一句？`;button.classList.add('try-again');return;}
      placed.push(index);renderOrder();
      if(placed.length===lines.length)onComplete({version:1,kind:'order',correct:true,retries:misses,completedAt:Date.now()});
      container.querySelector('[data-play="piece"], [data-play="restart"]')?.focus({preventScroll:true});
    }
    if(action==='undo'){placed.pop();renderOrder();}
    if(action==='hint')$('.play-message').textContent=`這一句從「${lines[placed.length].slice(0,2)}」開始。`;
    if(action==='tap')tap();
    if(action==='demo')demo();
    if(action==='listen')speak(phrase,'',button);
    if(action==='restart'){stopAudio();stopDemo();beat=0;placed=[];misses=0;mode==='order'?renderOrder():renderRhythm();}
  },{signal:controller.signal});
  function pause(){
    if(demonstrating){stopDemo();beat=0;renderRhythm();}
    if(context?.state==='running')void context.suspend().catch(()=>{});
  }
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')pause();},{signal:controller.signal});
  shell();
  return {pause,destroy(){disposed=true;stopDemo();controller.abort();if(context&&context.state!=='closed')void context.close().catch(()=>{});container.replaceChildren();}};
}
