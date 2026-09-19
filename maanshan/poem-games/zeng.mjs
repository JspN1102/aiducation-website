import {createProcessResearch} from './research.mjs?v=20260920a';
const asset=name=>new URL(`../media/poem-games/farewell/${name}`,import.meta.url).href;
const chapters=[
 {title:'幫小舟準備出發',verse:'李白乘舟將欲行',action:'把小舟划到亮着的水面。想聽詩句，也可以按「聽這句」。'},
 {title:'我也來踏歌',verse:'忽聞岸上踏歌聲',action:'左、右、左、右，踏四步。快慢都由你！'},
 {title:'把友情送給你',verse:'不及汪倫送我情',action:'依次點「汪倫」「送我」「情」，把友情送上船。'}
];
const rhythm=[0,1,0,1],pieces=['汪倫','送我','情'];
const voice='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m10 5-5 4H2v6h3l5 4ZM14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';

/** Listening story; three different untimed interactions. Complete old drafts
 * migrate to a finished illustration without awarding another result. */
export function mountFarewell(holder,{initialState,readOnly=false,playAudio,onState,onComplete,onResearch,reducedMotion=false}={}){
 const doc=holder.ownerDocument,view=doc.defaultView,abort=new view.AbortController(),timers=new Set();
 const modern=initialState?.version===2,legacyDone=initialState?.gameCompleted===true||(!modern&&initialState?.completed===true&&initialState?.round===2&&initialState?.taps===3);
 const count=(v,max)=>Number.isInteger(v)?Math.max(0,Math.min(max,v)):0;
 let stage=legacyDone?2:modern?count(initialState.stage,2):0,placed=legacyDone||modern&&initialState.placed===true;
 let beats=legacyDone?4:modern?count(initialState.beats,4):0,arranged=legacyDone?3:modern?count(initialState.arranged,3):0;
 let heard=modern&&Array.isArray(initialState.heard)?initialState.heard.slice(0,3).map(v=>v===true):[false,false,false];
 let done=legacyDone||modern&&initialState.completed===true&&placed&&beats===4&&arranged===3;
 let reported=done,dead=false,ready=false,solved=false,busy=false,selected=false,drag=null,generation=0,loadGeneration=0,audioContext=null;
 const research=createProcessResearch(onResearch,{prefix:'game.farewell',alive:()=>!dead});
 const currentStep=()=>stage===0?'boat':stage===1?`beat.${Math.min(beats,3)}`:`ticket.${Math.min(arranged,2)}`;
 function presentStep(){if(!ready||readOnly||done||solved||passed())return;research.present(currentStep(),{position:stage===0?0:stage===1?1+beats:5+arranged,total:8,...(stage===1?{optionOrder:['left','right']}:stage===2?{optionOrder:['ticket.2','ticket.0','ticket.1']}:{})});}
 const root=doc.createElement('section');root.className='poem-farewell-game farewell-story';root.setAttribute('aria-label','送別小劇場');
 root.innerHTML=`<header class="fs-header"><div><span class="fs-eyebrow">送別小劇場</span><h3></h3></div><span class="fs-progress"></span></header>
 <div class="fs-stage" aria-busy="true"><img class="fs-scene" src="${asset('shore-20260919.webp')}" width="1536" height="1024" alt="桃花潭的岸邊，汪倫站在桃花樹下揮手送別。" draggable="false"><div class="fs-waterlight" aria-hidden="true"></div><button type="button" class="fs-dock" data-fs-dock aria-label="把小舟划到這片水面"><span>到這裏</span></button><button type="button" class="fs-boat" data-fs-boat aria-label="李白的小舟，拖到亮着的水面，也可點選後點目的地"><img src="${asset('libai-boat-20260919.webp')}" alt="李白乘着小舟" draggable="false"></button><span class="fs-friend" aria-hidden="true">汪倫</span><div class="fs-note" hidden>歌聲送到了<br><span>情意留在心裏</span></div><div class="fs-loading" role="status"><span>桃花潭正在展開…</span><button type="button" data-fs-retry hidden>再試一次</button></div></div>
 <p class="fs-verse"></p><p class="fs-task"></p><div class="fs-rhythm" hidden><div class="fs-beats" aria-label="四個腳步">${rhythm.map((_,i)=>`<i data-fs-beat="${i}" aria-hidden="true"></i>`).join('')}</div><div class="fs-feet"><button type="button" data-fs-foot="0"><span aria-hidden="true">‹</span>左腳</button><button type="button" data-fs-foot="1">右腳<span aria-hidden="true">›</span></button></div></div>
 <div class="fs-compose" hidden><div class="fs-line"><b>不及</b>${pieces.map((_,i)=>`<span class="fs-slot" data-fs-slot="${i}">${i+1}</span>`).join('')}</div><div class="fs-tickets">${[2,0,1].map(i=>`<button type="button" data-fs-ticket="${i}">${pieces[i]}</button>`).join('')}</div></div>
 <div class="fs-actions"><button type="button" data-fs-listen>${voice}<span>聽這句</span></button><button type="button" class="fs-next" data-fs-next hidden>下一步 <span aria-hidden="true">→</span></button></div><p class="fs-feedback" role="status" aria-live="polite"></p>`;
 holder.append(root);const q=s=>root.querySelector(s),tell=t=>{if(!dead)q('.fs-feedback').textContent=t;};
 const delay=(fn,ms)=>{const id=view.setTimeout(()=>{timers.delete(id);if(!dead)fn();},ms);timers.add(id);return id;};
 const state=()=>({version:2,stage,placed,beats,arranged,heard:[...heard],completed:done});
 const save=()=>{if(!readOnly&&!solved&&!dead)onState?.(state());};
 const passed=()=>stage===0?placed:stage===1?beats===4:arranged===3;
 const available=()=>!dead&&ready&&!readOnly&&!solved&&!done;
 function update(){
  presentStep();
  root.dataset.stage=String(stage);root.dataset.placed=String(placed||solved);root.dataset.complete=String(done||solved);root.dataset.selected=String(selected);
  q('h3').textContent=done||solved?'一起送出一份友情':chapters[stage].title;q('.fs-progress').textContent=`${stage+1} / 3`;
  q('.fs-verse').textContent=chapters[stage].verse;q('.fs-task').textContent=done||solved?'汪倫踏歌送別，李白把友情寫進詩裏。':chapters[stage].action;
  q('.fs-rhythm').hidden=stage!==1||done||solved;q('.fs-compose').hidden=stage!==2||done||solved;
  q('[data-fs-dock]').hidden=stage!==0||placed||solved;q('[data-fs-boat]').disabled=!available()||stage!==0||placed;q('[data-fs-dock]').disabled=!available();q('.fs-note').hidden=!(done||solved);
  const listen=q('[data-fs-listen]');listen.disabled=!ready||busy||solved;listen.setAttribute('aria-busy',String(busy));listen.querySelector('span').textContent=busy?'仔細聽…':stage===1&&heard[1]?'再聽腳步':'聽這句';
  q('[data-fs-next]').hidden=!(passed()&&stage<2&&!readOnly&&!solved);q('[data-fs-next]').disabled=!available();
  root.querySelectorAll('[data-fs-foot]').forEach(el=>{el.disabled=!available()||beats===4;});root.querySelectorAll('[data-fs-beat]').forEach((el,i)=>el.classList.toggle('is-done',i<beats));
  root.querySelectorAll('[data-fs-ticket]').forEach(el=>{const i=+el.dataset.fsTicket;el.disabled=!available()||i<arranged;el.classList.toggle('is-used',i<arranged);});root.querySelectorAll('[data-fs-slot]').forEach((el,i)=>{el.textContent=i<arranged?pieces[i]:String(i+1);el.classList.toggle('is-filled',i<arranged);el.classList.toggle('is-next',i===arranged);});
 }
 function complete(){if(done||solved||readOnly||!placed||beats!==4||arranged!==3)return;generation++;busy=false;done=true;update();save();tell('謝謝你的歌聲！朋友的情意，比深深的潭水還深。');if(!reported){reported=true;research.complete();onComplete?.({correct:true,response:state(),knowledge:'李白乘舟，汪倫在岸上踏歌送別。「不及」是比不上，寫出朋友的深情。'});}}
 function boatArrive(){if(!available()||stage!==0||placed)return;research.answer('boat','water',true);placed=true;selected=false;update();save();tell('乘舟，就是坐船。小舟準備好了，一起到岸上踏歌吧。');}
 function sound(side){try{audioContext??=new(view.AudioContext||view.webkitAudioContext)();if(audioContext.state==='suspended')void audioContext.resume().catch(()=>{});const osc=audioContext.createOscillator(),gain=audioContext.createGain(),now=audioContext.currentTime;osc.type='sine';osc.frequency.setValueAtTime(side?260:170,now);osc.frequency.exponentialRampToValueAtTime(side?130:75,now+.11);gain.gain.setValueAtTime(.001,now);gain.gain.exponentialRampToValueAtTime(.2,now+.008);gain.gain.exponentialRampToValueAtTime(.001,now+.18);osc.connect(gain);gain.connect(audioContext.destination);osc.start(now);osc.stop(now+.2);}catch{}}
 function glow(side){const foot=q(`[data-fs-foot="${side}"]`);foot.classList.add('is-sounding');delay(()=>foot.classList.remove('is-sounding'),360);sound(side);}
 function demonstrate(token){return new Promise(resolve=>{let n=0;const next=()=>{if(dead||token!==generation){resolve();return;}if(n===rhythm.length){delay(resolve,450);return;}glow(rhythm[n++]);delay(next,640);};next();});}
 async function listen(){
  if(dead||!ready||busy||solved)return;const token=++generation;busy=true;update();tell(stage===1?'先聽詩句，再記住四個腳步。不用趕時間。':'仔細聽，也可以跟着讀一句。');
  const audioStep=currentStep();research.hint(audioStep,'audio');
  let ok=false,timer;try{ok=await Promise.race([Promise.resolve(playAudio?.({text:chapters[stage].verse})),new Promise(resolve=>{timer=delay(()=>resolve(false),15000);})]);}catch{}finally{view.clearTimeout(timer);timers.delete(timer);}
  if(dead||token!==generation)return;if(ok===false||ok===undefined)research.error(audioStep,'audio_unavailable');if(stage===1&&!done&&!readOnly){research.hint(audioStep,'demo');await demonstrate(token);if(dead||token!==generation)return;}
  busy=false;if(!readOnly&&!done){heard[stage]=true;save();}update();tell(ok===false||ok===undefined?'朗讀暫時未能播放，可以看詩句繼續，再按一次重聽。':stage===1?'輪到你：照剛才的次序按腳步，快慢都可以。':stage===0?'拖動小舟；也可以點小舟，再點亮着的水面。':'找出「汪倫」「送我」「情」，按聽到的次序送上船。');
 }
 function tapFoot(side){if(!available()||stage!==1||beats===4)return;glow(side);research.answer(currentStep(),side?'right':'left',side===rhythm[beats]);if(side!==rhythm[beats]){research.hint(currentStep());tell(`這一步是${rhythm[beats]?'右':'左'}腳，試一試。之前的腳步都保留着。`);return;}beats++;update();save();tell(beats===4?'踏着節拍唱歌，就是踏歌！現在把友情送上小舟。':`第 ${beats} 步踏好了，接着聽心裏的節拍。`);}
 function ticket(index){if(!available()||stage!==2||index<arranged)return;research.answer(currentStep(),`ticket.${index}`,index===arranged);if(index!==arranged){research.hint(currentStep());tell(`下一張是「${pieces[arranged]}」。慢慢來就好。`);return;}arranged++;update();save();if(arranged===3)complete();else tell(`「${pieces[index]}」送到了，再接下一張。`);}
 function next(){if(!available()||!passed()||stage===2)return;generation++;busy=false;stage++;selected=false;update();save();tell(chapters[stage].action);q('[data-fs-listen]').focus({preventScroll:true});}
 const boat=q('[data-fs-boat]'),canvas=q('.fs-stage');
 boat.addEventListener('pointerdown',e=>{if(!available()||stage!==0||placed)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};boat.setPointerCapture(e.pointerId);},{signal:abort.signal});
 boat.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const r=canvas.getBoundingClientRect(),x=Math.max(33,Math.min(84,(e.clientX-r.left)/r.width*100)),y=Math.max(43,Math.min(88,(e.clientY-r.top)/r.height*100));drag.moved ||= Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5;boat.style.setProperty('--boat-x',x+'%');boat.style.setProperty('--boat-y',y+'%');},{signal:abort.signal});
 boat.addEventListener('pointerup',e=>{if(!drag||drag.id!==e.pointerId)return;const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*100,y=(e.clientY-r.top)/r.height*100,moved=drag.moved;drag=null;boat.style.removeProperty('--boat-x');boat.style.removeProperty('--boat-y');if(moved&&x>40&&x<88&&y>43&&y<76)boatArrive();else if(moved){research.answer('boat','outside-water',false);research.hint('boat');tell('小舟要在水面上，划向發亮的位置吧。');}},{signal:abort.signal});
 boat.addEventListener('pointercancel',()=>{drag=null;boat.style.removeProperty('--boat-x');boat.style.removeProperty('--boat-y');},{signal:abort.signal});
 root.addEventListener('click',e=>{const t=e.target;if(t.closest('[data-fs-listen]'))void listen();if(t.closest('[data-fs-next]'))next();if(t.closest('[data-fs-dock]'))boatArrive();if(t.closest('[data-fs-boat]')&&available()){selected=true;update();tell('再點亮着的水面，小舟就會過去。');}const foot=t.closest('[data-fs-foot]');if(foot)tapFoot(+foot.dataset.fsFoot);const tile=t.closest('[data-fs-ticket]');if(tile)ticket(+tile.dataset.fsTicket);if(t.closest('[data-fs-retry]'))void load();},{signal:abort.signal});
 async function load(){if(loadGeneration)research.retry('assets');const token=++loadGeneration;ready=false;update();const loading=q('.fs-loading');loading.hidden=false;q('[data-fs-retry]').hidden=true;let timeout;try{if(token>1)root.querySelectorAll('img').forEach(img=>{const u=new URL(img.src);u.searchParams.set('retry',String(token));img.src=u.href;});await Promise.race([Promise.all([...root.querySelectorAll('img')].map(img=>img.decode())),new Promise((_,reject)=>{timeout=delay(()=>reject(new Error('timeout')),12000);})]);if(dead||token!==loadGeneration)return;ready=true;loading.hidden=true;canvas.setAttribute('aria-busy','false');update();}catch{if(dead||token!==loadGeneration)return;research.error('assets');loading.querySelector('span').textContent='畫面未能載入，再試一次吧。';q('[data-fs-retry]').hidden=false;}finally{view.clearTimeout(timeout);timers.delete(timeout);}}
 if(reducedMotion)root.classList.add('is-reduced-motion');update();tell(done?'這份友情已經送到了。':'');void load();
 return {showSolution(){if(dead||solved)return;research.hint('game','reveal');generation++;busy=false;solved=true;stage=2;update();tell('李白乘舟將欲行；汪倫在岸上踏歌送別。李白說：「不及汪倫送我情。」');},destroy(){if(dead)return;dead=true;generation++;loadGeneration++;abort.abort();timers.forEach(id=>view.clearTimeout(id));timers.clear();try{void audioContext?.close().catch(()=>{});}catch{}root.remove();}};
}
