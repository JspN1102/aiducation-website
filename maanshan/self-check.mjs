// 輕量自查 (school69): every few recorded lines, while the line is being scored,
// the pupil taps the characters they think they read badly. Nothing is scored,
// right or wrong is never shown, and teachers do not see it. Whatever the pupil
// chooses, Shishi gives the same small painting of the line; nothing is kept or
// collected, so there is nothing to read more lines for. 跳過 just closes, with no painting.
const CHECK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const SMILE='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1.8 2 5.2 2 7 0"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="3"/></svg>';
const SPEAKER='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>';
const RING='<svg class="self-check-ring" viewBox="0 0 116 112" aria-hidden="true"><path d="M60 8C28 6 8 28 9 56s22 48 52 47 46-22 45-50S86 6 52 10"/></svg>';
export const SELF_CHECK_TITLE='你覺得你哪個字讀得不好？點一點。';
export const SELF_CHECK_NOTE='沒讀出來的字也可以點。這個不計分，點錯了再點一下就能取消。可以多選。';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const HAN=/\p{Script=Han}/u;

// chars: the line's Han characters in order, each {char, pinyin}; clauses keeps
// the line's own punctuation breaks so a long line wraps where it pauses.
export function selfCheckClauses(text,pinyin=[]){
  const clauses=[];let current=[],index=0;
  for(const char of Array.from(String(text||''))){
    if(HAN.test(char)){current.push({index,char,pinyin:pinyin[index]||''});index++;}
    else if(current.length){clauses.push(current);current=[];}
  }
  if(current.length)clauses.push(current);
  return clauses;
}

