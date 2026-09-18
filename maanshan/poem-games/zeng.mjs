const scene=new URL('../media/exploration/zeng-wang-lun/scene.webp',import.meta.url).href;
const rounds=[
  {text:'李白乘舟將欲行',groups:['李白','乘舟','將欲行'],note:'詩人準備乘船離開。',done:'第一句送到了，船邊泛起小小的水紋。'},
  {text:'忽聞岸上踏歌聲',groups:['忽聞','岸上','踏歌聲'],note:'岸上傳來朋友的踏歌聲。',done:'一邊踏着步子，一邊唱歌，這就是踏歌。'},
  {text:'不及汪倫送我情',groups:['不及','汪倫','送我情'],note:'把這句送給好朋友。',done:'你的踏歌傳到了！汪倫送我的情，比深深的潭水還深。'},
];
const places=[{x:9,y:85,rotate:-22},{x:27,y:79,rotate:14},{x:45,y:85,rotate:-12}];
const shoe='<svg viewBox="0 0 30 48" aria-hidden="true"><path d="M15 2c8-2 12 6 12 14 0 5-2 9-4 12-2 4-2 6-2 8H9c0-5-1-9-4-13C1 15 6 4 15 2Z"/><path d="M9 39h12v4c0 3-3 4-6 4s-6-1-6-4Z"/><path class="shoe-detail" d="M10 10c3-4 7-5 10-2M9 15c3-4 7-5 12-2"/></svg>';
const voiceIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 5-5 4H2v6h3l5 4ZM14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';

/** A slow, untimed, keyboard-accessible stepping-song activity.
 * Speech is explicitly started by the child. Timing never affects completion.
 */
