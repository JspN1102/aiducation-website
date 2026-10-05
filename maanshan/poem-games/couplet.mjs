import {createGameImageLoader} from './image-ready.mjs?v=20260922-school11';
import {imageAsset} from '../media-images.mjs?v=20261005-school41';
import {createProcessResearch} from './research.mjs?v=20260920a';
const file = path => new URL(imageAsset(`media/${path}`), import.meta.url).href;
const lines=['兩個黃鸝鳴翠柳','一行白鷺上青天','窗含西嶺千秋雪','門泊東吳萬里船'];
const knowledge='上下兩句詞語一一相對：數量對數量、顏色對顏色、方位對方位，這叫對仗；四句詩寫出近景和遠景。';
// Painted objects in the 1600×900 scenes: centre x, y, width, height (%).
const spots={birds:[34.6,29.5,17,25],beak:[32.6,21.5,7,10],willow:[37,47,36,66],sky:[77,13,38,22],shutter:[14,44,8,74],
  peak:[74.5,40,18,14],range:[75,45,48,22],pier:[91.5,88,16,22],moored:[90.5,67,16,30],sails:[72,64.5,13,8],boat:[76.5,77,25,42]};
// Scene 2 egrets (round 1, one group per pair) and scene 4 pieces (round 2, by pair): centre x, y, mask radius x, y (%).
const egrets=[[63.3,27.8,7,8],[74.3,19.8,6.6,7],[85.3,13.5,6,6],[92.8,8.5,3.4,4]];
const pieces={chuang:[92,90,8.5,13],han:[91,68,10,19],xiling:[72,65,6.5,5.5],qianqiuxue:[76.5,76,13.5,24]};
const pairs=[
  {id:'liangge',up:'兩個',down:'yihang',low:'一行',cat:'數量詞',clue:'數量詞',spot:['birds','egret'],note:'「兩個」對「一行」：都是數量詞——兩隻黃鸝，一行白鷺。'},
  {id:'huangli',up:'黃鸝',down:'bailu',low:'白鷺',cat:'顏色＋鳥',clue:'顏色加鳥兒',spot:['birds','egret'],note:'黃對白是顏色，鸝和鷺都是鳥兒。'},
  {id:'ming',up:'鳴',down:'shang',low:'上',cat:'動作',clue:'鳥兒的動作',spot:['beak','egret'],note:'黃鸝「鳴」叫，白鷺飛「上」青天：都是動作。'},
  {id:'cuiliu',up:'翠柳',down:'qingtian',low:'青天',cat:'顏色＋景物',clue:'顏色加景物',spot:['willow','sky'],note:'翠對青是顏色，柳和天都是景物。'},
  {id:'chuang',up:'窗',down:'men',low:'門',cat:'房屋',clue:'房屋的一部分',spot:['shutter','pier'],note:'窗對門：都是房屋的一部分。門外就是碼頭。'},
  {id:'han',up:'含',down:'bo',low:'泊',cat:'動作',clue:'一個動作',spot:['shutter','peak','moored'],note:'含：窗框像把雪山含在裏面；泊：船停泊在岸邊。'},
  {id:'xiling',up:'西嶺',down:'dongwu',low:'東吳',cat:'方位＋地名',clue:'方位加地名',spot:['range','sails'],note:'西對東是方位；西嶺、東吳都是地方的名字。'},
  {id:'qianqiuxue',up:'千秋雪',down:'wanlichuan',low:'萬里船',cat:'數字＋景物',clue:'數字加景物',spot:['peak','boat'],note:'千對萬是數字。千秋雪：西嶺上終年不化的積雪；萬里船：遠航萬里、往來東吳的船。'}
].map((p,index)=>({...p,index,round:index<4?1:2}));
const byUp=new Map(pairs.map(p=>[p.id,p])),byDown=new Map(pairs.map(p=>[p.down,p]));
const trays=[['bailu','qingtian','yihang','shang'],['dongwu','wanlichuan','men','bo']];
const voice='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m10 5-5 4H2v6h3l5 4ZM14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';