export function openSelfCheck({clauses,picture,caption,stillURL,waveURL,speak=()=>{},onAnswer=()=>{},onClose=()=>{},
  enableAfter=1500,now=()=>performance.now()}){
  const dialog=document.createElement('dialog');
  dialog.className='self-check';dialog.setAttribute('aria-labelledby','self-check-title');
  const count=clauses.reduce((n,clause)=>n+clause.length,0);
  const tapped=new Set(),opened=now(),timers=[];
  let stage='ask',changes=0,ready=false,scoreOutcome=null,closed=false;
  // The painting loads while the pupil is still choosing.
  if(picture){const preload=new Image();preload.decoding='async';preload.src=picture;}
  dialog.innerHTML='<section class="self-check-sheet"><div class="self-check-top"><div class="self-check-shishi"><img src="'+esc(stillURL)+'" alt=""></div>'+
    '<div class="self-check-bubble"><h2 id="self-check-title">'+esc(SELF_CHECK_TITLE)+'<button class="self-check-speak" type="button" data-self-check="speak">'+SPEAKER+'聽詩詩說</button></h2><p>'+esc(SELF_CHECK_NOTE)+'</p></div></div>'+
    '<div class="self-check-tiles" data-size="'+(count>7?'small':'large')+'">'+clauses.map(clause=>'<div class="self-check-clause">'+clause.map(({index,char,pinyin})=>
      '<button class="self-check-tile" type="button" data-self-check="tile" data-index="'+index+'" aria-pressed="false" aria-label="'+esc(char)+'"><span class="self-check-pinyin">'+esc(pinyin)+'</span><span class="self-check-box"><b>'+esc(char)+'</b>'+RING+'</span></button>').join('')+'</div>').join('')+'</div>'+
    '<div class="self-check-actions"><button class="self-check-button done" type="button" data-self-check="done" disabled>'+CHECK+'<span>點好了</span></button><button class="self-check-button good" type="button" data-self-check="good" disabled>'+SMILE+'<span>全部都讀得好</span></button></div>'+
    '<button class="self-check-skip" type="button" data-self-check="skip" disabled>跳過</button></section>';
  const $=selector=>dialog.querySelector(selector);
  function updateDone(){
    const done=$('[data-self-check="done"]');if(!done)return;
    done.querySelector('span').textContent=tapped.size?'點好了（'+tapped.size+' 個）':'點好了';
    done.disabled=!ready||!tapped.size;
  }
  function answer(choice){
    if(stage!=='ask')return;stage=choice==='skipped'?'closed':'reward';
    try{onAnswer({choice,tapped:choice==='skipped'?[]:[...tapped].sort((a,b)=>a-b),elapsedMs:Math.round(now()-opened),selectionChanges:changes});}catch{}
    if(choice==='skipped')close();else showReward();
  }
  function rewardFooter(){
    if(scoreOutcome==='ok')return '<button class="self-check-button done" type="button" data-self-check="close">'+CHECK+'<span>看看這句成果</span></button>';
    if(scoreOutcome)return '<button class="self-check-button done" type="button" data-self-check="close"><span>返回</span></button>';
    return '<p class="self-check-listen" role="status"><span class="self-check-dots" aria-hidden="true"><i></i><i></i><i></i></span>詩詩正在聽你的朗讀……</p>';
  }
  function showReward(){
    speak(null);
    $('.self-check-sheet').innerHTML='<div class="self-check-reward"><div class="self-check-top"><div class="self-check-shishi"><img src="'+esc(waveURL)+'" alt=""></div>'+
      '<div class="self-check-bubble"><h2 id="self-check-title">謝謝你認真想一想！</h2><p>詩詩送你一張小畫。</p></div></div>'+
      (picture?'<figure class="self-check-picture"><img src="'+esc(picture)+'" alt="'+esc(caption)+'的小畫" width="768" height="768"><figcaption>'+esc(caption)+'</figcaption></figure>':'')+
      '<div class="self-check-footer">'+rewardFooter()+'</div></div>';
    const img=$('.self-check-picture img');if(img)img.onerror=()=>img.closest('figure')?.remove();
    // A score that never settles still lets the pupil leave.
    timers.push(setTimeout(()=>{if(!scoreOutcome)scoreReady('late');},25000));
    $('.self-check-footer button')?.focus({preventScroll:true});
  }
  function scoreReady(outcome='ok'){
    if(scoreOutcome||closed)return;scoreOutcome=outcome;
    if(stage!=='reward')return;
    const footer=$('.self-check-footer');if(footer){footer.innerHTML=rewardFooter();footer.querySelector('button')?.focus({preventScroll:true});}
  }
  function close(){
    if(closed)return;closed=true;timers.forEach(clearTimeout);speak(null);
    if(stage==='ask'){stage='closed';try{onAnswer({choice:'skipped',tapped:[],elapsedMs:Math.round(now()-opened),selectionChanges:changes});}catch{}}
    try{dialog.close();}catch{}dialog.remove();
    try{onClose();}catch{}
  }
  dialog.addEventListener('click',event=>{
    const target=event.target.closest('[data-self-check]');if(!target||closed)return;
    const action=target.dataset.selfCheck;
    if(action==='speak'){speak(SELF_CHECK_TITLE+SELF_CHECK_NOTE,target);return;}
    if(action==='tile'&&stage==='ask'){
      const index=Number(target.dataset.index);changes++;
      if(tapped.has(index))tapped.delete(index);else tapped.add(index);
      target.classList.toggle('on',tapped.has(index));target.setAttribute('aria-pressed',String(tapped.has(index)));updateDone();return;
    }
    if(action==='done'&&tapped.size)answer('tapped');
    else if(action==='good')answer('none');
    else if(action==='skip'&&ready)answer('skipped');
    else if(action==='close')close();
  });
  // Escape works like 跳過 once the buttons work, and closes the painting once the score is in.
  dialog.addEventListener('cancel',event=>{
    event.preventDefault();
    if(stage==='ask'&&ready)answer('skipped');else if(stage==='reward'&&scoreOutcome)close();
  });
  timers.push(setTimeout(()=>{ready=true;for(const name of ['good','skip']){const button=$('[data-self-check="'+name+'"]');if(button)button.disabled=false;}updateDone();},enableAfter));
  document.body.append(dialog);
  try{dialog.showModal();}catch{dialog.setAttribute('open','');}
  return {scoreReady,close,get stage(){return stage;}};
}