export function mountFarewell(holder,{initialState,readOnly=false,playAudio,onState,onComplete,reducedMotion=false}={}){
  const validNumber=(value,max)=>Number.isInteger(value)?Math.max(0,Math.min(max,value)):0;
  let round=validNumber(initialState?.round,2),taps=validNumber(initialState?.taps,3),heard=initialState?.heard===true;
  let finished=(initialState?.completed===true||initialState?.finished===true)&&round===2&&taps===3;
  if(taps>0)heard=true;
  let dead=false,ready=false,solution=false,playing=false,voiceGeneration=0,imageGeneration=0;
  const abort=new AbortController(),timers=new Set();
  const root=document.createElement('section');root.className=`poem-farewell-game${reducedMotion?' is-reduced-motion':''}`;
  root.setAttribute('aria-label','踏歌送朋友');
  root.innerHTML=`<div class="farewell-instruction"><p>聽一句，沿着腳印踏歌。</p><span class="farewell-progress"></span></div>
    <div class="farewell-picture" tabindex="0" role="group" aria-label="桃花潭邊有三枚腳印。聽完示範後，可以按空格踏歌。" aria-busy="true">
      <img class="farewell-scene" alt="汪倫站在桃花樹下的岸邊，向小船上的李白揮手送別。" width="1536" height="1024" draggable="false">
      <div class="farewell-light" aria-hidden="true"></div>
      <div class="farewell-footprints">${places.map((p,i)=>`<button type="button" class="farewell-foot" data-farewell-foot="${i}" style="--x:${p.x}%;--y:${p.y}%;--rotate:${p.rotate}deg" aria-label="第 ${i+1} 步" disabled>${shoe}<span aria-hidden="true">${i+1}</span></button>`).join('')}</div>
      <div class="farewell-complete-note" hidden>踏歌送朋友<br><span>友情留在心裏</span></div>
      <div class="farewell-loading" role="status"><span>桃花潭正在展開…</span><button type="button" data-farewell-retry hidden>再試一次</button></div>
    </div>
    <div class="farewell-verse" aria-label="朗讀詩句"></div>
    <div class="farewell-actions"><button type="button" class="farewell-listen" data-farewell-listen>${voiceIcon}<span>聽示範</span></button><button type="button" class="farewell-next" data-farewell-next hidden>再送一句 <span aria-hidden="true">→</span></button></div>
    <p class="farewell-feedback" role="status" aria-live="polite"></p>`;
  holder.append(root);
  const q=selector=>root.querySelector(selector),picture=q('.farewell-picture'),feedback=q('.farewell-feedback');
  const tell=text=>{feedback.textContent=text;};
  const later=(fn,delay)=>{const id=setTimeout(()=>{timers.delete(id);if(!dead)fn();},delay);timers.add(id);return id;};
  const state=()=>({round,taps,heard,completed:finished});
  const save=()=>onState?.(state());
  function update(){
    root.dataset.round=String(round);root.dataset.steps=String(taps);root.dataset.finished=String(finished);root.dataset.solution=String(solution);
    root.classList.toggle('is-complete',finished||solution);picture.style.setProperty('--journey',String(solution?1:(round*3+taps)/9));
    q('.farewell-progress').textContent=finished?'3 / 3':`${round+1} / 3`;
    q('.farewell-progress').setAttribute('aria-label',`第 ${round+1} 句，共 3 句`);
    q('.farewell-verse').innerHTML=rounds[round].groups.map((word,i)=>`<span class="${i<taps||solution?'is-sung':''}${i===taps&&heard&&!finished&&!solution?' is-current':''}">${word}</span>`).join('');
    q('.farewell-verse').setAttribute('aria-label',rounds[round].text);
    q('[data-farewell-listen]').disabled=!ready||playing||solution;
    q('[data-farewell-listen] span').textContent=playing?'正在讀…':heard?'再聽一次':'聽示範';
    q('[data-farewell-listen]').setAttribute('aria-busy',String(playing));
    q('[data-farewell-next]').hidden=!(taps===3&&round<2&&!readOnly&&!solution);
    q('[data-farewell-next]').disabled=playing;
    for(let i=0;i<3;i++){
      const button=q(`[data-farewell-foot="${i}"]`);
      button.disabled=!ready||!heard||playing||finished||readOnly||solution;
      button.classList.toggle('is-next',i===taps&&heard&&!finished&&!solution);
      button.classList.toggle('is-stepped',i<taps||solution);
      button.setAttribute('aria-label',`第 ${i+1} 步：${rounds[round].groups[i]}${i<taps?'，已踏過':''}`);
    }
    q('.farewell-complete-note').hidden=!(finished||solution);
    picture.setAttribute('aria-busy',String(!ready));
  }
  function flourish(index){
    if(reducedMotion||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const ripple=document.createElement('i');ripple.className='farewell-ripple';ripple.setAttribute('aria-hidden','true');ripple.style.left=`${61+index*7}%`;ripple.style.top=`${73+index*4}%`;picture.append(ripple);later(()=>ripple.remove(),1200);
    const petal=document.createElement('i');petal.className='farewell-petal';petal.setAttribute('aria-hidden','true');petal.style.left=`${15+index*8}%`;petal.style.top=`${18+index*6}%`;picture.append(petal);later(()=>petal.remove(),1900);
  }
  function step(index,keyboard=false){
    if(dead||!ready||readOnly||solution||finished||playing)return;
    if(!heard){tell('先聽一聽這句詩，再點亮着的腳印。');return;}
    if(index!==taps){tell(index<taps?'這一步踏過啦，試試下一枚亮着的腳印。':'沿着亮着的腳印，一步一步來。');return;}
    taps++;flourish(index);finished=round===2&&taps===3;update();save();
    tell(taps===3?rounds[round].done:`${rounds[round].groups[index]}——再踏下一步。`);
    if(keyboard){if(taps<3)q(`[data-farewell-foot="${taps}"]`).focus({preventScroll:true});else if(round<2)q('[data-farewell-next]').focus({preventScroll:true});}
    if(finished)onComplete?.({correct:true,response:state(),knowledge:'踏歌是踏着節拍唱歌。汪倫在岸上踏歌，為李白送行。'});
  }
  async function listen(){
    if(dead||!ready||playing||solution)return;
    const generation=++voiceGeneration;playing=true;update();tell('聽一聽，再跟着句子輕輕讀。');
    let ok=false,timeout;
    try{ok=typeof playAudio==='function'&&(await Promise.race([playAudio({text:rounds[round].text}),new Promise(resolve=>{timeout=setTimeout(()=>resolve(false),20000);timers.add(timeout);})]))===true;}catch{}
    finally{clearTimeout(timeout);timers.delete(timeout);}
    if(dead||generation!==voiceGeneration)return;
    playing=false;
    if(!readOnly&&!finished){heard=true;save();}
    update();
    tell(ok?(finished?rounds[round].done:taps===3?rounds[round].done:'跟着這句輕輕讀，再點亮着的腳印。'):'聲音暫時沒來。可以再聽，也可以照着文字讀，繼續踏歌。');
  }
  function next(){
    if(dead||readOnly||solution||playing||taps!==3||round>=2)return;
    round++;taps=0;heard=false;finished=false;update();save();tell(rounds[round].note);q('[data-farewell-listen]').focus({preventScroll:true});
  }
  function click(event){
    const target=event.target;
    if(target.closest('[data-farewell-retry]')){load();return;}
    if(target.closest('[data-farewell-listen]')){listen();return;}
    if(target.closest('[data-farewell-next]')){next();return;}
    const foot=target.closest('[data-farewell-foot]');if(foot)step(Number(foot.dataset.farewellFoot),event.detail===0);
  }
  function key(event){
    if(event.target!==picture||![' ','Enter'].includes(event.key)||event.repeat)return;
    event.preventDefault();step(taps,true);
  }
  function load(){
    if(dead)return;const generation=++imageGeneration;ready=false;update();
    const notice=q('.farewell-loading');notice.hidden=false;notice.querySelector('span').textContent='桃花潭正在展開…';notice.querySelector('button').hidden=true;
    const img=new Image();let timeout;
    const finish=failed=>{clearTimeout(timeout);timers.delete(timeout);img.onload=null;img.onerror=null;if(dead||generation!==imageGeneration)return;if(failed){notice.querySelector('span').textContent='畫卷還沒打開，再試一次吧。';notice.querySelector('button').hidden=false;return;}q('.farewell-scene').src=img.src;ready=true;notice.hidden=true;update();};
    img.onload=()=>finish(false);img.onerror=()=>finish(true);timeout=setTimeout(()=>finish(true),15000);timers.add(timeout);img.src=scene;
  }
  root.addEventListener('click',click,{signal:abort.signal});root.addEventListener('keydown',key,{signal:abort.signal});
  update();tell(finished?rounds[2].done:rounds[round].note);load();
  return{
    showSolution(){if(dead)return;solution=true;voiceGeneration++;playing=false;update();tell('汪倫在岸上踏着節拍唱歌，為坐船離開的李白送行。');},
    destroy(){if(dead)return;dead=true;voiceGeneration++;imageGeneration++;abort.abort();timers.forEach(clearTimeout);timers.clear();root.remove();},
  };
}