/** 對仗對對碰: pair each word of the upper line with its partner in the lower line. */
export function mountCouplet(holder,{initialState,readOnly=false,playAudio,onState,onComplete,onResearch,reducedMotion=false,onProgress}={}){
  const doc=holder.ownerDocument,view=doc.defaultView,abort=new view.AbortController(),on={signal:abort.signal},timers=new Set();
  const loadImages=createGameImageLoader({signal:abort.signal});
  const saved=initialState&&typeof initialState==='object'&&initialState.version===1&&Array.isArray(initialState.pairs)?[...new Set(initialState.pairs.filter(id=>byUp.has(id)))]:[];
  const opening=saved.filter(id=>byUp.get(id).round===1),matched=new Set(opening.length===4?saved:opening);
  let round=opening.length===4&&(initialState.round===2||matched.size>4)?2:1;
  let dead=false,ready=false,solved=false,sel=null,hinted=null,drag=null,generation=0,loadId=0,suppressUntil=0,audioContext=null,listenNext=0,reciting=-1;
  const misses=new Map(),done=()=>matched.size===8,final=()=>readOnly||solved||done();
  let reported=done();
  const research=createProcessResearch(onResearch,{prefix:'game.couplet',alive:()=>!dead});
  const scene=(n,layer,m)=>`<img class="cp-scene${m?' cp-piece':''}" data-cp-layer="${layer}" src="${file(`jue-ju/scene-${n}.webp`)}" alt="" width="1600" height="900" draggable="false"${m?` style="--mx:${m[0]}%;--my:${m[1]}%;--rx:${m[2]}%;--ry:${m[3]}%"`:''}>`;
  const block=r=>`<div class="cp-block" data-cp-block="${r}" role="group" aria-label="${r===1?'第一、二句':'第三、四句'}"><span class="cp-label cp-label-up" aria-hidden="true">上句</span><span class="cp-label cp-label-down" aria-hidden="true">下句</span>${pairs.filter(p=>p.round===r).map((p,i)=>`<div class="cp-col" data-cp-col="${p.id}" style="--c:${i+2}"><button type="button" class="cp-tile cp-up${p.up.length>2?' is-long':''}" data-cp-up="${p.id}">${p.up}</button><span class="cp-seal">${p.cat.replace('＋','＋<wbr>')}</span><span class="cp-slot${p.low.length>2?' is-long':''}"><b>${p.low}</b></span></div>`).join('')}</div>`;
  const root=doc.createElement('section');root.className='poem-couplet-game is-settling';root.setAttribute('aria-label','對仗對對碰');
  root.innerHTML=`<div class="cp-layout"><div class="cp-head"><p></p><span class="cp-count"></span></div>
    <div class="cp-stage" aria-busy="true"><div class="cp-pic" role="img">${scene(1,'s1')}${egrets.map((m,i)=>scene(2,`e${i}`,m)).join('')}${scene(2,'s2')}${scene(3,'s3')}${Object.entries(pieces).map(([id,m])=>scene(4,`p-${id}`,m)).join('')}${scene(4,'s4')}<div class="cp-glows" aria-hidden="true"></div></div>
      <div class="cp-loading" role="status"><span>畫面正在展開…</span><button type="button" data-cp-retry hidden>再試一次</button></div></div>
    <div class="cp-panel"><div class="cp-board">${block(1)}${block(2)}</div>
      <div class="cp-tray" role="group" aria-label="下句的詞語卡">${trays.flat().map(id=>`<button type="button" class="cp-tile cp-down${byDown.get(id).low.length>2?' is-long':''}" data-cp-down="${id}">${byDown.get(id).low}</button>`).join('')}</div>
      <div class="cp-actions"><button type="button" data-cp-listen>${voice}<span>聽這句詩</span></button><button type="button" class="cp-next" data-cp-next hidden>下兩句 <span aria-hidden="true">→</span></button></div>
      <p class="cp-feedback" role="status" aria-live="polite"></p></div></div>`;
  holder.append(root);
  const q=s=>root.querySelector(s),tell=text=>{if(!dead)q('.cp-feedback').textContent=text;};
  const later=(fn,ms)=>{const id=view.setTimeout(()=>{timers.delete(id);if(!dead)fn();},ms);timers.add(id);return id;};
  const state=()=>({version:1,round,pairs:[...matched]});
  const save=()=>{if(!readOnly&&!solved&&!dead)onState?.(state());};
  const progress=()=>onProgress?.({completed:final()?8:matched.size,total:8});
  const roundDone=()=>pairs.every(p=>p.round!==round||matched.has(p.id));
  const available=()=>!dead&&ready&&!final()&&!roundDone();
  const intro=()=>round===1?'點一個詞，再點它的對子；也可以把詞語卡拖過去。':'從窗口望出去，遠處是積雪的西嶺。替「窗含西嶺千秋雪」每個詞找對子。';
  const roundOne='黃鸝對白鷺，翠柳對青天——上下兩句一一相對，這叫對仗。按「下兩句」繼續。';

  function render(){
    const all=final(),r1=pairs.filter(p=>p.round===1&&matched.has(p.id)).length,n=all?8:matched.size;
    root.classList.toggle('is-final',all);root.classList.toggle('is-readonly',readOnly);root.classList.toggle('is-reduced-motion',reducedMotion);
    q('.cp-head p').textContent=all?'上下兩句，詞語一一相對。':'替上句每個詞找下句的對子。';q('.cp-count').textContent=`${n} / 8`;q('.cp-count').setAttribute('aria-label',`已配對 ${n} 對，共 8 對`);
    for(const p of pairs){
      const has=all||matched.has(p.id),col=q(`[data-cp-col="${p.id}"]`),up=col.querySelector('[data-cp-up]'),low=q(`[data-cp-down="${p.down}"]`),off=!available()||p.round!==round;
      col.classList.toggle('is-matched',has);col.classList.toggle('is-target',sel?.side==='up'&&sel.id===p.id);
      up.disabled=has||off;up.setAttribute('aria-pressed',String(sel?.side==='up'&&sel.id===p.id));up.classList.toggle('is-hinted',hinted==='up:'+p.id);
      up.setAttribute('aria-label',has?`${p.up}，對下句的${p.low}，${p.cat}`:`上句的詞：${p.up}`);
      low.hidden=p.round!==round;low.disabled=has||off;low.classList.toggle('is-used',has);low.setAttribute('aria-pressed',String(sel?.side==='down'&&sel.id===p.down));low.classList.toggle('is-hinted',hinted==='down:'+p.down);
      low.setAttribute('aria-label',has?`${p.low}，已配對`:`下句的詞：${p.low}`);
    }
    root.querySelectorAll('[data-cp-block]').forEach(b=>{b.hidden=!all&&+b.dataset.cpBlock!==round;});
    q('.cp-tray').hidden=all||roundDone();q('[data-cp-next]').hidden=all||round!==1||!roundDone();q('[data-cp-next]').disabled=!ready;
    const layer=(name,show)=>q(`[data-cp-layer="${name}"]`).classList.toggle('is-on',show);
    layer('s1',true);egrets.forEach((_,i)=>layer(`e${i}`,r1>i));layer('s2',all||round===2||r1===4);layer('s3',all||round===2);
    Object.keys(pieces).forEach(id=>layer(`p-${id}`,all||matched.has(id)));layer('s4',all);
    q('.cp-pic').setAttribute('aria-label',all?'窗外柳樹上兩隻黃鸝，一行白鷺飛上青天；窗口望見西嶺的雪山，門外停泊着遠行的船。':round===2?'從窗口望見西邊積雪的山嶺，門外的河上漸漸有船。':r1===4?'柳樹上兩隻黃鸝在唱歌，一行白鷺飛上青天。':'窗外柳樹上，兩隻黃鸝在唱歌。');
    paintReciting();
  }
  function paintReciting(){root.querySelectorAll('[data-cp-block]').forEach(b=>{b.dataset.reciting=reciting>=0&&(reciting>>1)+1===+b.dataset.cpBlock?(reciting%2?'down':'up'):'';});}
  function present(){if(!ready||final())return;pairs.forEach(p=>{if(p.round===round&&!matched.has(p.id))research.present(`pair.${p.id}`,{position:p.index,total:8,optionOrder:trays[round-1]});});}
  function tone(good){
    try{
      audioContext??=new(view.AudioContext||view.webkitAudioContext)();if(audioContext.state==='suspended')void audioContext.resume().catch(()=>{});
      const now=audioContext.currentTime;
      for(const [f,t] of good?[[659,0],[988,.09]]:[[247,0]]){const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type=good?'sine':'triangle';osc.frequency.setValueAtTime(f,now+t);gain.gain.setValueAtTime(.0001,now+t);gain.gain.exponentialRampToValueAtTime(good?.15:.08,now+t+.012);gain.gain.exponentialRampToValueAtTime(.0001,now+t+(good?.34:.22));osc.connect(gain);gain.connect(audioContext.destination);osc.start(now+t);osc.stop(now+t+.38);}
    }catch{}
  }
  function glow(p){
    const box=q('.cp-glows'),r1=pairs.filter(x=>x.round===1&&matched.has(x.id)).length;
    box.replaceChildren(...p.spot.map(name=>{const [x,y,w,h]=name==='egret'?(e=>[e[0],e[1],e[2]*1.7,e[3]*1.7])(egrets[Math.max(0,r1-1)]):spots[name],el=doc.createElement('i');el.className='cp-glow';el.style.cssText=`left:${x}%;top:${y}%;width:${w}%;height:${h}%`;return el;}));
    later(()=>box.replaceChildren(),3200);
  }
  const reveal=(el=q('.cp-feedback'))=>el.scrollIntoView?.({block:'nearest',behavior:reducedMotion?'auto':'smooth'});
  function flash(el,name,ms){el.classList.remove(name);void el.offsetWidth;el.classList.add(name);later(()=>el.classList.remove(name),ms);}
  const tiles=side=>[...root.querySelectorAll(side==='up'?`[data-cp-block="${round}"] [data-cp-up]`:'[data-cp-down]')].filter(b=>!b.disabled&&!b.hidden);

  function pick(side,id,keyboard){
    if(!available())return;
    const p=side==='up'?byUp.get(id):byDown.get(id);if(!p||matched.has(p.id)||p.round!==round)return;
    if(sel&&sel.side!==side){attempt(side==='up'?id:sel.id,side==='down'?id:sel.id,sel.side,keyboard);return;}
    if(sel?.id===id){sel=null;hinted=null;render();tell('放下了這個詞，再選一個。');return;}
    sel={side,id};hinted=null;research.action('tile',`${side}:${id}`,'option_selected');render();
    tell(side==='up'?`選了「${p.up}」。下句哪個詞和它相對？`:`選了「${p.low}」。上句哪個詞和它相對？`);
    if(keyboard)tiles(side==='up'?'down':'up')[0]?.focus();
  }
  function attempt(upId,downId,anchor,keyboard){
    const p=byUp.get(upId),partner=byDown.get(downId);
    if(!available()||!p||!partner||matched.has(p.id)||matched.has(partner.id)||p.round!==round||partner.round!==round)return;
    const owner=anchor==='up'?p:partner,step=`pair.${owner.id}`,correct=p.down===downId;
    research.answer(step,`up:${upId}/down:${downId}`,correct);
    if(!correct){
      const key=anchor==='up'?'up:'+upId:'down:'+downId,count=(misses.get(key)||0)+1;misses.set(key,count);research.hint(step,count>1?'highlight':'explanation');
      sel={side:anchor,id:anchor==='up'?upId:downId};hinted=count>1?(anchor==='up'?'down:'+owner.down:'up:'+owner.id):null;tone(false);render();
      flash(anchor==='up'?q(`[data-cp-down="${downId}"]`):q(`[data-cp-up="${upId}"]`),'is-wrong',480);
      tell(`「${anchor==='up'?owner.up:owner.low}」是${owner.clue}，${anchor==='up'?'下':'上'}句哪個詞也是${owner.clue}？${count>1?'看看發亮的那個詞。':''}`);
      return;
    }
    matched.add(p.id);sel=null;hinted=null;tone(true);render();glow(p);flash(q(`[data-cp-col="${p.id}"]`),'is-new',900);save();progress();
    if(done()){tell(knowledge);if(!reported){reported=true;research.complete();onComplete?.({correct:true,response:state(),knowledge});}void recite([2,3],600);if(keyboard)q('[data-cp-listen]').focus();else reveal();}
    else if(roundDone()){tell(roundOne);void recite([0,1],600);if(keyboard)q('[data-cp-next]').focus();else reveal();}
    else{tell(p.note);if(keyboard)(tiles(anchor)[0]||tiles(anchor==='up'?'down':'up')[0])?.focus();}
  }
  async function recite(list,wait=0){
    const token=++generation;let ok;
    if(wait)await new Promise(resolve=>later(resolve,wait));
    for(const i of list){
      if(dead||token!==generation)return;
      reciting=i;paintReciting();let timer;
      try{ok=await Promise.race([Promise.resolve().then(()=>playAudio?.({text:lines[i]})),new Promise(resolve=>{timer=later(()=>resolve(false),15000);})]);}catch{ok=false;}finally{view.clearTimeout(timer);timers.delete(timer);}
      if(dead||token!==generation)return;
      if(ok===false){research.error('audio','audio_unavailable');break;}
    }
    reciting=-1;paintReciting();return ok;
  }
  function listen(){
    if(dead)return;research.hint('game','audio');
    let i=round*2-(roundDone()?1:2);if(final()){i=listenNext;listenNext=(listenNext+1)%4;}
    void recite([i]).then(ok=>{if(ok===false)tell('朗讀暫時未能播放，可以看着詞語卡讀一讀，稍後再試。');});
  }
  function next(keyboard){
    if(dead||!ready||final()||round!==1||!roundDone())return;
    generation++;reciting=-1;round=2;sel=null;hinted=null;research.action('round','round.2');render();save();present();tell(intro());
    if(keyboard)tiles('up')[0]?.focus();else reveal(q('[data-cp-block="2"]'));
  }

  function targetAt(x,y){
    for(const el of doc.elementsFromPoint(x,y)){
      if(drag.tile.contains(el))continue;
      const t=drag.side==='up'?el.closest?.('[data-cp-down]'):el.closest?.('[data-cp-col]');
      if(t&&root.contains(t))return drag.side==='up'?(t.disabled||t.hidden?null:t):(matched.has(t.dataset.cpCol)||byUp.get(t.dataset.cpCol).round!==round?null:t);
    }
    return null;
  }
  function endDrag(){
    const d=drag;drag=null;if(!d)return null;
    d.tile.classList.remove('is-dragging');d.tile.style.removeProperty('transform');d.over?.classList.remove('is-over');root.classList.remove('is-dragging');
    try{d.tile.releasePointerCapture(d.pointer);}catch{}
    if(d.moving)suppressUntil=Date.now()+450;return d;
  }
  function down(event){
    const t=event.target.closest?.('[data-cp-up],[data-cp-down]');
    if(drag||!t||t.disabled||!available()||event.button>0||event.isPrimary===false)return;
    drag={pointer:event.pointerId,tile:t,side:t.dataset.cpUp?'up':'down',x:event.clientX,y:event.clientY,moving:false,over:null};
    try{t.setPointerCapture(event.pointerId);}catch{}
  }
  function move(event){
    if(!drag||event.pointerId!==drag.pointer)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(!drag.moving){if(Math.hypot(dx,dy)<8)return;drag.moving=true;drag.tile.classList.add('is-dragging');root.classList.add('is-dragging');}
    if(event.cancelable)event.preventDefault();
    drag.tile.style.transform=`translate(${dx}px,${dy}px)`;
    const over=targetAt(event.clientX,event.clientY);
    if(over!==drag.over){drag.over?.classList.remove('is-over');over?.classList.add('is-over');drag.over=over;}
  }
  function release(event){
    if(!drag||event.pointerId!==drag.pointer)return;
    const target=drag.moving&&event.type==='pointerup'?targetAt(event.clientX,event.clientY):null,d=endDrag();
    if(!target)return;
    if(d.side==='up')attempt(d.tile.dataset.cpUp,target.dataset.cpDown,'up',false);else attempt(target.dataset.cpCol,d.tile.dataset.cpDown,'down',false);
  }
  async function load(){
    if(loadId)research.retry('assets');
    const request=++loadId,stage=q('.cp-stage'),loading=q('.cp-loading');ready=false;loading.hidden=false;loading.querySelector('span').textContent='畫面正在展開…';q('[data-cp-retry]').hidden=true;stage.setAttribute('aria-busy','true');render();
    const unavailable=()=>{if(dead||request!==loadId)return;research.error('assets');loading.querySelector('span').textContent='圖畫還在載入，可以再試一次。';q('[data-cp-retry]').hidden=false;stage.setAttribute('aria-busy','false');};
    try{
      if(request>1)for(const image of root.querySelectorAll('img')){const url=new URL(image.src);url.searchParams.set('retry',String(request));image.src=url.href;}
      await loadImages(root.querySelectorAll('img'),{onTimeout:unavailable});
      if(dead||request!==loadId)return;ready=true;loading.hidden=true;stage.setAttribute('aria-busy','false');render();present();progress();
      later(()=>root.classList.remove('is-settling'),80);
    }catch{unavailable();}
  }
  root.addEventListener('pointerdown',down,on);
  root.addEventListener('pointermove',move,{signal:abort.signal,passive:false});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(type,release,on);
  for(const type of ['contextmenu','selectstart','dragstart'])root.addEventListener(type,event=>{if(event.target.closest?.('.cp-tile,.cp-stage')&&event.cancelable)event.preventDefault();},on);
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)endDrag();},on);
  view.addEventListener('blur',()=>endDrag(),on);
  root.addEventListener('click',event=>{
    const t=event.target,keyboard=event.detail===0;
    if(t.closest?.('[data-cp-retry]')){void load();return;}
    if(t.closest?.('[data-cp-listen]')){listen();return;}
    if(t.closest?.('[data-cp-next]')){next(keyboard);return;}
    if(!keyboard&&Date.now()<suppressUntil)return;
    const up=t.closest?.('[data-cp-up]'),low=t.closest?.('[data-cp-down]'),col=t.closest?.('[data-cp-col]');
    if(up)pick('up',up.dataset.cpUp,keyboard);else if(low)pick('down',low.dataset.cpDown,keyboard);else if(col)pick('up',col.dataset.cpCol,false);
  },on);
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&sel&&available()){event.preventDefault();sel=null;hinted=null;render();tell('已取消選擇。');return;}
    const t=event.target.closest?.('[data-cp-up],[data-cp-down]'),side=t?.dataset.cpUp?'up':'down';
    if(!t)return;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){const list=tiles(side),i=list.indexOf(t);if(!list.length)return;event.preventDefault();list[(i+(event.key==='ArrowRight'?1:-1)+list.length)%list.length].focus();}
    else if((event.key==='ArrowDown'&&side==='up')||(event.key==='ArrowUp'&&side==='down')){const list=tiles(side==='up'?'down':'up');if(list.length){event.preventDefault();list[0].focus();}}
  },on);
  render();tell(final()?knowledge:roundDone()?roundOne:intro());void load();
  return {
    showSolution(){if(dead||final())return;endDrag();research.hint('game','reveal');generation++;reciting=-1;solved=true;reported=true;sel=null;hinted=null;render();tell(knowledge);},
    reset(){if(dead||readOnly)return;endDrag();generation++;reciting=-1;research.reset();matched.clear();misses.clear();round=1;sel=null;hinted=null;solved=false;reported=false;listenNext=0;q('.cp-glows').replaceChildren();render();present();tell(intro());save();progress();},
    destroy(){if(dead)return;endDrag();dead=true;generation++;loadId++;abort.abort();timers.forEach(id=>view.clearTimeout(id));timers.clear();try{void audioContext?.close().catch(()=>{});}catch{}root.remove();}
  };
}
